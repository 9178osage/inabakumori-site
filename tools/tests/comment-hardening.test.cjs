const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const express = require("../../backend/node_modules/express");

const TOKEN = "c".repeat(48);
const script = fs.readFileSync(path.join(__dirname, "../../script.js"), "utf8");

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
  registerBackupEndpoint(app, { databasePath, token: TOKEN, limiter: (_req, _res, next) => next(), log });
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  return { port: server.address().port, logs, close: () => new Promise(r => server.close(r)), dir };
}
const waitFor = async (predicate, ms = 5000) => {
  const end = Date.now() + ms;
  while (!predicate()) { if (Date.now() > end) throw new Error("timed out"); await new Promise(r => setTimeout(r, 20)); }
};

test("1: 'Backup served' is logged only after the whole snapshot was sent", async () => {
  const s = await serveBackup();
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/api/admin/backup`, { headers: { Authorization: `Bearer ${TOKEN}` } });
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
      const req = http.get({ host: "127.0.0.1", port: s.port, path: "/api/admin/backup", headers: { Authorization: `Bearer ${TOKEN}` } }, res => {
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

test("2: duplicate detection ignores rows that have already expired", async () => {
  const { createRecentDuplicateChecker } = await import("../../backend/services.mjs");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE comments(content TEXT, user_id TEXT, is_guest INTEGER, created_at INTEGER, expires_at INTEGER)");
    const now = 1800000000000;
    const insert = db.prepare("INSERT INTO comments VALUES(?,?,?,?,?)");
    insert.run("expired guest text", null, 1, now - 60_000, now - 1);
    insert.run("expired member text", "alice", 0, now - 60_000, now);
    insert.run("live guest text here", null, 1, now - 60_000, now + 1000);
    insert.run("permanent member text", "alice", 0, now - 60_000, null);
    const duplicate = createRecentDuplicateChecker(db);
    assert.equal(duplicate("expired guest text", null, now), false);
    assert.equal(duplicate("expired member text", "alice", now), false, "expires_at == now is expired");
    assert.equal(duplicate("live guest text here", null, now), true);
    assert.equal(duplicate("permanent member text", "alice", now), true);
  } finally { db.close(); }
});

function clientHelpers() {
  const pick = re => script.match(re)?.[0] || assert.fail(`missing ${re}`);
  const code = [
    pick(/const MAX_NICKNAME_LENGTH = \d+;/), pick(/const MAX_COMMENT_LENGTH = \d+;/),
    pick(/function unicodeLength\(value\) \{[\s\S]*?\n\}/),
    pick(/const LONE_SURROGATE = .*;/), pick(/function hasLoneSurrogate\(value\) \{[\s\S]*?\n\}/),
    "this.out = { unicodeLength, hasLoneSurrogate, MAX_COMMENT_LENGTH };"
  ].join("\n");
  const context = {};
  vm.runInNewContext(code, context);
  return context.out;
}

test("3: the client counts length after NFC, like the server", async () => {
  const { unicodeLength, MAX_COMMENT_LENGTH } = clientHelpers();
  const { validateCommentInput } = await import("../../backend/services.mjs");
  const decomposed = "e\u0301";
  assert.equal(unicodeLength(decomposed), 1);
  const text = decomposed.repeat(MAX_COMMENT_LENGTH);
  assert.equal(unicodeLength(text), MAX_COMMENT_LENGTH, "500 decomposed é are 500 characters, not 1000");
  assert.equal(validateCommentInput({ nickname: "rain", content: text }).ok, true, "server agrees");
  const over = decomposed.repeat(MAX_COMMENT_LENGTH + 1);
  assert.equal(unicodeLength(over), MAX_COMMENT_LENGTH + 1);
  assert.equal(validateCommentInput({ nickname: "rain", content: over }).ok, false);
});

test("3: an over-length message is reported, not silently truncated on submit", () => {
  const add = script.match(/async function addMessage\(\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(add, /enforceCommentFieldLimits\(/, "submit must not trim the fields before checking them");
  assert.match(add, /unicodeLength\(content\) > MAX_COMMENT_LENGTH\) \{\n\s*showLengthFeedback\("content"\)/);
  const enforce = script.match(/function enforceCommentFieldLimits\([\s\S]*?\n\}/)[0];
  assert.match(enforce, /showLengthFeedback\(trimmed\)/, "typing past the limit says so");
});

test("4: server and client reject lone surrogates but keep real emoji", async () => {
  const { validateCommentInput } = await import("../../backend/services.mjs");
  const { hasLoneSurrogate } = clientHelpers();
  for (const bad of ["\uD800", "a\uDC00b", "好\uD83D", "\uDE00x"]) {
    assert.equal(validateCommentInput({ nickname: "rain", content: bad }).ok, false, JSON.stringify(bad));
    assert.equal(validateCommentInput({ nickname: bad, content: "hello" }).ok, false, JSON.stringify(bad));
    assert.equal(hasLoneSurrogate(bad), true, JSON.stringify(bad));
  }
  for (const good of ["😀 好听", "👨‍👩‍👧", "𠮷野家"]) {
    assert.equal(validateCommentInput({ nickname: "rain", content: good }).ok, true, good);
    assert.equal(hasLoneSurrogate(good), false, good);
  }
  const add = script.match(/async function addMessage\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(add, /hasLoneSurrogate\(nickname\) \|\| hasLoneSurrogate\(content\)/);
});
