const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const express = require("../../backend/node_modules/express");

const TOKEN = "a".repeat(16) + "0123456789abcdef0123456789abcdef";

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
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
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
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("inabakumori-backup-")).length, tmpBefore, "temp snapshot removed");
    assert.ok(s.logs.length >= 3);
    assert.ok(s.logs.every(line => !line.includes(TOKEN)), "token never logged");
  } finally { await s.close(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});
