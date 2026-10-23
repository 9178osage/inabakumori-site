const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("documentation and 6to4 ranges are non-public; real public hosts are not", async () => {
  const { isNonPublicHost } = await import("../net-guards.mjs");
  for (const host of ["192.0.2.1", "198.51.100.7", "203.0.113.255", "::ffff:203.0.113.5", "2001:db8::1", "[2001:db8:ffff::1]", "2002:c0a8:0101::1", "2002::"]) {
    assert.equal(isNonPublicHost(host), true, host);
  }
  for (const host of ["192.0.3.1", "198.51.101.1", "203.0.114.1", "2001:db9::1", "2003::1", "8.8.8.8", "osagechan.top"]) {
    assert.equal(isNonPublicHost(host), false, host);
  }
});

test("assertRepoPath accepts names starting with '..' but still refuses parent steps", async () => {
  const { assertRepoPath } = await import("../safe-fs.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "safe-fs-"));
  try {
    assert.equal(assertRepoPath(root, "..cache"), path.join(root, "..cache"));
    assert.equal(assertRepoPath(root, "dir/..hidden.txt"), path.join(root, "dir", "..hidden.txt"));
    fs.writeFileSync(path.join(root, "..data"), "x");
    assert.equal(assertRepoPath(root, "..data", { mustExist: true }), path.join(root, "..data"));
    for (const target of ["..", "../x", "a/../../x", path.join(path.dirname(root), "elsewhere")]) {
      assert.throws(() => assertRepoPath(root, target), /outside the repository/u, target);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
