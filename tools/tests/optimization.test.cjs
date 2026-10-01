const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");

test("comment validation rejects invisible/control-only content and preserves multilingual emoji", async () => {
  const { validateCommentInput: validate } = await import("../../backend/services.mjs");
  for (const content of ["", "  ", "\u200B\u200D", "hello\u0000", "hello\u202E", "a".repeat(501)]) {
    assert.equal(validate({ nickname: "站员", content }).ok, false, JSON.stringify(content));
  }
  for (const nickname of [null, [], "a\nb", "\uFEFF", "雨".repeat(31)]) assert.equal(validate({ nickname, content: "好きです" }).ok, false);
  for (const content of ["雨の音が好きです。\n谢谢你的音乐 ☔", "👨‍👩‍👧‍👦", "😀".repeat(500)]) assert.equal(validate({ nickname: "站员", content }).ok, true);
  assert.equal(validate({ nickname: " Cafe\u0301 ", content: " 感谢 " }).nickname, "Café");
});

test("cursor parser rejects coercion, repeated query params, unsafe numbers and exponent notation", async () => {
  const { positiveInteger } = await import("../../backend/services.mjs");
  for (const value of ["", "0", "-1", "1e2", "0x10", "1.5", " 1", "01", ["1", "2"], {}, "9007199254740992"]) assert.equal(positiveInteger(value), null);
  assert.equal(positiveInteger("9007199254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(positiveInteger(undefined, 99), 99);
});

test("public preview cannot expose source, environment, database or directory listings", async () => {
  const { publicPath } = await import("../static-server.mjs");
  for (const url of ["/backend/.env", "/backend/server.mjs", "/AI_HANDOFF.md", "/docs/AI_HANDOFF.md", "/docs/OPTIMIZATION.md", "/trusted-read-20260929/test.json", "/.git/config", "/node_modules/x.js", "/images/../../backend/.env", "/images/%2e%2e%2fbackend%2f.env", "/images", "/js", "/js/missing.js", "/%E0%A4%A"]) assert.equal(publicPath(url), null, url);
  assert.equal(publicPath("/?q=rain"), "index.html");
  assert.equal(publicPath("/script.js?v=123"), "script.js");
  assert.equal(publicPath("/images/optimized/hero/001.webp"), "images/optimized/hero/001.webp");
});

test("blocked storage still permits theme, language and favorites for the session", async () => {
  const context = {
    window: { matchMedia: () => ({ matches: true }) },
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } }
  };
  vm.runInNewContext(await fs.readFile("js/preferences.js", "utf8"), context);
  assert.equal(context.document.documentElement.dataset.theme, "dark");
  context.window.siteStorage.setItem("language", "ja");
  assert.equal(context.window.siteStorage.getItem("language"), "ja");
  context.window.siteStorage.setItem("favorite-songs", '["video"]');
  assert.equal(context.window.siteStorage.getItem("favorite-songs"), '["video"]');
});

test("a failed preference write overrides the stale persisted value for this session", async () => {
  const context = { window: {}, document: { documentElement: { dataset: {} } }, localStorage: { getItem: () => "light", setItem() { throw new Error("QuotaExceededError"); } } };
  vm.runInNewContext(await fs.readFile("js/preferences.js", "utf8"), context);
  context.window.siteStorage.setItem("theme", "dark");
  assert.equal(context.window.siteStorage.getItem("theme"), "dark");
});

test("network requests use the session-aware fetch at call time and have a deadline without write retries", async () => {
  let calls = 0;
  const context = { window: {}, AbortSignal, fetch: async () => { throw new Error("old fetch must not be used"); } };
  vm.createContext(context);
  vm.runInContext(await fs.readFile("js/network.js", "utf8"), context);
  context.fetch = async (_url, options) => { calls++; assert.ok(options.signal instanceof AbortSignal); throw new Error("offline"); };
  await assert.rejects(context.window.siteFetch("/api/comments", { method: "POST" }), /offline/);
  assert.equal(calls, 1);
});

test("SQLite online backup includes WAL data, verifies integrity and refuses overwrite", async () => {
  const { backupDatabase } = await import("../../backend/backup.mjs");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "station-backup-test-"));
  const source = path.join(directory, "source.db");
  const destination = path.join(directory, "snapshot.db");
  const db = new DatabaseSync(source);
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE comments(content TEXT); INSERT INTO comments VALUES('雨 ☔');");
    await backupDatabase(source, destination);
    const snapshot = new DatabaseSync(destination, { readOnly: true });
    try { assert.equal(snapshot.prepare("SELECT content FROM comments").get().content, "雨 ☔"); }
    finally { snapshot.close(); }
    await assert.rejects(backupDatabase(source, destination), { code: "EEXIST" });
    await assert.rejects(backupDatabase(source, source), /must not overwrite/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM comments").get().n, 1);
  } finally { db.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test("static preview sends security headers and HTML 404 pages", async () => {
  const http = require("node:http");
  const { createStaticServer } = await import("../static-server.mjs");
  const server = createStaticServer(path.join(process.cwd()));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const request = (url) => new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: url }, res => {
        const chunks = [];
        res.on("data", chunk => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      }).on("error", reject);
    });
    const home = await request("/");
    assert.equal(home.status, 200);
    assert.equal(home.headers["x-content-type-options"], "nosniff");
    assert.equal(home.headers["x-frame-options"], "DENY");
    assert.equal(home.headers["cross-origin-opener-policy"], "same-origin");
    assert.match(home.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.match(home.headers["permissions-policy"], /camera=\(\)/);
    const missing = await request("/no-such-page");
    assert.equal(missing.status, 404);
    assert.match(missing.headers["content-type"], /text\/html/);
    assert.match(missing.body, /404/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("homepage ships CSP meta, locale hints and dns-prefetch for API/thumbnails", async () => {
  const html = await fs.readFile("index.html", "utf8");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /og:locale/);
  assert.match(html, /dns-prefetch" href="https:\/\/inabakumori-site-production\.up\.railway\.app"/);
  assert.match(html, /dns-prefetch" href="https:\/\/i\.ytimg\.com"/);
  assert.match(html, /id="message-submit"/);
  assert.match(html, /aria-busy="false"/);
});

test("comment DELETE paths are rate-limited separately from reads", async () => {
  const backend = await fs.readFile("backend/server.mjs", "utf8");
  assert.match(backend, /commentDeleteLimiter/);
  assert.match(backend, /admin\\\/\)\?comments/);
  assert.match(backend, /Permissions-Policy/);
  assert.match(backend, /uptimeSec/);
  assert.match(backend, /cross-origin/);
});
