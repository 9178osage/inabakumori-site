const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm, stat, writeFile, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const INSERT = "INSERT INTO comments (nickname, content, user_id, is_guest, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)";
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test("SQL placeholders leave quoted text, escaped quotes, comments and dollar blocks intact", async () => {
  const { postgresPlaceholders } = await import("../../backend/database.mjs");
  const source = `SELECT ?, '?', 'it''s ?', "?", $$?$$, $body$?$body$, E'it\\'s ?' /* ? /* ? */ ? */ -- ?\n, ?`;
  assert.equal(postgresPlaceholders(source), source.replace("SELECT ?", "SELECT $1").replace(/, \?$/u, ", $2"));
  assert.equal(postgresPlaceholders("SELECT $1, $2"), "SELECT $1, $2");
});

test("database configuration refuses ephemeral Vercel SQLite and redacts invalid URLs", async () => {
  const { openDatabase } = await import("../../backend/database.mjs");
  await assert.rejects(openDatabase({ VERCEL: "1", COMMENTS_DB_PATH: "/tmp/comments.db" }, "/tmp"), error =>
    error.code === "DATABASE_CONFIG" && /Vercel requires DATABASE_URL/u.test(error.message));
  await assert.rejects(openDatabase({ DATABASE_URL: "https://private-password@private-host/db" }, "/tmp"), error =>
    error.code === "DATABASE_CONFIG" && error.message === "DATABASE_URL must be a PostgreSQL connection URL");
  await assert.rejects(openDatabase({ NODE_ENV: "production" }, "/tmp"), error =>
    error.code === "DATABASE_CONFIG" && /Production requires/u.test(error.message));
});

test("SQLite transactions isolate concurrent requests, roll back, and reject escaped transaction handles", async () => {
  const { openDatabase } = await import("../../backend/database.mjs");
  const directory = await mkdtemp(path.join(tmpdir(), "station-database-"));
  const db = await openDatabase({}, directory);
  const started = deferred();
  const resume = deferred();
  let escaped;
  try {
    assert.equal(db.kind, "sqlite");
    const pending = db.transaction(async tx => {
      escaped = tx.prepare("SELECT count(*) AS n FROM comments");
      await tx.prepare(INSERT).run("name", "private until commit", null, 1, 1234, 5678);
      started.resolve();
      await resume.promise;
      throw new Error("rollback example");
    });
    await started.promise;
    let observed = false;
    const read = db.prepare("SELECT count(*) AS n FROM comments").get().then(row => { observed = true; return row.n; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(observed, false, "outside readers wait for the entire async transaction");
    resume.resolve();
    await assert.rejects(pending, /rollback example/u);
    assert.equal(await read, 0);
    await assert.rejects(escaped.get(), /already closed/u);
    await assert.rejects(db.transaction(() => db.prepare("SELECT 1").get()), /transaction-scoped/u);
    const inserted = await db.prepare(INSERT).run("name", "committed", null, 1, 1234, 5678);
    assert.equal(inserted.changes, 1);
    assert.equal(Number(inserted.lastInsertRowid), 1);
    assert.equal((await db.prepare("SELECT content FROM comments WHERE id = ?").get(1)).content, "committed");
  } finally {
    resume.resolve();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite check-and-insert transactions keep a shared cap under simultaneous requests", async () => {
  const { openDatabase } = await import("../../backend/database.mjs");
  const directory = await mkdtemp(path.join(tmpdir(), "station-database-cap-"));
  const db = await openDatabase({}, directory);
  try {
    const accepted = await Promise.all(Array.from({ length: 20 }, (_, index) => db.transaction(async tx => {
      const count = await tx.prepare("SELECT count(*) AS n FROM comments").get();
      await new Promise(resolve => setImmediate(resolve));
      if (count.n >= 5) return false;
      await tx.prepare(INSERT).run("name", `comment ${index}`, "member", 0, 1234 + index, null);
      return true;
    })));
    assert.equal(accepted.filter(Boolean).length, 5);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM comments").get()).n, 5);
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});

test("SQLite snapshots include committed data, remain private and never overwrite existing files", async () => {
  const { openDatabase } = await import("../../backend/database.mjs");
  const directory = await mkdtemp(path.join(tmpdir(), "station-database-snapshot-"));
  const db = await openDatabase({}, directory);
  const destination = path.join(directory, "snapshot.db");
  try {
    await db.prepare(INSERT).run("用户", "保留正文\nsecond line", "member-id", 0, 123456, null);
    await db.snapshot(destination);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      assert.equal(copy.prepare("PRAGMA quick_check").get().quick_check, "ok");
      assert.equal(copy.prepare("SELECT content FROM comments").get().content, "保留正文\nsecond line");
    } finally { copy.close(); }
    assert.equal((await stat(destination)).mode & 0o777, 0o600);
    const occupied = path.join(directory, "occupied.db");
    await writeFile(occupied, "preserve existing");
    await assert.rejects(db.snapshot(occupied), { code: "EEXIST" });
    assert.equal(await readFile(occupied, "utf8"), "preserve existing");
    await assert.rejects(db.snapshot(db.databasePath), /must not overwrite/u);
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});

function fakePool(handler = () => ({ rows: [], fields: [], rowCount: 0 })) {
  const calls = [];
  let next = 0;
  const query = async (connection, sql, parameters) => { calls.push({ connection, sql, parameters }); return handler(sql, parameters); };
  return {
    calls,
    query: (sql, parameters) => query("pool", sql, parameters),
    async connect() {
      const connection = ++next;
      return { query: (sql, parameters) => query(connection, sql, parameters), release(error) { calls.push({ connection, sql: "release", ...(error ? { error } : {}) }); } };
    },
    async end() { calls.push({ sql: "end" }); }
  };
}

test("PostgreSQL binds parameters and converts only safe BIGINT columns", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const pool = fakePool(sql => {
    if (sql.startsWith("INSERT")) return { rows: [{ id: "12" }], rowCount: 1, fields: [{ name: "id", dataTypeID: 20 }] };
    if (sql.startsWith("SELECT id")) return { rows: [{ id: "12", nickname: "00123", created_at: "1800000000000" }], rowCount: 1,
      fields: [{ name: "id", dataTypeID: 20 }, { name: "nickname", dataTypeID: 25 }, { name: "created_at", dataTypeID: 20 }] };
    if (sql === "SELECT unsafe") return { rows: [{ id: "9007199254740992" }], fields: [{ name: "id", dataTypeID: 20 }] };
    return { rows: [], fields: [], rowCount: 0 };
  });
  const db = await createPostgresDatabase(pool);
  try {
    assert.equal(db.kind, "postgres");
    assert.equal(db.databasePath, null);
    assert.deepEqual(await db.prepare(INSERT).run("name", "? stays data", null, 1, 123, 456), { changes: 1, lastInsertRowid: 12 });
    const insertion = pool.calls.find(call => call.sql.startsWith("INSERT"));
    assert.match(insertion.sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6\) RETURNING id$/u);
    assert.deepEqual(insertion.parameters, ["name", "? stays data", null, 1, 123, 456]);
    assert.deepEqual(await db.prepare("SELECT id, nickname, created_at FROM comments").all(), [{ id: 12, nickname: "00123", created_at: 1800000000000 }]);
    await assert.rejects(db.prepare("SELECT unsafe").get(), /safe JavaScript range/u);
  } finally { await db.close(); }
});

test("PostgreSQL transactions keep one client, share the compatibility gate and release after rollback", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const pool = fakePool();
  const db = await createPostgresDatabase(pool);
  let escaped;
  try {
    await db.transaction(async tx => { escaped = tx; await tx.prepare("SELECT ?").get(7); });
    const committed = pool.calls.filter(call => call.connection === 2);
    assert.deepEqual(committed.map(call => call.sql), ["BEGIN ISOLATION LEVEL READ COMMITTED; SELECT pg_advisory_xact_lock_shared(721784230);", "SELECT $1", "COMMIT", "release"]);
    await assert.rejects(escaped.prepare("SELECT 1").get(), /already closed/u);
    await assert.rejects(db.transaction(async tx => { await tx.exec("SELECT 2"); throw new Error("abort write"); }), /abort write/u);
    assert.deepEqual(pool.calls.filter(call => call.connection === 3).map(call => call.sql), ["BEGIN ISOLATION LEVEL READ COMMITTED; SELECT pg_advisory_xact_lock_shared(721784230);", "SELECT 2", "ROLLBACK", "release"]);
    assert.equal(pool.calls.find(call => call.connection === 3 && call.sql === "release").error, undefined, "a successful rollback leaves the connection reusable");
    await assert.rejects(db.transaction(() => db.prepare("SELECT 1").get()), /transaction-scoped/u);
  } finally { await db.close(); }
});

test("PostgreSQL discards connections after rollback failures in initialization, writes and snapshots without replacing the original error", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  for (const phase of ["initialization", "transaction", "snapshot"]) {
    const operationError = new Error(`synthetic ${phase} failure`);
    const rollbackError = new Error("synthetic rollback timeout");
    let failOperation = phase === "initialization";
    const pool = fakePool(sql => {
      if (sql === "ROLLBACK") throw rollbackError;
      if (failOperation && (phase === "initialization" && sql.includes("CREATE TABLE") || phase === "snapshot" && sql.includes("FROM comments ORDER BY id"))) throw operationError;
      return { rows: [], fields: [], rowCount: 0 };
    });
    let db;
    try {
      if (phase === "initialization") {
        await assert.rejects(createPostgresDatabase(pool), error => error === operationError);
      } else {
        db = await createPostgresDatabase(pool);
        failOperation = true;
        await assert.rejects(phase === "transaction"
          ? db.transaction(() => { throw operationError; })
          : db.snapshot("/unused-synthetic-snapshot.db"), error => error === operationError);
      }
      const released = pool.calls.filter(call => call.sql === "release");
      assert.equal(released.at(-1).error, rollbackError, `${phase}: pg must destroy this connection`);
      assert.equal(released.length, phase === "initialization" ? 1 : 2, `${phase}: each acquired connection is released once`);
      assert.equal(pool.calls.filter(call => call.sql === "ROLLBACK").length, 1);
    } finally { await db?.close(); }
  }
});

test("discarding an unknown transaction prevents a later commit from reviving its failed write", async () => {
  const { PGlite } = require("@electric-sql/pglite");
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const engine = new PGlite();
  let rollbackFails = false, discarded = 0;
  let replacementReady = Promise.resolve();
  const query = async (sql, parameters) => {
    await replacementReady;
    if (sql === "ROLLBACK" && rollbackFails) {
      rollbackFails = false;
      throw new Error("synthetic control-query timeout");
    }
    if (!parameters?.length && sql.includes(";")) return (await engine.exec(sql)).at(-1);
    const result = await engine.query(sql, parameters);
    return { ...result, rowCount: result.affectedRows };
  };
  const pool = {
    query,
    async connect() {
      return { query, release(error) {
        if (!error) return;
        discarded++;
        // Simulate PostgreSQL's rollback on physical connection disposal. A
        // healthy release intentionally leaves this one-session engine as-is.
        replacementReady = engine.exec("ROLLBACK");
      } };
    },
    async end() { await replacementReady; await engine.close(); }
  };
  const db = await createPostgresDatabase(pool);
  try {
    rollbackFails = true;
    const businessError = new Error("synthetic business rejection");
    await assert.rejects(db.transaction(async tx => {
      await tx.prepare(INSERT).run("name", "rejected write", null, 1, 1, null);
      throw businessError;
    }), error => error === businessError);
    assert.equal(discarded, 1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM comments").get()).n, 0);
    await db.transaction(tx => tx.prepare(INSERT).run("name", "valid later write", null, 1, 2, null));
    assert.equal((await db.prepare("SELECT count(*) AS n FROM comments").get()).n, 1);
    assert.equal((await db.prepare("SELECT content FROM comments").get()).content, "valid later write");
  } finally { await db.close(); }
});

test("a pending or failed PostgreSQL compatibility gate never starts the write callback", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const started = deferred();
  const resume = deferred();
  const failure = Object.assign(new Error("synthetic advisory lock timeout"), { code: "57014" });
  const pool = fakePool(async sql => {
    if (sql === "BEGIN ISOLATION LEVEL READ COMMITTED; SELECT pg_advisory_xact_lock_shared(721784230);") {
      started.resolve();
      await resume.promise;
      throw failure;
    }
    return { rows: [], fields: [], rowCount: 0 };
  });
  const db = await createPostgresDatabase(pool);
  let called = false;
  try {
    const pending = db.transaction(() => { called = true; });
    await started.promise;
    assert.equal(called, false, "callback waits for the entire lock batch");
    resume.resolve();
    await assert.rejects(pending, error => error === failure);
    assert.equal(called, false, "a failed lock batch never enters user work");
    assert.deepEqual(pool.calls.filter(call => call.connection === 2).map(call => call.sql), [
      "BEGIN ISOLATION LEVEL READ COMMITTED; SELECT pg_advisory_xact_lock_shared(721784230);", "ROLLBACK", "release"
    ]);
  } finally { resume.resolve(); await db.close(); }
});

test("PostgreSQL backup produces a restorable SQLite snapshot with exact IDs and metadata", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const directory = await mkdtemp(path.join(tmpdir(), "station-postgres-snapshot-"));
  const rows = [{ id: "42", nickname: "ユーザー", content: "完整正文\nmore", user_id: "member", is_guest: 0, created_at: "1800000000000", expires_at: null }];
  const pool = fakePool(sql => {
    if (sql.includes("FROM comments ORDER BY id")) return { rows, fields: ["id", "created_at", "expires_at"].map(name => ({ name, dataTypeID: 20 })) };
    if (sql.includes("pg_sequence_last_value")) return { rows: [{ high_water: "100" }], fields: [{ name: "high_water", dataTypeID: 20 }] };
    return { rows: [], fields: [], rowCount: 0 };
  });
  const db = await createPostgresDatabase(pool);
  try {
    const destination = path.join(directory, "snapshot.db");
    await db.snapshot(destination);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      const copied = copy.prepare("SELECT * FROM comments").get();
      assert.deepEqual({ ...copied }, { ...rows[0], id: 42, created_at: 1800000000000 });
      assert.equal(copy.prepare("PRAGMA quick_check").get().quick_check, "ok");
      assert.equal(copy.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'rate_limit_counters'").get().n, 0);
      assert.deepEqual({ ...copy.prepare("SELECT seq, typeof(seq) AS storage_type FROM sqlite_sequence WHERE name = 'comments'").get() }, { seq: 100, storage_type: "integer" });
    } finally { copy.close(); }
    assert.equal((await stat(destination)).mode & 0o777, 0o600);
    assert.match(pool.calls.find(call => call.connection === 2).sql, /REPEATABLE READ READ ONLY/u);
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});

test("PostgreSQL snapshots release the committed client before local file errors and never roll back that completed transaction", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const directory = await mkdtemp(path.join(tmpdir(), "station-postgres-local-snapshot-"));
  try {
    for (const occupied of [true, false]) {
      const destination = path.join(directory, occupied ? "preserve.db" : "invalid-row.db");
      if (occupied) await writeFile(destination, "preserve prior backup");
      const pool = fakePool(sql => {
        if (sql.includes("FROM comments ORDER BY id")) return { rows: occupied ? [] : [{ id: 1, nickname: {}, content: "synthetic", user_id: null, is_guest: 1, created_at: 1, expires_at: null }], fields: [] };
        if (sql.includes("pg_sequence_last_value")) return { rows: [{ high_water: "1" }], fields: [{ name: "high_water", dataTypeID: 20 }] };
        return { rows: [], fields: [], rowCount: 0 };
      });
      const db = await createPostgresDatabase(pool);
      try {
        await assert.rejects(db.snapshot(destination));
        const calls = pool.calls.filter(call => call.connection === 2);
        assert.deepEqual(calls.map(call => call.sql), [
          "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
          "SELECT id, nickname, content, user_id, is_guest, created_at, expires_at FROM comments ORDER BY id",
          "SELECT pg_sequence_last_value(pg_get_serial_sequence('comments', 'id')::regclass) AS high_water",
          "COMMIT", "release"
        ]);
        assert.equal(calls.at(-1).error, undefined, "local serialization errors do not discard a healthy committed client");
        if (occupied) assert.equal(await readFile(destination, "utf8"), "preserve prior backup");
        else await assert.rejects(stat(destination), { code: "ENOENT" });
      } finally { await db.close(); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("PostgreSQL snapshots preserve integer MAX_SAFE_INTEGER sequence metadata with rows or an empty table", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const directory = await mkdtemp(path.join(tmpdir(), "station-postgres-sequence-type-"));
  try {
    for (const populated of [true, false]) {
      const rows = populated ? [{ id: String(Number.MAX_SAFE_INTEGER), nickname: "name", content: "last safe ID", user_id: null, is_guest: 1, created_at: "1800000000000", expires_at: null }] : [];
      const pool = fakePool(sql => {
        if (sql.includes("FROM comments ORDER BY id")) return { rows, fields: ["id", "created_at", "expires_at"].map(name => ({ name, dataTypeID: 20 })) };
        if (sql.includes("pg_sequence_last_value")) return { rows: [{ high_water: String(Number.MAX_SAFE_INTEGER) }], fields: [{ name: "high_water", dataTypeID: 20 }] };
        return { rows: [], fields: [], rowCount: 0 };
      });
      const db = await createPostgresDatabase(pool);
      try {
        const destination = path.join(directory, populated ? "populated.db" : "empty.db");
        await db.snapshot(destination);
        const copy = new DatabaseSync(destination, { readOnly: true });
        try {
          const sequence = copy.prepare("SELECT seq, typeof(seq) AS storage_type, CAST(seq AS TEXT) AS exact_value FROM sqlite_sequence WHERE name = 'comments'").get();
          assert.equal(sequence.storage_type, "integer");
          assert.equal(sequence.seq, Number.MAX_SAFE_INTEGER);
          assert.equal(sequence.exact_value, String(Number.MAX_SAFE_INTEGER));
          assert.equal(copy.prepare("SELECT count(*) AS n FROM comments").get().n, populated ? 1 : 0);
          if (populated) assert.equal(copy.prepare("SELECT id FROM comments").get().id, Number.MAX_SAFE_INTEGER);
          assert.equal(copy.prepare("PRAGMA quick_check").get().quick_check, "ok");
        } finally { copy.close(); }
      } finally { await db.close(); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
