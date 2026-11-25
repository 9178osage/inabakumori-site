const test = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

// Same single-session lease as vercel-rate-limit.test.cjs: real PostgreSQL SQL, one connection.
function postgresPool(engine) {
  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    return release;
  };
  const query = async (sql, parameters) => {
    if (!parameters?.length && sql.includes(";")) return (await engine.exec(sql)).at(-1);
    return engine.query(sql, parameters);
  };
  return {
    async query(sql, parameters) { const release = await acquire(); try { return await query(sql, parameters); } finally { release(); } },
    async connect() { const release = await acquire(); return { query, release }; },
    async end() { await engine.close(); }
  };
}

const NOW = 1800000000000;
const EXPIRES = NOW + 182 * 24 * 60 * 60 * 1000;
const guest = { nickname: "访客", content: "谢谢", userId: null, isGuest: true, createdAt: NOW, expiresAt: EXPIRES };

async function exercise(db) {
  const { insertFreshCommentAsync, commentIdempotency, findCommentReplay } = await import("../../backend/services.mjs");
  const count = async () => Number((await db.prepare("SELECT count(*) AS n FROM comments").get()).n);
  assert.equal(commentIdempotency(undefined, guest), null, "older pages without a key keep working");
  assert.equal(commentIdempotency("short", guest), false);
  assert.equal(commentIdempotency("x".repeat(129), guest), false);
  assert.equal(commentIdempotency("bad key with spaces!", guest), false);
  const key = "0f8e2a4c-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
  const idempotency = commentIdempotency(key, guest);
  // Short guest text skips text dedup on purpose, so without a key a retry would post twice.
  const first = await insertFreshCommentAsync(db, { row: guest, idempotency });
  assert.deepEqual(first, { ok: true, id: first.id });
  const retry = await insertFreshCommentAsync(db, { row: { ...guest, createdAt: NOW + 5000, expiresAt: EXPIRES + 5000 }, idempotency });
  assert.deepEqual(retry, { ok: true, id: first.id, replayed: true, createdAt: NOW, expiresAt: EXPIRES }, "a retry replays the first result");
  assert.deepEqual(await findCommentReplay(db, idempotency, NOW + 5000), retry, "the read-only check agrees with the transaction");
  assert.equal(await count(), 1);
  assert.deepEqual(await insertFreshCommentAsync(db, { row: { ...guest, content: "别的" }, idempotency: commentIdempotency(key, { ...guest, content: "别的" }) }),
    { ok: false, code: "IDEMPOTENCY_KEY_REUSED" }, "one key cannot post different text");
  const member = { ...guest, userId: "member-1", isGuest: false, expiresAt: null };
  const asMember = await insertFreshCommentAsync(db, { row: member, idempotency: commentIdempotency(key, member) });
  assert.equal(asMember.replayed, undefined, "a member's key scope is separate from the guest scope");
  assert.notEqual(asMember.id, first.id);
  const concurrentKey = commentIdempotency("concurrent-retry-key-1234", { ...guest, content: "好" });
  const racing = await Promise.all(Array.from({ length: 5 }, () => insertFreshCommentAsync(db, { row: { ...guest, content: "好" }, idempotency: concurrentKey })));
  assert.equal(new Set(racing.map(result => result.id)).size, 1, "concurrent same-key requests store one comment");
  assert.equal(await count(), 3);
  await db.prepare("DELETE FROM comments WHERE id = ?").run(first.id);
  const removed = { ok: false, code: "COMMENT_REMOVED", replayed: true };
  assert.deepEqual(await findCommentReplay(db, idempotency, NOW + 5000), removed);
  assert.deepEqual(await insertFreshCommentAsync(db, { row: { ...guest, createdAt: NOW + 5000 }, idempotency }), removed);
  assert.equal(await count(), 2, "retrying a deleted comment must never restore it");
  const later = await insertFreshCommentAsync(db, { row: { ...guest, createdAt: NOW + 24 * 60 * 60 * 1000 + 1 }, idempotency });
  assert.equal(later.replayed, undefined, "a key older than the replay window starts a new post");
  const stored = await db.prepare("SELECT * FROM comment_idempotency").all();
  assert.ok(stored.every(row => /^[a-f0-9]{64}$/u.test(row.key_hash) && !JSON.stringify(row).includes(key) && !JSON.stringify(row).includes("member-1")),
    "only hashes are stored, never the raw key or account ID");
  const plain = await insertFreshCommentAsync(db, { row: { ...guest, content: "没有编号" } });
  assert.deepEqual(plain, { ok: true, id: plain.id }, "requests without a key behave exactly as before");
}

test("comment idempotency on the SQLite path", async () => {
  const { openDatabase } = await import("../../backend/database.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "idempotency-"));
  const db = await openDatabase({ COMMENTS_DB_PATH: path.join(directory, "comments.db") }, directory);
  try { await exercise(db); } finally { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("comment idempotency on PostgreSQL, including a database created before the table existed", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const engine = new PGlite();
  // An existing production database already has comments; startup only adds the new table.
  await engine.exec(`CREATE TABLE comments (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, nickname TEXT NOT NULL, content TEXT NOT NULL,
    user_id TEXT, is_guest INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, expires_at BIGINT);
    INSERT INTO comments (nickname, content, is_guest, created_at) VALUES ('old', 'kept', 1, 1);`);
  const db = await createPostgresDatabase(postgresPool(engine));
  try {
    assert.equal(Number((await db.prepare("SELECT count(*) AS n FROM comments").get()).n), 1, "existing comments are untouched");
    await db.prepare("DELETE FROM comments").run();
    await exercise(db);
  } finally { await db.close(); }
});

test("the server binds the key to the sender, allows the header in CORS and expires old records", () => {
  const server = fs.readFileSync("backend/server.mjs", "utf8");
  assert.match(server, /allowedHeaders: \["content-type", "idempotency-key", \.\.\.supertokens\.getAllCORSHeaders\(\)\]/u);
  assert.match(server, /commentIdempotency\(key, \{ userId, nickname, content \}\)/u);
  assert.match(server, /DELETE FROM comment_idempotency WHERE created_at <= \?/u);
  assert.match(server, /if \(!result\.replayed\) invalidatePublicComments\(\);/u);
  const script = fs.readFileSync("script.js", "utf8");
  assert.match(script, /"Idempotency-Key": idempotencyKey/u);
  assert.match(script, /pendingCommentAttempt = null;\n    if \(nameInput\.value === originalName\)/u, "the key is dropped only after a confirmed post");
});

test("the page reuses one key for a retry of unchanged text and starts a new one otherwise", () => {
  const source = fs.readFileSync("script.js", "utf8");
  const start = source.indexOf("let pendingCommentAttempt = null;");
  const end = source.indexOf("async function addMessage()", start);
  assert.ok(start >= 0 && end > start);
  const run = crypto => {
    const context = { globalThis: { crypto } };
    vm.runInNewContext(`${source.slice(start, end)}\nthis.key = commentIdempotencyKey; this.done = () => { pendingCommentAttempt = null; };`, context);
    return context;
  };
  let counter = 0;
  const page = run({ randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}` });
  const first = page.key("访客", "谢谢");
  assert.equal(page.key("访客", "谢谢"), first, "manual retry after a timeout keeps the key");
  const edited = page.key("访客", "谢谢！");
  assert.notEqual(edited, first, "edited text is a new submit action");
  page.done();
  assert.notEqual(page.key("访客", "谢谢！"), edited, "after a confirmed post the same text is a new post");
  const legacy = run({ getRandomValues: bytes => bytes.fill(171) });
  assert.match(legacy.key("a", "b"), /^[a-f0-9]{32}$/u, "browsers without randomUUID still send a valid key");
  assert.equal(run(undefined).key("a", "b"), null, "no Web Crypto: the request is sent without a key");
});
