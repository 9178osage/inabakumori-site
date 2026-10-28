const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("the real header-session SDK skips anonymous refresh without blocking login or session recovery", async t => {
  const source = fs.readFileSync("tools/auth-src.js", "utf8").replace(/^import .*;\n/gm, "").split('let resetToken = "";')[0];
  const context = vm.createContext({ window: { location: new URL("https://osagechan.top/") } });
  vm.runInContext(source, context);
  const jar = new Map(), calls = [], writes = [], storage = new Map();
  const originalCookieHandler = {
    async getCookie() { return [...jar].map(([name, value]) => `${name}=${value}`).join("; "); },
    async setCookie(cookie) {
      writes.push(cookie);
      const pair = cookie.split(";")[0], index = pair.indexOf("=");
      const name = pair.slice(0, index), value = pair.slice(index + 1);
      if (/expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }
  };
  let handler;
  const frontToken = expires => Buffer.from(JSON.stringify({ uid: "synthetic-user", ate: expires,
    up: { iat: Math.floor(Date.now() / 1000) } })).toString("base64");
  const browser = {
    async fetch(url, options = {}) {
      const pathname = new URL(String(url)).pathname;
      const headers = new Headers(options.headers);
      calls.push({ pathname, authorization: headers.get("authorization"), method: options.method || "GET" });
      if (pathname.endsWith("/session/refresh")) {
        assert.equal(headers.get("authorization"), "Bearer synthetic-refresh", "recovery must use the existing refresh credential");
      }
      const signedOut = pathname.endsWith("/signout");
      const sessionResponse = /\/(?:signin|session\/refresh)$/u.test(pathname);
      const responseHeaders = signedOut ? { "front-token": "remove" } : sessionResponse ? {
        "front-token": frontToken(Date.now() + 3600000),
        "st-access-token": "synthetic-access", "st-refresh-token": "synthetic-refresh"
      } : {};
      const body = pathname.endsWith("/signin") ? { status: "OK", user: {
        id: "synthetic-user", email: "synthetic@example.test", timeJoined: 1
      } } : { status: "OK", comments: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: responseHeaders });
    }
  };
  const SuperTokens = require("supertokens-web-js").default;
  const EmailPassword = require("supertokens-web-js/recipe/emailpassword");
  const Session = require("supertokens-web-js/recipe/session");
  const sdk = require("supertokens-website/lib/build/fetch");
  SuperTokens.init({
    appInfo: { appName: "Anonymous header-session regression", apiDomain: "https://api.example.test", apiBasePath: "/auth" },
    cookieHandler: () => ({ getCookie: () => handler.getCookie(), setCookie: cookie => handler.setCookie(cookie) }),
    windowHandler: original => ({
      ...original, getWindowUnsafe: () => browser,
      location: { ...original.location, getHostName: () => context.window.location.hostname,
        getOrigin: () => context.window.location.origin, getSearch: () => "" },
      localStorage: { ...original.localStorage, getItemSync: key => storage.get(key) ?? null,
        setItemSync: (key, value) => storage.set(key, value) }
    }),
    recipeList: [EmailPassword.default.init(), Session.default.init({ tokenTransferMethod: "header",
      lockFactory: async () => ({ acquireLock: async () => true, releaseLock: async () => {} }),
      override: { functions: original => ({ ...original, addXMLHttpRequestInterceptor() {} }) }
    })]
  });
  const savedFetch = global.fetch;
  global.fetch = browser.fetch;
  try {
    for (const origin of ["https://osagechan.top/", "http://localhost:5500/"]) await t.test(origin, async () => {
      context.window.location = new URL(origin);
      jar.clear(); calls.length = writes.length = 0;
      handler = context.anonymousSessionCookieHandler(context.secureSessionCookieHandler(originalCookieHandler));
      assert.equal(await Session.doesSessionExist(), false);
      await browser.fetch("https://api.example.test/api/comments", { credentials: "include" });
      await browser.fetch("https://api.example.test/api/comments", { method: "POST", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: "fan", content: "synthetic guest message" }) });
      assert.deepEqual(calls.map(call => call.pathname), ["/api/comments", "/api/comments"]);
      assert.ok(calls.every(call => call.authorization === null), "anonymous reads and guest writes carry no session credential");
      assert.equal(writes.length, 0, "the anonymous marker exists only in the virtual read and never creates a cookie");
      assert.equal(jar.size, 0);

      const login = await EmailPassword.signIn({ formFields: [
        { id: "email", value: "synthetic@example.test" }, { id: "password", value: "Synthetic123" }
      ] });
      assert.equal(login.status, "OK");
      assert.equal(await Session.doesSessionExist(), true);
      assert.equal(await Session.getUserId(), "synthetic-user");
      assert.equal(calls.filter(call => call.pathname.endsWith("/session/refresh")).length, 0);
      const prefix = origin.startsWith("https:") ? "__Host-station-" : "";
      assert.equal(jar.get(`${prefix}st-access-token`), "synthetic-access");
      assert.equal(jar.get(`${prefix}st-refresh-token`), "synthetic-refresh");
      await browser.fetch("https://api.example.test/api/comments/mine", { credentials: "include" });
      assert.equal(calls.at(-1).authorization, "Bearer synthetic-access");

      // A real expired access token still uses the SDK's refresh path.
      await sdk.FrontToken.setItem(frontToken(Date.now() - 1000));
      const beforeRefresh = calls.length;
      assert.equal(await Session.doesSessionExist(), true);
      assert.deepEqual(calls.slice(beforeRefresh).map(call => call.pathname), ["/auth/session/refresh"]);
      assert.equal((await sdk.FrontToken.getTokenInfo()).uid, "synthetic-user");

      // Metadata loss with an existing refresh credential is not an anonymous visitor.
      for (const key of [...jar.keys()]) if (key !== `${prefix}st-refresh-token`) jar.delete(key);
      const beforeRecovery = calls.length;
      assert.equal(await Session.doesSessionExist(), true);
      assert.deepEqual(calls.slice(beforeRecovery).map(call => call.pathname), ["/auth/session/refresh"]);
      assert.equal(jar.get(`${prefix}st-access-token`), "synthetic-access");
      assert.ok(jar.get(`${prefix}sFrontToken`));

      await Session.signOut();
      const afterSignOut = calls.length;
      assert.equal(await Session.doesSessionExist(), false);
      await browser.fetch("https://api.example.test/api/comments", { credentials: "include" });
      assert.equal(calls.length, afterSignOut + 1, "a public read after sign-out does not attempt refresh");
      assert.equal(calls.at(-1).authorization, null);
      for (const key of ["st-access-token", "st-refresh-token", "sFrontToken"]) assert.equal(jar.has(prefix + key), false);
      if (prefix) for (const cookie of writes) {
        assert.match(cookie, /^__Host-station-/u);
        assert.match(cookie, /;path=\/;secure$/iu);
        assert.doesNotMatch(cookie, /;domain=/iu);
      }
    });
  } finally { global.fetch = savedFetch; }
});
