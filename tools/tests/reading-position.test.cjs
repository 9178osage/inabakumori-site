const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repo = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(repo, "js/updates.js"), "utf8");
function helpers() {
  const window = {};
  vm.runInContext(source, vm.createContext({ window, document: { readyState: "loading", addEventListener() {} } }));
  return window.xArchiveReading;
}
const mark = (at, id) => ({ at, id });

test("first visit records the newest post without badging anything", () => {
  const { nextSeenState } = helpers();
  const newest = mark("2026-10-24T10:00:00.000Z", "200");
  const { baseline, record } = nextSeenState(null, newest, 1_000);
  assert.equal(baseline, null);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), { through: newest, baseline: null, since: 1_000 });
});

test("a later visit badges posts newer than what was seen, and a quick reload keeps the badges", () => {
  const { nextSeenState, compareMarks } = helpers();
  const old = mark("2026-10-20T10:00:00.000Z", "100");
  const newest = mark("2026-10-24T10:00:00.000Z", "200");
  const visit = nextSeenState({ through: old, baseline: null, since: 0 }, newest, 2 * 60 * 60 * 1000);
  assert.deepEqual(visit.baseline, old);
  assert.ok(compareMarks(newest, visit.baseline) > 0);
  const reload = nextSeenState(JSON.parse(JSON.stringify(visit.record)), newest, 2 * 60 * 60 * 1000 + 60_000);
  assert.deepEqual(reload.baseline, old, "within 30 minutes the same posts stay new");
  const later = nextSeenState(JSON.parse(JSON.stringify(reload.record)), newest, 5 * 60 * 60 * 1000);
  assert.deepEqual(later.baseline, newest, "after the window everything seen is no longer new");
});

test("corrupt or hostile stored values are ignored", () => {
  const { nextSeenState, validMark, readRecord, compareMarks } = helpers();
  for (const value of [{ through: { at: "<script>", id: "1" } }, { through: { at: "2026-01-01T00:00:00Z", id: "1e9" } }, { through: "x" }, []]) {
    assert.equal(nextSeenState(value, null, 0).baseline, null);
  }
  assert.equal(validMark(mark("2026-01-01T00:00:00.000Z", "9".repeat(31))), false);
  assert.ok(compareMarks(mark("2026-01-01T00:00:00Z", "99"), mark("2026-01-01T00:00:00Z", "100")) < 0, "same second compares IDs numerically");
  assert.equal(readRecord({ getItem() { throw new Error("SecurityError"); } }, "k"), null, "blocked storage reads as nothing");
  assert.equal(readRecord({ getItem: () => "{not json" }, "k"), null);
  assert.equal(readRecord({ getItem: () => "[1]" }, "k"), null);
});

test("page labels are trilingual and reading data stays in local storage", () => {
  const { pageLabel } = helpers();
  assert.deepEqual(JSON.parse(JSON.stringify(pageLabel("updates-nknk-page-3.html"))), { zh: "NKNK · 第 3 页", en: "NKNK · page 3", ja: "NKNK · 3ページ目" });
  assert.equal(pageLabel("updates.html").en, "page 1");
  assert.match(source, /继续上次阅读/u);
  assert.match(source, /Continue where you left off/u);
  assert.match(source, /前回の続きから/u);
  assert.doesNotMatch(source, /document\.cookie|sendBeacon/u, "reading position never leaves the browser");
  const block = source.slice(source.indexOf("function initReadingPosition"), source.indexOf("window.xArchiveReading"));
  assert.doesNotMatch(block, /fetch\(|XMLHttpRequest/u);
  assert.match(block, /scrollY \|\| 0\) < 300/u, "arriving at the top does not overwrite the saved spot");
});

test("a saved or linked post is found on its current page after new posts shift the pages (audit #08)", () => {
  const { pageForPost } = helpers();
  const lookup = { version: 1, pageSize: 2, ordered: true, views: { all: ["900", "700", "500"], nknk: ["800", "400"] } };
  assert.equal(pageForPost(lookup, "all", "950"), "updates.html");
  assert.equal(pageForPost(lookup, "all", "900"), "updates.html");
  assert.equal(pageForPost(lookup, "all", "899"), "updates-page-2.html");
  assert.equal(pageForPost(lookup, "all", "500"), "updates-page-3.html");
  assert.equal(pageForPost(lookup, "nknk", "401"), "updates-nknk-page-2.html");
  assert.equal(pageForPost(lookup, "all", "499"), null, "older than every page: no guess");
  assert.equal(pageForPost({ ...lookup, ordered: false }, "all", "950"), null, "an archive not in ID order is never guessed");
  assert.equal(pageForPost(lookup, "all", "1e9"), null);
  assert.equal(pageForPost(null, "all", "950"), null);
  assert.equal(pageForPost({ ...lookup, views: { all: ["<x>"] } }, "all", "950"), null);
  // Arrival only counts when the saved post is really on this page, and a miss follows the post.
  assert.match(source, /const savedHere = savedValid && articles\.some\(article => article\.dataset\.xPostId === saved\.id\);/u);
  assert.match(source, /locatePost\(viewOf\(page\), id\)\.then\(name => \{ if \(name && name !== page\) window\.location\.replace/u);
});

test("the published page lookup matches the real archive ordering (audit #08)", async () => {
  const { readXPostsArchive } = await import("../x-posts-data.mjs");
  const { createXPostsRenderer } = await import("../render-x-posts.mjs");
  const renderer = createXPostsRenderer(await readXPostsArchive(repo));
  const lookup = renderer.pageIndex(30);
  assert.equal(lookup.ordered, true, "X IDs must follow the archive order for ID-based lookup");
  const { pageForPost } = helpers();
  const posts = renderer.posts();
  for (const index of [0, 29, 30, 31, posts.length - 1]) {
    assert.equal(pageForPost(lookup, "all", posts[index].id), index < 30 ? "updates.html" : `updates-page-${Math.floor(index / 30) + 1}.html`);
  }
});
