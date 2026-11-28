const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

function pgliteHarness(engine) {
  const query = async (sql, parameters) => {
    if (!parameters?.length && sql.includes(";")) return (await engine.exec(sql)).at(-1);
    const result = await engine.query(sql, parameters);
    return { ...result, rowCount: result.affectedRows };
  };
  return { query, async connect() { return { query, release() {} }; }, async end() {} };
}

// A fake Core: sessions with creation times, and a switch that makes every call fail.
function fakeCore() {
  const core = { down: false, sessions: new Map(), revoked: [] };
  const guard = () => { if (core.down) throw Object.assign(new Error("core unreachable"), { code: "ECONNREFUSED" }); };
  core.listSessionHandles = async userId => { guard(); return [...core.sessions].filter(([, s]) => s.userId === userId).map(([h]) => h); };
  core.sessionCreatedAt = async handle => { guard(); return core.sessions.get(handle)?.created; };
  core.revokeSessions = async handles => { guard(); for (const h of handles) { core.sessions.delete(h); core.revoked.push(h); } return handles; };
  core.revokeAll = async userId => { guard(); for (const h of await core.listSessionHandles(userId)) { core.sessions.delete(h); core.revoked.push(h); } };
  return core;
}

async function exercise(db) {
  const { revokeSessionsAfterPasswordReset } = await import("../../backend/services.mjs");
  const { createPendingSessionRevocations, SESSION_REVOCATION_ALERT_ATTEMPTS, sessionRevocationBackoff } = await import("../../backend/session-revocation.mjs");
  let clock = 1_000_000;
  const logs = [];
  const log = { warn: (...a) => logs.push(["warn", ...a]), error: (...a) => logs.push(["error", ...a]) };
  const core = fakeCore();
  const queue = createPendingSessionRevocations(db, { ...core, now: () => clock, log });
  core.sessions.set("stolen", { userId: "user-1", created: 10 });
  core.sessions.set("other-user", { userId: "user-2", created: 10 });
  const reset = revokeSessionsAfterPasswordReset(async () => ({ status: "OK", user: { id: "user-1" } }), core.revokeAll, log,
    { onPersistentFailure: (userId, at) => queue.enqueue(userId, at), now: () => clock });

  // The Core is down during the reset: the reset still succeeds and the account is queued.
  core.down = true;
  assert.equal((await reset({})).status, "OK");
  assert.equal(await queue.backlog(), 1);
  const queued = await queue.get("user-1");
  assert.equal(Number(queued.reset_at), clock);
  assert.ok(core.sessions.has("stolen"));

  // Still down: the retry is recorded with backoff, nothing is lost.
  assert.equal(await queue.process(), 0);
  assert.equal(Number((await queue.get("user-1")).attempts), 1);
  assert.equal(await queue.process(), 0, "not due again before the backoff");
  assert.equal(Number((await queue.get("user-1")).attempts), 1);

  // The owner signs in again with the new password before the Core recovers.
  clock += 5_000;
  core.sessions.set("new-device", { userId: "user-1", created: clock });
  core.down = false;
  clock += sessionRevocationBackoff(1);
  assert.equal(await queue.process(), 1);
  assert.deepEqual(core.revoked, ["stolen"], "only sessions from before the reset are revoked");
  assert.ok(core.sessions.has("new-device"), "the device signed in after the reset keeps its session");
  assert.ok(core.sessions.has("other-user"));
  assert.equal(await queue.backlog(), 0);

  // A long outage keeps retrying and raises an error-level alert without user data.
  core.down = true;
  core.sessions.set("stolen-2", { userId: "user-1", created: clock - 1 });
  await reset({});
  for (let i = 0; i < SESSION_REVOCATION_ALERT_ATTEMPTS; i++) { clock += 2 * 60 * 60 * 1000; await queue.process(); }
  assert.equal(await queue.backlog(), 1, "a failing revocation is never dropped");
  assert.ok(logs.some(([level, message]) => level === "error" && /still failing/u.test(message)));
  assert.doesNotMatch(JSON.stringify(logs), /user-1|stolen/u, "logs carry no account or session identifiers");

  // A second reset before recovery keeps the newer reset time.
  clock += 1000;
  await queue.enqueue("user-1", clock);
  assert.equal(Number((await queue.get("user-1")).reset_at), clock);
  await assert.rejects(queue.enqueue("", 1), TypeError);

  // Without a queue, the old behaviour (log only) is unchanged.
  const plain = revokeSessionsAfterPasswordReset(async () => ({ status: "OK", user: { id: "user-3" } }), core.revokeAll, log);
  assert.equal((await plain({})).status, "OK");
  // A broken queue never turns a completed reset into an error.
  const broken = revokeSessionsAfterPasswordReset(async () => ({ status: "OK", user: { id: "user-3" } }), core.revokeAll, log,
    { onPersistentFailure: async () => { throw new Error("db down"); } });
  assert.equal((await broken({})).status, "OK");
  assert.equal(logs.at(-1)[0], "error");
}

test("failed post-reset revocations are queued durably and retried on SQLite", async () => {
  const { openDatabase } = await import("../../backend/database.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "revocations-"));
  const db = await openDatabase({ COMMENTS_DB_PATH: path.join(directory, "comments.db") }, directory);
  try { await exercise(db); } finally { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("failed post-reset revocations are queued durably and retried on PostgreSQL", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const engine = new PGlite();
  const db = await createPostgresDatabase(pgliteHarness(engine));
  try { await exercise(db); } finally { await db.close(); }
});

test("the server queues failed revocations and retries them from maintenance", () => {
  const server = fs.readFileSync("backend/server.mjs", "utf8");
  assert.match(server, /onPersistentFailure: \(userId, resetAt\) => pendingSessionRevocations\.enqueue\(userId, resetAt\)/u);
  assert.match(server, /work: \(\) => pendingSessionRevocations\.process\(\), env: \{\}/u);
  assert.match(server, /Session\.getSessionInformation\(handle\)\)\?\.timeCreated/u);
});

test("enqueue upserts and keeps the later reset time (audit P2-3)", async () => {
  const source = require("fs").readFileSync(require("path").join(__dirname, "../../backend/session-revocation.mjs"), "utf8");
  assert.match(source, /ON CONFLICT \(user_id\) DO UPDATE SET/);
  assert.match(source, /excluded\.reset_at > pending_session_revocations\.reset_at/);
  assert.match(source, /db\.kind === "postgres"/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /SELECT user_id, reset_at, attempts FROM pending_session_revocations WHERE next_attempt_at/);
  const { createPendingSessionRevocations } = await import("../../backend/session-revocation.mjs");
  const { DatabaseSync } = require("node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE pending_session_revocations (
    user_id TEXT PRIMARY KEY, reset_at INTEGER, attempts INTEGER, next_attempt_at INTEGER)`);
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return Object.fromEntries(["get", "all", "run"].map(method => [method, async (...args) => stmt[method](...args)]));
    }
  };
  let clock = 1000;
  const queue = createPendingSessionRevocations(db, {
    listSessionHandles: async () => [], sessionCreatedAt: async () => 0, revokeSessions: async () => {}, now: () => clock
  });
  await queue.enqueue("user-1", 50);
  clock = 2000;
  await queue.enqueue("user-1", 80);
  assert.equal((await queue.get("user-1")).reset_at, 80);
  clock = 3000;
  await queue.enqueue("user-1", 70);
  assert.equal((await queue.get("user-1")).reset_at, 80, "an earlier reset_at must not replace a later one");
  sqlite.close();
});
