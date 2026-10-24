const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");

const script = fs.readFileSync(path.join(__dirname, "../../script.js"), "utf8");

test("2: duplicate detection ignores rows that have already expired", async () => {
  const { createRecentDuplicateChecker } = await import("../../backend/services.mjs");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE comments(content TEXT, user_id TEXT, is_guest INTEGER, created_at INTEGER, expires_at INTEGER)");
    const now = 1800000000000;
    const insert = db.prepare("INSERT INTO comments VALUES(?,?,?,?,?)");
    insert.run("expired guest text", null, 1, now - 60_000, now - 1);
    insert.run("expired member text", "alice", 0, now - 60_000, now);
    insert.run("live guest text here", null, 1, now - 60_000, now + 1000);
    insert.run("permanent member text", "alice", 0, now - 60_000, null);
    const duplicate = createRecentDuplicateChecker(db);
    assert.equal(duplicate("expired guest text", null, now), false);
    assert.equal(duplicate("expired member text", "alice", now), false, "expires_at == now is expired");
    assert.equal(duplicate("live guest text here", null, now), true);
    assert.equal(duplicate("permanent member text", "alice", now), true);
  } finally { db.close(); }
});

function asyncCommentDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE comments(id INTEGER PRIMARY KEY, nickname TEXT, content TEXT,
    user_id TEXT, is_guest INTEGER, created_at INTEGER, expires_at INTEGER)`);
  let active = false;
  const tx = {
    prepare(sql) {
      assert.equal(active, true, "all duplicate, cap and insert queries belong to the transaction");
      const statement = sqlite.prepare(sql);
      return Object.fromEntries(["all", "get", "run"].map(method => [method, async (...args) => {
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(active, true, "the transaction must remain open until async queries finish");
        return statement[method](...args);
      }]));
    }
  };
  return {
    sqlite,
    async transaction(callback) {
      assert.equal(active, false);
      sqlite.exec("BEGIN IMMEDIATE");
      active = true;
      try {
        const result = await callback(tx);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally { active = false; }
    }
  };
}

test("async comment inserts keep normalization, account scope and ten-minute member windows", async () => {
  const { insertFreshCommentAsync } = await import("../../backend/services.mjs");
  const db = asyncCommentDatabase();
  const now = 1800000000000;
  const row = { nickname: "fan", content: "Ｒａｉｎ　Station\u2060", userId: "alice", isGuest: false, createdAt: now, expiresAt: null };
  try {
    assert.deepEqual(await insertFreshCommentAsync(db, { row }), { ok: true, id: 1 });
    const same = { ...row, content: "  rain station  ", createdAt: now + 1 };
    assert.deepEqual(await insertFreshCommentAsync(db, { row: same }), { ok: false, code: "DUPLICATE_COMMENT" });
    assert.deepEqual(await insertFreshCommentAsync(db, { row: { ...same, userId: "bob" } }), { ok: true, id: 2 });
    assert.deepEqual(await insertFreshCommentAsync(db, { row: { ...same, createdAt: now + 10 * 60 * 1000 } }), { ok: true, id: 3 });
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM comments").get().n, 3);
    const expired = { ...row, content: "expired member text", expiresAt: now + 1 };
    assert.equal((await insertFreshCommentAsync(db, { row: expired })).ok, true);
    assert.equal((await insertFreshCommentAsync(db, { row: { ...expired, createdAt: now + 1, expiresAt: null } })).ok, true, "expired member text does not block a duplicate");
  } finally { db.sqlite.close(); }
});

test("async guest inserts keep the five-minute global window, eight-character threshold and expiry", async () => {
  const { insertFreshCommentAsync } = await import("../../backend/services.mjs");
  const db = asyncCommentDatabase();
  const now = 1800000000000;
  const row = { nickname: "fan", content: "喜欢", userId: null, isGuest: true, createdAt: now, expiresAt: now + 1000000 };
  try {
    for (const content of ["喜欢", "喜欢", "１２３４５６７\u2060", "1234567"]) {
      assert.equal((await insertFreshCommentAsync(db, { row: { ...row, content } })).ok, true);
    }
    assert.equal((await insertFreshCommentAsync(db, { row: { ...row, content: "１２３４５６７８" } })).ok, true);
    assert.deepEqual(await insertFreshCommentAsync(db, { row: { ...row, content: "12345678", createdAt: now + 1 } }), { ok: false, code: "DUPLICATE_COMMENT" });
    assert.equal((await insertFreshCommentAsync(db, { row: { ...row, content: "12345678", createdAt: now + 5 * 60 * 1000 } })).ok, true);
    assert.equal((await insertFreshCommentAsync(db, { row: { ...row, content: "expired guest text", expiresAt: now + 1 } })).ok, true);
    assert.equal((await insertFreshCommentAsync(db, { row: { ...row, content: "expired guest text", createdAt: now + 1 } })).ok, true, "expires_at == now no longer blocks a duplicate");
  } finally { db.sqlite.close(); }
});

test("async comment inserts enforce the member cap before inserting and propagate database errors", async () => {
  const { insertFreshCommentAsync } = await import("../../backend/services.mjs");
  const db = asyncCommentDatabase();
  const row = { nickname: "fan", content: "first member message", userId: "alice", isGuest: false, createdAt: 1800000000000, expiresAt: null };
  try {
    assert.equal((await insertFreshCommentAsync(db, { memberCap: 1, row })).ok, true);
    assert.deepEqual(await insertFreshCommentAsync(db, { memberCap: 1, row: { ...row, content: "second member message" } }), { ok: false, code: "MEMBER_COMMENT_CAP" });
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM comments").get().n, 1);
    assert.equal((await insertFreshCommentAsync(db, { memberCap: 0, row: { ...row, content: "second member message" } })).ok, true);
    assert.equal((await insertFreshCommentAsync(db, { memberCap: 1, row: { ...row, userId: null, isGuest: true } })).ok, true);
    db.sqlite.exec(`CREATE TRIGGER reject_broken_comment BEFORE INSERT ON comments
      WHEN NEW.content = 'broken insert' BEGIN SELECT RAISE(ABORT, 'insert rejected'); END`);
    const count = db.sqlite.prepare("SELECT count(*) AS n FROM comments").get().n;
    await assert.rejects(insertFreshCommentAsync(db, { memberCap: 0, row: { ...row, content: "broken insert" } }), /insert rejected/);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM comments").get().n, count, "a failed insert rolls back its transaction");
    assert.equal((await insertFreshCommentAsync(db, { memberCap: 0, row: { ...row, content: "after failed insert" } })).ok, true, "failed transactions release the connection");
  } finally { db.sqlite.close(); }
});

function clientHelpers() {
  const pick = re => script.match(re)?.[0] || assert.fail(`missing ${re}`);
  const code = [
    pick(/const MAX_NICKNAME_LENGTH = \d+;/), pick(/const MAX_COMMENT_LENGTH = \d+;/),
    pick(/function unicodeLength\(value\) \{[\s\S]*?\n\}/),
    pick(/const LONE_SURROGATE = .*;/), pick(/function hasLoneSurrogate\(value\) \{[\s\S]*?\n\}/),
    "this.out = { unicodeLength, hasLoneSurrogate, MAX_COMMENT_LENGTH };"
  ].join("\n");
  const context = {};
  vm.runInNewContext(code, context);
  return context.out;
}

test("3: the client counts length after NFC, like the server", async () => {
  const { unicodeLength, MAX_COMMENT_LENGTH } = clientHelpers();
  const { validateCommentInput } = await import("../../backend/services.mjs");
  const decomposed = "e\u0301";
  assert.equal(unicodeLength(decomposed), 1);
  const text = decomposed.repeat(MAX_COMMENT_LENGTH);
  assert.equal(unicodeLength(text), MAX_COMMENT_LENGTH, "500 decomposed é are 500 characters, not 1000");
  assert.equal(validateCommentInput({ nickname: "rain", content: text }).ok, true, "server agrees");
  const over = decomposed.repeat(MAX_COMMENT_LENGTH + 1);
  assert.equal(unicodeLength(over), MAX_COMMENT_LENGTH + 1);
  assert.equal(validateCommentInput({ nickname: "rain", content: over }).ok, false);
});

test("3: an over-length message is reported, not silently truncated on submit", () => {
  const add = script.match(/async function addMessage\(\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(add, /enforceCommentFieldLimits\(/, "submit must not trim the fields before checking them");
  assert.match(add, /unicodeLength\(content\) > MAX_COMMENT_LENGTH\) \{\n\s*showLengthFeedback\("content"\)/);
  const enforce = script.match(/function enforceCommentFieldLimits\([\s\S]*?\n\}/)[0];
  assert.match(enforce, /showLengthFeedback\(trimmed\)/, "typing past the limit says so");
});

test("4: server and client reject lone surrogates but keep real emoji", async () => {
  const { validateCommentInput } = await import("../../backend/services.mjs");
  const { hasLoneSurrogate } = clientHelpers();
  for (const bad of ["\uD800", "a\uDC00b", "好\uD83D", "\uDE00x"]) {
    assert.equal(validateCommentInput({ nickname: "rain", content: bad }).ok, false, JSON.stringify(bad));
    assert.equal(validateCommentInput({ nickname: bad, content: "hello" }).ok, false, JSON.stringify(bad));
    assert.equal(hasLoneSurrogate(bad), true, JSON.stringify(bad));
  }
  for (const good of ["😀 好听", "👨‍👩‍👧", "𠮷野家"]) {
    assert.equal(validateCommentInput({ nickname: "rain", content: good }).ok, true, good);
    assert.equal(hasLoneSurrogate(good), false, good);
  }
  const add = script.match(/async function addMessage\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(add, /hasLoneSurrogate\(nickname\) \|\| hasLoneSurrogate\(content\)/);
});
