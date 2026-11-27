const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const COLUMNS = ["id", "nickname", "content", "user_id", "is_guest", "created_at", "expires_at"];
const ROWS = [
  { id: 7, nickname: "雨 ☔", content: "synthetic private text\n第二段", user_id: "synthetic-user-id", is_guest: 0, created_at: 1_700_000_000_000, expires_at: null },
  { id: 13, nickname: "雲", content: "expired synthetic guest", user_id: null, is_guest: 1, created_at: 1_600_000_000_000, expires_at: 1_600_000_600_000 }
];
const URL = "postgresql://synthetic-user:private-test-password@db.example.test/comments";

function fixture(t, rows = ROWS, { autoIncrement = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "station-migration-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "backup.db");
  const db = new DatabaseSync(source);
  db.exec(`CREATE TABLE comments (id INTEGER PRIMARY KEY${autoIncrement ? " AUTOINCREMENT" : ""}, nickname TEXT NOT NULL, content TEXT NOT NULL,
    user_id TEXT, is_guest INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER)`);
  const insert = db.prepare(`INSERT INTO comments (${COLUMNS.join(", ")}) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const row of rows) insert.run(...COLUMNS.map(column => row[column]));
  db.close();
  return { directory, source };
}

function fakeTarget({ initial = [], corrupt = false, failInsert = false, issued = null } = {}) {
  const state = { rows: structuredClone(initial), committed: false, rolledBack: false, closed: false, locked: false, verified: false, sequence: null, inserts: 0 };
  const target = {
    kind: "postgres",
    async transaction(work) {
      const before = structuredClone(state.rows);
      try {
        await work({
          async exec(sql) { assert.equal(sql, "LOCK TABLE comments IN EXCLUSIVE MODE"); state.locked = true; },
          prepare(sql) {
            return {
              async get(value) {
                assert.ok(state.locked, "lock must precede target inspection");
                if (sql.startsWith("SELECT COUNT")) return { n: state.rows.length };
                if (sql.includes("pg_sequence_last_value")) return { issued };
                assert.match(sql, /^SELECT setval/u);
                assert.equal(state.verified, true, "sequence updates must follow field verification");
                state.sequence = value;
                return { setval: value };
              },
              async run(...values) {
                assert.match(sql, /^INSERT INTO comments/u);
                if (failInsert && state.inserts === 1) throw new Error(`private driver error ${URL} ${ROWS[0].content}`);
                state.inserts++;
                state.rows.push(Object.fromEntries(COLUMNS.map((column, index) => [column, values[index]])));
              },
              async all() {
                const rows = structuredClone(state.rows);
                if (corrupt) rows[0].content = "changed by synthetic trigger";
                state.verified = true;
                return rows;
              }
            };
          }
        });
        state.committed = true;
      } catch (error) {
        state.rows = before;
        state.rolledBack = true;
        throw error;
      }
    },
    async close() { state.closed = true; }
  };
  return { target, state };
}

test("dry-run is the default, reads a backup without changing bytes and never opens PostgreSQL", async t => {
  const { source } = fixture(t);
  const before = fs.readFileSync(source);
  const { migrateComments, parseMigrationArgs } = await import("../../backend/migrate-comments.mjs");
  assert.equal(parseMigrationArgs(["--source", source]).apply, false);
  assert.equal(parseMigrationArgs(["--source", source, "--dry-run"]).apply, false);
  assert.equal(parseMigrationArgs(["--source", source, "--apply"]).apply, true);
  for (const args of [[], ["--source"], ["--source", source, "--apply", "--dry-run"], ["--source", source, "--typo"]]) {
    assert.throws(() => parseMigrationArgs(args));
  }
  const result = await migrateComments({ source, env: { DATABASE_URL: URL } }, { openTarget() { assert.fail("dry-run must not connect"); } });
  assert.deepEqual(result, { applied: false, total: 2, members: 1, guests: 1 });
  assert.deepEqual(fs.readFileSync(source), before);
});

test("a failing close() after a committed import still reports success and logs only sanitized metadata", async t => {
  const { source } = fixture(t);
  const { target, state } = fakeTarget();
  target.close = async () => { state.closed = true; throw Object.assign(new Error(`private close error ${URL}`), { code: "ECONNRESET" }); };
  const warnings = [];
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  const result = await migrateComments({ source, apply: true, env: { DATABASE_URL: URL } }, { openTarget: async () => target, log: { warn: (...args) => warnings.push(args) } });
  assert.equal(result.applied, true);
  assert.equal(state.committed, true);
  assert.equal(state.closed, true);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0][1], { name: "Error", code: "ECONNRESET" });
  assert.equal(JSON.stringify(warnings).includes(URL), false, "the connection string never reaches the log");
});

test("apply preserves IDs, owners, original text, timestamps and expired guest rows, then advances the sequence", async t => {
  const { source } = fixture(t);
  const { target, state } = fakeTarget();
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  const result = await migrateComments({ source, apply: true, env: { DATABASE_URL: URL } }, { openTarget: async () => target });
  assert.equal(result.applied, true);
  assert.deepEqual(state.rows, ROWS);
  assert.equal(state.sequence, 13);
  assert.equal(state.committed, true);
  assert.equal(state.closed, true);
});

test("a nonempty target is refused under the lock without inserting or overwriting", async t => {
  const { source } = fixture(t);
  const { target, state } = fakeTarget({ initial: [ROWS[0]] });
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  await assert.rejects(migrateComments({ source, apply: true, env: { DATABASE_URL: URL } }, { openTarget: async () => target }), /not empty/u);
  assert.deepEqual(state.rows, [ROWS[0]]);
  assert.equal(state.inserts, 0);
  assert.equal(state.rolledBack, true);
  assert.equal(state.closed, true);
});

test("field mismatch or an interrupted insert rolls back the whole import and never reports content or credentials", async t => {
  const { source } = fixture(t);
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  for (const options of [{ corrupt: true }, { failInsert: true }]) {
    const { target, state } = fakeTarget(options);
    await assert.rejects(migrateComments({ source, apply: true, env: { DATABASE_URL: URL } }, { openTarget: async () => target }), error => {
      assert.doesNotMatch(error.message, /private-test-password|synthetic private text|postgresql:/u);
      return true;
    });
    assert.deepEqual(state.rows, []);
    assert.equal(state.committed, false);
    assert.equal(state.rolledBack, true);
    assert.equal(state.sequence, null);
    assert.equal(state.closed, true);
  }
});

test("invalid sources are rejected before a connection is opened and missing backups are never created", async t => {
  const { directory, source } = fixture(t, [{ ...ROWS[0], is_guest: 2 }]);
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  const missing = path.join(directory, "missing.db");
  for (const candidate of [source, missing]) {
    await assert.rejects(migrateComments({ source: candidate, apply: true, env: { DATABASE_URL: URL } }, { openTarget() { assert.fail("invalid source must not connect"); } }));
  }
  assert.equal(fs.existsSync(missing), false);
});

test("apply requires an explicit PostgreSQL database and refuses a SQLite target", async t => {
  const { source } = fixture(t);
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  for (const value of [undefined, "sqlite:///tmp/comments.db", "postgresql://db.example.test", "postgresql://db.example.test/"]) {
    await assert.rejects(migrateComments({ source, apply: true, env: { DATABASE_URL: value } }, { openTarget() { assert.fail("invalid target URL must not connect"); } }), /requires a PostgreSQL DATABASE_URL/u);
  }
  let closed = false;
  await assert.rejects(migrateComments({ source, apply: true, env: { DATABASE_URL: URL } }, {
    openTarget: async () => ({ kind: "sqlite", async transaction() { assert.fail("SQLite target must not be used"); }, async close() { closed = true; } })
  }), /target must be PostgreSQL/u);
  assert.equal(closed, true);
});

test("empty backups commit without moving the PostgreSQL identity sequence", async t => {
  const { source } = fixture(t, []);
  const { target, state } = fakeTarget();
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  assert.deepEqual(await migrateComments({ source, apply: true, env: { DATABASE_URL: URL } }, { openTarget: async () => target }),
    { applied: true, total: 0, members: 0, guests: 0 });
  assert.equal(state.sequence, null);
  assert.equal(state.committed, true);
  assert.equal(state.closed, true);
});

test("SQLite AUTOINCREMENT high-water is preserved after the highest ID or all comments were deleted", async t => {
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  for (const deleteAll of [false, true]) {
    const { source } = fixture(t, ROWS, { autoIncrement: true });
    const db = new DatabaseSync(source);
    db.prepare(`INSERT INTO comments (${COLUMNS.join(", ")}) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(...COLUMNS.map(column => column === "id" ? 101 : ROWS[0][column]));
    db.exec(deleteAll ? "DELETE FROM comments" : "DELETE FROM comments WHERE id = 101");
    assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'comments'").get().seq, 101);
    db.close();
    const { target, state } = fakeTarget();
    await migrateComments({ source, apply: true, env: { DATABASE_URL: URL } }, { openTarget: async () => target });
    assert.deepEqual(state.rows, deleteAll ? [] : ROWS);
    assert.equal(state.sequence, 101, "the next generated ID must remain above every formerly issued SQLite ID");
    assert.equal(state.committed, true);
  }
});

test("invalid or regressed SQLite sequences are refused before the target is opened", async t => {
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  for (const seq of [-1, 2, 13.5]) {
    const { source } = fixture(t, ROWS, { autoIncrement: true });
    const db = new DatabaseSync(source);
    db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'comments'").run(seq);
    db.close();
    await assert.rejects(migrateComments({ source, apply: true, env: { DATABASE_URL: URL } }, { openTarget() { assert.fail("invalid high-water must not connect"); } }), /invalid ID sequence/u);
  }
});

test("the real CLI defaults to a read-only dry-run and emits only counts; failures redact private paths and URL values", t => {
  const { source, directory } = fixture(t);
  const script = path.resolve(__dirname, "../../backend/migrate-comments.mjs");
  const env = { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", DATABASE_URL: URL };
  const result = spawnSync(process.execPath, [script, "--source", source], { cwd: directory, env, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry-run verified .*2 comments \(1 members, 1 guests\)/u);
  assert.doesNotMatch(result.stdout + result.stderr, /private-test-password|synthetic-user-id|synthetic private text|backup\.db/u);
  const failed = spawnSync(process.execPath, [script, "--source", source, "--apply"], { cwd: directory, env: { ...env, DATABASE_URL: "https://private-test-password.example.test/comments" }, encoding: "utf8", timeout: 10_000 });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /requires a PostgreSQL DATABASE_URL/u);
  assert.doesNotMatch(failed.stdout + failed.stderr, /private-test-password|station-migration-|synthetic private text/u);
});

test("an empty target that already issued IDs never moves its sequence back or silently reuses IDs (audit #03)", async t => {
  const { source } = fixture(t);
  const { migrateComments, parseMigrationArgs } = await import("../../backend/migrate-comments.mjs");
  const env = { DATABASE_URL: URL };
  // Overlapping history: refused under the lock, nothing inserted.
  let fake = fakeTarget({ issued: 100 });
  await assert.rejects(migrateComments({ source, apply: true, env }, { openTarget: async () => fake.target }), /already issued comment IDs up to 100/u);
  assert.equal(fake.state.inserts, 0);
  assert.equal(fake.state.sequence, null);
  // Explicitly confirmed same-database restore: rows imported, sequence keeps the larger high-water.
  fake = fakeTarget({ issued: 100 });
  await migrateComments({ source, apply: true, acceptTargetHistory: true, env }, { openTarget: async () => fake.target });
  assert.equal(fake.state.sequence, 100);
  // Backup IDs above the target history need no confirmation; the backup high-water wins.
  fake = fakeTarget({ issued: 5 });
  await migrateComments({ source, apply: true, env }, { openTarget: async () => fake.target });
  assert.equal(fake.state.sequence, 13);
  assert.equal(parseMigrationArgs(["--source", source, "--apply", "--accept-target-history"]).acceptTargetHistory, true);
  assert.throws(() => parseMigrationArgs(["--source", source, "--accept-target-history"]), /only meaningful with --apply/u);
});

test("preflight uses the shared Date-safe range and names the offending comment IDs (audit #04)", async t => {
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  for (const [field, value] of [["created_at", -1], ["created_at", 8_640_000_000_000_001], ["expires_at", -5], ["expires_at", 8_640_000_000_000_001]]) {
    const { source } = fixture(t, [ROWS[0], { ...ROWS[1], [field]: value }]);
    await assert.rejects(migrateComments({ source }), error => /ID 13/u.test(error.message) && !/ID 7\b/u.test(error.message), `${field}=${value}`);
  }
  const { source } = fixture(t, [{ ...ROWS[0], created_at: 8_640_000_000_000_000 }]);
  assert.equal((await migrateComments({ source })).total, 1, "the Date maximum itself is accepted");
});

test("real PostgreSQL: issued IDs survive an empty-table import and the time range is enforced (audit #03/#04)", async t => {
  const { PGlite } = require("@electric-sql/pglite");
  const { createPostgresDatabase } = await import("../../backend/database.mjs");
  const { migrateComments } = await import("../../backend/migrate-comments.mjs");
  const { createPublicCommentsCache } = await import("../../backend/public-comments-cache.mjs");
  const engine = new PGlite();
  const harness = () => {
    const query = async (sql, parameters) => {
      if (!parameters?.length && sql.includes(";")) return (await engine.exec(sql)).at(-1);
      const result = await engine.query(sql, parameters);
      return { ...result, rowCount: result.affectedRows };
    };
    return { query, async connect() { return { query, release() {} }; }, async end() {} };
  };
  // An older table without the new constraint, which already issued IDs up to 100 and was emptied.
  await engine.exec(`CREATE TABLE comments (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, nickname TEXT NOT NULL, content TEXT NOT NULL,
    user_id TEXT, is_guest INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
    expires_at BIGINT CHECK (expires_at BETWEEN 0 AND 9007199254740991));
    SELECT setval(pg_get_serial_sequence('comments', 'id'), 100, true);`);
  const { source } = fixture(t);
  const env = { DATABASE_URL: URL };
  const open = async () => createPostgresDatabase(harness());
  await assert.rejects(migrateComments({ source, apply: true, env }, { openTarget: open }), /up to 100/u);
  await migrateComments({ source, apply: true, acceptTargetHistory: true, env }, { openTarget: open });
  const db = await open();
  t.after(() => db.close());
  const next = await db.transaction(tx => tx.prepare("INSERT INTO comments (nickname, content, user_id, is_guest, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("新", "after import", null, 1, 1_700_000_000_000, null));
  assert.equal(next.lastInsertRowid, 101, "the next ID continues after every ID the target issued");
  // The upgraded table now rejects times JavaScript cannot represent, without rescanning old rows.
  await assert.rejects(db.prepare("INSERT INTO comments (nickname, content, user_id, is_guest, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("bad", "too far", null, 1, 8_640_000_000_000_001, null), /comments_time_range/u);
  // A legacy row outside the range is left out of the public list instead of breaking it.
  await engine.exec("ALTER TABLE comments DROP CONSTRAINT comments_time_range; INSERT INTO comments (nickname, content, is_guest, created_at) VALUES ('legacy', 'x', 1, 8640000000000001);");
  const cache = createPublicCommentsCache({ load: async () => (await db.prepare("SELECT * FROM comments ORDER BY id").all()) });
  const listed = await cache.read();
  assert.deepEqual(listed.map(comment => comment.id), [7, 13, 101].filter(id => id !== 13), "expired guest 13 and the out-of-range row are not listed");
});
