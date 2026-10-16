const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("tools/auth-src.js", "utf8").replace(/^import .*;\n/gm, "");

function setup() {
  const elements = {}, listeners = {}, configs = {}, timers = new Map(), notices = [];
  let nextTimer = 0, language = "zh";
  const context = {
    URL, URLSearchParams, Event, AbortController, DOMException,
    // Deliberately omit AbortSignal.timeout/any, as in older Safari.
    console: { error() {} },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    localStorage: { getItem: () => language, setItem() {} },
    SuperTokens: { init() {} },
    EmailPassword: { init(config) { configs.email = config; } },
    Session: { init(config) { configs.session = config; } },
    doesSessionExist: async () => false,
    alert(message) { notices.push(message); },
    window: {
      APP_CONFIG: { apiDomain: "https://api.example.test" },
      location: new URL("https://site.example.test/"),
      history: { state: null, replaceState() {} },
      addEventListener(name, handler) { listeners[name] = handler; }, dispatchEvent() {}
    },
    document: {
      getElementById: id => elements[id], addEventListener(name, handler) { listeners[name] = handler; }
    }
  };
  for (const id of ["auth-btn", "auth-title", "auth-email", "auth-password", "auth-password-confirm", "auth-submit", "auth-switch", "auth-forgot", "auth-status", "auth-error", "auth-close"]) {
    elements[id] = {
      id, value: "", hidden: false, disabled: false, attributes: {},
      focus() { context.document.activeElement = this; },
      setAttribute(name, value) { this.attributes[name] = String(value); }
    };
  }
  const classes = new Set();
  elements["auth-modal"] = { classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) } };
  context.document.activeElement = elements["auth-btn"];
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/i18n.js", "utf8"), context);
  vm.runInContext(source, context);
  return {
    context, configs, elements, timers, notices,
    run: code => vm.runInContext(code, context),
    language(value) { language = value; },
    expireRequests() {
      const pending = [...timers.values()];
      assert.ok(pending.length > 0, "a request has a deadline");
      for (const timer of pending) assert.equal(timer.delay, 15000);
      timers.clear();
      for (const timer of pending) timer.callback();
    }
  };
}

async function settleUntil(condition) {
  for (let turn = 0; turn < 30 && !condition(); turn++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(condition(), "the expected asynchronous SDK step was reached");
}

test("auth deadlines preserve SDK request options and caller cancellation without AbortSignal.timeout/any", async () => {
  const app = setup();
  for (const hook of [app.configs.email.preAPIHook, app.configs.session.preAPIHook]) {
    assert.equal(typeof hook, "function");
    const caller = new AbortController();
    const options = { method: "POST", headers: { example: "kept" }, body: "synthetic", credentials: "include", signal: caller.signal };
    const result = await hook({ url: "https://api.example.test/auth/synthetic", requestInit: options });
    assert.equal(result.url, "https://api.example.test/auth/synthetic");
    assert.equal(result.requestInit.headers, options.headers);
    assert.equal(result.requestInit.body, options.body);
    assert.equal(result.requestInit.credentials, "include");
    assert.equal(options.signal, caller.signal, "the caller's options are not mutated");
    assert.notEqual(result.requestInit.signal, caller.signal);
    const reason = new DOMException("Cancelled by caller", "AbortError");
    caller.abort(reason);
    assert.equal(result.requestInit.signal.aborted, true);
    assert.equal(result.requestInit.signal.reason, reason);
    assert.equal(app.timers.size, 0, "caller cancellation removes the deadline timer");

    const alreadyCancelled = await hook({ url: result.url, requestInit: options });
    assert.equal(alreadyCancelled.requestInit.signal.aborted, true);
    assert.equal(alreadyCancelled.requestInit.signal.reason, reason);
    assert.equal(app.timers.size, 0, "an already-aborted request needs no new timer");

    const live = await hook({ url: result.url, requestInit: {} });
    assert.equal(live.requestInit.signal.aborted, false);
    app.expireRequests();
    assert.equal(live.requestInit.signal.aborted, true);
    assert.equal(live.requestInit.signal.reason.name, "TimeoutError");
  }
});

test("the real SDK aborts four submissions, sign-out and expired-session refresh and unlocks the account UI", async () => {
  const app = setup();
  const SuperTokens = require("supertokens-web-js").default;
  const EmailPassword = require("supertokens-web-js/recipe/emailpassword");
  const Session = require("supertokens-web-js/recipe/session");
  const sdk = require("supertokens-website/lib/build/fetch");
  const jar = new Map(), saved = new Map(), requests = [], actions = [];
  let behaviour = "stall", acquired = 0, released = 0;
  const frontToken = expires => Buffer.from(JSON.stringify({ uid: "synthetic-user", ate: expires, up: { iat: Math.floor(Date.now() / 1000) } })).toString("base64");
  const browser = {
    async fetch(url, options) {
      const request = { url: String(url), options, aborted: false };
      requests.push(request);
      assert.ok(options.signal, "the real SDK forwards the hook's abort signal to fetch");
      if (behaviour === "stall") {
        return new Promise((resolve, reject) => {
          const abort = () => { request.aborted = true; reject(options.signal.reason); };
          if (options.signal.aborted) abort();
          else options.signal.addEventListener("abort", abort, { once: true });
        });
      }
      const signedOut = String(url).endsWith("/signout");
      const sessionResponse = /\/(?:signin|signup|session\/refresh)$/.test(String(url));
      const headers = signedOut ? { "front-token": "remove" } : sessionResponse ? {
        "front-token": frontToken(Date.now() + 3600000), "st-access-token": "synthetic-access", "st-refresh-token": "synthetic-refresh"
      } : {};
      return new Response(JSON.stringify({ status: "OK", user: { id: "synthetic-user", email: "synthetic@example.test", timeJoined: 1 } }), { headers });
    }
  };
  SuperTokens.init({
    appInfo: { appName: "Auth timeout regression", apiDomain: "https://api.example.test", apiBasePath: "/auth" },
    cookieHandler: () => ({
      async getCookie() { return [...jar].map(([key, value]) => `${key}=${value}`).join("; "); },
      async setCookie(cookie) {
        const pair = cookie.split(";")[0], index = pair.indexOf("=");
        const key = pair.slice(0, index), value = pair.slice(index + 1);
        if (/expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(key); else jar.set(key, value);
      }
    }),
    windowHandler: original => ({
      ...original, getWindowUnsafe: () => browser,
      location: { ...original.location, getHostName: () => "site.example.test", getOrigin: () => "https://site.example.test", getSearch: () => "" },
      localStorage: { ...original.localStorage, getItemSync: key => saved.get(key) ?? null, setItemSync: (key, value) => saved.set(key, value) }
    }),
    recipeList: [
      EmailPassword.default.init(app.configs.email),
      Session.default.init({
        ...app.configs.session,
        preAPIHook: context => { actions.push(context.action); return app.configs.session.preAPIHook(context); },
        lockFactory: async () => ({ acquireLock: async () => { acquired++; return true; }, releaseLock: async () => { released++; } }),
        override: { functions: original => ({ ...original, addXMLHttpRequestInterceptor() {} }) }
      })
    ]
  });
  Object.assign(app.context, {
    signIn: EmailPassword.signIn, signUp: EmailPassword.signUp,
    sendPasswordResetEmail: EmailPassword.sendPasswordResetEmail, submitNewPassword: EmailPassword.submitNewPassword,
    signOut: Session.signOut, doesSessionExist: Session.doesSessionExist
  });
  const originalFetch = global.fetch;
  global.fetch = browser.fetch;
  try {
    await sdk.saveLastAccessTokenUpdate();
    assert.equal(await Session.doesSessionExist(), false);
    const expectedError = {
      zh: "连接服务器失败，请稍后重试。",
      en: "Could not connect to the server. Please try again later.",
      ja: "サーバーに接続できませんでした。しばらくしてから再試行してください。"
    };
    for (const [mode, language, endpoint] of [["signin", "zh", "/signin"], ["signup", "en", "/signup"], ["forgot", "ja", "/user/password/reset/token"], ["reset", "zh", "/user/password/reset"]]) {
      app.language(language);
      app.run(`showAuthModal(${JSON.stringify(mode)})`);
      if (mode === "reset") app.run('resetToken = "synthetic-reset"; resetLinkRequested = true;');
      app.elements["auth-email"].value = "synthetic@example.test";
      app.elements["auth-password"].value = app.elements["auth-password-confirm"].value = "Synthetic123";
      behaviour = "stall";
      const count = requests.length;
      const pending = app.run("submitAuth()");
      await settleUntil(() => requests.length > count);
      assert.ok(requests[count].url.endsWith(endpoint), requests[count].url);
      assert.equal(app.elements["auth-submit"].disabled, true);
      app.run("closeAuthModal()");
      app.expireRequests();
      await pending;
      assert.equal(requests[count].aborted, true, `${mode} aborts the actual request`);
      assert.equal(app.run("authSubmitting"), false);
      assert.equal(app.elements["auth-submit"].disabled, false);
      assert.equal(app.elements["auth-error"].innerText, expectedError[language]);
      await app.run("openAuthModal()");
      assert.equal(app.elements["auth-modal"].classList.contains("open"), true, `${mode} can reopen after timeout`);

      // Retry the original operation through the real SDK; it receives a fresh signal and succeeds.
      app.run(`showAuthModal(${JSON.stringify(mode)})`);
      app.elements["auth-password"].value = app.elements["auth-password-confirm"].value = "Synthetic123";
      behaviour = "ok";
      await app.run("submitAuth()");
      assert.equal(app.run("authSubmitting"), false);
      assert.equal(app.elements["auth-error"].innerText, "");
      assert.equal(requests[count + 1].options.signal.aborted, false, "a retry does not reuse the aborted signal");
      await Session.signOut();
      app.timers.clear();
    }

    await sdk.FrontToken.setItem(frontToken(Date.now() + 3600000));
    await sdk.setToken("access", "synthetic-access");
    await sdk.setToken("refresh", "synthetic-refresh");
    app.run('resetToken = ""; closeAuthModal();');
    behaviour = "stall";
    let count = requests.length;
    const signingOut = app.run("openAuthModal()");
    await settleUntil(() => requests.length > count);
    assert.ok(requests[count].url.endsWith("/signout"));
    assert.equal(app.run("authOpening"), true);
    app.expireRequests();
    await signingOut;
    assert.equal(requests[count].aborted, true);
    assert.equal(app.run("authOpening"), false);
    assert.equal(app.elements["auth-btn"].attributes["aria-disabled"], "false");
    behaviour = "ok";
    await app.run("openAuthModal()");
    await app.run("openAuthModal()");
    assert.equal(app.elements["auth-modal"].classList.contains("open"), true, "sign-out timeout does not lock subsequent account actions");
    app.run("closeAuthModal()");
    app.timers.clear();

    await sdk.FrontToken.setItem(frontToken(Date.now() - 1000));
    await sdk.setToken("access", "synthetic-expired-access");
    await sdk.setToken("refresh", "synthetic-refresh");
    behaviour = "stall";
    count = requests.length;
    const refreshing = app.run("openAuthModal()");
    await settleUntil(() => requests.length > count);
    assert.ok(requests[count].url.endsWith("/session/refresh"));
    app.expireRequests();
    await refreshing;
    assert.equal(requests[count].aborted, true);
    assert.equal(app.run("authOpening"), false);
    assert.equal(acquired, released, "the SDK releases its refresh lock after the request is aborted");
    app.run("closeAuthModal()");
    behaviour = "ok";
    await app.run("openAuthModal()");
    await app.run("openAuthModal()");
    assert.equal(app.elements["auth-modal"].classList.contains("open"), true, "refresh timeout permits a later retry and reopening");
    assert.ok(actions.includes("SIGN_OUT"));
    assert.ok(actions.includes("REFRESH_SESSION"));
    assert.equal(acquired, released);
  } finally {
    global.fetch = originalFetch;
    app.timers.clear();
  }
});
