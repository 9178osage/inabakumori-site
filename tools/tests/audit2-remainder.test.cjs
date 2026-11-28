const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("rate-limit cleanup claims expired rows in prefix/key order with SKIP LOCKED (audit P3-1)", () => {
  const source = fs.readFileSync("backend/rate-limit-store.mjs", "utf8");
  assert.match(source, /ORDER BY prefix, key_hash/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
});

test("postgres snapshots stream pages to the worker instead of cloning all rows in workerData (audit P3-1)", () => {
  const source = fs.readFileSync("backend/database.mjs", "utf8");
  assert.match(source, /workerData: \{ destination, schema:/);
  assert.doesNotMatch(source, /workerData: \{ destination, schema:[^}]*rows/);
  assert.match(source, /await writer\.send\(page\)/);
});

test("calendar-song reuses the shared YouTube ID parser (audit P3-6)", () => {
  const source = fs.readFileSync("tools/calendar-song.mjs", "utf8");
  assert.match(source, /import \{ youtubeVideoId as videoId \} from "\.\/youtube-id\.mjs"/);
  assert.doesNotMatch(source, /function videoId\(/);
});

test("song-archive validates albumRelease and breaks timestamp ties by post id (audit P3-6)", () => {
  const source = fs.readFileSync("tools/song-archive.mjs", "utf8");
  assert.match(source, /entry\.albumRelease === undefined \|\| typeof entry\.albumRelease === "string"/);
  assert.match(source, /a\.publishedAt > b\.publishedAt \? 1 : a\.id < b\.id/);
});

test("jpegSize skips consecutive 0xFF fill and fullDir cleanup uses recursive rm (audit P3-6)", () => {
  const source = fs.readFileSync("tools/generate-nknk-gallery.mjs", "utf8");
  assert.match(source, /data\[i \+ 1\] === 0xff/);
  assert.match(source, /await rm\(target, \{ recursive: true, force: true \}\)/);
});

test("recordCurrentDeployment honors a valid GITHUB_REPOSITORY override (audit P3-6)", async () => {
  const { githubRepository } = await import("../../tools/record-current-deployment.mjs");
  assert.equal(githubRepository({}), "9178osage/inabakumori-site");
  assert.equal(githubRepository({ GITHUB_REPOSITORY: "example-owner/example-repo" }), "example-owner/example-repo");
  assert.throws(() => githubRepository({ GITHUB_REPOSITORY: "not a repo" }), /Invalid GITHUB_REPOSITORY/);
});

test("build-site stamps hand-maintained sitemap lastmod dates from content (audit P3-6)", () => {
  const source = fs.readFileSync("tools/build-site.mjs", "utf8");
  assert.match(source, /stampLastmod\(/);
  assert.match(source, /https:\/\/osagechan\.top\/updates\.html/);
});
