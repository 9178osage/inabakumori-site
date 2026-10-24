const test = require("node:test");
const assert = require("node:assert/strict");
const { Duplex } = require("node:stream");
const { PGlite } = require("@electric-sql/pglite");
const { Client } = require("../../backend/node_modules/pg");

// Feed the real pg driver's messages into PostgreSQL's in-memory wire protocol.
// Only authentication is synthetic; SQL, results and transaction errors are real.
async function postgresFixture() {
  const engine = new PGlite();
  await engine.waitReady;
  const messages = [];
  class ProtocolSocket extends Duplex {
    startup = true;
    connect() { queueMicrotask(() => this.emit("connect")); }
    setNoDelay() {}
    setKeepAlive() {}
    ref() {}
    unref() {}
    _read() {}
    _write(chunk, _encoding, done) {
      if (this.startup) {
        this.startup = false;
        const authentication = Buffer.alloc(9);
        authentication[0] = 82; authentication.writeInt32BE(8, 1);
        this.push(Buffer.concat([authentication, Buffer.from([90, 0, 0, 0, 5, 73])]));
        done();
      } else if (chunk[0] === 88) {
        done(); this.push(null);
      } else {
        messages.push({ type: String.fromCharCode(chunk[0]), sql: chunk[0] === 81 ? chunk.subarray(5, -1).toString("utf8") : undefined });
        engine.execProtocolRaw(chunk).then(reply => { this.push(Buffer.from(reply)); done(); }, done);
      }
    }
  }
  const client = new Client({ stream: new ProtocolSocket(), user: "postgres", database: "template1", host: "memory.invalid", ssl: false });
  await client.connect();
  let releases = 0;
  let ended = false;
  const close = async () => {
    if (ended) return;
    ended = true;
    try { await client.end(); } finally { await engine.close(); }
  };
  return {
    client, messages, close,
    get releases() { return releases; },
    pool: {
      query: (sql, parameters) => client.query(sql, parameters),
      async connect() { return { query: (sql, parameters) => client.query(sql, parameters), release() { releases++; } }; },
      end: close
    }
  };
}

test("pg sends one schema message and batches the write lock before parameterized user work", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const fixture = await postgresFixture();
  try {
    const db = await createPostgresDatabase(fixture.pool);
    assert.equal(fixture.messages.filter(message => message.type === "Q").length, 1, "schema initialization needs one simple query round trip");
    assert.match(fixture.messages[0].sql, /^BEGIN;[\s\S]*pg_advisory_xact_lock\(721784230\);[\s\S]*CREATE TABLE[\s\S]*COMMIT;$/u);
    const start = fixture.messages.length;
    const text = "user value ? '; DROP TABLE comments; --";
    await db.transaction(async tx => {
      const setup = fixture.messages.slice(start);
      assert.equal(setup.length, 1);
      assert.equal(setup[0].sql, "BEGIN; SELECT pg_advisory_xact_lock(721784230);");
      const lock = await tx.prepare("SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND granted").get();
      assert.equal(lock.n, 1, "the advisory lock is held when the callback starts");
      await tx.prepare("INSERT INTO comments (nickname, content, is_guest, created_at) VALUES (?, ?, ?, ?)").run("name", text, 1, 1800000000000);
    });
    const writeMessages = fixture.messages.slice(start);
    assert.deepEqual(writeMessages.filter(message => message.type === "Q").map(message => message.sql), [
      "BEGIN; SELECT pg_advisory_xact_lock(721784230);",
      "SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND granted",
      "COMMIT"
    ]);
    assert.ok(writeMessages.some(message => message.type === "P"), "user INSERT still uses PostgreSQL parameter binding");
    assert.ok(writeMessages.every(message => !message.sql?.includes(text)), "user content is absent from simple-query batches");
    assert.equal((await db.prepare("SELECT content FROM comments").get()).content, text);
    assert.equal(fixture.releases, 2);
  } finally { await fixture.close(); }
});

test("a schema error skips its COMMIT and the separate rollback makes the pg client reusable", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const fixture = await postgresFixture();
  const brokenPool = {
    ...fixture.pool,
    async connect() {
      const connection = await fixture.pool.connect();
      return { ...connection, query(sql, parameters) {
        return connection.query(sql.replace("ON comments(created_at DESC)", "ON absent_comments(created_at DESC)"), parameters);
      } };
    }
  };
  try {
    await assert.rejects(createPostgresDatabase(brokenPool), { code: "42P01" });
    assert.equal(fixture.messages.length, 2);
    assert.match(fixture.messages[0].sql, /BEGIN;[\s\S]*absent_comments[\s\S]*COMMIT;/u);
    assert.equal(fixture.messages[1].sql, "ROLLBACK");
    assert.equal(fixture.releases, 1);
    assert.equal((await fixture.client.query("SELECT to_regclass('comments') AS relation")).rows[0].relation, null, "DDL before the error was rolled back");
    const db = await createPostgresDatabase(fixture.pool);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM comments").get()).n, 0, "the same client initializes normally after rollback");
  } finally { await fixture.close(); }
});

test("a failed write callback rolls back bound values and releases its transaction lock", async () => {
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const fixture = await postgresFixture();
  try {
    const db = await createPostgresDatabase(fixture.pool);
    const start = fixture.messages.length;
    const failure = new Error("synthetic callback failure");
    await assert.rejects(db.transaction(async tx => {
      await tx.prepare("INSERT INTO comments (nickname, content, is_guest, created_at) VALUES (?, ?, ?, ?)").run("name", "'; COMMIT; -- ?", 1, 1800000000000);
      throw failure;
    }), error => error === failure);
    assert.deepEqual(fixture.messages.slice(start).filter(message => message.type === "Q").map(message => message.sql), [
      "BEGIN; SELECT pg_advisory_xact_lock(721784230);", "ROLLBACK"
    ], "one setup message and one rollback message surround bound work");
    assert.equal((await db.prepare("SELECT count(*) AS n FROM comments").get()).n, 0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND granted").get()).n, 0);
    await db.transaction(tx => tx.prepare("INSERT INTO comments (nickname, content, is_guest, created_at) VALUES (?, ?, ?, ?)").run("name", "after rollback", 1, 1800000000001));
    assert.equal((await db.prepare("SELECT content FROM comments").get()).content, "after rollback");
    assert.equal(fixture.releases, 3);
  } finally { await fixture.close(); }
});
