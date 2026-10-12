const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Minimal forgiving DOM: enough for script.js's DOMContentLoaded handler to run without js/songs.js.
class FakeElement {
  constructor(id = "") {
    this.id = id; this.children = []; this.dataset = {}; this.style = { setProperty() {} }; this.listeners = {};
    this.attributes = {}; this.value = ""; this.text = "";
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  get textContent() { return this.text; } set textContent(v) { this.text = String(v); }
  get innerText() { return this.text; } set innerText(v) { this.text = String(v); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  click() { for (const handler of this.listeners.click || []) handler({ target: this, preventDefault() {} }); }
  append(...nodes) { this.children.push(...nodes); } appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelector() { return null; } querySelectorAll() { return []; }
  getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
  focus() {} remove() {}
}

function loadWithoutSongs() {
  const elements = {};
  const byId = id => (elements[id] ||= new FakeElement(id));
  const list = byId("song-list");
  list.children = ["pre-rendered song 1", "pre-rendered song 2"];
  const ready = [];
  const errors = [];
  const document = {
    documentElement: new FakeElement("html"), body: new FakeElement("body"), hidden: false,
    addEventListener(type, handler) { if (type === "DOMContentLoaded") ready.push(handler); },
    getElementById: byId, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => new FakeElement(), createTextNode: text => ({ textContent: text })
  };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const context = {
    console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
    document, localStorage: storage, sessionStorage: storage, navigator: { onLine: true, language: "zh-CN" },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }),
    Event: class { constructor(type) { this.type = type; } }, URL, Intl, alert() {}
  };
  context.window = Object.assign(context, { APP_CONFIG: { apiDomain: "http://localhost:3001" }, addEventListener() {}, dispatchEvent() {}, innerWidth: 1280, innerHeight: 800 });
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/i18n.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("script.js", "utf8"), context);
  return { context, elements, list, ready, errors };
}

test("a failed js/songs.js load keeps the pre-rendered list and the language/theme buttons working", () => {
  const { context, elements, list, ready } = loadWithoutSongs();
  assert.equal(vm.runInContext("typeof SONGS", context), "undefined");
  assert.ok(ready.length > 0, "script.js registers a DOMContentLoaded handler");
  for (const handler of ready) assert.doesNotThrow(() => handler(), "startup must not throw without SONGS");
  assert.deepEqual(list.children, ["pre-rendered song 1", "pre-rendered song 2"], "pre-rendered songs must not be cleared");
  const before = vm.runInContext("currentLanguage", context);
  elements["lang-btn"].click();
  assert.notEqual(vm.runInContext("currentLanguage", context), before, "language button still switches language");
  const theme = vm.runInContext("currentTheme", context);
  elements["theme-btn"].click();
  assert.notEqual(vm.runInContext("currentTheme", context), theme, "theme button still switches theme");
});

test("zh view counts use 万/亿 with one decimal and no grouping", () => {
  const { context } = loadWithoutSongs();
  const format = n => vm.runInContext(`formatChineseViews(${n})`, context);
  assert.equal(format(3025787), "302.6万");
  assert.equal(format(99485203), "9948.5万");
  assert.equal(format(123456789), "1.2亿");
  assert.equal(format(9999), "9,999");
});

test("rate-limited message loads show a retry countdown from Retry-After in every language", async () => {
  const { context, elements } = loadWithoutSongs();
  vm.runInContext(fs.readFileSync("js/i18n.js", "utf8"), context);
  const run = code => vm.runInContext(code, context);
  assert.equal(run('retryAfterSeconds("42")'), 42);
  assert.equal(run('retryAfterSeconds("")'), 30);
  assert.equal(run('retryAfterSeconds("nonsense")'), 30);
  assert.ok(Math.abs(run(`retryAfterSeconds(new Date(Date.now() + 90000).toUTCString())`) - 90) <= 1);
  context.window.siteFetch = async () => ({ status: 429, ok: false, headers: { get: name => name.toLowerCase() === "retry-after" ? "25" : null }, json: async () => ({ code: "RATE_LIMITED" }) });
  await run("loadMessages()");
  assert.equal(run("messageLoadState"), "ratelimited");
  assert.equal(elements["message-load-status"].textContent, "留言读取过于频繁，请在 25 秒后重试。");
  assert.equal(elements["message-retry"].hidden, false, "retry stays available");
  run('currentLanguage = "en"; updateMessageLoadStatus()');
  assert.equal(elements["message-load-status"].textContent, "Too many requests. Please retry in 25 s.");
  context.localStorage.getItem = () => "ja";
  run('currentLanguage = "ja"; updateMessageLoadStatus()');
  assert.equal(elements["message-load-status"].textContent, "読み込みが多すぎます。25 秒後に再試行してください。");
});
