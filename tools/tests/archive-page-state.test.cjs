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

test("song index lists every song once with its Japan public year and album, retaining unknown dates", async () => {
  const { renderArchivePages } = await import("../render-archive-pages.mjs");
  const songs = [
    { title: "Known", youtube: "https://youtu.be/AAAAAAAAAAA", album: "SINGLES", singers: [] },
    { title: "Unknown", youtube: "https://youtu.be/BBBBBBBBBBB", album: "SINGLES", singers: [] }
  ];
  const details = { releasedAt: "2020-12-31T16:00:00Z", releaseConfidence: "inferred", vocal: null, credits: [], unverified: [],
    checkedAt: "2020-12-31", sources: [{ label: "Official", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" }] };
  const { files } = renderArchivePages({ songs, xPosts: { version: 1, items: [] }, xTranslations: new Map(),
    xPostsRenderer: { posts: () => [], renderPost: () => "" }, songDetailsSource: { version: 1, songs: { AAAAAAAAAAA: details } }, updatesHtml: read("updates.html") });
  const html = files.get("songs.html");
  assert.match(html, /<li value="1" data-album="singles" data-year="2021"><a href="song-AAAAAAAAAAA\.html"/u);
  assert.match(html, /<li value="2" data-album="singles" data-year="unknown"><a href="song-BBBBBBBBBBB\.html"[^]*?class="song-index-year"[^>]*>年份待确认</u);
  assert.match(html, /data-song-filter="year" data-value="2021" aria-pressed="false">2021<span class="song-filter-count" aria-hidden="true">1<\/span>/u, "the count is visual; the status line announces results");
  assert.match(html, /data-song-filter="year" data-value="unknown" aria-pressed="false"><span[^>]*>年份待确认<\/span>/u);
  assert.match(html, /data-year="2021">[^]*?日期推定/u, "inferred dates stay visibly qualified even without JavaScript");
  assert.match(html, /<div id="song-filters" class="song-filters" hidden>/u, "the filter appears only once the script can run it");
  assert.doesNotMatch(html, /<details|song-index-group/u, "no separate year or album sections remain");
});

// A DOM just large enough for the songs.html filter: list items, filter buttons, status, reset and empty notice.
function songFilterPage(html, search = "") {
  let focused = null;
  const element = (tag, extra = {}) => {
    const attrs = attributes(tag);
    const dataset = Object.fromEntries(Object.entries(attrs).filter(([name]) => name.startsWith("data-"))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()), value]));
    return { attributes: attrs, dataset, hidden: "hidden" in attrs, disabled: false, textContent: "", listeners: {},
      getAttribute(name) { return this.attributes[name] ?? null; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      focus() { focused = this; }, ...extra };
  };
  const items = [...html.matchAll(/<li\b[^>]*data-album[^>]*>/gu)].map(([tag]) => element(tag));
  const buttons = [...html.matchAll(/(<button type="button" data-song-filter[^>]*>)([^]*?)<\/button>/gu)].map(([, tag, inner]) => {
    const count = { textContent: inner.match(/class="song-filter-count"[^>]*>(\d+)</u)[1] };
    return element(tag, { querySelector: selector => selector === ".song-filter-count" ? count : null, count });
  });
  const byId = id => element(html.match(new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`, "u"))[0]);
  const panel = byId("song-filters");
  panel.querySelectorAll = selector => selector === "button[data-song-filter]" ? buttons : [];
  const status = byId("song-filter-status"), reset = byId("song-filter-reset"), empty = byId("song-filter-empty");
  const languageButton = element("<button>");
  const elements = { "song-filters": panel, "song-filter-status": status, "song-filter-reset": reset, "song-filter-empty": empty, "archive-lang-btn": languageButton };
  const root = element(html.match(/<html\b[^>]*>/u)[0]);
  const urls = [];
  const location = { pathname: "/songs.html", search, hash: "#list" };
  const document = {
    readyState: "complete", documentElement: root, title: "",
    getElementById: id => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: selector => selector === ".song-index-list li[data-album][data-year]" ? items
      : selector === "[data-zh][data-en][data-ja]" ? [status, reset, empty].filter(node => node.dataset.zh) : [],
    addEventListener() {}
  };
  const saved = new Map([["language", "zh"]]);
  const window = {
    siteStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    matchMedia: () => ({ matches: false }), addEventListener() {}, location,
    history: { replaceState(_state, _title, url) { urls.push(url); location.search = url.match(/\?[^#]*/u)?.[0] ?? ""; } }
  };
  vm.runInNewContext(read("js/archive-pages.js"), { window, document, Intl, Date });
  const button = (facet, value) => buttons.find(entry => entry.dataset.songFilter === facet && entry.dataset.value === value);
  const visible = () => items.filter(item => !item.hidden);
  return { items, buttons, button, visible, panel, status, reset, empty, urls, languageButton, focused: () => focused };
}

const fullSongIndex = (async () => {
  const { renderArchivePages } = await import("../render-archive-pages.mjs");
  const context = vm.createContext({});
  vm.runInContext(read("js/songs.js"), context);
  const songs = JSON.parse(JSON.stringify(vm.runInContext("SONGS", context)));
  return renderArchivePages({ songs, xPosts: { version: 1, items: [] }, xTranslations: new Map(),
    xPostsRenderer: { posts: () => [], renderPost: () => "" }, songDetailsSource: JSON.parse(read("data/song-archive.json")),
    updatesHtml: read("updates.html") }).files.get("songs.html");
})();

test("songs.html filters one list by album and public year together and keeps the choice in the address", async () => {
  const app = songFilterPage(await fullSongIndex);
  const total = app.items.length;
  const expectCounts = (album, year) => {
    const choice = { album, year };
    for (const entry of app.buttons) {
      const { songFilter: facet, value } = entry.dataset;
      const scope = { ...choice, [facet]: value };
      const count = app.items.filter(item => ["album", "year"].every(key => scope[key] === "all" || item.dataset[key] === scope[key])).length;
      const pressed = choice[facet] === value;
      assert.equal(entry.count.textContent, String(count), `${facet}=${value} count`);
      assert.equal(entry.getAttribute("aria-pressed"), String(pressed), `${facet}=${value} pressed`);
      assert.equal(entry.disabled, !pressed && count === 0, `${facet}=${value} disabled`);
    }
  };
  assert.equal(total, 52);
  assert.equal(app.panel.hidden, false);
  assert.equal(app.visible().length, total);
  assert.equal(app.status.textContent, `共 ${total} 首`);
  assert.equal(app.reset.hidden, true);
  assert.equal(app.empty.hidden, true);
  assert.deepEqual(app.buttons.filter(entry => entry.dataset.songFilter === "album").map(entry => [entry.dataset.value, entry.count.textContent]),
    [["all", "52"], ["anticyclone", "14"], ["weather-station", "11"], ["singles", "27"]]);
  expectCounts("all", "all");
  assert.deepEqual(app.urls, [], "the initial render leaves the address alone");

  app.button("album", "anticyclone").listeners.click();
  assert.equal(app.visible().length, 14);
  assert.ok(app.visible().every(item => item.dataset.album === "anticyclone"));
  assert.equal(app.status.textContent, `显示 14 / ${total} 首`);
  assert.equal(app.reset.hidden, false);
  assert.equal(app.urls.at(-1), "/songs.html?album=anticyclone#list");
  expectCounts("anticyclone", "all");
  const emptyYear = app.buttons.find(entry => entry.dataset.songFilter === "year" && entry.disabled);
  assert.ok(emptyYear, "a year without アンチサイクロン songs is unavailable");
  emptyYear.listeners.click();
  assert.equal(app.visible().length, 14, "a disabled option is ignored");

  const year = app.visible()[0].dataset.year;
  app.button("year", year).listeners.click();
  const both = app.items.filter(item => item.dataset.album === "anticyclone" && item.dataset.year === year);
  assert.deepEqual(app.visible(), both);
  assert.equal(app.urls.at(-1), `/songs.html?album=anticyclone&year=${year}#list`);
  expectCounts("anticyclone", year);

  app.languageButton.listeners.click();
  assert.equal(app.status.textContent, `Showing ${both.length} of ${total} songs`, "the count follows a language switch");
  app.languageButton.listeners.click();
  assert.equal(app.status.textContent, `${total}曲中${both.length}曲を表示`);

  app.reset.listeners.click();
  assert.equal(app.visible().length, total);
  assert.equal(app.urls.at(-1), "/songs.html#list");
  assert.equal(app.reset.hidden, true);
  assert.equal(app.focused(), app.button("album", "all"), "focus moves off the hidden reset button");
  assert.equal(app.status.textContent, `全${total}曲`);
});

test("songs.html reads only the first, valid ?album= and ?year= values and explains an empty combination", async () => {
  const html = await fullSongIndex;
  const linked = songFilterPage(html, "?year=2020&year=2019&album=bogus&album=singles");
  assert.equal(linked.button("year", "2020").getAttribute("aria-pressed"), "true");
  assert.equal(linked.button("album", "all").getAttribute("aria-pressed"), "true", "an unknown first value is not replaced by a later one");
  assert.ok(linked.visible().length > 0 && linked.visible().every(item => item.dataset.year === "2020"));

  const malformed = songFilterPage(html, "?album=%E0%A4%A&year=2020");
  assert.equal(malformed.button("album", "all").getAttribute("aria-pressed"), "true");
  assert.equal(malformed.button("year", "2020").getAttribute("aria-pressed"), "true", "a malformed value leaves the other filter working");

  const items = songFilterPage(html).items;
  const years = [...new Set(items.map(item => item.dataset.year))];
  const year = years.find(value => !items.some(item => item.dataset.album === "anticyclone" && item.dataset.year === value));
  const none = songFilterPage(html, `?album=anticyclone&year=${year}`);
  assert.equal(none.visible().length, 0);
  assert.equal(none.empty.hidden, false);
  assert.equal(none.reset.hidden, false, "the empty notice comes with a way out");
  assert.equal(none.status.textContent, `显示 0 / ${items.length} 首`);
});

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
