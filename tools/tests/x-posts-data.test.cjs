const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const load = () => import("../x-posts-data.mjs");
const WHEN = "2026-07-04T04:02:15.000Z";
const COLLECTED = "2026-10-18T18:08:22.381Z";
function post(overrides = {}) {
  const id = "2073256048929148966";
  return { creator: "inabakumori", handle: "inabakumori", id, url: `https://x.com/inabakumori/status/${id}`,
    text: "原文\n100M views!", translated: false, publishedAt: WHEN, collectedAt: COLLECTED,
    hasVideo: false, links: [], media: [], relatedUrls: [], ...overrides };
}
const scan = (items = [post()], coverage = []) => ({ version: 1, coverage, items });
const empty = () => scan([]);
async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-posts-data-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("original post normalization keeps source text, resolves X-relative links and does not expand t.co", async () => {
  const { normalizeXPost } = await load();
  const input = post({ text: "原文\r\n<雨> & 100M views!", links: [{ label: "#雨", url: "/hashtag/雨?src=hashtag_click" }, { label: "動画", url: "https://t.co/AbC123" }],
    media: [{ alt: "図像", url: "https://pbs.twimg.com/media/HMWt6NBakAAyvWn?format=png&name=medium" }],
    relatedUrls: ["https://x.com/YouTubeJapan/status/2058851317976641965"], token: "must-not-export" });
  const result = normalizeXPost(input);
  assert.equal(result.text, "原文\n<雨> & 100M views!");
  assert.equal(result.links[0].url, "https://x.com/hashtag/%E9%9B%A8?src=hashtag_click");
  assert.equal(result.links[1].url, "https://t.co/AbC123");
  assert.deepEqual(result.relatedUrls, input.relatedUrls);
  assert.equal(result.translated, false);
  assert.ok(!Object.hasOwn(result, "token"));
});

test("import refuses translated, truncated, mismatched, unsafe and fabricated post metadata", async () => {
  const { normalizeXPost } = await load();
  for (const overrides of [
    { translated: true }, { translated: undefined }, { textTruncated: true },
    { creator: "someone" }, { handle: "NKNK_NGRMS" }, { id: 2073256048929148966 },
    { url: "https://x.com/other/status/2073256048929148966" },
    { url: "https://x.com/inabakumori/status/2073256048929148966?token=private" },
    { publishedAt: "2026-07-04T04:03:15.000Z" }, { collectedAt: "2026-01-01T00:00:00Z" },
    { collectedAt: "2026-02-30T00:00:00Z" }, { hasVideo: undefined },
    { links: [{ label: "bad", url: "javascript:alert(1)" }] },
    { links: [{ label: "bad", url: "https://name:password@example.com/" }] },
    { media: [{ url: "https://pbs.twimg.com.evil.example/media/photo?format=png" }] },
    { media: [{ url: "https://pbs.twimg.com/media/photo?format=svg" }] },
    { media: [{ url: "https://pbs.twimg.com/media/photo?format=png&token=secret" }] },
    { media: [{ url: "https://pbs.twimg.com/media/photo?format=png&format=jpg" }] },
    { relatedUrls: ["https://other.example/quoted"] }, { text: "\u0000" }
  ]) assert.throws(() => normalizeXPost(post(overrides)), String(Object.keys(overrides)));
});

test("empty coverage becomes honest partial coverage and duplicate IDs fail without writes", async t => {
  const { normalizeXPostsScan, importXPostsScan } = await load();
  const normalized = normalizeXPostsScan(scan());
  assert.deepEqual(normalized.coverage, [{ creator: "inabakumori", handle: "inabakumori", completeness: "partial", count: 1, oldestAt: WHEN, newestAt: WHEN, lastCollectedAt: COLLECTED }]);
  assert.throws(() => normalizeXPostsScan(scan([post(), post()])), /Duplicate X post ID/);
  assert.throws(() => normalizeXPostsScan(scan([post()], [{ creator: "inabakumori", completeness: "complete" }])), /cannot assert complete/);
  const root = await sandbox(t);
  await assert.rejects(importXPostsScan(root, scan([post({ translated: true })])));
  assert.deepEqual(await fs.readdir(root), []);
});

test("merge retains old original text on conflicts and adds observed attachments without deleting posts", async () => {
  const { mergeXPostsArchives } = await load();
  const conflict = mergeXPostsArchives(scan(), scan([post({ text: "different original" })]));
  assert.deepEqual(conflict.conflicts, [post().id]);
  assert.equal(conflict.archive.items[0].text, post().text);
  const enriched = mergeXPostsArchives(scan(), scan([post({ collectedAt: "2026-10-18T19:00:00Z", hasVideo: true, links: [{ label: "source", url: "https://t.co/More" }] })]));
  assert.equal(enriched.updated, 1);
  assert.equal(enriched.archive.items[0].hasVideo, true);
  assert.equal(enriched.archive.items[0].links.length, 1);
  assert.equal(mergeXPostsArchives(enriched.archive, enriched.archive).unchanged, 1);
  assert.equal(mergeXPostsArchives(enriched.archive, empty()).archive.items.length, 1);
});

test("read/write round trip verifies shards, removes superseded shards, and cannot import while locked", async t => {
  const { importXPostsScan, readXPostsArchive } = await load();
  const root = await sandbox(t);
  assert.deepEqual(await readXPostsArchive(root), empty());
  const result = await importXPostsScan(root, scan());
  assert.equal(result.added, 1);
  assert.deepEqual(await readXPostsArchive(root), result.archive);
  const firstShard = result.files.find(file => file.includes("posts-"));
  const second = await importXPostsScan(root, scan([post({ collectedAt: "2026-10-18T19:00:00Z" })]));
  assert.equal(second.updated, 1);
  await assert.rejects(fs.stat(path.join(root, firstShard)), { code: "ENOENT" });
  await fs.writeFile(path.join(root, "data/x-posts/.import-lock"), "");
  await assert.rejects(readXPostsArchive(root), /import is in progress/);
  await assert.rejects(importXPostsScan(root, scan()), { code: "EEXIST" });
});

test("whole-post shards stay under 120000 bytes and retain every original byte", async t => {
  const { importXPostsScan, readXPostsArchive, X_POSTS_SHARD_BYTES } = await load();
  const root = await sandbox(t);
  const source = [];
  for (let index = 0; index < 7; index++) {
    const id = (BigInt(post().id) + BigInt(index)).toString();
    source.push(post({ id, url: `https://x.com/inabakumori/status/${id}`, text: `投稿 ${index}\n${"雨".repeat(15_000)}\n` }));
  }
  const result = await importXPostsScan(root, scan(source));
  assert.ok(result.files.length > 2);
  for (const file of result.files) assert.ok((await fs.stat(path.join(root, file))).size <= X_POSTS_SHARD_BYTES);
  const read = await readXPostsArchive(root);
  assert.equal(read.items.length, source.length);
  for (const item of read.items) assert.equal(item.text, source.find(value => value.id === item.id).text);
  await assert.rejects(importXPostsScan(root, scan([post({ text: "雨".repeat(40_000) })])), /complete-post size/);
  assert.equal((await readXPostsArchive(root)).items.length, 7);
});

test("corrupt or redirected archive files are rejected while prior committed archive remains readable", async t => {
  const { importXPostsScan, readXPostsArchive } = await load();
  const root = await sandbox(t), victim = path.join(root, "keep.txt");
  await fs.writeFile(victim, "KEEP");
  await fs.mkdir(path.join(root, "data"));
  await fs.symlink(path.dirname(victim), path.join(root, "data/x-posts"));
  await assert.rejects(importXPostsScan(root, scan()), /symlink/);
  assert.equal(await fs.readFile(victim, "utf8"), "KEEP");
  await fs.unlink(path.join(root, "data/x-posts"));
  const result = await importXPostsScan(root, scan());
  const shard = result.files.find(file => file.includes("posts-"));
  const original = await fs.readFile(path.join(root, shard), "utf8");
  await fs.writeFile(path.join(root, shard), original.replace("100M", "200M"));
  await assert.rejects(readXPostsArchive(root), /hash mismatch/);
  await fs.writeFile(path.join(root, shard), original);
  assert.equal((await readXPostsArchive(root)).items.length, 1);
  await fs.unlink(path.join(root, shard));
  await fs.symlink(victim, path.join(root, shard));
  await assert.rejects(readXPostsArchive(root), /symlink/);
  assert.equal(await fs.readFile(victim, "utf8"), "KEEP");
});

test("coverage preserves observed scan intervals and recomputes counts instead of trusting profile totals", async () => {
  const { normalizeXPostsScan, mergeXPostsArchives } = await load();
  const coverage = [{ creator: "inabakumori", profilePostCount: 4045, scannedTabs: ["posts"], scannedRanges: [{ from: "2026-01-01T00:00:00Z", to: "2026-10-18T00:00:00Z", status: "interrupted" }], interruptedReason: "UI stopped loading" }];
  const result = normalizeXPostsScan(scan([post()], coverage));
  assert.equal(result.coverage[0].count, 1);
  assert.equal(result.coverage[0].profilePostCount, 4045);
  assert.equal(result.coverage[0].completeness, "partial");
  assert.equal(mergeXPostsArchives(result, scan()).archive.coverage[0].interruptedReason, "UI stopped loading");
});
