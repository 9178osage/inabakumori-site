const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  let now = 1_000_000;
  let timerId = 0;
  const timers = new Map();
  const elements = {
    "message-load-status": {},
    "message-retry": {},
    "floating-wall": { setAttribute() {} }
  };
  const context = {
    Date: class extends Date { static now() { return now; } },
    console: { error() {} },
    localStorage: { getItem: () => null },
    document: {
      documentElement: {}, addEventListener() {},
      getElementById: id => elements[id], querySelector: () => null, querySelectorAll: () => []
    },
    window: { APP_CONFIG: { apiDomain: "http://localhost:3001" }, addEventListener() {}, dispatchEvent() {} },
    setInterval() {},
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/i18n.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("script.js", "utf8"), context);
  const run = code => vm.runInContext(code, context);
  const limited = seconds => {
    context.window.siteFetch = async () => ({ status: 429, headers: { get: () => String(seconds) } });
    return run("loadMessages()");
  };
  return {
    context, elements, timers, run, limited,
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due > now) continue;
        timers.delete(id);
        timer.callback();
      }
    }
  };
}

test("429 countdown advances without interaction and allows retry at zero in all languages", async () => {
  for (const [language, initial, next, ready] of [
    ["zh", "留言读取过于频繁，请在 2 秒后重试。", "留言读取过于频繁，请在 1 秒后重试。", "现在可以重新加载留言。"],
    ["en", "Too many requests. Please retry in 2 s.", "Too many requests. Please retry in 1 s.", "You can retry loading messages now."],
    ["ja", "読み込みが多すぎます。2 秒後に再試行してください。", "読み込みが多すぎます。1 秒後に再試行してください。", "メッセージを再読み込みできます。"]
  ]) {
    const app = setup();
    app.run(`currentLanguage = "${language}"`);
    await app.limited(2);
    assert.equal(app.elements["message-load-status"].textContent, initial);
    assert.equal(app.elements["message-retry"].disabled, true);
    assert.equal(app.timers.size, 1);
    app.advance(1000);
    assert.equal(app.elements["message-load-status"].textContent, next);
    app.advance(1000);
    assert.equal(app.elements["message-load-status"].textContent, ready);
    assert.equal(app.elements["message-retry"].hidden, false);
    assert.equal(app.elements["message-retry"].disabled, false);
    assert.equal(app.timers.size, 0, "expired countdown must stop ticking");
    app.context.window.siteFetch = async () => ({ ok: true, json: async () => ({ comments: [] }) });
    await app.run("loadMessages()");
    assert.equal(app.run("messageLoadState"), "empty");
    assert.equal(app.elements["message-retry"].hidden, true);
  }
});

test("language changes keep one countdown and a delayed timer catches up after tab suspension", async () => {
  const app = setup();
  await app.limited(5);
  app.run('currentLanguage = "en"; updateMessageLoadStatus()');
  assert.equal(app.timers.size, 1, "language changes must replace the pending timer");
  assert.equal(app.elements["message-load-status"].textContent, "Too many requests. Please retry in 5 s.");
  app.advance(60_000);
  assert.equal(app.elements["message-load-status"].textContent, "You can retry loading messages now.");
  assert.equal(app.elements["message-retry"].disabled, false);
  assert.equal(app.timers.size, 0);
});

test("a new load clears the old countdown so its result cannot be overwritten", async () => {
  const app = setup();
  await app.limited(30);
  let resolve;
  app.context.window.siteFetch = () => new Promise(done => { resolve = done; });
  const loading = app.run("loadMessages()");
  assert.equal(app.timers.size, 0);
  assert.equal(app.run("messageLoadState"), "loading");
  resolve({ ok: true, json: async () => ({ comments: [] }) });
  await loading;
  app.advance(60_000);
  assert.equal(app.run("messageLoadState"), "empty");
  assert.equal(app.elements["message-load-status"].textContent, "还没有留言，来留下第一条吧。");
  assert.equal(app.elements["message-retry"].hidden, true);
  assert.equal(app.timers.size, 0);
});
