const test = require("node:test");
const assert = require("node:assert/strict");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function database(overrides = {}) {
  return {
    databasePath: "/synthetic/comments.db",
    prepare: sql => ({ get: async (...parameters) => ({ sql, parameters }), all: async () => [], run: async () => ({ changes: 1 }) }),
    exec: async () => {}, transaction: async callback => callback(database()), snapshot: async destination => destination, close: async () => {},
    ...overrides
  };
}
const driverError = () => Object.assign(new Error("postgresql://secret@private.invalid/db"), { code: "ECONNREFUSED", cause: new Error("private driver context") });
function assertUnavailable(error) {
  assert.equal(error.code, "DATABASE_UNAVAILABLE");
  assert.equal(error.message, "Database unavailable");
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(JSON.stringify(error), /secret|private|postgresql/u);
  return true;
}

test("a failed cold start shares one open attempt, backs off and recovers after five seconds", async () => {
  const { createDatabaseAccess } = await import("../../backend/database-access.mjs");
  let clock = 100;
  let attempts = 0;
  const first = deferred();
  const opened = database();
  const logs = [];
  const access = createDatabaseAccess({ kind: "postgres", now: () => clock, open: () => ++attempts === 1 ? first.promise : opened,
    log: { error: (...args) => logs.push(args) } });
  const ready = access.ready();
  const shared = access.ready();
  assert.equal(ready, shared);
  const reading = access.prepare("SELECT ?").get(7);
  first.reject(driverError());
  await assert.rejects(ready, assertUnavailable);
  await assert.rejects(shared, assertUnavailable);
  await assert.rejects(reading, assertUnavailable);
  assert.equal(attempts, 1);
  clock = 5099;
  await assert.rejects(access.ready(), assertUnavailable);
  assert.equal(attempts, 1);
  clock = 5100;
  assert.equal(await access.ready(), opened);
  assert.equal(attempts, 2);
  assert.equal(access.databasePath, opened.databasePath);
  assert.deepEqual(await access.prepare("SELECT ?").get(8), { sql: "SELECT ?", parameters: [8] });
  assert.deepEqual(logs, [["Database access failed", { name: "Error", code: "ECONNREFUSED" }]]);
});

test("configuration errors fail fast unchanged and never enter connection retries", async () => {
  const { createDatabaseAccess } = await import("../../backend/database-access.mjs");
  const error = Object.assign(new Error("DATABASE_URL must be a PostgreSQL connection URL"), { code: "DATABASE_CONFIG" });
  let attempts = 0;
  let clock = 0;
  const access = createDatabaseAccess({ kind: "postgres", now: () => clock, open() { attempts++; throw error; } });
  await assert.rejects(access.ready(), candidate => candidate === error);
  clock = 60000;
  await assert.rejects(access.prepare("SELECT 1").get(), candidate => candidate === error);
  assert.equal(attempts, 1);
});

test("PostgreSQL query failures are sanitized while the opened pool remains reusable", async () => {
  const { createDatabaseAccess } = await import("../../backend/database-access.mjs");
  let attempts = 0;
  let offline = true;
  const log = { error() {} };
  const opened = database({ prepare: () => Object.fromEntries(["get", "all", "run"].map(method => [method, async () => {
    if (offline) throw driverError();
    return method;
  }])), exec: async () => { if (offline) throw driverError(); }, snapshot: async () => { if (offline) throw driverError(); } });
  const access = createDatabaseAccess({ kind: "postgres", open() { attempts++; return opened; }, log });
  for (const method of ["get", "all", "run"]) await assert.rejects(access.prepare("SELECT 1")[method](), assertUnavailable);
  await assert.rejects(access.exec("SELECT 1"), assertUnavailable);
  await assert.rejects(access.snapshot("/synthetic/backup.db"), assertUnavailable);
  assert.equal(attempts, 1);
  offline = false;
  assert.equal(await access.prepare("SELECT 1").get(), "get");
  assert.equal(await access.ready(), opened);
  assert.equal(attempts, 1, "let the existing pool reconnect instead of opening more pools");
});

test("transactions distinguish driver setup/commit failures from callback business errors", async () => {
  const { createDatabaseAccess } = await import("../../backend/database-access.mjs");
  const log = { error() {} };
  for (const phase of ["begin", "commit"]) {
    const access = createDatabaseAccess({ kind: "postgres", log, open: async () => database({ transaction: async callback => {
      if (phase === "begin") throw driverError();
      await callback(database());
      throw driverError();
    } }) });
    await assert.rejects(access.transaction(async tx => tx.prepare("SELECT 1").get()), assertUnavailable);
  }
  const access = createDatabaseAccess({ kind: "postgres", log, open: async () => database() });
  const business = Object.assign(new Error("member reached its cap"), { code: "MEMBER_COMMENT_CAP" });
  await assert.rejects(access.transaction(() => { throw business; }), error => error === business);
  await assert.rejects(access.transaction(() => { throw undefined; }), error => error === undefined);
});

test("transaction SQL failures are sanitized and expired handles retain the underlying closed check", async () => {
  const { createDatabaseAccess } = await import("../../backend/database-access.mjs");
  const log = { error() {} };
  let closed = false;
  const closedError = new Error("Transaction is already closed");
  const tx = database({ prepare: () => ({ get: async () => {
    if (closed) throw closedError;
    throw driverError();
  } }), exec: async () => { if (closed) throw closedError; throw driverError(); } });
  const access = createDatabaseAccess({ kind: "postgres", log, open: async () => database({ transaction: async callback => {
    closed = false;
    try { return await callback(tx); } finally { closed = true; }
  } }) });
  await assert.rejects(access.transaction(transaction => transaction.prepare("SELECT 1").get()), assertUnavailable);
  await assert.rejects(access.transaction(transaction => transaction.exec("SELECT 1")), assertUnavailable);
  let retained, statement;
  await access.transaction(transaction => { retained = transaction; statement = transaction.prepare("SELECT 1"); });
  await assert.rejects(statement.get(), error => error === closedError);
  await assert.rejects(retained.prepare("SELECT 1").get(), error => error === closedError);
  await assert.rejects(retained.exec("SELECT 1"), error => error === closedError);
});

test("SQLite operation errors retain their identity and busy/error codes", async () => {
  const { createDatabaseAccess } = await import("../../backend/database-access.mjs");
  const busy = Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR" });
  const access = createDatabaseAccess({ kind: "sqlite", open: async () => database({ prepare: () => ({ get() { throw busy; } }) }) });
  await assert.rejects(access.prepare("SELECT 1").get(), error => error === busy);
});

test("an untrusted driver error cannot bypass sanitization by using the public unavailable code", async () => {
  const { createDatabaseAccess } = await import("../../backend/database-access.mjs");
  const unsafe = Object.assign(driverError(), { code: "DATABASE_UNAVAILABLE", name: "postgresql://private.invalid" });
  const logs = [];
  const access = createDatabaseAccess({ kind: "postgres", log: { error: (...args) => logs.push(args) }, open: async () => database({
    prepare: () => ({ get: async () => { throw unsafe; } })
  }) });
  await assert.rejects(access.prepare("SELECT 1").get(), error => error !== unsafe && assertUnavailable(error));
  assert.deepEqual(logs, [["Database access failed", { name: "Error" }]]);
});

test("close never opens a database, waits for an existing open and closes it only once", async () => {
  const { createDatabaseAccess } = await import("../../backend/database-access.mjs");
  let attempts = 0;
  const idle = createDatabaseAccess({ kind: "postgres", open() { attempts++; return database(); } });
  await idle.close();
  assert.equal(attempts, 0);
  await assert.rejects(idle.ready(), { code: "DATABASE_UNAVAILABLE" });
  const pending = deferred();
  let closes = 0;
  const access = createDatabaseAccess({ kind: "postgres", open: () => pending.promise });
  const ready = access.ready();
  const closing = access.close();
  assert.equal(access.close(), closing);
  pending.resolve(database({ close: async () => { closes++; } }));
  await ready;
  await closing;
  assert.equal(closes, 1);
  assert.equal(access.databasePath, null);
  await assert.rejects(access.prepare("SELECT 1").get(), { code: "DATABASE_UNAVAILABLE" });
});
