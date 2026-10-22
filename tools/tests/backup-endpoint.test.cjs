const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const express = require("../../backend/node_modules/express");

const TOKEN = "a".repeat(16) + "0123456789abcdef0123456789abcdef";

function listenOnLoopback(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", error => {
      if (error) return reject(error);
      resolve(server);
    });
  });
}

test("a failed listener preserves the original error before reading its address", async () => {
  const failure = Object.assign(new Error("Synthetic listener permission denied"), { code: "EPERM" });
  let addressReads = 0;
  const app = {
    listen(port, host, callback) {
      assert.equal(port, 0);
      assert.equal(host, "127.0.0.1");
      queueMicrotask(() => callback(failure));
      return { address() { addressReads++; return null; } };
    }
  };
  await assert.rejects(async () => {
    const server = await listenOnLoopback(app);
    return server.address().port;
  }, error => error === failure, "the caller receives the original Error, not an address TypeError");
  assert.equal(addressReads, 0, "an unsuccessful listener has no address to inspect");
});

async function serve(token) {
  const { registerBackupEndpoint } = await import("../../backend/backup-endpoint.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  const databasePath = path.join(dir, "comments.db");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE comments (id INTEGER PRIMARY KEY, content TEXT); INSERT INTO comments (content) VALUES ('hello');");
  db.close();
  const logs = [];
  const log = { log: (...a) => logs.push(JSON.stringify(a)), warn: (...a) => logs.push(JSON.stringify(a)) };
  const app = express();
  registerBackupEndpoint(app, { databasePath, token, limiter: (_req, _res, next) => next(), log });
  app.use((_req, res) => res.status(404).json({ code: "NOT_FOUND" }));
  const server = await listenOnLoopback(app);
  const url = `http://127.0.0.1:${server.address().port}/api/admin/backup`;
  return { url, logs, dir, close: () => new Promise(resolve => server.close(resolve)) };
}

test("backup token must be at least 32 characters, otherwise the endpoint is disabled", async () => {
  const { backupTokenFrom, bearerMatches, backupFilename, isBackupPath } = await import("../../backend/backup-endpoint.mjs");
  assert.equal(backupTokenFrom({}), null);
  assert.equal(backupTokenFrom({ BACKUP_TOKEN: "x".repeat(31) }), null);
  assert.equal(backupTokenFrom({ BACKUP_TOKEN: ` ${TOKEN} ` }), TOKEN);
  assert.equal(bearerMatches(`Bearer ${TOKEN}`, TOKEN), true);
  for (const header of [undefined, "", TOKEN, `Basic ${TOKEN}`, `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, `Bearer  ${TOKEN}`]) assert.equal(bearerMatches(header, TOKEN), false, String(header));
  assert.equal(bearerMatches(`Bearer ${TOKEN}`, null), false);
  assert.equal(backupFilename(new Date("2026-10-11T08:00:00Z")), "comments-20261011.db");
  assert.equal(isBackupPath("/API/Admin/Backup/?x=1"), true);
  assert.equal(isBackupPath("/api/admin/comments"), false);
  assert.match(fs.readFileSync("backend/backup-endpoint.mjs", "utf8"), /timingSafeEqual\(given, expected\)/);
});

test("disabled endpoint returns 404 even with a bearer header", async () => {
  const s = await serve(null);
  try {
    assert.equal((await fetch(s.url, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
    assert.equal((await fetch(s.url, { method: "HEAD", headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
  } finally { await s.close(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("HEAD is rejected with the allowed method before opening the snapshot source", async () => {
  const s = await serve(TOKEN);
  try {
    fs.unlinkSync(path.join(s.dir, "comments.db"));
    const response = await fetch(s.url, { method: "HEAD", headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
    assert.deepEqual(s.logs, [], "HEAD must not try to serve a backup");
  } finally { await s.close(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("wrong or missing token is rejected; correct token streams a valid SQLite snapshot and cleans up", async () => {
  const s = await serve(TOKEN);
  const tmpBefore = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("inabakumori-backup-")).length;
  try {
    assert.equal((await fetch(s.url)).status, 401);
    assert.equal((await fetch(s.url, { headers: { Authorization: "Bearer " + "b".repeat(48) } })).status, 401);
    const res = await fetch(s.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.subarray(0, 16).toString("latin1"), "SQLite format 3\0");
    const copy = path.join(s.dir, "downloaded.db");
    fs.writeFileSync(copy, body);
    const check = new DatabaseSync(copy, { readOnly: true });
    assert.equal(check.prepare("SELECT content FROM comments").get().content, "hello");
    check.close();
    // Cleanup runs after the response finishes; on a busy CI runner that can take longer than a fixed sleep.
    const snapshots = () => fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("inabakumori-backup-")).length;
    for (let waited = 0; snapshots() !== tmpBefore && waited < 5000; waited += 25) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(snapshots(), tmpBefore, "temp snapshot removed");
    assert.ok(s.logs.length >= 3);
    assert.ok(s.logs.every(line => !line.includes(TOKEN)), "token never logged");
  } finally { await s.close(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

// Same file as the cleanup test on purpose: tests in one file run in order, so temp-dir counts never race.
const ABORT_TOKEN = "c".repeat(48);

async function serveBackup() {
  const { registerBackupEndpoint } = await import("../../backend/backup-endpoint.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-abort-test-"));
  const databasePath = path.join(dir, "comments.db");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE comments (id INTEGER PRIMARY KEY, content BLOB)");
  // Big enough (~8 MB) that the response cannot fit in one socket write, so an abort lands mid-stream.
  const insert = db.prepare("INSERT INTO comments (content) VALUES (randomblob(?))");
  for (let i = 0; i < 8; i++) insert.run(1024 * 1024);
  db.close();
  const logs = [];
  const log = { log: (...a) => logs.push(["log", ...a]), warn: (...a) => logs.push(["warn", ...a]) };
  const app = express();
  registerBackupEndpoint(app, { databasePath, token: ABORT_TOKEN, limiter: (_req, _res, next) => next(), log });
  const server = await listenOnLoopback(app);
  return { port: server.address().port, logs, close: () => new Promise(r => server.close(r)), dir };
}
const waitFor = async (predicate, ms = 5000) => {
  const end = Date.now() + ms;
  while (!predicate()) { if (Date.now() > end) throw new Error("timed out"); await new Promise(r => setTimeout(r, 20)); }
};

test("1: 'Backup served' is logged only after the whole snapshot was sent", async () => {
  const s = await serveBackup();
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/api/admin/backup`, { headers: { Authorization: `Bearer ${ABORT_TOKEN}` } });
    assert.equal(res.status, 200);
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.length, Number(res.headers.get("content-length")));
    await waitFor(() => s.logs.length > 0);
    assert.deepEqual(s.logs.map(entry => entry[1]), ["Backup served"]);
    assert.equal(s.logs[0][2].size, body.length);
  } finally { await s.close(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("1: a client that aborts mid-download is logged as aborted, never as served", async () => {
  const s = await serveBackup();
  try {
    await new Promise((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port: s.port, path: "/api/admin/backup", headers: { Authorization: `Bearer ${ABORT_TOKEN}` } }, res => {
        assert.equal(res.statusCode, 200);
        res.once("data", () => { req.destroy(); resolve(); });
      });
      req.on("error", error => { if (error.code !== "ECONNRESET") reject(error); });
    });
    await waitFor(() => s.logs.length > 0);
    assert.equal(s.logs[0][0], "warn");
    assert.equal(s.logs[0][1], "Backup aborted");
    assert.ok(!s.logs.some(entry => entry[1] === "Backup served"));
  } finally { await s.close(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

