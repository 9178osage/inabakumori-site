const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = file => fs.readFileSync(file, "utf8");
const decode = value => value.replace(/&(amp|lt|gt|quot|#39);/gu, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]);
const attributes = tag => Object.fromEntries([...tag.matchAll(/([^\s=]+)="([^"]*)"/gu)].map(([, name, value]) => [name, decode(value)]));

// Only the controls and metadata are needed: no search form or calendar sheet is
// mounted, so this runs the real page initialization without a second full DOM.
function page(source, html) {
  let writes = 0, blockedStorage = false;
  const node = (attrs = {}) => ({
    attributes: attrs, dataset: {}, listeners: {},
    get content() { return this.attributes.content; },
    set content(value) { this.attributes.content = value; writes++; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = value; writes++; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, handler) { this.listeners[name] = handler; }
  });
  const root = node(attributes(html.match(/<html\b[^>]*>/u)[0]));
  const metadata = new Map([...html.matchAll(/<meta\b[^>]*>/gu)].map(([tag]) => {
    const attrs = attributes(tag);
    return [attrs.property ? `meta[property="${attrs.property}"]` : `meta[name="${attrs.name}"]`, node(attrs)];
  }));
  const prefix = source.includes("calendar") ? "calendar" : "archive";
  const languageButton = node(), themeButton = node(), controls = node();
  const buttons = { [`${prefix}-lang-btn`]: languageButton, [`${prefix}-theme-btn`]: themeButton };
  const document = {
    readyState: "complete", documentElement: root,
    title: decode(html.match(/<title>([^<]*)<\/title>/u)[1]),
    querySelector: selector => metadata.get(selector) || (selector === ".page-controls" ? controls : null),
    querySelectorAll: selector => selector === 'meta[name="theme-color"]' ? [metadata.get(selector)].filter(Boolean) : [],
    getElementById: id => buttons[id] || null,
    addEventListener() {}
  };
  const saved = new Map([["language", "zh"], ["theme", "light"]]);
  const localStorage = {}, sessionStorage = {}, events = {};
  const window = {
    siteStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    matchMedia: () => ({ matches: true }),
    addEventListener(name, handler) { events[name] = handler; },
    setTimeout: () => 1, clearTimeout() {}
  };
  Object.defineProperty(window, "localStorage", { get() { if (blockedStorage) throw new Error("Storage denied"); return localStorage; } });
  vm.runInNewContext(read(source), { window, document, Intl, Date, Math, Number, String });
  return { root, document, metadata, saved, events, localStorage, sessionStorage, languageButton,
    writes: () => writes, blockStorage: () => { blockedStorage = true; } };
}

const generatedPages = (async () => {
  const { renderArchivePages } = await import("../render-archive-pages.mjs");
  const context = vm.createContext({});
  vm.runInContext(read("js/songs.js"), context);
  const songs = JSON.parse(JSON.stringify(vm.runInContext("SONGS.slice(0, 1)", context)));
  const { files } = renderArchivePages({ songs, xPosts: { version: 1, items: [] }, xTranslations: new Map(),
    xPostsRenderer: { posts: () => [], renderPost: () => "" }, songDetailsSource: { version: 1, songs: {} }, updatesHtml: read("updates.html") });
  return [...files].filter(([name]) => name.endsWith(".html"));
})();

test("generated song index and song detail metadata follows actual language-button clicks", async () => {
  const pages = await generatedPages;
  assert.equal(pages.length, 2);
  for (const [name, html] of pages) {
    const app = page("js/archive-pages.js", html);
    for (const [index, language] of ["zh", "en", "ja", "zh"].entries()) {
      if (index) app.languageButton.listeners.click();
      const title = app.root.attributes[`data-title-${language}`];
      const description = app.root.attributes[`data-description-${language}`];
      assert.ok(title && description, `${name} has generated ${language} metadata`);
      assert.equal(app.root.lang, { zh: "zh-CN", en: "en", ja: "ja" }[language]);
      assert.equal(app.document.title, title);
      assert.equal(app.metadata.get('meta[name="description"]').content, description);
      assert.equal(app.metadata.get('meta[property="og:title"]').content, title);
      assert.equal(app.metadata.get('meta[property="og:description"]').content, description);
    }
  }
});

for (const source of ["js/archive-pages.js", "js/calendar.js"]) {
  test(`${source}: only localStorage events update language/theme, including clear`, async () => {
    const html = source.includes("calendar") ? read("calendar.html") : (await generatedPages)[0][1];
    const app = page(source, html);
    app.saved.set("language", "en");
    app.events.storage({ key: "language", storageArea: app.localStorage });
    assert.equal(app.root.lang, "en");
    app.saved.set("theme", "dark");
    app.events.storage({ key: "theme", storageArea: app.localStorage });
    assert.equal(app.root.dataset.theme, "dark");

    app.saved.set("language", "ja");
    app.saved.set("theme", "light");
    const before = app.writes();
    for (const storageArea of [app.sessionStorage, null, undefined]) {
      for (const key of ["language", "theme", null]) app.events.storage({ key, storageArea });
    }
    assert.equal(app.root.lang, "en");
    assert.equal(app.root.dataset.theme, "dark");
    assert.equal(app.writes(), before, "unrelated events do not rerender metadata");
    app.events.storage({ key: "language", storageArea: app.localStorage });
    assert.equal(app.root.lang, "ja");
    assert.equal(app.root.dataset.theme, "light");
    app.saved.clear();
    app.events.storage({ key: null, storageArea: app.localStorage });
    assert.equal(app.root.lang, "zh-CN");
    assert.equal(app.root.dataset.theme, "dark", "clear restores the system theme");
  });

  test(`${source}: a blocked localStorage getter cannot break storage-event handling`, async () => {
    const html = source.includes("calendar") ? read("calendar.html") : (await generatedPages)[0][1];
    const app = page(source, html);
    app.saved.set("language", "en");
    app.saved.set("theme", "dark");
    app.blockStorage();
    const before = app.writes();
    for (const key of ["language", "theme", null]) {
      assert.doesNotThrow(() => app.events.storage({ key, storageArea: app.localStorage }));
    }
    assert.equal(app.root.lang, "zh-CN");
    assert.equal(app.root.dataset.theme, "light");
    assert.equal(app.writes(), before);
  });
}
