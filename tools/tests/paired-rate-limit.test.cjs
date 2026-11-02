const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { PGlite } = require("@electric-sql/pglite");

// Same single-session pg adapter as vercel-rate-limit.test.cjs; it also counts SQL round-trips.
function postgresPool(engine, counter) {
  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    return release;
  };
  const query = async (sql, parameters) => {
    if (/rate_limit_counters/u.test(sql) && !/^\s*(CREATE|ALTER)/iu.test(sql)) counter.count++;
    if (!parameters?.length && sql.includes(";")) return (await engine.exec(sql)).at(-1);
    return engine.query(sql, parameters);
  };
  return {
    async query(sql, parameters) {
      const release = await acquire();
      try { return await query(sql, parameters); } finally { release(); }
    },
    async connect() { const release = await acquire(); return { query, release }; },
    async end() { await engine.close(); }
  };
}

// The same chain as backend/server.mjs: global limiter, other middleware, then the read limiter.
async function chain(db, { paired, prefix, leaderLimit, followerLimit, failing = false }) {
  const express = require("../../backend/node_modules/express");
  const { createRequestRateLimit } = await import("../../backend/request-rate-limit.mjs");
  const { createPostgresRateLimitStore, pairNextIncrement, withRateLimitRequestContext } = await import("../../backend/rate-limit-store.mjs");
  const source = failing ? { kind: "postgres", prepare() { throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" }); } } : db;
  const leader = createPostgresRateLimitStore(source, { prefix: `${prefix}-global` });
  const follower = createPostgresRateLimitStore(source, { prefix: `${prefix}-read` });
  const log = { error() {} };
  const app = express();
  app.use(withRateLimitRequestContext);
  app.use((req, _res, next) => {
    if (paired && req.method === "GET" && req.path === "/api/comments") pairNextIncrement(leader, follower, { leaderLimit });
    next();
  });
  app.use(createRequestRateLimit({ store: leader, keyGenerator: () => "198.51.100.7", windowMs: 60_000, limit: leaderLimit,
    standardHeaders: "draft-7", legacyHeaders: false, message: { code: "RATE_LIMITED" } }, { allowReadOnStoreError: true, log }));
  app.use("/api", createRequestRateLimit({ store: follower, keyGenerator: () => "198.51.100.7", windowMs: 60_000, limit: followerLimit,
    standardHeaders: "draft-7", legacyHeaders: false, message: { code: "RATE_LIMITED" } }, { allowReadOnStoreError: true, log }));
  app.get("/api/comments", (_req, res) => res.json({ comments: [] }));
  app.post("/api/comments", (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    async request(method = "GET") {
      const response = await fetch(`${base}/api/comments`, { method });
      await response.text();
      const ratelimit = (response.headers.get("ratelimit") || "").replace(/reset=\d+/u, "reset=*");
      return { status: response.status, ratelimit, policy: response.headers.get("ratelimit-policy") };
    },
    close: () => new Promise(resolve => server.close(resolve))
  };
}

const counters = async (db, prefix) => Object.fromEntries((await db.prepare("SELECT prefix, total_hits FROM rate_limit_counters WHERE prefix LIKE ?")
  .all(`${prefix}-%`)).map(row => [row.prefix.slice(prefix.length + 1), Number(row.total_hits)]));

test("paired GET charges both limiters in one round-trip with identical statuses, headers and counters", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const counter = { count: 0 };
  const db = await createPostgresDatabase(postgresPool(new PGlite(), counter));
  const runs = {};
  for (const [name, paired] of [["separate", false], ["paired", true]]) {
    for (const [scenario, leaderLimit, followerLimit] of [["read-first", 8, 4], ["global-first", 4, 8]]) {
      const prefix = `${name}-${scenario}`;
      const app = await chain(db, { paired, prefix, leaderLimit, followerLimit });
      const replies = [];
      const before = counter.count;
      for (let index = 0; index < 11; index++) replies.push(await app.request());
      const trips = counter.count - before;
      replies.push(await app.request("POST"));
      await app.close();
      runs[`${name}-${scenario}`] = { replies, trips, counters: await counters(db, prefix) };
    }
  }
  for (const scenario of ["read-first", "global-first"]) {
    const separate = runs[`separate-${scenario}`];
    const paired = runs[`paired-${scenario}`];
    assert.deepEqual(paired.replies, separate.replies, scenario);
    assert.deepEqual(paired.counters, separate.counters, scenario);
    assert.ok(paired.replies.some(reply => reply.status === 429), scenario);
  }
  // Global limit 4: requests 5..11 are rejected there and never charge the read limiter.
  assert.deepEqual(runs["paired-global-first"].counters, { global: 12, read: 4 });
  assert.deepEqual(runs["paired-read-first"].counters, { global: 12, read: 8 });
  // Separately each allowed GET costs two round-trips and each globally rejected one costs one; paired, every GET costs one.
  assert.equal(runs["separate-read-first"].trips, 19);
  assert.equal(runs["paired-read-first"].trips, 11);
  assert.equal(runs["separate-global-first"].trips, 15);
  assert.equal(runs["paired-global-first"].trips, 11);
});

test("an unavailable counter store keeps public reads open exactly as before", async () => {
  const replies = {};
  for (const paired of [false, true]) {
    const app = await chain(null, { paired, prefix: `down-${paired}`, leaderLimit: 5, followerLimit: 5, failing: true });
    replies[paired] = [await app.request(), await app.request("POST")];
    await app.close();
  }
  assert.deepEqual(replies[true], replies[false]);
  assert.equal(replies[true][0].status, 200);
  assert.equal(replies[true][1].status, 503);
});

test("pairing is ignored outside a request context or for a mismatched leader", async () => {
  const { createPostgresRateLimitStore, pairNextIncrement } = await import("../../backend/rate-limit-store.mjs");
  const store = createPostgresRateLimitStore({ kind: "postgres" }, { prefix: "lead", windowMs: 60_000 });
  const follower = createPostgresRateLimitStore({ kind: "postgres" }, { prefix: "follow", windowMs: 60_000 });
  assert.equal(pairNextIncrement(store, follower, { leaderLimit: 5 }), false);
});

test("server pairs only literal, bodiless, CORS-accepted public reads and keeps the limits", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../backend/server.mjs"), "utf8");
  assert.match(source, /const REQUEST_LIMIT = 180;/u);
  assert.match(source, /req\.path === "\/api\/comments"/u);
  assert.match(source, /ALLOWED_ORIGINS\.has\(req\.get\("origin"\)\)/u);
  assert.match(source, /req\.skipIpRateLimits !== true/u);
  assert.match(source, /commentReadLimiter = createRequestRateLimit\(\{ \.\.\.commentReadStore, keyGenerator: clientIpKey, windowMs: 60_000, limit: 120,/u);
  assert.ok(source.indexOf("pairNextIncrement(requestLimiterStore.store") < source.indexOf("app.use(requestLimiter)"));
});
