const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup(creators = [...Array(12).fill("inabakumori"), ...Array(17).fill("nknk")]) {
  const events = new Map();
  const element = (dataset = {}) => ({
    dataset, hidden: true, textContent: "", attributes: {}, listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, handler) { this.listeners[type] = handler; }
  });
  const document = { readyState: "complete", activeElement: null };
  const entries = creators.map(creator => {
    const entry = element({ creator });
    const link = { focus() { document.activeElement = link; } };
    entry.querySelector = selector => selector === "h3 a" ? link : null;
    return entry;
  });
  const buttons = ["all", "inabakumori", "nknk"].map(homeCreator => element({ homeCreator }));
  const more = element();
  const count = element();
  const empty = element();
  const toolbar = element();
  const section = {
    querySelector: () => toolbar,
    querySelectorAll: selector => selector === ".update-item[data-creator]" ? entries : selector === "[data-home-creator]" ? buttons : []
  };
  document.getElementById = id => ({ updates: section, "home-updates-more": more, "home-updates-count": count, "home-updates-empty": empty })[id];
  let nextTimer = 0;
  const timers = new Set();
  const context = vm.createContext({
    document, currentLanguage: "zh",
    window: {
      addEventListener(type, handler) { events.set(type, handler); },
      setInterval() { timers.add(++nextTimer); return nextTimer; },
      clearInterval(id) { timers.delete(id); }
    }
  });
  vm.runInContext(fs.readFileSync("js/home-updates.js", "utf8"), context);
  const click = item => { document.activeElement = item; item.listeners.click(); };
  return { context, entries, buttons, more, count, empty, toolbar, document, click, events, timers, visible: () => entries.filter(entry => !entry.hidden) };
}

test("homepage updates initially show six entries and paginate within the page", () => {
  const app = setup();
  assert.equal(app.visible().length, 6);
  assert.equal(app.toolbar.hidden, false);
  assert.equal(app.count.textContent, "显示 6 / 29 条动态");
  app.click(app.more);
  assert.equal(app.visible().length, 12);
  assert.equal(app.document.activeElement, app.more);
  assert.equal(app.more.hidden, false);
});

test("creator filtering resets the batch while language changes preserve filter and expansion", () => {
  const app = setup();
  app.click(app.buttons[2]);
  assert.ok(app.visible().every(entry => entry.dataset.creator === "nknk"));
  app.click(app.more);
  assert.equal(app.visible().length, 12);
  app.context.currentLanguage = "ja";
  app.events.get("languagechange")();
  assert.equal(app.visible().length, 12);
  assert.equal(app.count.textContent, "17件中12件を表示");
  assert.equal(app.buttons[2].attributes["aria-pressed"], "true");
  app.click(app.buttons[1]);
  assert.equal(app.visible().length, 6);
  assert.ok(app.visible().every(entry => entry.dataset.creator === "inabakumori"));
});

test("loading the final batch moves focus from the hidden button to the first new title", () => {
  const app = setup(Array(8).fill("nknk"));
  app.click(app.more);
  assert.equal(app.more.hidden, true);
  assert.equal(app.visible().length, 8);
  assert.equal(app.document.activeElement, app.entries[6].querySelector("h3 a"));
});

test("an empty creator result shows an explicit empty state without an unusable more button", () => {
  const app = setup(Array(3).fill("inabakumori"));
  app.click(app.buttons[2]);
  assert.equal(app.visible().length, 0);
  assert.equal(app.empty.hidden, false);
  assert.equal(app.more.hidden, true);
  assert.equal(app.count.textContent, "显示 0 / 0 条动态");
});

test("bfcache restores the existing filter and a single staleness timer", () => {
  const app = setup();
  app.click(app.buttons[2]);
  app.click(app.more);
  assert.equal(app.timers.size, 1);
  app.events.get("pagehide")();
  assert.equal(app.timers.size, 0);
  app.events.get("pageshow")();
  assert.equal(app.timers.size, 1);
  assert.equal(app.visible().length, 12);
  assert.ok(app.visible().every(entry => entry.dataset.creator === "nknk"));
});

test("homepage links lead to the integrated section and its progressive controls are initially hidden", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const beforeContent = html.slice(0, html.indexOf('<main id="main-content"'));
  assert.doesNotMatch(beforeContent, /href="updates\.html"/u);
  assert.equal([...beforeContent.matchAll(/href="#updates"/gu)].length, 3);
  assert.match(html, /id="updates" class="home-updates"/u);
  assert.match(html, /id="home-updates-feed"/u);
  assert.match(html, /aria-controls="home-updates-feed" hidden/u);
  assert.match(html, /<!-- HOME-UPDATES:ITEMS -->/u);
});
