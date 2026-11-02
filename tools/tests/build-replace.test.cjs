const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const build = fs.readFileSync("tools/build-site.mjs", "utf8");

test("build inserts generated HTML with function replacements, so $ patterns stay literal (audit A6)", () => {
  assert.match(build, /html = html\.replace\('<div class="song-scroll song-list" id="song-list"><\/div>', \(\) => `/);
  assert.match(build, /template\.replace\("<\/head>", \(\) => `<meta name="x-posts-version"/, "newest X post metadata is inserted literally");
  // String patterns whose replacement interpolates data must use a function replacement.
  const risky = [...build.matchAll(/\.replace\((?:"[^"]*"|'[^']*'), `[^`]*\$\{/g)].map(match => match[0]);
  assert.deepEqual(risky, []);
  const sample = "<i>a</i><div id=x></div><i>b</i>";
  const title = "Song $` $' $&";
  assert.equal(sample.replace("<div id=x></div>", () => `<div id=x>${title}</div>`), `<i>a</i><div id=x>${title}</div><i>b</i>`);
});
