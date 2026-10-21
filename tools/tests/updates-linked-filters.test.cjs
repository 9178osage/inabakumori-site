const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Runs js/updates.js against a minimal DOM with a given ?query string.
function load(search) {
  const element = (dataset = {}) => ({ dataset, hidden: false, textContent: "", attributes: {}, listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; this.hidden = false; },
    addEventListener(type, handler) { this.listeners[type] = handler; }, querySelector: () => null });
  const entries = [
    ["inabakumori", "youtube", "2026"], ["inabakumori", "youtube", "2025"],
    ["nknk", "pixiv", "2026"], ["nknk", "pixiv", "2025"], ["nknk", "campfire", "2026"]
  ].map(([creator, source, year]) => element({ creator, source, year }));
  const buttons = ["all", "inabakumori", "nknk"].map(filter => element({ filter }));
  const count = element(), empty = element();
  const document = {
    readyState: "complete", documentElement: { dataset: {} }, title: "",
    getElementById: id => ({ "updates-count": count, "updates-empty": empty })[id] || null,
    querySelector: () => null,
    querySelectorAll: selector => selector.startsWith(".update-item") ? entries : selector === "[data-filter]" ? buttons : []
  };
  const window = {
    location: { search }, siteStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, setInterval: () => 1, clearInterval() {}, localStorage: {}
  };
  vm.runInContext(fs.readFileSync("js/updates.js", "utf8"), vm.createContext({ window, document, Intl, Date }));
  return { entries, buttons, count, empty, shown: () => entries.filter(entry => !entry.hidden).map(entry => Object.values(entry.dataset).join("/")) };
}

test("updates page applies whitelisted creator, source and year from the homepage link", () => {
  const app = load("?creator=nknk&source=pixiv&year=2025");
  assert.deepEqual(app.shown(), ["nknk/pixiv/2025"]);
  assert.equal(app.buttons[2].attributes["aria-pressed"], "true");
  assert.match(app.count.textContent, /^pixiv · 2025 · 已收录 1 条/u);
});

test("unknown, malformed or injected filter values are ignored", () => {
  for (const search of ["?creator=<img%20src=x>&source=evil&year=1999", "?year=%E0%A4%A", "?source=__proto__&creator=constructor", "?creator=nknk=invalid", "?source=youtube=invalid", "?year=2025=invalid", "?source=youtube%3Dinvalid", ""]) {
    const app = load(search);
    assert.equal(app.shown().length, 5, search);
    assert.doesNotMatch(app.count.textContent, /img|evil|1999|proto/u, search);
  }
});

test("a malformed filter does not discard valid filters later in the query", () => {
  for (const search of ["?source=%E0%A4%A&creator=nknk&year=2025", "?creator=nknk&year=2025&source=%E0%A4%A"]) {
    assert.deepEqual(load(search).shown(), ["nknk/pixiv/2025"], search);
  }
});

test("a valid combination without work updates shows the empty state", () => {
  const app = load("?creator=nknk&source=youtube&year=2026");
  assert.deepEqual(app.shown(), []);
  assert.equal(app.empty.hidden, false);
  assert.match(app.count.textContent, /^YouTube · 2026 · 已收录 0 条/u);
});

test("choosing a creator on the updates page clears linked source and year", () => {
  const app = load("?source=youtube&year=2026");
  assert.deepEqual(app.shown(), ["inabakumori/youtube/2026"]);
  app.buttons[2].listeners.click();
  assert.equal(app.shown().length, 3);
});
