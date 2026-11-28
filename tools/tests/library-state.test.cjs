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

function loadLibrary(search = "", { ids = ["first", "second", "third"], saved: initial = {} } = {}) {
  const elements = new Map();
  const byId = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const links = ids.map(id => Object.assign(new Element(), {
    href: `https://example.com/${id}`, dataset: { songTitle: id }
  }));
  const list = byId("song-list");
  list.children = links.slice();
  const ready = [], listeners = {}, documentListeners = {}, saved = new Map(Object.entries(initial));
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


const RETIRED = "dmG60q44PJQ", CURRENT = "2A46CwhV4aE";
const starButtons = list => list.children.filter(item => item.className === "song-row").map(row => row.children[1]);

test("a favorite saved under a retired video ID follows the song to its new ID", () => {
  const { list, ready, saved, storage, fire } = loadLibrary("", { ids: [CURRENT, "BBBBBBBBBBB"], saved: { "favorite-songs": JSON.stringify([RETIRED]) } });
  ready.forEach(handler => handler());
  const [song, other] = starButtons(list);
  assert.equal(song.attributes["aria-pressed"], "true", "the star saved before the video link changed is still lit");
  assert.equal(other.attributes["aria-pressed"], "false");
  other.click();
  assert.deepEqual(JSON.parse(saved.get("favorite-songs")), [CURRENT, "BBBBBBBBBBB"], "saving writes current IDs only, so the retired ID cannot linger");
  song.click();
  assert.equal(song.attributes["aria-pressed"], "false", "the migrated favorite can be removed");
  assert.deepEqual(JSON.parse(saved.get("favorite-songs")), ["BBBBBBBBBBB"]);
  fire("storage", { key: "favorite-songs", newValue: JSON.stringify([RETIRED, CURRENT]), storageArea: storage });
  assert.equal(song.attributes["aria-pressed"], "true", "another tab's older record is read the same way");
});


test("every retired song address in data/song-redirects.json also keeps its saved favorite", () => {
  const { redirects } = JSON.parse(fs.readFileSync("data/song-redirects.json", "utf8"));
  assert.ok(Object.keys(redirects).length > 0, "at least one retired address is recorded");
  for (const [from, to] of Object.entries(redirects)) {
    const { list, ready } = loadLibrary("", { ids: [to], saved: { "favorite-songs": JSON.stringify([from]) } });
    ready.forEach(handler => handler());
    assert.equal(starButtons(list)[0].attributes["aria-pressed"], "true", `js/experience.js must map ${from} to ${to}`);
  }
});

test("the retired-ID map in js/experience.js lists exactly the pairs in data/song-redirects.json", () => {
  const { redirects } = JSON.parse(fs.readFileSync("data/song-redirects.json", "utf8"));
  const literal = /const MOVED_SONG_IDS = new Map\(\[([^;]*)\]\);/u.exec(fs.readFileSync("js/experience.js", "utf8"))?.[1];
  assert.notEqual(literal, undefined, "js/experience.js defines MOVED_SONG_IDS");
  const pair = /\["([A-Za-z0-9_-]{11})",\s*"([A-Za-z0-9_-]{11})"\]/gu;
  assert.equal(literal.replace(pair, "").replace(/[\s,]/gu, ""), "", "every entry is a pair of video IDs");
  assert.deepEqual(Object.fromEntries([...literal.matchAll(pair)].map(match => [match[1], match[2]])), redirects,
    "an extra or stale pair in the script would send a favorite to the wrong song, and a missing one loses it");
});







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






