const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

test("invalid database configuration exits with a single actionable line before starting the server", () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "station-startup-review-")));
  const script = path.resolve(__dirname, "../../backend/server.mjs");
  const env = {
    PATH: process.env.PATH, NODE_ENV: "production", NODE_NO_WARNINGS: "1", TRUST_PROXY: "1",
    API_DOMAIN: "https://api.example.test", WEBSITE_URL: "https://example.test", ADMIN_USER_IDS: "test-admin",
    SUPERTOKENS_CONNECTION_URI: "http://127.0.0.1:39999", SUPERTOKENS_API_KEY: "synthetic-startup-test-key"
  };
  try {
    const scenarios = [
      [{}, "Production requires COMMENTS_DB_PATH or a Railway volume"],
      [{ RAILWAY_SERVICE_ID: "test-service", COMMENTS_DB_PATH: "/data/comments.db" }, "Attach a Railway volume before storing production comments"],
      [{ RAILWAY_VOLUME_MOUNT_PATH: "relative-volume" }, "RAILWAY_VOLUME_MOUNT_PATH must be absolute"],
      [{ COMMENTS_DB_PATH: "relative-comments.db" }, "Production COMMENTS_DB_PATH must be absolute"],
      [{ RAILWAY_VOLUME_MOUNT_PATH: "/data", COMMENTS_DB_PATH: "/outside/comments.db" }, "COMMENTS_DB_PATH must be inside the Railway volume"]
    ];
    for (const [configuration, message] of scenarios) {
      const result = spawnSync(process.execPath, [script], { cwd: directory, env: { ...env, ...configuration }, encoding: "utf8", timeout: 10_000 });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stderr.trim(), `❌ ${message}`);
      assert.doesNotMatch(result.stdout, /database ready|Backend running/u);
    }
    const blockedParent = path.join(directory, "private-path-must-not-appear");
    fs.writeFileSync(blockedParent, "not a directory");
    const corruptDatabase = path.join(directory, "corrupt-private-database.db");
    fs.writeFileSync(corruptDatabase, "not a SQLite database".repeat(100));
    for (const databasePath of [path.join(blockedParent, "comments.db"), directory, corruptDatabase]) {
      const result = spawnSync(process.execPath, [script], { cwd: directory, env: { ...env, COMMENTS_DB_PATH: databasePath }, encoding: "utf8", timeout: 10_000 });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stderr.trim(), "❌ Unable to initialize comments database; check COMMENTS_DB_PATH, volume write permissions and database integrity");
      assert.doesNotMatch(result.stderr, /private-path-must-not-appear|corrupt-private-database|synthetic-startup-test-key/u);
      assert.doesNotMatch(result.stdout, /database ready|Backend running/u);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("Unicode forced line breaks obey the comment limit and cannot split nicknames", async () => {
  const { validateCommentInput } = await import("../../backend/services.mjs");
  for (const separator of ["\u2028", "\u2029"]) {
    const accepted = validateCommentInput({ nickname: "雨 ☔", content: Array(16).fill("雨").join(separator) });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.content, Array(16).fill("雨").join("\n"), "accepted separators have the same stored form as normal line breaks");
    const denied = validateCommentInput({ nickname: "雨 ☔", content: Array(17).fill("雨").join(separator) });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "TOO_MANY_LINE_BREAKS");
    assert.equal(validateCommentInput({ nickname: `雨${separator}曇`, content: "普通的留言" }).ok, false,
      "a nickname must stay on one line");
  }
  const collapsed = validateCommentInput({ nickname: "雨 ☔", content: "前\r\n\u2028\u2029\n後" });
  assert.equal(collapsed.ok, true);
  assert.equal(collapsed.content, "前\n\n後", "mixed line endings still collapse to one blank line");
});

test("the real backup CLI creates verified snapshots from both regular and symlink entry paths", () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "station-backend-review-")));
  const repository = path.resolve(__dirname, "../..");
  try {
    const backend = path.join(directory, "backend");
    fs.mkdirSync(backend);
    for (const file of ["backup.mjs", "services.mjs"]) fs.copyFileSync(path.join(repository, "backend", file), path.join(backend, file));
    fs.symlinkSync(path.join(repository, "backend/node_modules"), path.join(backend, "node_modules"), "dir");
    const source = path.join(directory, "synthetic.db");
    const db = new DatabaseSync(source);
    db.exec("CREATE TABLE comments (content TEXT); INSERT INTO comments VALUES ('synthetic review data');");
    db.close();
    const script = path.join(backend, "backup.mjs");
    const alias = path.join(directory, "backup-link.mjs");
    fs.symlinkSync(script, alias);
    for (const [index, entry] of [script, alias].entries()) {
      const destination = path.join(directory, `snapshot-${index}.db`);
      const result = spawnSync(process.execPath, [entry, destination], {
        cwd: directory, env: { PATH: process.env.PATH, NODE_ENV: "development", COMMENTS_DB_PATH: source },
        encoding: "utf8", timeout: 10_000
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Backup created and verified:/u, "exit 0 must mean that the command actually ran");
      assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
      const snapshot = new DatabaseSync(destination, { readOnly: true });
      try { assert.equal(snapshot.prepare("SELECT content FROM comments").get().content, "synthetic review data"); }
      finally { snapshot.close(); }
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
