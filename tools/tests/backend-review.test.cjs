const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

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
