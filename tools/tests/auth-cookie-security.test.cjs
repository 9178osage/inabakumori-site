const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const authSource = fs.readFileSync("tools/auth-src.js", "utf8");
const handlerSource = authSource.replace(/^import .*;\n/gm, "").split('let resetToken = "";')[0];

function setup(protocol = "https:", initial = "", hostname = protocol === "http:" ? "localhost" : "osagechan.top") {
  const writes = [];
  const jar = new Map(initial.split(";").map(pair => pair.trim()).filter(Boolean).map(pair => {
    const index = pair.indexOf("=");
    return [pair.slice(0, index), pair.slice(index + 1)];
  }));
  const original = {
    async getCookie() { return [...jar].map(([name, value]) => `${name}=${value}`).join("; "); },
    async setCookie(cookie) {
      writes.push(cookie);
      const pair = cookie.split(";")[0];
      const index = pair.indexOf("=");
      const name = pair.slice(0, index), value = pair.slice(index + 1);
      if (/expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }
  };
  const context = vm.createContext({ window: { location: { protocol, hostname } } });
  vm.runInContext(handlerSource, context);
  const createHandler = () => context.secureSessionCookieHandler(original);
  return { handler: createHandler(), createHandler, original, writes, jar };
}

test("HTTPS discards every legacy SDK cookie without copying credentials or changing unrelated cookies", async () => {
  const app = setup("https:", "st-access-token=old-access; st-refresh-token=old-refresh==; sFrontToken=claims; st-last-access-token-update=123; sAntiCsrf=csrf; sIRTFrontend=legacy; theme=dark");
  assert.equal(await app.handler.getCookie(), "theme=dark");
  assert.equal(app.jar.get("theme"), "dark");
  assert.equal(app.jar.size, 1);
  assert.equal(app.writes.length, 6);
  for (const cookie of app.writes) {
    assert.match(cookie, /;secure(?:;|$)/i);
    assert.match(cookie, /;path=\/(?:;|$)/i);
    assert.match(cookie, /;samesite=lax(?:;|$)/i);
    assert.match(cookie, /expires=Thu, 01 Jan 1970/);
    assert.doesNotMatch(cookie, /old-access|old-refresh|claims|=csrf|=legacy/, "old values are never rewritten");
    assert.doesNotMatch(cookie, /;domain=/i);
    assert.doesNotMatch(cookie, /^theme=/);
  }
  await app.handler.getCookie();
  assert.equal(app.writes.length, 6);
});

test("two handlers sharing a cookie jar cannot overwrite a concurrent refresh rotation during initialization", async () => {
  const app = setup("https:", "st-refresh-token=legacy-refresh");
  await app.handler.getCookie();
  await app.handler.setCookie("st-refresh-token=old-refresh;path=/;samesite=lax");
  const fresh = app.createHandler();
  await Promise.all([
    fresh.getCookie(),
    app.handler.setCookie("st-refresh-token=rotated-refresh;path=/;samesite=lax")
  ]);
  assert.equal(app.jar.get("__Host-station-st-refresh-token"), "rotated-refresh");
  assert.equal(await fresh.getCookie(), "st-refresh-token=rotated-refresh");
  assert.equal(app.jar.has("st-refresh-token"), false);
});

test("two handlers sharing a cookie jar cannot resurrect a token deleted during initialization", async () => {
  const app = setup();
  await app.handler.setCookie("st-refresh-token=old-refresh;path=/;samesite=lax");
  const fresh = app.createHandler();
  await Promise.all([
    fresh.getCookie(),
    app.handler.setCookie("st-refresh-token=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;samesite=lax")
  ]);
  assert.equal(app.jar.has("__Host-station-st-refresh-token"), false);
  assert.equal(await fresh.getCookie(), "");
});

test("an old bundle's writes and deletions cannot replace or erase the new namespace", async () => {
  const app = setup();
  await app.handler.setCookie("st-refresh-token=new-session==;path=/;samesite=lax");
  await app.original.setCookie("st-refresh-token=old-bundle-token;path=/;samesite=lax");
  assert.equal(await app.handler.getCookie(), "st-refresh-token=new-session==");
  assert.equal(app.jar.has("st-refresh-token"), false);
  await app.original.setCookie("st-refresh-token=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;samesite=lax");
  assert.equal(await app.handler.getCookie(), "st-refresh-token=new-session==");
});

test("session metadata also round-trips through virtual SDK names and the host-only namespace", async () => {
  const app = setup();
  for (const name of ["sFrontToken", "sAntiCsrf", "st-last-access-token-update", "sIRTFrontend"]) {
    await app.handler.setCookie(`${name}=value==;expires=Fri, 31 Dec 9999 23:59:59 GMT;path=/old;domain=.osagechan.top;samesite=lax`);
    assert.equal(app.jar.get(`__Host-station-${name}`), "value==");
    assert.match(await app.handler.getCookie(), new RegExp(`${name}=value==`));
  }
  for (const cookie of app.writes) {
    assert.match(cookie, /^__Host-station-/);
    assert.match(cookie, /;path=\/;secure$/);
    assert.doesNotMatch(cookie, /;domain=/i);
    assert.doesNotMatch(cookie, /;path=\/old/i);
  }
});

test("the real SuperTokens Session bridge preserves header login, session metadata and sign-out in the Secure namespace", async () => {
  const app = setup();
  const SuperTokens = require("supertokens-web-js").default;
  const Session = require("supertokens-web-js/recipe/session").default;
  const sdk = require("supertokens-website/lib/build/fetch");
  const payload = { uid: "synthetic-user", ate: Date.now() + 3600000, up: { iat: Math.floor(Date.now() / 1000) } };
  const frontToken = Buffer.from(JSON.stringify(payload)).toString("base64");
  const calls = [];
  const browser = {
    async fetch(url, options) {
      calls.push({ url, options });
      const headers = String(url).endsWith("/signout") ? { "front-token": "remove" } : {
        "st-access-token": "header-access", "st-refresh-token": "header-refresh",
        "front-token": frontToken, "anti-csrf": "header-csrf"
      };
      return new Response(JSON.stringify({ status: "OK" }), { status: 200, headers });
    }
  };
  const memory = new Map();
  SuperTokens.init({
    appInfo: { appName: "Cookie security test", apiDomain: "https://api.example.test", apiBasePath: "/auth" },
    cookieHandler: () => app.handler,
    windowHandler: original => ({
      ...original,
      getWindowUnsafe: () => browser,
      location: { ...original.location, getHostName: () => "osagechan.top", getOrigin: () => "https://osagechan.top", getSearch: () => "" },
      localStorage: { ...original.localStorage, getItemSync: key => memory.get(key) ?? null, setItemSync: (key, value) => memory.set(key, value) }
    }),
    recipeList: [Session.init({ tokenTransferMethod: "header", override: { functions: original => ({ ...original, addXMLHttpRequestInterceptor() {} }) } })]
  });

  await sdk.setToken("access", "test-access-token");
  await sdk.setToken("refresh", "test-refresh-token");
  assert.equal(await sdk.getTokenForHeaderAuth("access"), "test-access-token");
  assert.equal(await sdk.getTokenForHeaderAuth("refresh"), "test-refresh-token");
  await sdk.setToken("access", "");
  await sdk.setToken("refresh", "");
  assert.equal(await sdk.getTokenForHeaderAuth("access"), undefined);
  assert.equal(await sdk.getTokenForHeaderAuth("refresh"), undefined);
  assert.equal(app.writes.length, 4);
  // Establish an explicitly signed-out local state, avoiding any real refresh
  // request before the mocked sign-in response is processed by the interceptor.
  await sdk.saveLastAccessTokenUpdate();
  assert.equal((await sdk.getLocalSessionState(false)).status, "NOT_EXISTS");
  assert.equal(await Session.doesSessionExist(), false);
  const originalFetch = global.fetch;
  global.fetch = browser.fetch;
  try {
    await browser.fetch("https://api.example.test/auth/signin", { method: "POST" });
    assert.equal(await Session.doesSessionExist(), true);
    assert.equal(await Session.getUserId(), "synthetic-user");
    assert.deepEqual(await sdk.FrontToken.getTokenInfo(), payload);
    assert.equal(await sdk.getTokenForHeaderAuth("access"), "header-access");
    assert.equal(await sdk.getTokenForHeaderAuth("refresh"), "header-refresh");
    const state = await sdk.getLocalSessionState(false);
    assert.equal(state.status, "EXISTS");
    assert.equal(await sdk.AntiCsrfToken.getToken(state.lastAccessTokenUpdate), "header-csrf");
    for (const name of ["st-access-token", "st-refresh-token", "sFrontToken", "st-last-access-token-update", "sAntiCsrf"]) {
      assert.equal(app.jar.has(`__Host-station-${name}`), true, name);
      assert.equal(app.jar.has(name), false, name);
    }
    await Session.signOut();
    assert.equal(await Session.doesSessionExist(), false);
    assert.equal((await sdk.getLocalSessionState(false)).status, "NOT_EXISTS");
    for (const name of ["st-access-token", "st-refresh-token", "sFrontToken", "sAntiCsrf", "sIRTFrontend"]) {
      assert.equal(app.jar.has(`__Host-station-${name}`), false, `${name} cleared`);
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, "https://api.example.test/auth/signout");
    assert.equal(calls[1].options.headers.get("Authorization"), "Bearer header-access");
  } finally {
    global.fetch = originalFetch;
  }
  for (const cookie of app.writes) {
    assert.match(cookie, /^__Host-station-/);
    assert.match(cookie, /;path=\/;secure$/);
    assert.doesNotMatch(cookie, /;domain=/i);
  }
  assert.ok(app.writes.some(cookie => cookie.startsWith("__Host-station-sIRTFrontend=;expires=Thu, 01 Jan 1970")));
  assert.match(authSource, /cookieHandler: secureSessionCookieHandler/);
});

test("Secure is not duplicated and HTTP is exempted only for loopback development", async () => {
  const secure = setup();
  await secure.handler.setCookie("st-refresh-token=value;path=/;SameSite=Lax;Secure");
  assert.equal(secure.writes[0], "__Host-station-st-refresh-token=value;SameSite=Lax;path=/;secure");
  const local = setup("http:", "st-access-token=local-token");
  assert.equal(local.handler, local.original);
  await local.handler.setCookie("st-access-token=local-token;path=/;samesite=lax");
  assert.equal(local.writes[0], "st-access-token=local-token;path=/;samesite=lax");
  const remoteHttp = setup("http:", "", "osagechan.top");
  await remoteHttp.handler.setCookie("st-access-token=value;path=/;samesite=lax");
  assert.equal(remoteHttp.writes[0], "__Host-station-st-access-token=value;samesite=lax;path=/;secure");
});
