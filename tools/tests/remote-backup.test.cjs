const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("private remote backup validates snapshots, permissions, redirects and retention with Python stdlib", () => {
  const result = spawnSync("python3", ["-B", "-m", "unittest", "discover", "-s", "tools/tests", "-p", "remote_backup_test.py"], {
    cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 30_000
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran [1-9]\d* tests/u);
});
