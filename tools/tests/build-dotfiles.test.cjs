const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");

const repo = path.resolve(__dirname, "../..");
// A throwaway copy of the tracked repo; the real checkout and its dist/ are never touched.
function fullCopy() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "station-dotfiles-")));
  const root = path.join(base, "repo");
  const outside = path.join(base, "elsewhere");
  fs.mkdirSync(outside);
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const file of files) {
    if (!fs.existsSync(path.join(repo, file))) continue;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(repo, file), path.join(root, file));
  }
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(root, "node_modules"), "dir");
  return { root, outside, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
function run(root, script, cwd) {
  const env = { ...process.env };
  delete env.CI; delete env.GITHUB_ACTIONS; delete env.KEEP_LOCAL_API_CSP;
  return spawnSync(process.execPath, [path.join(root, script)], { cwd, env, encoding: "utf8", timeout: 120_000 });
}
function dotfiles(folder) {
  const found = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...dotfiles(full));
    else if (entry.name.startsWith(".")) found.push(path.relative(folder, full));
  }
  return found;
}

test("build works from another cwd, strips planted .DS_Store files, and check-build allows only .nojekyll", () => {
  const box = fullCopy();
  try {
    // Leftovers from a Finder visit: one in a stale dist/, one in a source image folder.
    fs.mkdirSync(path.join(box.root, "dist/images"), { recursive: true });
    fs.writeFileSync(path.join(box.root, "dist/.DS_Store"), "x");
    fs.writeFileSync(path.join(box.root, "dist/images/.DS_Store"), "x");
    fs.writeFileSync(path.join(box.root, "images/optimized/.DS_Store"), "x");

    const built = run(box.root, "tools/build-site.mjs", box.outside);
    assert.equal(built.status, 0, built.stderr);
    assert.equal(fs.existsSync(path.join(box.outside, "dist")), false, "build must not write relative to the caller's cwd");
    assert.deepEqual(dotfiles(path.join(box.root, "dist")), [".nojekyll"]);

    const checked = run(box.root, "tools/check-build.mjs", box.outside);
    assert.equal(checked.status, 0, checked.stderr);

    fs.writeFileSync(path.join(box.root, "dist/images/.DS_Store"), "x");
    const refused = run(box.root, "tools/check-build.mjs", box.outside);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /refusing to publish dotfile: .*images\/\.DS_Store/);
  } finally { box.cleanup(); }
});
