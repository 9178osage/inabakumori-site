const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");

test("the committed X archive is readable from the repository root and stays honest about coverage", async () => {
  const { readXPostsArchive } = await import("../x-posts-data.mjs");
  const archive = await readXPostsArchive(repo);
  assert.ok(archive.items.length > 0, "the committed archive must not silently read as empty");
  for (const creator of ["inabakumori", "nknk"]) {
    const posts = archive.items.filter(item => item.creator === creator);
    assert.ok(posts.length > 0, `${creator} posts are present`);
    const coverage = archive.coverage.find(entry => entry.creator === creator);
    assert.equal(coverage.completeness, "partial");
    assert.equal(coverage.count, posts.length);
    assert.ok(coverage.scannedTabs.includes("posts"), "the recorded posts scan remains represented");
  }
  for (const item of archive.items) {
    assert.equal(item.translated, false);
    assert.ok(Date.parse(item.collectedAt) >= Date.parse(item.publishedAt));
    assert.doesNotMatch(item.text, /&(?:amp|lt|gt);/u, `X API entities must be decoded: ${item.id}`);
  }
});

test("previously collected replies and self-replies remain in the committed archive", async () => {
  const { readXPostsArchive } = await import("../x-posts-data.mjs");
  const archive = await readXPostsArchive(repo);
  for (const id of ["2030585186002633100", "1711938508083114447"]) {
    const post = archive.items.find(item => item.id === id);
    assert.ok(post, `previously collected reply ${id} must not be dropped`);
    assert.equal(post.creator, "inabakumori");
    assert.equal(post.translated, false);
    assert.ok(post.text.trim());
  }
});

test("older verified replies are imported with their original collection time", async () => {
  const { readXPostsArchive } = await import("../x-posts-data.mjs");
  const archive = await readXPostsArchive(repo);
  const post = archive.items.find(item => item.id === "979981016549941248");
  assert.ok(post, "the saved early reply must be present in the website archive");
  assert.equal(post.creator, "inabakumori");
  assert.equal(post.text, "yes 左に強い川島");
  assert.equal(post.publishedAt, "2018-03-31T07:17:36.000Z");
  assert.equal(post.collectedAt, "2026-10-18T23:20:43.752Z");
});

test("build and check-build read the archive from the repository root, not a doubled data/x-posts path", () => {
  const build = fs.readFileSync(path.join(repo, "tools/build-site.mjs"), "utf8");
  const check = fs.readFileSync(path.join(repo, "tools/check-build.mjs"), "utf8");
  assert.match(build, /readXPostsArchive\(root\)/u);
  assert.match(check, /readXPostsArchive\(path\.resolve\(root, "\.\."\)\)/u);
  assert.doesNotMatch(build + check, /readXPostsArchive\([^)]*data\/x-posts/u);
});

test("every generated archive page is listed once in the published sitemap", () => {
  const build = fs.readFileSync(path.join(repo, "tools/build-site.mjs"), "utf8");
  assert.match(build, /archivePageNames\.push\(name\)/u);
  assert.match(build, /writeFile\(output\("dist\/sitemap\.xml"\)/u);
  assert.doesNotMatch(build, /"robots\.txt", "sitemap\.xml"/u, "sitemap.xml must be generated rather than copied verbatim");
  const check = fs.readFileSync(path.join(repo, "tools/check-build.mjs"), "utf8");
  assert.match(check, /Sitemap must list archive page/u);
  assert.match(check, /Archive pages exceed 20 MiB/u);
  assert.match(check, /Public build \(excluding archive pages\) exceeds 12 MiB/u);
});
