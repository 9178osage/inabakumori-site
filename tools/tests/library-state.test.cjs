const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor() {
    this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {};
    this.value = ""; this.hidden = false;
    this.classList = { contains: () => false, toggle() {} };
  }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  click() { for (const handler of this.listeners.click || []) handler(); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  append(...children) {
    for (const child of children) {
      this.children = this.children.filter(item => item !== child);
      this.children.push(child);
    }
  }
  before() {}
  focus() { this.focused = true; }
  scrollIntoView() {}
  querySelectorAll() { return this.children; }
}

function loadLibrary(search = "") {
  const elements = new Map();
  const byId = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const links = ["first", "second", "third"].map(id => Object.assign(new Element(), {
    href: `https://example.com/${id}`, dataset: { songTitle: id }
  }));
  const list = byId("song-list");
  list.children = links.slice();
  const ready = [], listeners = {}, documentListeners = {}, saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const fire = (type, event = {}) => { for (const handler of listeners[type] || []) handler(event); };
  const context = {
    document: {
      addEventListener(type, handler) { if (type === "DOMContentLoaded") ready.push(handler); else documentListeners[type] = handler; },
      getElementById: byId, createElement: () => new Element(),
      querySelector: selector => selector === ".glitch" ? byId("title") : null,
      querySelectorAll: () => []
    },
    siteStorage: storage, localStorage: storage, sessionStorage: storage,
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
    currentLanguage: "zh", getSongThumbnailUrl: href => `${href}/image.jpg`,
    updateTagFilter() {
      for (const link of links) link.hidden = !context.includeFavoriteSong(link);
      fire("songsfiltered");
    },
    enforceCommentFieldLimits() {}, unicodeLength: text => [...text].length,
    wallStatic: false, reducedMotionQuery: { matches: false, addEventListener() {} },
    location: new URL(`https://example.com/${search}`), history: { state: null, replaceState() {} },
    URL, URLSearchParams, navigator: {}
  };
  context.history.replaceState = (_state, _title, url) => { context.location = new URL(url, context.location); };
  context.window = context;
  vm.runInNewContext(fs.readFileSync("js/experience.js", "utf8"), context);
  return { elements, list, ready, saved, storage, fire, context, documentListeners };
}

test("the search keyboard shortcut opens a compact phone library before focusing its field", () => {
  const { elements, ready, documentListeners } = loadLibrary();
  ready.forEach(handler => handler());
  const lightbox = new Element();
  lightbox.hidden = true;
  elements.set("nknk-lightbox", lightbox);
  const expand = new Element();
  elements.set("mobile-songs-expand", expand);
  let expanded = false;
  expand.addEventListener("click", () => { expanded = true; });
  elements.get("tag-filter-input").focus = () => assert.equal(expanded, true, "expand must precede focus");
  let prevented = false;
  documentListeners.keydown({ key: "/", target: { closest: () => null }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(expanded, true);
});

test("changing a library sort also recomputes the visible song set", () => {
  const { elements, ready, context } = loadLibrary();
  ready.forEach(handler => handler());
  let refreshed = 0;
  const update = context.updateTagFilter;
  context.updateTagFilter = () => { refreshed++; update(); };
  elements.get("song-sort").value = "popular";
  elements.get("song-sort").listeners.change[0]();
  assert.equal(refreshed, 1);
  assert.equal(context.location.search, "?sort=popular");
});

test("share succeeds with clipboard support and falls back when the API is absent", async () => {
  const { elements, ready, context } = loadLibrary("?favorites=1&icons=2");
  ready.forEach(handler => handler());
  elements.get("tag-filter-input").value = "rain";
  let copied;
  context.navigator.clipboard = { writeText: async value => { copied = value; } };
  await elements.get("share-search").listeners.click[0]();
  assert.equal(copied, "https://example.com/?q=rain#songs");
  assert.equal(elements.get("library-status").textContent, "链接已复制");
  delete context.navigator.clipboard;
  await elements.get("share-search").listeners.click[0]();
  assert.ok(elements.get("library-status").textContent.includes(copied));
});

for (const language of ["zh", "en", "ja"]) {
  test(`share fallback exposes the public URL without local favorites (${language})`, async () => {
    const { elements, ready, context } = loadLibrary("?q=rain&sort=title&favorites=1#intro");
    context.currentLanguage = language;
    context.navigator.clipboard = { writeText: async () => { throw new Error("permission denied"); } };
    ready.forEach(handler => handler());
    await elements.get("share-search").listeners.click[0]();
    const message = elements.get("library-status").textContent;
    assert.ok(message.includes("https://example.com/?q=rain&sort=title#songs"));
    assert.ok(!message.includes("favorites="));
    assert.equal(elements.get("favorites-filter").attributes["aria-pressed"], "true");
  });
}

test("popular sort tolerates pre-rendered songs when the song data script fails", () => {
  const { elements, ready } = loadLibrary("?sort=popular");
  assert.doesNotThrow(() => ready.forEach(handler => handler()));
  assert.equal(elements.get("message-counter").textContent, "0 / 500", "later initialization still runs");
});

test("favorites changed in another tab refresh the filter and survive the next local edit", () => {
  const { elements, list, ready, saved, storage, fire } = loadLibrary();
  ready.forEach(handler => handler());
  const rows = list.children.filter(item => item.className === "song-row");
  const buttons = rows.map(row => row.children[1]);
  buttons[0].click();
  fire("storage", { key: "favorite-songs", newValue: '["first","second"]', storageArea: storage });
  assert.equal(buttons[1].attributes["aria-pressed"], "true", "the other tab's favorite appears");
  buttons[2].click();
  assert.deepEqual(JSON.parse(saved.get("favorite-songs")), ["first", "second", "third"]);
  elements.get("favorites-filter").click();
  fire("storage", { key: "favorite-songs", newValue: '["second"]', storageArea: storage });
  assert.deepEqual(rows.map(row => row.hidden), [true, false, true]);
  fire("storage", { key: null, newValue: null, storageArea: storage });
  assert.ok(rows.every(row => row.hidden), "clearing storage clears favorites in the other tab");
});

test("favorite synchronization ignores other storage areas and handles malformed values", () => {
  const { list, ready, storage, fire } = loadLibrary();
  ready.forEach(handler => handler());
  const button = list.children.find(item => item.className === "song-row").children[1];
  fire("storage", { key: "favorite-songs", newValue: '["first"]', storageArea: {} });
  assert.equal(button.attributes["aria-pressed"], "false");
  fire("storage", { key: "favorite-songs", newValue: '["first",null,42]', storageArea: storage });
  assert.equal(button.attributes["aria-pressed"], "true");
  assert.doesNotThrow(() => fire("storage", { key: "favorite-songs", newValue: "invalid", storageArea: storage }));
  assert.equal(button.attributes["aria-pressed"], "false");
});

test("share hint follows the language switch after a successful copy", async () => {
  const { elements, ready, context, fire } = loadLibrary("?q=rain&favorites=1");
  ready.forEach(handler => handler());
  context.navigator.clipboard = { writeText: async () => {} };
  await elements.get("share-search").listeners.click[0]();
  const status = elements.get("library-status");
  assert.equal(status.textContent, "链接已复制");
  for (const [language, expected] of [["en", "Link copied"], ["ja", "リンクをコピーしました"], ["zh", "链接已复制"]]) {
    context.currentLanguage = language;
    fire("languagechange");
    assert.equal(status.textContent, expected, `status should follow the switch to ${language}`);
  }
});

test("share fallback keeps the public URL across a language switch", async () => {
  const { elements, ready, context, fire } = loadLibrary("?q=rain&sort=title&favorites=1#intro");
  ready.forEach(handler => handler());
  context.navigator.clipboard = { writeText: async () => { throw new Error("permission denied"); } };
  await elements.get("share-search").listeners.click[0]();
  const status = elements.get("library-status");
  const sharedUrl = "https://example.com/?q=rain&sort=title#songs";
  assert.ok(status.textContent.includes(sharedUrl));
  assert.ok(!status.textContent.includes("favorites="));
  context.currentLanguage = "ja";
  fire("languagechange");
  assert.ok(status.textContent.includes("自動コピーできませんでした"), status.textContent);
  assert.ok(status.textContent.includes(sharedUrl), "the URL itself must not change");
  assert.ok(!status.textContent.includes("favorites="));
  context.currentLanguage = "en";
  fire("languagechange");
  assert.ok(status.textContent.startsWith("Could not copy automatically."), status.textContent);
  assert.ok(status.textContent.includes(sharedUrl));
});

test("a language switch keeps the share hint, a real filter change clears it", async () => {
  const { elements, list, ready, context, fire, storage } = loadLibrary("?q=rain");
  ready.forEach(handler => handler());
  const status = elements.get("library-status");
  context.navigator.clipboard = { writeText: async () => {} };
  await elements.get("share-search").listeners.click[0]();
  assert.equal(status.textContent, "链接已复制");

  // The language switch re-runs the filter with the same visible songs: the hint must
  // be translated, not erased.
  const originalUpdateTagFilter = context.updateTagFilter;
  context.currentLanguage = "ja";
  fire("languagechange");
  context.updateTagFilter();
  assert.equal(status.textContent, "リンクをコピーしました");
  context.currentLanguage = "zh";
  fire("languagechange");
  context.updateTagFilter();
  assert.equal(status.textContent, "链接已复制");

  // A filter that actually changes the visible songs retires the hint for good.
  context.updateTagFilter = originalUpdateTagFilter;
  context.includeFavoriteSong = link => JSON.parse(storage.getItem("favorite-songs") || "[]").includes(link.dataset.songTitle);
  storage.setItem("favorite-songs", JSON.stringify(["first"]));
  elements.get("favorites-filter").click();
  const links = list.children.filter(item => item.dataset.songTitle);
  assert.deepEqual(links.map(link => link.hidden), [false, true, true], "the visible set really changed");
  assert.equal(status.textContent, "", "a real filter change clears the hint");
  context.currentLanguage = "ja";
  fire("languagechange");
  assert.equal(status.textContent, "", "the cleared hint never comes back");
});

test("changing the query or sort retires a share link even when the visible songs stay the same", async () => {
  const { elements, ready, context, fire } = loadLibrary("?q=rain");
  ready.forEach(handler => handler());
  const share = () => elements.get("share-search").listeners.click[0]();
  const status = elements.get("library-status");
  await share(); // Missing Clipboard API displays a manually copyable URL.
  assert.ok(status.textContent.includes("q=rain"));
  elements.get("tag-filter-input").value = "weather";
  context.updateTagFilter(); // Same visible songs in this fixture.
  assert.equal(status.textContent, "", "the old query URL must disappear");
  await share();
  assert.ok(status.textContent.includes("q=weather"));
  elements.get("song-sort").value = "title";
  elements.get("song-sort").listeners.change[0]();
  assert.equal(status.textContent, "", "the old sort URL must disappear");
  context.currentLanguage = "en";
  fire("languagechange");
  context.updateTagFilter();
  assert.equal(status.textContent, "", "translation must not revive an old link");
});

for (const succeeds of [true, false]) {
  test(`a pending clipboard ${succeeds ? "success" : "failure"} cannot restore a retired hint`, async () => {
    const { elements, ready, context } = loadLibrary("?q=rain");
    ready.forEach(handler => handler());
    let settle;
    context.navigator.clipboard = { writeText: () => new Promise((resolve, reject) => {
      settle = () => succeeds ? resolve() : reject(new Error("permission denied"));
    }) };
    const pending = elements.get("share-search").listeners.click[0]();
    elements.get("tag-filter-input").value = "weather";
    context.updateTagFilter();
    settle();
    await pending;
    assert.equal(elements.get("library-status").textContent, "");
  });
}

test("an earlier clipboard request cannot overwrite the latest share result", async () => {
  const { elements, ready, context } = loadLibrary("?q=rain");
  ready.forEach(handler => handler());
  let rejectFirst;
  context.navigator.clipboard = { writeText: () => new Promise((_resolve, reject) => { rejectFirst = reject; }) };
  const first = elements.get("share-search").listeners.click[0]();
  context.navigator.clipboard.writeText = async () => {};
  await elements.get("share-search").listeners.click[0]();
  rejectFirst(new Error("permission denied"));
  await first;
  assert.equal(elements.get("library-status").textContent, "链接已复制");
});
