const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repo = path.resolve(__dirname, "../..");
const build = fs.readFileSync(path.join(repo, "tools/build-site.mjs"), "utf8");

test("build no longer publishes the unused font files", () => {
  assert.doesNotMatch(build, /copyPublicFolder\("fonts"/);
  assert.match(build, /fonts\.css/);
});

test("no page, stylesheet, or script references a web font file", () => {
  const files = execFileSync("git", ["ls-files", "-z", "*.html", "*.css", "*.js"], { cwd: repo, encoding: "utf8" })
    // 网站海报/ holds offline poster sources that the build never publishes.
    .split("\0").filter((file) => file && !file.startsWith("inabakumori-site-all-code/") && !file.startsWith("tools/") && !file.startsWith("网站海报/"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = fs.readFileSync(path.join(repo, file), "utf8");
    assert.doesNotMatch(text, /@font-face|\.woff2?\b/i, file);
  }
});

