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
function hiddenPaths(folder, root = folder) {
  const found = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.name.startsWith(".")) found.push(path.relative(root, full));
    if (entry.isDirectory()) found.push(...hiddenPaths(full, root));
  }
  return found;
}

test("build skips hidden source paths and check-build allows only the root .nojekyll file", () => {
  const box = fullCopy();
  try {
    // Leftovers from a Finder visit: one in a stale dist/, one in a source image folder.
    fs.mkdirSync(path.join(box.root, "dist/images"), { recursive: true });
    fs.writeFileSync(path.join(box.root, "dist/.DS_Store"), "x");
    fs.writeFileSync(path.join(box.root, "dist/images/.DS_Store"), "x");
    fs.writeFileSync(path.join(box.root, "images/optimized/.DS_Store"), "x");
    for (const folder of ["images/optimized/.private", "fonts/.private", "images/icons/.nojekyll"]) {
      fs.mkdirSync(path.join(box.root, folder), { recursive: true });
      fs.writeFileSync(path.join(box.root, folder, folder.startsWith("fonts") ? "private.txt" : "private.webp"), "PRIVATE_MARKER");
    }
    fs.writeFileSync(path.join(box.root, "images/.private.png"), "PRIVATE_MARKER");

    const built = run(box.root, "tools/build-site.mjs", box.outside);
    assert.equal(built.status, 0, built.stderr);
    assert.equal(fs.existsSync(path.join(box.outside, "dist")), false, "build must not write relative to the caller's cwd");
    assert.deepEqual(hiddenPaths(path.join(box.root, "dist")), [".nojekyll"]);
    assert.equal(fs.existsSync(path.join(box.root, "dist/images/optimized/.private")), false);
    assert.equal(fs.existsSync(path.join(box.root, "dist/fonts/.private")), false);

    const checked = run(box.root, "tools/check-build.mjs", box.outside);
    assert.equal(checked.status, 0, checked.stderr);

    for (const [planted, directory] of [["images/.DS_Store", false], ["images/.private", true], [".private", true], ["images/.nojekyll", false], [".nojekyll", true]]) {
      const target = path.join(box.root, "dist", planted);
      fs.rmSync(target, { recursive: true, force: true });
      if (directory) {
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, "proof.webp"), "PRIVATE_MARKER");
      } else fs.writeFileSync(target, "PRIVATE_MARKER");
      const refused = run(box.root, "tools/check-build.mjs", box.outside);
      assert.notEqual(refused.status, 0, planted);
      assert.match(refused.stderr, /refusing to publish hidden path/, planted);
      fs.rmSync(target, { recursive: true, force: true });
    }
  } finally { box.cleanup(); }
});
