const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const loader = fs.readFileSync("js/auth-loader.js", "utf8").replace("import(", "loadBundle(");

function page({ cookie = "", url = "https://osagechan.top/", defer = false, fail = false } = {}) {
  const imported = [], requests = [], alerts = [], events = [], listeners = {};
  const location = new URL(url), attributes = {};
  const button = { innerText: "登录 / 注册", setAttribute(name, value) { attributes[name] = value; } };
  let finish, reject, modalCalls = 0, signedIn = true;
  const context = { URL, URLSearchParams, Promise, Event, alert: message => alerts.push(message),
    localStorage: { getItem: () => "zh" },
    document: { cookie, currentScript: { src: new URL("js/auth-loader.js?v=loader", location).href }, getElementById: () => button },
    window: { location, history: { state: { retained: true }, replaceState(state, _, next) {
      this.state = state; this.next = next;
    } }, addEventListener(name, callback) { listeners[name] = callback; },
    dispatchEvent: event => events.push(event.type),
    siteFetch: async (...args) => { requests.push(args); return { ok: true }; } },
    loadBundle(importUrl) {
      imported.push(importUrl);
      return new Promise((resolve, rejectLoad) => {
        finish = () => {
          context.window.openAuthModal = async () => { modalCalls++; };
          context.window.hasCommentSession = async () => signedIn;
          resolve();
        };
        reject = () => rejectLoad(new Error("synthetic module unavailable"));
        if (fail) { fail = false; reject(); }
        else if (!defer) finish();
      });
    }
  };
  vm.createContext(context);
  vm.runInContext(loader, context);
  return { context, imported, requests, alerts, events, button, attributes, listeners,
    finish: () => finish(), reject: () => reject(), modalCalls: () => modalCalls, signedIn(value) { signedIn = value; } };
}
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

test("anonymous visitors read and post as guests without loading the SDK or refreshing a session", async () => {
  const app = page();
  assert.equal(await app.context.window.hasCommentSession(), false);
  await app.context.window.siteFetch("https://api.example.test/api/comments");
  await app.context.window.siteFetch("https://api.example.test/api/comments", { method: "POST", body: "guest" });
  assert.equal(app.imported.length, 0);
  assert.equal(app.requests.length, 2);
  assert.equal(app.button.innerText, "登录 / 注册");
});

test("only exact nonempty host-only credential names restore HTTPS sessions", async () => {
  for (const cookie of ["st-refresh-token=legacy", "__Host-station-sFrontToken=", "other__Host-station-st-refresh-token=wrong", "__Host-station-st-last-access-token-update=123"]) {
    const app = page({ cookie });
    assert.equal(await app.context.window.hasCommentSession(), false);
    assert.equal(app.imported.length, 0);
  }
  for (const cookie of ["__Host-station-st-access-token=access", "__Host-station-st-refresh-token=refresh", "__Host-station-sFrontToken=front"]) {
    const app = page({ cookie });
    assert.equal(await app.context.window.hasCommentSession(), true);
    assert.equal(app.imported.length, 1);
  }
  assert.equal(await page({ url: "http://localhost:5500/", cookie: "st-refresh-token=local" }).context.window.hasCommentSession(), true);
});

test("a returning member's first request waits for one shared SDK load", async () => {
  const app = page({ cookie: "__Host-station-st-refresh-token=refresh", defer: true });
  const read = app.context.window.hasCommentSession();
  const write = app.context.window.siteFetch("/api/comments", { method: "POST" });
  assert.equal(app.imported.length, 1);
  assert.equal(app.requests.length, 0, "never downgrade a returning member's post to a guest");
  app.finish();
  assert.equal(await read, true);
  await write;
  assert.equal(app.requests.length, 1);
});

test("sign-in starts one load, ignores duplicate taps and restores the button after failure and retry", async () => {
  const app = page({ defer: true });
  const first = app.context.window.openAuthModal();
  await app.context.window.openAuthModal();
  assert.equal(app.attributes["aria-busy"], "true");
  assert.equal(app.imported.length, 1);
  app.reject(); await first;
  assert.equal(app.attributes["aria-busy"], "false");
  assert.equal(app.alerts.length, 1);
  const retry = app.context.window.openAuthModal();
  assert.equal(app.imported.length, 2);
  assert.match(app.imported[1], /auth\.js\?v=20261028lazy&retry=2$/u);
  app.finish(); await retry;
  assert.equal(app.modalCalls(), 1);
  assert.equal(app.attributes["aria-disabled"], "false");
});

test("reset URLs scrub tokens before loading the module and preserve other URL state", async () => {
  const app = page({ url: "https://osagechan.top/?resetPassword=1&token=private&tenantId=tenant&q=rain#section", defer: true });
  assert.equal(app.context.window.history.next, "/?q=rain#section");
  assert.equal(app.context.window.siteAuthReset.token, "private");
  assert.equal(app.context.window.siteAuthReset.tenantId, "tenant");
  assert.equal(app.imported.length, 1);
  const fragment = page({ url: "https://osagechan.top/?q=rain#token=fragment%2Btoken&tenantId=public&section=rain", defer: true });
  assert.equal(fragment.context.window.history.next, "/?q=rain#section=rain");
  assert.equal(fragment.context.window.siteAuthReset.token, "fragment+token");
});

test("cross-tab sign-in loads on demand and announces the restored state once", async () => {
  const app = page({ defer: true });
  app.listeners.storage({ key: "auth-sync" });
  assert.equal(app.imported.length, 0);
  app.context.document.cookie = "__Host-station-st-refresh-token=other-tab";
  app.listeners.storage({ key: "auth-sync" });
  assert.equal(app.imported.length, 1);
  app.finish(); await settle();
  assert.deepEqual(app.events, ["authchange"]);
  app.listeners.storage({ key: "auth-sync" });
  assert.equal(app.imported.length, 1);
});

test("a failed automatic restoration blocks a member write instead of sending it anonymously", async () => {
  const app = page({ cookie: "__Host-station-st-refresh-token=refresh", defer: true });
  const write = app.context.window.siteFetch("/api/comments", { method: "POST" });
  app.reject();
  await assert.rejects(write, /synthetic module unavailable/u);
  assert.equal(app.requests.length, 0);
  assert.match(app.button.innerText, /点击重试/u);
});
