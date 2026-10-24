const test = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { setTimeout: delay } = require("node:timers/promises");

// PGlite executes the actual PostgreSQL engine, including schema constraints,
// advisory locks and UPSERTs. Its one session needs a lease around a transaction;
// this pg-compatible adapter leaves every SQL statement unmodified.
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
    if (!parameters?.length && sql.includes(";")) {
      const results = await engine.exec(sql);
      return results.at(-1);
    }
    return engine.query(sql, parameters);
  };
  return {
    async query(sql, parameters) {
      const release = await acquire();
      try { return await query(sql, parameters); } finally { release(); }
    },
    async connect() {
      const release = await acquire();
      return { query, release };
    },
    async end() { await engine.close(); }
  };
}

test("shared rate limit setup rejects a local database or missing/invalid windows", async () => {
  const { createPostgresRateLimitStore } = await import("../../backend/rate-limit-store.mjs");
  assert.throws(() => createPostgresRateLimitStore({ kind: "sqlite" }, { prefix: "requests" }), /PostgreSQL/u);
  assert.throws(() => createPostgresRateLimitStore({ kind: "postgres" }), /unique prefix/u);
  const store = createPostgresRateLimitStore({ kind: "postgres" }, { prefix: "requests" });
  await assert.rejects(store.increment("key"), /windowMs/u);
  for (const windowMs of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => store.init({ windowMs }), /windowMs/u);
});

test("shared storage fails closed when PostgreSQL is unavailable", async () => {
  const { createPostgresRateLimitStore } = await import("../../backend/rate-limit-store.mjs");
  const databaseError = Object.assign(new Error("synthetic offline database"), { code: "ECONNREFUSED" });
  const store = createPostgresRateLimitStore({ kind: "postgres", prepare() { throw databaseError; } }, { prefix: "offline", windowMs: 60_000 });
  await assert.rejects(store.increment("key"), error => error === databaseError);
  await assert.rejects(store.get("key"), error => error === databaseError);
  await store.decrement("key"); // No request context means no unsafe refund attempt.
  const express = require("../../backend/node_modules/express");
  const { rateLimit } = require("../../backend/node_modules/express-rate-limit");
  const app = express();
  let allowed = false;
  app.use(rateLimit({ store, windowMs: 60_000, limit: 3 }));
  app.get("/", (_req, res) => { allowed = true; res.end("allowed"); });
  app.use((_error, _req, res, _next) => res.status(503).end("unavailable"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/`)).status, 503);
    assert.equal(allowed, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("background refunds retain their request context, register one promise and catch failures safely", async () => {
  const { createPostgresRateLimitStore, withRateLimitRequestContext } = await import("../../backend/rate-limit-store.mjs");
  let registered;
  let updates = 0;
  const resetAt = Date.now() + 60_000;
  const db = { kind: "postgres", prepare() {
    return {
      async get() { return { total_hits: 1, reset_at: resetAt }; },
      async run() { updates++; throw Object.assign(new Error("secret connection URL must not appear"), { code: "ECONNREFUSED" }); }
    };
  } };
  const store = createPostgresRateLimitStore(db, { prefix: "background", windowMs: 60_000, onBackgroundTask: pending => { registered = pending; } });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await store.decrement("untracked");
    assert.equal(updates, 0);
    await withRateLimitRequestContext({}, {}, async () => {
      await store.increment("visitor");
      const pending = store.decrement("visitor");
      assert.equal(registered, pending, "the registered task includes its rejection handler");
      await pending;
    });
    assert.equal(updates, 1);
    assert.deepEqual(errors, [["Rate limit decrement failed", { name: "Error", code: "ECONNREFUSED" }]]);
  } finally { console.error = originalError; }
});

test("PostgreSQL engine validates migration, backup and shared rate counters", async t => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const { createPostgresRateLimitStore, cleanupExpiredRateLimits, withRateLimitRequestContext } = await import("../../backend/rate-limit-store.mjs");
  const engine = new PGlite();
  const db = await createPostgresDatabase(postgresPool(engine));
  const newStore = (prefix, windowMs = 60_000) => createPostgresRateLimitStore(db, { prefix, windowMs });
  try {
    await t.test("all instances share atomic increments while limiter prefixes and keys remain independent", async () => {
      const first = newStore("requests");
      const second = newStore("requests");
      assert.equal(first.localKeys, false);
      const replies = await Promise.all(Array.from({ length: 40 }, (_, index) => (index % 2 ? first : second).increment("203.0.113.9")));
      assert.deepEqual(replies.map(reply => reply.totalHits).sort((a, b) => a - b), Array.from({ length: 40 }, (_, index) => index + 1));
      assert.equal((await second.get("203.0.113.9")).totalHits, 40);
      assert.equal((await newStore("authentication").increment("203.0.113.9")).totalHits, 1);
      assert.equal((await first.increment("203.0.113.10")).totalHits, 1);
      const counters = await db.prepare("SELECT key_hash FROM rate_limit_counters").all();
      assert.ok(counters.every(row => /^[a-f0-9]{64}$/u.test(row.key_hash)), "IP addresses are not stored in plaintext");
    });

    await t.test("expired windows reset atomically, decrements never debit an expired window or go negative", () => withRateLimitRequestContext({}, {}, async () => {
      const store = newStore("expired");
      await store.increment("visitor");
      await store.increment("visitor");
      await db.prepare("UPDATE rate_limit_counters SET reset_at = ? WHERE prefix = ?").run(Date.now() - 1000, "expired");
      assert.equal(await store.get("visitor"), undefined);
      await store.decrement("visitor");
      assert.equal((await db.prepare("SELECT total_hits FROM rate_limit_counters WHERE prefix = ?").get("expired")).total_hits, 2);
      const reset = await store.increment("visitor");
      assert.equal(reset.totalHits, 1);
      assert.ok(reset.resetTime > new Date());
      await store.decrement("visitor");
      await store.decrement("visitor");
      assert.equal((await store.get("visitor")).totalHits, 0);
      await store.resetKey("visitor");
      assert.equal(await store.get("visitor"), undefined);
    }));

    await t.test("a queued refund SQL statement cannot subtract from another request's replacement window", async () => {
      const replacementStore = newStore("suspended-refund");
      let release;
      let started;
      const handlerStarted = new Promise(resolve => { started = resolve; });
      const pending = new Promise(resolve => { release = resolve; });
      const delayed = { ...db, prepare(sql) {
        const statement = db.prepare(sql);
        return { ...statement, async run(...parameters) {
          if (/UPDATE rate_limit_counters SET total_hits/u.test(sql)) {
            assert.equal(parameters.length, 3, "refund includes its original reset timestamp");
            started();
            await pending;
          }
          return statement.run(...parameters);
        } };
      } };
      const oldStore = createPostgresRateLimitStore(delayed, { prefix: "suspended-refund", windowMs: 60_000 });
      const refund = withRateLimitRequestContext({}, {}, async () => {
        await oldStore.increment("visitor");
        await oldStore.decrement("visitor");
      });
      await handlerStarted;
      await db.prepare("UPDATE rate_limit_counters SET reset_at = ? WHERE prefix = ?").run(Date.now() - 1000, "suspended-refund");
      await delay(3);
      await withRateLimitRequestContext({}, {}, () => replacementStore.increment("visitor"));
      release();
      await refund;
      assert.equal((await replacementStore.get("visitor")).totalHits, 1);
    });

    await t.test("resetAll and expiry cleanup preserve other limiters and active windows", async () => {
      const disposable = newStore("disposable");
      const active = newStore("active");
      await disposable.increment("a");
      await disposable.increment("b");
      await active.increment("a");
      await disposable.resetAll();
      assert.equal(await disposable.get("a"), undefined);
      assert.equal((await active.get("a")).totalHits, 1);
      await disposable.increment("old");
      await db.prepare("UPDATE rate_limit_counters SET reset_at = ? WHERE prefix = ?").run(Date.now() - 1000, "disposable");
      await cleanupExpiredRateLimits(db);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM rate_limit_counters WHERE prefix = ?").get("disposable")).n, 0);
      assert.equal((await active.get("a")).totalHits, 1);
    });

    await t.test("comment transactions preserve duplicate protection, member caps and rollback in PostgreSQL", async () => {
      const { insertFreshCommentAsync } = await import("../../backend/services.mjs");
      const row = { nickname: "用户", content: "a member comment", userId: "member", isGuest: false, createdAt: 1800000000000, expiresAt: null };
      const duplicate = await Promise.all(Array.from({ length: 10 }, () => insertFreshCommentAsync(db, { row, memberCap: 5 })));
      assert.equal(duplicate.filter(result => result.ok).length, 1);
      assert.equal(duplicate.filter(result => result.code === "DUPLICATE_COMMENT").length, 9);
      const capped = await Promise.all(Array.from({ length: 10 }, (_, index) => insertFreshCommentAsync(db, { row: { ...row, content: `unique comment ${index}` }, memberCap: 5 })));
      assert.equal(capped.filter(result => result.ok).length, 4);
      assert.equal(capped.filter(result => result.code === "MEMBER_COMMENT_CAP").length, 6);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM comments").get()).n, 5);
      await assert.rejects(db.transaction(tx => tx.prepare("INSERT INTO comments (nickname, content, is_guest, created_at) VALUES (?, ?, ?, ?)").run("name", "invalid date", 1, Number.MAX_SAFE_INTEGER + 1)), { code: "23514" });
      assert.equal((await db.prepare("SELECT count(*) AS n FROM comments").get()).n, 5);
    });

    await t.test("a PostgreSQL snapshot migrates without field loss, rejects nonempty targets and resumes its sequence", async () => {
      const { migrateComments } = await import("../../backend/migrate-comments.mjs");
      const directory = await mkdtemp(path.join(tmpdir(), "station-pg-roundtrip-"));
      const target = await createPostgresDatabase(postgresPool(new PGlite()));
      try {
        const source = path.join(directory, "source.db");
        await db.snapshot(source);
        const sourceCopy = new DatabaseSync(source, { readOnly: true });
        let highWater;
        try { highWater = sourceCopy.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'comments'").get().seq; }
        finally { sourceCopy.close(); }
        const dependencies = { openTarget: async () => ({ ...target, close: async () => {} }) };
        const options = { source, apply: true, env: { DATABASE_URL: "postgresql://synthetic.invalid/test" } };
        assert.deepEqual(await migrateComments(options, dependencies), { applied: true, total: 5, members: 5, guests: 0 });
        const sourceRows = await db.prepare("SELECT * FROM comments ORDER BY id").all();
        assert.deepEqual(await target.prepare("SELECT * FROM comments ORDER BY id").all(), sourceRows);
        await assert.rejects(migrateComments(options, dependencies), /not empty/u);
        assert.equal((await target.prepare("SELECT count(*) AS n FROM comments").get()).n, 5);
        const inserted = await target.prepare("INSERT INTO comments (nickname, content, user_id, is_guest, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run("guest", "after migration", null, 1, 1800000000100, 1810000000000);
        assert.ok(highWater > sourceRows.at(-1).id, "a rolled-back insertion still consumed its PostgreSQL identity");
        assert.equal(inserted.lastInsertRowid, highWater + 1);
        const destination = path.join(directory, "roundtrip.db");
        await target.snapshot(destination);
        const copy = new DatabaseSync(destination, { readOnly: true });
        try {
          assert.deepEqual(copy.prepare("SELECT * FROM comments ORDER BY id").all().map(row => ({ ...row })), await target.prepare("SELECT * FROM comments ORDER BY id").all());
          assert.equal(copy.prepare("PRAGMA quick_check").get().quick_check, "ok");
        } finally { copy.close(); }
      } finally { await target.close(); await rm(directory, { recursive: true, force: true }); }
    });

    await t.test("empty PostgreSQL snapshots preserve IDs already consumed and deleted", async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "station-pg-empty-snapshot-"));
      try {
        await db.exec("DELETE FROM comments");
        const highWater = (await db.prepare("SELECT pg_sequence_last_value(pg_get_serial_sequence('comments', 'id')::regclass) AS high_water").get()).high_water;
        const destination = path.join(directory, "empty.db");
        await db.snapshot(destination);
        const copy = new DatabaseSync(destination);
        try {
          assert.equal(copy.prepare("SELECT count(*) AS n FROM comments").get().n, 0);
          const inserted = copy.prepare("INSERT INTO comments (nickname, content, is_guest, created_at) VALUES (?, ?, ?, ?)").run("guest", "next comment", 1, 1800000000200);
          assert.equal(Number(inserted.lastInsertRowid), highWater + 1);
        } finally { copy.close(); }
      } finally { await rm(directory, { recursive: true, force: true }); }
    });

    await t.test("a slow failed request cannot decrement the next rate-limit window", async () => {
      const express = require("../../backend/node_modules/express");
      const { rateLimit } = require("../../backend/node_modules/express-rate-limit");
      const store = newStore("slow-response", 40);
      const app = express();
      app.use(withRateLimitRequestContext);
      let release;
      let started;
      const handlerStarted = new Promise(resolve => { started = resolve; });
      const pending = new Promise(resolve => { release = resolve; });
      app.use(rateLimit({ store, windowMs: 40, limit: 5, skipFailedRequests: true, keyGenerator: () => "visitor" }));
      app.get("/slow", async (_req, res) => { started(); await pending; res.status(500).end("failed"); });
      app.get("/fast", (_req, res) => res.end("ok"));
      const server = app.listen(0, "127.0.0.1");
      await new Promise(resolve => server.once("listening", resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        const slow = fetch(`${base}/slow`);
        await handlerStarted;
        await delay(65);
        assert.equal((await fetch(`${base}/fast`)).status, 200);
        assert.equal((await store.get("visitor")).totalHits, 1);
        release();
        assert.equal((await slow).status, 500);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal((await store.get("visitor")).totalHits, 1);
      } finally { release(); await new Promise(resolve => server.close(resolve)); }
    });
  } finally { await db.close(); }
});
