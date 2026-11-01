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
  assert.match(html, /data-song-filter="year" data-value="2021" data-label-zh="2021" data-label-en="2021" data-label-ja="2021" aria-pressed="false"><span class="song-filter-check" aria-hidden="true">✓<\/span><span class="song-filter-text">2021<\/span><span class="song-filter-count" aria-hidden="true">1<\/span>/u, "the count is visual; the status line announces results");
  assert.match(html, /data-song-filter="year" data-value="unknown" data-label-zh="年份待确认" data-label-en="Year unconfirmed" data-label-ja="年未確認" aria-pressed="false">[^]*?>年份待确认<\/span>/u);
  assert.match(html, /data-song-filter="album" data-value="singles" data-label-zh="单曲与其他" data-label-en="Singles and more" data-label-ja="シングル・その他"/u);
  assert.match(html, /data-year="2021">[^]*?日期推定/u, "inferred dates stay visibly qualified even without JavaScript");
  assert.match(html, /<div id="song-filters" class="song-filters" hidden>/u, "the filter appears only once the script can run it");
  assert.match(html, /<button type="button" id="song-filter-toggle" class="song-filter-toggle" aria-expanded="false" aria-controls="song-filter-menu"><span id="song-filter-toggle-label" data-zh="筛选" data-en="Filter" data-ja="絞り込み">筛选<\/span>/u);
  assert.match(html, /<div id="song-filter-menu" class="song-filter-menu" hidden><button type="button" id="song-filter-all"[^>]*aria-pressed="true">[^]*?全部歌曲[^]*?id="song-filter-mode-album"[^]*?id="song-filter-mode-year"/u, "one menu lists all songs, then album before year");
  for (const facet of ["year", "album"]) {
    assert.match(html, new RegExp(`id="song-filter-mode-${facet}" class="song-filter-mode" data-song-mode="${facet}" aria-expanded="false" aria-controls="song-filter-${facet}"`, "u"));
    assert.match(html, new RegExp(`<div id="song-filter-${facet}" class="song-filter-submenu" role="group" aria-labelledby="song-filter-mode-${facet}" hidden>`, "u"), "both submenus start hidden");
  }
  assert.doesNotMatch(html, /data-value="all"/u, "\"all songs\" is one first-level item, not an option inside each submenu");
  assert.doesNotMatch(html, /<details|song-index-group|role="menu/u, "no separate sections and no partial ARIA menu pattern");
  const app = songFilterPage(html);
  app.toggle.listeners.click();
  app.mode("year").listeners.click();
  app.button("year", "unknown").listeners.click();
  assert.equal(app.visible().length, 1);
  assert.equal(app.visible()[0].dataset.year, "unknown");
  assert.equal(app.toggleLabel.textContent, "筛选：年份待确认");
});

// A DOM just large enough for the songs.html filter: list items, the trigger, its menu and
// submenus, status, reset and empty notice. Page-level listeners record Escape and outside clicks.
function songFilterPage(html, search = "") {
  let focused = null;
  const element = (tag, extra = {}) => {
    const attrs = attributes(tag);
    const dataset = Object.fromEntries(Object.entries(attrs).filter(([name]) => name.startsWith("data-"))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()), value]));
    return { attributes: attrs, dataset, hidden: /\shidden(?=[\s>])/u.test(tag), textContent: decode(extra.text ?? ""), listeners: {},
      getAttribute(name) { return this.attributes[name] ?? null; },
      hasAttribute(name) { return name in this.attributes; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      focus() { focused = this; }, ...extra };
  };
  const items = [...html.matchAll(/<li\b[^>]*data-album[^>]*>/gu)].map(([tag]) => element(tag));
  const buttons = [...html.matchAll(/(<button type="button" data-song-filter[^>]*>)([^]*?)<\/button>/gu)].map(([, tag, inner]) => {
    const count = { textContent: inner.match(/class="song-filter-count"[^>]*>(\d+)</u)[1] };
    return element(tag, { count });
  });
  const modes = [...html.matchAll(/<button\b[^>]*data-song-mode[^>]*>/gu)].map(([tag]) => element(tag));
  const byId = (id, extra) => element(html.match(new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`, "u"))[0], extra);
  const toggleLabel = byId("song-filter-toggle-label", { text: html.match(/id="song-filter-toggle-label"[^>]*>([^<]*)</u)[1] });
  const toggle = byId("song-filter-toggle"), menu = byId("song-filter-menu"), all = byId("song-filter-all");
  const submenus = Object.fromEntries(["year", "album"].map(facet => [facet, byId(`song-filter-${facet}`)]));
  const status = byId("song-filter-status"), reset = byId("song-filter-reset"), empty = byId("song-filter-empty");
  const inDropdown = new Set([toggle, toggleLabel, menu, all, ...modes, ...buttons, ...Object.values(submenus)]);
  const dropdown = { listeners: {}, contains: node => inDropdown.has(node), addEventListener(name, handler) { this.listeners[name] = handler; } };
  inDropdown.add(dropdown);
  const panel = byId("song-filters");
  panel.querySelector = selector => selector === ".song-filter-dropdown" ? dropdown : null;
  panel.querySelectorAll = selector => selector === "button[data-song-filter]" ? buttons : selector === "button[data-song-mode]" ? modes : [];
  const languageButton = element("<button>");
  const elements = { "song-filters": panel, "song-filter-toggle": toggle, "song-filter-toggle-label": toggleLabel, "song-filter-menu": menu,
    "song-filter-all": all, "song-filter-status": status, "song-filter-reset": reset, "song-filter-empty": empty,
    "song-filter-year": submenus.year, "song-filter-album": submenus.album, "archive-lang-btn": languageButton };
  const root = element(html.match(/<html\b[^>]*>/u)[0]);
  const urls = [];
  const location = { pathname: "/songs.html", search, hash: "#list" };
  const body = element("<body>");
  const pageListeners = {};
  const document = {
    readyState: "complete", documentElement: root, title: "", body,
    get activeElement() { return focused || body; },
    getElementById: id => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: selector => selector === ".song-index-list li[data-album][data-year]" ? items
      : selector === "[data-zh][data-en][data-ja]" ? [toggleLabel, status, reset, empty].filter(node => node.dataset.zh) : [],
    addEventListener(name, handler) { pageListeners[name] = handler; }
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
  const outside = element("<a>");
  return { items, buttons, button, modes, mode: facet => modes.find(entry => entry.dataset.songMode === facet), submenus,
    toggle, toggleLabel, menu, all, dropdown, visible, panel, status, reset, empty, urls, languageButton, outside,
    focused: () => focused, focus: node => { focused = node; },
    key: key => pageListeners.keydown({ key }), clickPage: target => pageListeners.click({ target }) };
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

test("songs.html filters from one menu: choose album or year, then one value, never both", async () => {
  const app = songFilterPage(await fullSongIndex);
  const total = app.items.length;
  const expectMenu = (open, branch = "") => {
    assert.equal(app.menu.hidden, !open);
    assert.equal(app.toggle.getAttribute("aria-expanded"), String(open));
    for (const mode of app.modes) {
      assert.equal(mode.getAttribute("aria-expanded"), String(mode.dataset.songMode === branch));
      assert.equal(app.submenus[mode.dataset.songMode].hidden, mode.dataset.songMode !== branch);
    }
  };
  const expectFilter = (facet, value) => {
    assert.equal(app.all.getAttribute("aria-pressed"), String(!facet));
    for (const mode of app.modes) assert.equal(mode.hasAttribute("data-active"), mode.dataset.songMode === facet);
    assert.equal(app.toggle.hasAttribute("data-active"), Boolean(facet));
    for (const entry of app.buttons) {
      const { songFilter, value: option } = entry.dataset;
      assert.equal(entry.count.textContent, String(app.items.filter(item => item.dataset[songFilter] === option).length), `${songFilter}=${option} count is independent of the other branch`);
      assert.equal(entry.getAttribute("aria-pressed"), String(songFilter === facet && option === value));
    }
    assert.equal(app.reset.hidden, !facet);
  };
  assert.equal(total, 52);
  assert.equal(app.panel.hidden, false);
  assert.equal(app.visible().length, total);
  assert.equal(app.toggleLabel.textContent, "筛选");
  assert.equal(app.status.textContent, `共 ${total} 首`);
  assert.equal(app.empty.hidden, true);
  assert.deepEqual(app.buttons.filter(entry => entry.dataset.songFilter === "album").map(entry => [entry.dataset.value, entry.count.textContent]),
    [["anticyclone", "14"], ["weather-station", "11"], ["singles", "27"]]);
  expectMenu(false);
  expectFilter("", "");
  assert.deepEqual(app.urls, [], "the initial render leaves the address alone");

  app.toggle.listeners.click();
  expectMenu(true);
  app.mode("album").listeners.click();
  expectMenu(true, "album");
  assert.equal(app.visible().length, total, "opening a submenu does not filter by itself");
  assert.deepEqual(app.urls, []);
  app.mode("album").listeners.click();
  expectMenu(true, "album");
  app.mode("year").listeners.pointerenter({ pointerType: "touch" });
  expectMenu(true, "album");
  app.mode("year").listeners.pointerenter({ pointerType: "mouse" });
  expectMenu(true, "year");
  app.all.listeners.pointerenter({ pointerType: "mouse" });
  expectMenu(true);
  app.mode("album").listeners.click();

  app.focus(app.button("album", "anticyclone"));
  app.button("album", "anticyclone").listeners.click();
  assert.equal(app.visible().length, 14);
  assert.ok(app.visible().every(item => item.dataset.album === "anticyclone"));
  assert.equal(app.status.textContent, `显示 14 / ${total} 首`);
  assert.equal(app.urls.at(-1), "/songs.html?album=anticyclone#list");
  assert.equal(app.toggleLabel.textContent, "筛选：アンチサイクロン");
  expectMenu(false);
  expectFilter("album", "anticyclone");
  assert.equal(app.focused(), app.toggle, "choosing closes the menu and returns focus to the trigger");

  app.toggle.listeners.click();
  expectMenu(true, "album");
  app.button("year", "2026").listeners.click();
  assert.equal(app.visible().length, 2, "a year replaces the album instead of combining with it");
  assert.ok(app.visible().every(item => item.dataset.year === "2026"));
  expectFilter("year", "2026");
  assert.equal(app.urls.at(-1), "/songs.html?year=2026#list");

  app.toggle.listeners.click();
  expectMenu(true, "year");
  app.mode("year").listeners.click();
  const year = "2019";
  app.button("year", year).listeners.click();
  const byYear = app.items.filter(item => item.dataset.year === year);
  assert.equal(byYear.length, 8);
  assert.deepEqual(app.visible(), byYear);
  assert.equal(new Set(app.visible().map(item => item.dataset.album)).size, 3, "the chosen year includes all albums");
  expectFilter("year", year);

  app.languageButton.listeners.click();
  assert.equal(app.status.textContent, `Showing ${byYear.length} of ${total} songs`, "the count follows a language switch");
  assert.equal(app.toggleLabel.textContent, `Filter: ${year}`);
  app.languageButton.listeners.click();
  assert.equal(app.status.textContent, `${total}曲中${byYear.length}曲を表示`);
  assert.equal(app.toggleLabel.textContent, `絞り込み：${year}`);
  app.button("album", "singles").listeners.click();
  assert.equal(app.toggleLabel.textContent, "絞り込み：シングル・その他");
  app.languageButton.listeners.click();

  app.toggle.listeners.click();
  app.all.listeners.click();
  assert.equal(app.visible().length, total, "\"all songs\" clears the filter");
  assert.equal(app.urls.at(-1), "/songs.html#list");
  assert.equal(app.toggleLabel.textContent, "筛选");
  expectMenu(false);
  expectFilter("", "");

  app.toggle.listeners.click();
  app.mode("year").listeners.click();
  app.button("year", "2022").listeners.click();
  app.reset.listeners.click();
  assert.equal(app.visible().length, total);
  assert.equal(app.urls.at(-1), "/songs.html#list");
  expectFilter("", "");
  assert.equal(app.focused(), app.toggle, "reset hides itself, so focus moves to the trigger");
  assert.equal(app.status.textContent, `共 ${total} 首`);
});

test("songs.html menu closes with Escape, the trigger, an outside click or tabbing away", async () => {
  const app = songFilterPage(await fullSongIndex);
  const open = () => { app.toggle.listeners.click(); app.mode("year").listeners.click(); assert.equal(app.menu.hidden, false); };
  open();
  app.focus(app.mode("year"));
  app.key("Enter");
  assert.equal(app.menu.hidden, false);
  app.key("Escape");
  assert.equal(app.menu.hidden, true);
  assert.equal(app.submenus.year.hidden, true);
  assert.equal(app.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(app.focused(), app.toggle);

  open();
  app.toggle.listeners.click();
  assert.equal(app.menu.hidden, true, "the trigger toggles the menu");

  open();
  app.clickPage(app.mode("year"));
  app.clickPage(app.toggleLabel);
  assert.equal(app.menu.hidden, false, "clicks inside the menu keep it open");
  app.focus(app.outside);
  app.clickPage(app.outside);
  assert.equal(app.menu.hidden, true);
  assert.equal(app.focused(), app.outside, "an outside click does not steal focus");

  open();
  app.dropdown.listeners.focusout({ relatedTarget: null });
  assert.equal(app.menu.hidden, false, "a click that focuses nothing (Safari) still reaches the menu item");
  app.dropdown.listeners.focusout({ relatedTarget: app.button("year", "2020") });
  assert.equal(app.menu.hidden, false);
  app.dropdown.listeners.focusout({ relatedTarget: app.reset });
  assert.equal(app.menu.hidden, true);
  assert.equal(app.visible().length, 52, "closing never applies a filter");
  assert.deepEqual(app.urls, []);
});

test("songs.html restores one filter and canonicalizes legacy combined, \"all\", duplicate and malformed URLs", async () => {
  const html = await fullSongIndex;
  const linked = songFilterPage(html, "?year=2020&year=2019&album=bogus&album=singles");
  assert.equal(linked.button("year", "2020").getAttribute("aria-pressed"), "true");
  assert.ok(linked.visible().length > 0 && linked.visible().every(item => item.dataset.year === "2020"));
  assert.equal(linked.toggleLabel.textContent, "筛选：2020");
  assert.equal(linked.menu.hidden, true, "a restored filter does not open the menu");
  assert.equal(linked.urls.at(-1), "/songs.html?year=2020#list");
  linked.toggle.listeners.click();
  assert.equal(linked.submenus.year.hidden, false, "reopening shows the active branch");

  const malformed = songFilterPage(html, "?album=%E0%A4%A&year=2020");
  assert.equal(malformed.button("year", "2020").getAttribute("aria-pressed"), "true", "a malformed value leaves the other filter working");

  const unknown = songFilterPage(html, "?album=bogus&album=singles&year=2019");
  assert.equal(unknown.visible().length, 8, "a repeated key cannot replace its first, invalid value");

  const combined = songFilterPage(html, "?album=anticyclone&year=2026");
  assert.equal(combined.visible().length, 14, "a legacy combined link cannot leave an invisible second filter");
  assert.equal(combined.empty.hidden, true);
  assert.equal(combined.urls.at(-1), "/songs.html?album=anticyclone#list");
  const yearFirst = songFilterPage(html, "?year=2026&album=anticyclone");
  assert.equal(yearFirst.visible().length, 2);
  assert.equal(yearFirst.urls.at(-1), "/songs.html?year=2026#list");
  const allThenYear = songFilterPage(html, "?album=all&year=2019");
  assert.equal(allThenYear.visible().length, 8, "\"all\" is no filter, so the next real one applies");
  assert.equal(allThenYear.urls.at(-1), "/songs.html?year=2019#list");

  for (const facet of ["year", "album"]) {
    const all = songFilterPage(html, `?${facet}=all`);
    assert.equal(all.visible().length, 52);
    assert.equal(all.all.getAttribute("aria-pressed"), "true");
    assert.equal(all.urls.at(-1), "/songs.html#list", "the former branch-only link becomes the plain address");
  }
  const invalid = songFilterPage(html, "?year=%E0%A4%A&album=bogus");
  assert.equal(invalid.visible().length, 52);
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
