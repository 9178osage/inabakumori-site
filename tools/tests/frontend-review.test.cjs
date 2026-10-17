const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function page() {
  const nodes = new Map(), saved = new Map(), listeners = new Map();
  let refuseWrites = false, requests = 0;
  const node = () => ({
    dataset: {}, value: "", textContent: "", style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, addEventListener() {}, focus() { document.activeElement = this; }
  });
  const document = {
    documentElement: node(), body: node(), hidden: false,
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}
  };
  const localStorage = {
    getItem(key) { return saved.get(key) ?? null; },
    setItem(key, value) { if (refuseWrites) throw new Error("Synthetic quota exhaustion"); saved.set(key, String(value)); }
  };
  const context = {
    document, localStorage, Event, navigator: { onLine: true }, innerHeight: 800, innerWidth: 1280,
    APP_CONFIG: { apiDomain: "https://synthetic.invalid" },
    setInterval() {}, setTimeout() {}, clearTimeout() {},
    matchMedia() { return { matches: false, addEventListener() {} }; },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
    dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); },
    console: { error() {} }, siteFetch: async () => { requests++; throw new Error("Unexpected request"); }
  };
  context.window = context;
  context.top = context.self = context;
  vm.createContext(context);
  for (const file of ["js/preferences.js", "js/i18n.js", "script.js"]) vm.runInContext(fs.readFileSync(file, "utf8"), context);
  return {
    context, document, saved, nodes, localStorage,
    run: code => vm.runInContext(code, context),
    quotaFull(value) { refuseWrites = value; }, requests: () => requests,
    storage(key, newValue, storageArea = localStorage) { context.dispatchEvent({ type: "storage", key, newValue, storageArea }); }
  };
}

test("a cross-tab language update replaces the fallback left by an earlier quota failure", () => {
  const app = page();
  app.quotaFull(true);
  app.run("toggleLanguage()");
  assert.equal(app.run("currentLanguage"), "en");
  assert.equal(app.context.siteStorage.getItem("language"), "en");
  // Another tab frees quota and successfully writes a new language.
  app.quotaFull(false);
  app.saved.set("language", "ja");
  app.storage("language", "ja");
  assert.equal(app.run("currentLanguage"), "ja");
  assert.equal(app.context.siteStorage.getItem("language"), "ja");
  assert.equal(app.context.siteText("删除", "Delete"), app.run('pageText("删除", "Delete")'));
});

test("storage clear resets quota fallbacks, while other storage areas leave them intact", () => {
  const app = page();
  app.quotaFull(true);
  app.context.siteStorage.setItem("theme", "dark");
  app.context.siteStorage.setItem("language", "en");
  app.storage("theme", null, {});
  assert.equal(app.context.siteStorage.getItem("theme"), "dark");
  app.storage(null, null);
  assert.equal(app.context.siteStorage.getItem("theme"), null);
  assert.equal(app.context.siteStorage.getItem("language"), null);
});

test("Unicode line and paragraph separators cannot bypass the frontend's 15-break limit", async () => {
  const app = page();
  app.document.getElementById("message-name").value = "fan";
  for (const separator of ["\u2028", "\u2029", "\r\n", "\n"]) {
    const overlong = Array.from({ length: 17 }, () => "雨").join(separator);
    app.document.getElementById("message-input").value = overlong;
    assert.equal(app.run(`countCommentLineBreaks(${JSON.stringify(overlong)})`), 16);
    await app.run("addMessage()");
    assert.equal(app.requests(), 0, "invalid line counts are rejected before posting");
    assert.match(app.document.getElementById("message-submit-status").textContent, /15/u);
    assert.equal(app.document.activeElement, app.document.getElementById("message-input"));
    const valid = Array.from({ length: 16 }, () => "雨").join(separator);
    assert.equal(app.run(`countCommentLineBreaks(${JSON.stringify(valid)})`), 15);
  }
  assert.equal(app.run('countCommentLineBreaks("首\\u2028\\u2029\\n\\r\\n尾")'), 2, "mixed blank-line runs still collapse");
});
