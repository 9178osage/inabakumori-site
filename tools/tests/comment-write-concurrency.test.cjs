const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function bounded(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Synthetic transaction barrier was not reached")), 5000);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

// Model independent PostgreSQL transactions: business SELECTs read committed
// rows; inserts publish at commit; advisory keys wait until their owner ends.
// Actual SQL queries run against SQLite, so cap/dedup logic is not duplicated.
function concurrentDatabase() {
  const committed = new DatabaseSync(":memory:");
  committed.exec("CREATE TABLE comments(id INTEGER PRIMARY KEY, nickname TEXT, content TEXT, user_id TEXT, is_guest INTEGER, created_at INTEGER, expires_at INTEGER)");
  const firstInsert = deferred(), resumeFirst = deferred(), lockWait = deferred();
  const held = new Map(), keys = [];
  let nextId = 0, intercepted = false;
  return {
    kind: "postgres", firstInsert, resumeFirst, lockWait, keys,
    count: () => committed.prepare("SELECT count(*) AS n FROM comments").get().n,
    close: () => committed.close(),
    async transaction(callback) {
      const releases = [], staged = [];
      const tx = { prepare(sql) {
        if (sql === "SELECT pg_advisory_xact_lock(?)") return { async get(key) {
          assert.equal(typeof key, "string");
          assert.ok(BigInt(key) < 0n && BigInt(key) >= -(1n << 63n), "full-precision negative keys stay apart from the compatibility gate");
          keys.push(key);
          const previous = held.get(key);
          const gate = deferred();
          held.set(key, gate.promise);
          if (previous) { lockWait.resolve(); await previous; }
          releases.push(() => { gate.resolve(); if (held.get(key) === gate.promise) held.delete(key); });
        } };
        if (/^INSERT INTO comments/u.test(sql)) return { async run(...parameters) {
          if (!intercepted) { intercepted = true; firstInsert.resolve(); await resumeFirst.promise; }
          const id = ++nextId;
          staged.push([id, ...parameters]);
          return { changes: 1, lastInsertRowid: id };
        } };
        const statement = committed.prepare(sql);
        return { async get(...parameters) { return statement.get(...parameters); }, async all(...parameters) { return statement.all(...parameters); } };
      } };
      try {
        const result = await callback(tx);
        const insert = committed.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?)");
        for (const row of staged) insert.run(...row);
        return result;
      } finally { for (const release of releases) release(); }
    }
  };
}

const row = (userId, content) => ({ nickname: "synthetic", content, userId, isGuest: !userId, createdAt: 1800000000000, expiresAt: userId ? null : 1800000600000 });

test("different members and different guest text progress while another domain is held", async () => {
  const { insertFreshCommentAsync } = await import("../../backend/services.mjs");
  for (const [firstRow, secondRow] of [
    [row("member-a", "same message text"), row("member-b", "same message text")],
    [row(null, "first independent guest text"), row(null, "second independent guest text")]
  ]) {
    const db = concurrentDatabase();
    const first = insertFreshCommentAsync(db, { memberCap: 1, row: firstRow });
    let second;
    try {
      await bounded(db.firstInsert.promise);
      second = insertFreshCommentAsync(db, { memberCap: 1, row: secondRow });
      assert.equal((await bounded(second)).ok, true, "the other domain commits before the held writer is resumed");
      assert.notEqual(db.keys[0], db.keys[1]);
      assert.equal(db.count(), 1);
      db.resumeFirst.resolve();
      assert.equal((await first).ok, true);
      assert.equal(db.count(), 2);
    } finally { db.resumeFirst.resolve(); await Promise.allSettled([first, second]); db.close(); }
  }
});

test("same member text, member cap and normalized guest duplicates wait for their protecting domain", async () => {
  const { insertFreshCommentAsync } = await import("../../backend/services.mjs");
  for (const [firstRow, secondRow, expected] of [
    [row("member", "same member text"), row("member", "same member text"), "DUPLICATE_COMMENT"],
    [row("member", "first member text"), row("member", "second member text"), "MEMBER_COMMENT_CAP"],
    [row(null, "Ｒａｉｎ　Station"), row(null, "rain\u2060 station"), "DUPLICATE_COMMENT"]
  ]) {
    const db = concurrentDatabase();
    const first = insertFreshCommentAsync(db, { memberCap: 1, row: firstRow });
    let second;
    try {
      await bounded(db.firstInsert.promise);
      second = insertFreshCommentAsync(db, { memberCap: 1, row: secondRow });
      await bounded(db.lockWait.promise);
      assert.equal(db.keys[0], db.keys[1]);
      assert.equal(db.count(), 0, "the second request waits while the first write remains uncommitted");
      db.resumeFirst.resolve();
      assert.equal((await first).ok, true);
      assert.deepEqual(await second, { ok: false, code: expected });
      assert.equal(db.count(), 1);
    } finally { db.resumeFirst.resolve(); await Promise.allSettled([first, second]); db.close(); }
  }
});

test("short guest messages retain their intentional lack of global deduplication", async () => {
  const { insertFreshCommentAsync } = await import("../../backend/services.mjs");
  const db = concurrentDatabase();
  db.resumeFirst.resolve();
  try {
    const results = await Promise.all([1, 2].map(() => insertFreshCommentAsync(db, { row: row(null, "喜欢") })));
    assert.ok(results.every(result => result.ok));
    assert.deepEqual(db.keys, []);
    assert.equal(db.count(), 2);
  } finally { db.close(); }
});
