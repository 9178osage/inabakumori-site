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
  focus() {}
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
  const ready = [], listeners = {}, saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const fire = (type, event = {}) => { for (const handler of listeners[type] || []) handler(event); };
  const context = {
    document: {
      addEventListener(type, handler) { if (type === "DOMContentLoaded") ready.push(handler); },
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
  context.window = context;
  vm.runInNewContext(fs.readFileSync("js/experience.js", "utf8"), context);
  return { elements, list, ready, saved, storage, fire };
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
