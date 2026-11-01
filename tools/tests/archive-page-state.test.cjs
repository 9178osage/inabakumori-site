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
  for (const facet of ["year", "album"]) {
    assert.match(html, new RegExp(`data-song-mode="${facet}" aria-expanded="false" aria-pressed="false" aria-controls="song-filter-${facet}"`, "u"));
    assert.match(html, new RegExp(`<div id="song-filter-${facet}"[^>]* hidden>`, "u"), "both second-level branches start hidden");
  }
  assert.doesNotMatch(html, /<details|song-index-group/u, "no separate year or album sections remain");
  const app = songFilterPage(html);
  app.mode("year").listeners.click();
  app.button("year", "unknown").listeners.click();
  assert.equal(app.visible().length, 1);
  assert.equal(app.visible()[0].dataset.year, "unknown");
});

// A DOM just large enough for the songs.html filter: list items, filter buttons, status, reset and empty notice.
function songFilterPage(html, search = "") {
  let focused = null;
  const element = (tag, extra = {}) => {
    const attrs = attributes(tag);
    const dataset = Object.fromEntries(Object.entries(attrs).filter(([name]) => name.startsWith("data-"))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()), value]));
    return { attributes: attrs, dataset, hidden: /\shidden(?=[\s>])/u.test(tag), disabled: false, textContent: "", listeners: {},
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
  const modes = [...html.matchAll(/<button\b[^>]*data-song-mode[^>]*>/gu)].map(([tag]) => element(tag));
  const byId = id => element(html.match(new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`, "u"))[0]);
  const panel = byId("song-filters");
  panel.querySelectorAll = selector => selector === "button[data-song-filter]" ? buttons : selector === "button[data-song-mode]" ? modes : [];
  const groups = Object.fromEntries(["year", "album"].map(facet => [facet, byId(`song-filter-${facet}`)]));
  const status = byId("song-filter-status"), reset = byId("song-filter-reset"), empty = byId("song-filter-empty");
  const languageButton = element("<button>");
  const elements = { "song-filters": panel, "song-filter-status": status, "song-filter-reset": reset, "song-filter-empty": empty,
    "song-filter-year": groups.year, "song-filter-album": groups.album, "archive-lang-btn": languageButton };
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
  return { items, buttons, button, modes, mode: facet => modes.find(entry => entry.dataset.songMode === facet), groups,
    visible, panel, status, reset, empty, urls, languageButton, focused: () => focused };
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

test("songs.html requires choosing a branch before a value and never combines album with year", async () => {
  const app = songFilterPage(await fullSongIndex);
  const total = app.items.length;
  const expectBranch = (facet, value = "all") => {
    for (const mode of app.modes) {
      const selected = mode.dataset.songMode === facet;
      assert.equal(mode.getAttribute("aria-pressed"), String(selected));
      assert.equal(mode.getAttribute("aria-expanded"), String(selected));
      assert.equal(app.groups[mode.dataset.songMode].hidden, !selected);
    }
    for (const entry of app.buttons) {
      const { songFilter, value: option } = entry.dataset;
      const count = app.items.filter(item => option === "all" || item.dataset[songFilter] === option).length;
      assert.equal(entry.count.textContent, String(count), `${songFilter}=${option} count is independent of the other branch`);
      assert.equal(entry.getAttribute("aria-pressed"), String(songFilter === facet && option === value));
      assert.equal(entry.disabled, false);
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
  expectBranch("");
  assert.deepEqual(app.urls, [], "the initial render leaves the address alone");

  app.button("album", "anticyclone").listeners.click();
  assert.equal(app.visible().length, total, "a second-level option cannot activate before its branch is chosen");
  app.mode("album").listeners.click();
  expectBranch("album");
  assert.equal(app.visible().length, total, "choosing the branch only reveals its second-level options");
  assert.equal(app.urls.at(-1), "/songs.html?album=all#list");
  assert.equal(app.reset.hidden, false);
  app.button("album", "anticyclone").listeners.click();
  assert.equal(app.visible().length, 14);
  assert.ok(app.visible().every(item => item.dataset.album === "anticyclone"));
  assert.equal(app.status.textContent, `显示 14 / ${total} 首`);
  assert.equal(app.reset.hidden, false);
  assert.equal(app.urls.at(-1), "/songs.html?album=anticyclone#list");
  expectBranch("album", "anticyclone");
  app.mode("album").listeners.click();
  assert.equal(app.visible().length, 14, "reselecting the open branch retains its chosen option");
  app.button("year", "2026").listeners.click();
  assert.equal(app.visible().length, 14, "the hidden year branch cannot affect an album selection");

  app.mode("year").listeners.click();
  expectBranch("year");
  assert.equal(app.visible().length, total, "switching branches clears the previous album filter");
  assert.equal(app.urls.at(-1), "/songs.html?year=all#list");
  const year = "2019";
  app.button("year", year).listeners.click();
  const byYear = app.items.filter(item => item.dataset.year === year);
  assert.equal(byYear.length, 8);
  assert.deepEqual(app.visible(), byYear);
  assert.equal(new Set(app.visible().map(item => item.dataset.album)).size, 3, "the chosen year includes all albums");
  assert.equal(app.urls.at(-1), `/songs.html?year=${year}#list`);
  expectBranch("year", year);

  app.languageButton.listeners.click();
  assert.equal(app.status.textContent, `Showing ${byYear.length} of ${total} songs`, "the count follows a language switch");
  app.languageButton.listeners.click();
  assert.equal(app.status.textContent, `${total}曲中${byYear.length}曲を表示`);

  app.mode("album").listeners.click();
  assert.equal(app.visible().length, total, "switching back does not restore a stale selection");
  app.button("album", "weather-station").listeners.click();
  assert.equal(app.visible().length, 11, "the new album is not restricted to the old year");
  expectBranch("album", "weather-station");
  app.button("album", "all").listeners.click();
  assert.equal(app.visible().length, total);
  expectBranch("album");

  app.reset.listeners.click();
  assert.equal(app.visible().length, total);
  assert.equal(app.urls.at(-1), "/songs.html#list");
  assert.equal(app.reset.hidden, true);
  expectBranch("");
  assert.equal(app.focused(), app.mode("year"), "focus returns to the first-level control, not a hidden option");
  assert.equal(app.status.textContent, `全${total}曲`);
});

test("songs.html restores one branch and canonicalizes legacy combined, duplicate and malformed URLs", async () => {
  const html = await fullSongIndex;
  const linked = songFilterPage(html, "?year=2020&year=2019&album=bogus&album=singles");
  assert.equal(linked.button("year", "2020").getAttribute("aria-pressed"), "true");
  assert.equal(linked.groups.album.hidden, true);
  assert.equal(linked.groups.year.hidden, false);
  assert.ok(linked.visible().length > 0 && linked.visible().every(item => item.dataset.year === "2020"));
  assert.equal(linked.urls.at(-1), "/songs.html?year=2020#list");

  const malformed = songFilterPage(html, "?album=%E0%A4%A&year=2020");
  assert.equal(malformed.groups.album.hidden, true);
  assert.equal(malformed.button("year", "2020").getAttribute("aria-pressed"), "true", "a malformed value leaves the other filter working");

  const unknown = songFilterPage(html, "?album=bogus&album=singles&year=2019");
  assert.equal(unknown.groups.album.hidden, true, "a repeated key cannot replace its first, invalid value");
  assert.equal(unknown.visible().length, 8);

  const combined = songFilterPage(html, "?album=anticyclone&year=2026");
  assert.equal(combined.visible().length, 14, "a legacy combined link cannot leave an invisible second filter");
  assert.equal(combined.groups.year.hidden, true);
  assert.equal(combined.empty.hidden, true);
  assert.equal(combined.urls.at(-1), "/songs.html?album=anticyclone#list");
  const yearFirst = songFilterPage(html, "?year=2026&album=anticyclone");
  assert.equal(yearFirst.visible().length, 2);
  assert.equal(yearFirst.groups.album.hidden, true);
  assert.equal(yearFirst.urls.at(-1), "/songs.html?year=2026#list");

  for (const facet of ["year", "album"]) {
    const all = songFilterPage(html, `?${facet}=all`);
    assert.equal(all.groups[facet].hidden, false, "the first-level choice survives a reload before selecting a value");
    assert.equal(all.visible().length, 52);
    assert.equal(all.button(facet, "all").getAttribute("aria-pressed"), "true");
    assert.deepEqual(all.urls, [], "a canonical link does not need rewriting");
  }
  const invalid = songFilterPage(html, "?year=%E0%A4%A&album=bogus");
  assert.equal(invalid.visible().length, 52);
  assert.equal(invalid.groups.year.hidden, true);
  assert.equal(invalid.groups.album.hidden, true);
  assert.equal(invalid.reset.hidden, true);
  assert.equal(invalid.urls.at(-1), "/songs.html#list");
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
