const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const row = (id, expiresAt = null) => ({ id, nickname: "雨", content: `message ${id}`,
  is_guest: expiresAt === null ? 0 : 1, created_at: 1, expires_at: expiresAt, user_id: "never-public" });
const deferred = () => Promise.withResolvers();

test("public cache shares concurrent reads, projects only public fields and expires at 30 seconds", async () => {
  const { createPublicCommentsCache } = await import("../../backend/public-comments-cache.mjs");
  let now = 1000, calls = 0;
  const first = deferred();
  const cache = createPublicCommentsCache({ now: () => now, load: async time => {
    calls++;
    if (calls === 1) { assert.equal(time, 1000); return first.promise; }
    return [];
  } });
  const reads = [cache.read(), cache.read(), cache.read()];
  await Promise.resolve();
  assert.equal(calls, 1);
  first.resolve([row(1)]);
  const results = await Promise.all(reads);
  assert.ok(results.every(result => result === results[0]));
  assert.deepEqual(Object.keys(results[0][0]), ["id", "nickname", "content", "isGuest", "createdAt", "expiresAt"]);
  assert.equal(results[0][0].createdAt, "1970-01-01T00:00:00.001Z");
  assert.ok(Object.isFrozen(results[0]) && Object.isFrozen(results[0][0]));
  now = 30_999;
  assert.equal((await cache.read())[0].id, 1);
  assert.equal(calls, 1);
  now = 31_000;
  assert.deepEqual(await cache.read(), []);
  assert.deepEqual(await cache.read(), []);
  assert.equal(calls, 2, "empty lists also cache");
});

test("guest expiry refills the list at the boundary and slow queries do not extend cache life", async () => {
  const { createPublicCommentsCache } = await import("../../backend/public-comments-cache.mjs");
  let now = 1000, calls = 0;
  const cache = createPublicCommentsCache({ now: () => now, load: async () => {
    calls++;
    return calls === 1 ? [row(2, 1500), row(1)] : [row(1), row(0)];
  } });
  assert.equal((await cache.read()).length, 2);
  now = 1499;
  assert.equal((await cache.read())[0].id, 2);
  now = 1500;
  assert.deepEqual((await cache.read()).map(item => item.id), [1, 0]);
  assert.equal(calls, 2, "refill includes older rows after the guest expires");
  let slowCalls = 0;
  const slow = createPublicCommentsCache({ now: () => now, load: async () => {
    slowCalls++; now += 31_000;
    return [row(3, now - 1), row(2)];
  } });
  assert.deepEqual((await slow.read()).map(item => item.id), [2], "never return a guest expired during SELECT");
  await slow.read();
  assert.equal(slowCalls, 2, "an already stale query is not cached");
});

test("failed queries are not cached and do not reuse an expired snapshot", async () => {
  const { createPublicCommentsCache } = await import("../../backend/public-comments-cache.mjs");
  let now = 0, calls = 0;
  const cache = createPublicCommentsCache({ now: () => now, load: () => {
    calls++;
    if (calls === 2) throw new Error("database unavailable");
    if (calls === 3) return Promise.reject(new Error("database still unavailable"));
    return [row(calls)];
  } });
  await cache.read();
  now = 30_000;
  await assert.rejects(cache.read(), /database unavailable/u);
  await assert.rejects(cache.read(), /database still unavailable/u);
  assert.equal((await cache.read())[0].id, 4);
});

test("a committed mutation invalidates both the warm list and a pre-write in-flight query", async () => {
  const { createPublicCommentsCache } = await import("../../backend/public-comments-cache.mjs");
  const old = deferred(), fresh = deferred();
  let calls = 0;
  const cache = createPublicCommentsCache({ load: () => ++calls === 1 ? old.promise : fresh.promise });
  const staleRead = cache.read();
  await Promise.resolve();
  cache.invalidate();
  const newRead = cache.read();
  old.resolve([row(1)]);
  fresh.resolve([row(2)]);
  assert.deepEqual((await staleRead).map(item => item.id), [2]);
  assert.deepEqual((await newRead).map(item => item.id), [2]);
  assert.equal(calls, 2, "the old query joins the fresh generation");
  await cache.read();
  assert.equal(calls, 2);
  cache.invalidate();
  await cache.read();
  assert.equal(calls, 3, "a warm snapshot is invalidated as well");
});

test("a warm version probe cannot return an invalidated snapshot, even if the probe fails", async t => {
  const { createPublicCommentsCache } = await import("../../backend/public-comments-cache.mjs");
  for (const probeFails of [false, true]) await t.test(probeFails ? "failed probe" : "matching old version", async () => {
    const probe = deferred();
    let versionCalls = 0, loads = 0;
    const cache = createPublicCommentsCache({
      version: () => ++versionCalls === 2 ? probe.promise : versionCalls === 1 ? 1 : 2,
      load: () => ++loads === 1 ? [row(1)] : []
    });
    await cache.read();
    const beforeDelete = cache.read();
    assert.equal(versionCalls, 2, "the warm read is waiting for the old version query");
    cache.invalidate();
    const afterDelete = cache.read();
    if (probeFails) probe.reject(new Error("old version query failed"));
    else probe.resolve(1);
    const [before, after] = await Promise.all([beforeDelete, afterDelete]);
    assert.deepEqual(before, [], "the in-flight read must not revive a deleted comment");
    assert.equal(before, after, "the invalidated read joins the fresh load");
    assert.equal(loads, 2);
  });
});

test("a warm version probe crossing the TTL or guest expiry refills before returning", async t => {
  const { createPublicCommentsCache } = await import("../../backend/public-comments-cache.mjs");
  for (const boundary of ["TTL", "guest expiry"]) for (const probeFails of [false, true]) {
    await t.test(`${boundary}, ${probeFails ? "failed probe" : "unchanged version"}`, async () => {
      const probe = deferred();
      let now = 1000, versionCalls = 0, loads = 0;
      const expiresAt = boundary === "guest expiry" ? 1500 : null;
      const cache = createPublicCommentsCache({ now: () => now,
        version: () => ++versionCalls === 2 ? probe.promise : 1,
        load: () => ++loads === 1 ? [row(1, expiresAt)] : [row(2)]
      });
      await cache.read();
      const read = cache.read();
      assert.equal(versionCalls, 2);
      now = boundary === "guest expiry" ? 1500 : 31_000;
      if (probeFails) probe.reject(new Error("slow version query failed"));
      else probe.resolve(1);
      assert.deepEqual((await read).map(item => item.id), [2], "expired data never escapes a delayed probe");
      assert.equal(loads, 2);
    });
  }
});

test("owner and admin deletion invalidate only after a successful, authorized database delete", async t => {
  const { registerCommentManagement, registerAdminCommentManagement } = await import("../../backend/services.mjs");
  for (const admin of [false, true]) await t.test(admin ? "admin" : "owner", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE comments(id INTEGER PRIMARY KEY, nickname TEXT, content TEXT, created_at INTEGER, user_id TEXT, is_guest INTEGER, expires_at INTEGER)");
      db.prepare("INSERT INTO comments VALUES(1,'n','c',1,'owner',0,NULL)").run();
      const routes = {};
      const app = { get(path, ...handlers) { routes[`GET ${path}`] = handlers; }, delete(path, ...handlers) { routes[`DELETE ${path}`] = handlers; } };
      let invalidations = 0;
      const invalidate = () => { invalidations++; assert.equal(db.prepare("SELECT id FROM comments WHERE id=1").get(), undefined); };
      const auth = () => (req, res, next) => next();
      if (admin) registerAdminCommentManagement(app, db, auth, async id => id === "owner", invalidate);
      else registerCommentManagement(app, db, auth, invalidate);
      const call = async (id, user = "owner") => {
        const req = { params: { id }, session: { getUserId: () => user } };
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        const handlers = routes[`DELETE /api/${admin ? "admin/" : ""}comments/:id`];
        const run = async index => { if (index < handlers.length) await handlers[index](req, res, () => run(index + 1)); };
        await run(0); return res;
      };
      assert.equal((await call("1", "other")).code, 403);
      assert.equal((await call("bad")).code, 400);
      assert.equal((await call("2")).code, 404);
      assert.equal(invalidations, 0);
      assert.equal((await call("1")).code, 200);
      assert.equal(invalidations, 1);
      assert.equal((await call("1")).code, 404);
      assert.equal(invalidations, 1);
    } finally { db.close(); }
  });
});
