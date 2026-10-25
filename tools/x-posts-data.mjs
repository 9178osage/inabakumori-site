import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, lstat } from "node:fs/promises";
import { assertRepoPath } from "./safe-fs.mjs";

export const X_POSTS_SHARD_BYTES = 120_000;
const MAX_ITEMS = 100_000;
const MAX_POST_BYTES = 100_000;
const HANDLES = { inabakumori: "inabakumori", nknk: "NKNK_NGRMS" };
const DIRECTORY = "data/x-posts";
const MANIFEST = `${DIRECTORY}/manifest.json`;
const LOCK = `${DIRECTORY}/.import-lock`;
const SHARD_NAME = /^posts-([a-f0-9]{64})\.json$/u;
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;
const digest = value => createHash("sha256").update(value).digest("hex");
const own = (object, key) => Object.hasOwn(object, key);

function record(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `Invalid ${label}`);
  return value;
}

function string(value, label, maximum, { empty = false } = {}) {
  assert.ok(typeof value === "string" && (empty || value.trim()) && value.length <= maximum, `Invalid ${label}`);
  assert.doesNotMatch(value, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u, `Invalid control character in ${label}`);
  return value.replace(/\r\n?/gu, "\n");
}

function timestamp(value, label) {
  assert.ok(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value), `Invalid ${label}`);
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/u, (_, fraction = "") => `.${fraction.padEnd(3, "0")}Z`);
  assert.ok(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === canonical, `Invalid ${label}`);
  return canonical;
}

function creator(value, handle) {
  assert.ok(own(HANDLES, value), "Unknown X creator");
  assert.ok(handle === undefined || handle === HANDLES[value], "X creator/handle mismatch");
  return value;
}

function array(value, label, maximum) {
  assert.ok(Array.isArray(value) && value.length <= maximum, `Invalid ${label}`);
  return value;
}

function publicUrl(value, label, { relative = false } = {}) {
  string(value, label, 4096);
  let url;
  try { url = relative ? new URL(value, "https://x.com") : new URL(value); }
  catch { throw new Error(`Invalid ${label}`); }
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.port, `Invalid ${label}`);
  return url;
}

function relatedUrl(value) {
  const url = publicUrl(value, "quoted post URL");
  assert.ok(url.hostname === "x.com" && /^\/[A-Za-z0-9_]{1,15}\/status\/[1-9]\d{0,19}$/u.test(url.pathname) && !url.search && !url.hash, "Invalid quoted post URL");
  return url.href;
}

function mediaItem(value) {
  record(value, "post image");
  const url = publicUrl(value.url, "post image URL");
  assert.ok(url.hostname === "pbs.twimg.com" && /^\/media\/[A-Za-z0-9_-]+(?:\.(?:jpe?g|png|webp))?$/u.test(url.pathname) && !url.hash, "Invalid post image host/path");
  for (const key of url.searchParams.keys()) assert.ok(["format", "name"].includes(key), "Invalid post image parameter");
  assert.ok(!url.searchParams.has("format") || /^(?:jpg|jpeg|png|webp)$/u.test(url.searchParams.get("format")), "Invalid post image format");
  assert.ok(!url.searchParams.has("name") || /^(?:thumb|small|medium|large|orig|\d{1,4}x\d{1,4})$/u.test(url.searchParams.get("name")), "Invalid post image size");
  assert.equal([...url.searchParams.keys()].length, new Set(url.searchParams.keys()).size, "Duplicate post image parameter");
  return { alt: string(value.alt ?? "", "post image description", 4000, { empty: true }), url: url.href };
}

export function normalizeXPost(input) {
  const item = record(input, "X post");
  const identity = creator(item.creator, item.handle);
  assert.ok(typeof item.id === "string" && /^[1-9]\d{0,19}$/u.test(item.id) && BigInt(item.id) < 2n ** 64n, "Invalid X post ID");
  const label = `X post ${item.id}`;
  assert.equal(item.url, `https://x.com/${HANDLES[identity]}/status/${item.id}`, `${label} author/URL mismatch`);
  assert.equal(item.translated, false, `${label} must explicitly contain untranslated original text`);
  assert.ok(item.textTruncated === undefined || item.textTruncated === false, `${label} text is truncated; expand the original post first`);
  const publishedAt = timestamp(item.publishedAt, `${label} publication time`);
  const collectedAt = timestamp(item.collectedAt, `${label} collection time`);
  const snowflakeTime = Number((BigInt(item.id) >> 22n) + 1_288_834_974_657n);
  assert.equal(Math.floor(Date.parse(publishedAt) / 1000), Math.floor(snowflakeTime / 1000), `${label} ID/publication time mismatch`);
  assert.ok(Date.parse(collectedAt) >= Date.parse(publishedAt), `${label} was collected before publication`);
  assert.equal(typeof item.hasVideo, "boolean", `${label} needs a video flag`);
  const text = string(item.text, `${label} original text`, MAX_POST_BYTES, { empty: true });
  const links = array(item.links ?? [], `${label} links`, 100).map(link => {
    record(link, `${label} link`);
    const url = publicUrl(link.url, `${label} link URL`, { relative: true });
    return { label: string(link.label, `${label} link label`, 2000, { empty: true }), url: url.href };
  });
  const media = array(item.media ?? [], `${label} images`, 16).map(mediaItem);
  const relatedUrls = array(item.relatedUrls ?? [], `${label} quoted posts`, 20).map(relatedUrl);
  const unique = (values, key) => [...new Map(values.map(value => [key(value), value])).values()];
  const result = {
    creator: identity, handle: HANDLES[identity], id: item.id, url: item.url,
    text, translated: false, publishedAt, collectedAt, hasVideo: item.hasVideo,
    links: unique(links, link => `${link.url}\0${link.label}`),
    media: unique(media, image => image.url), relatedUrls: [...new Set(relatedUrls)]
  };
  assert.ok(text.trim() || media.length || item.hasVideo || relatedUrls.length, `${label} has no readable content`);
  assert.ok(Buffer.byteLength(serialize(result)) <= MAX_POST_BYTES, `${label} exceeds the complete-post size limit`);
  return result;
}

function coverageMetadata(input) {
  const seen = new Set();
  return array(input ?? [], "X coverage", 2).map(value => {
    record(value, "X coverage entry");
    const identity = creator(value.creator, value.handle);
    assert.ok(!seen.has(identity), "Duplicate X creator coverage");
    seen.add(identity);
    assert.ok(value.completeness === undefined || value.completeness === "partial", "Offline import cannot assert complete X history");
    const result = { creator: identity, handle: HANDLES[identity], completeness: "partial" };
    if (value.note !== undefined) result.note = string(value.note, "X coverage note", 2000, { empty: true });
    if (value.interruptedReason !== undefined) result.interruptedReason = string(value.interruptedReason, "X scan interruption reason", 2000, { empty: true });
    if (value.profilePostCount !== undefined) {
      assert.ok(Number.isSafeInteger(value.profilePostCount) && value.profilePostCount >= 0, "Invalid X profile post count");
      result.profilePostCount = value.profilePostCount;
    }
    if (value.scannedTabs !== undefined) {
      result.scannedTabs = [...new Set(array(value.scannedTabs, "X scanned tabs", 3))];
      assert.ok(result.scannedTabs.every(tab => ["posts", "replies", "reposts"].includes(tab)), "Invalid X scanned tab");
    }
    if (value.scannedRanges !== undefined) result.scannedRanges = array(value.scannedRanges, "X scanned ranges", 1000).map(range => {
      record(range, "X scanned range");
      const from = timestamp(range.from, "X scan range start"), to = timestamp(range.to, "X scan range end");
      assert.ok(from < to && ["scanned", "interrupted"].includes(range.status), "Invalid X scanned range");
      return { from, to, status: range.status };
    });
    return result;
  });
}

function summarizeCoverage(items, metadata) {
  const entries = new Map(metadata.map(entry => [entry.creator, entry]));
  for (const item of items) if (!entries.has(item.creator)) entries.set(item.creator, { creator: item.creator, handle: item.handle, completeness: "partial" });
  return [...entries.values()].sort((a, b) => a.creator.localeCompare(b.creator)).map(entry => {
    const posts = items.filter(item => item.creator === entry.creator);
    return { ...entry, completeness: "partial", count: posts.length,
      oldestAt: posts.length ? posts.at(-1).publishedAt : null,
      newestAt: posts.length ? posts[0].publishedAt : null,
      lastCollectedAt: posts.length ? posts.map(item => item.collectedAt).sort().at(-1) : null };
  });
}

export function normalizeXPostsScan(input) {
  record(input, "X posts scan");
  assert.equal(input.version, 1, "Unsupported X posts scan version");
  const seen = new Set();
  const items = array(input.items, "X posts", MAX_ITEMS).map(normalizeXPost);
  for (const item of items) {
    assert.ok(!seen.has(item.id), `Duplicate X post ID ${item.id}`);
    seen.add(item.id);
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || (BigInt(a.id) < BigInt(b.id) ? 1 : -1));
  return { version: 1, coverage: summarizeCoverage(items, coverageMetadata(input.coverage)), items };
}

export function mergeXPostsArchives(previous, input) {
  const before = normalizeXPostsScan(previous), scan = normalizeXPostsScan(input);
  const posts = new Map(before.items.map(item => [item.id, item]));
  let added = 0, updated = 0, unchanged = 0;
  const conflicts = [];
  for (const item of scan.items) {
    const existing = posts.get(item.id);
    if (!existing) { posts.set(item.id, item); added++; continue; }
    if (existing.creator !== item.creator || existing.text !== item.text || existing.publishedAt !== item.publishedAt) {
      conflicts.push(item.id); continue;
    }
    const mergeUnique = (a, b, key) => [...new Map([...a, ...b].map(value => [key(value), value])).values()];
    const merged = { ...existing, collectedAt: existing.collectedAt < item.collectedAt ? item.collectedAt : existing.collectedAt,
      hasVideo: existing.hasVideo || item.hasVideo,
      links: mergeUnique(existing.links, item.links, value => `${value.url}\0${value.label}`),
      media: mergeUnique(existing.media, item.media, value => value.url),
      relatedUrls: [...new Set([...existing.relatedUrls, ...item.relatedUrls])] };
    if (JSON.stringify(merged) === JSON.stringify(existing)) unchanged++; else updated++;
    posts.set(item.id, merged);
  }
  const metadata = new Map(before.coverage.map(value => [value.creator, value]));
  for (const value of scan.coverage) {
    const old = metadata.get(value.creator) ?? {};
    const combined = { ...old, ...value };
    if (old.scannedTabs || value.scannedTabs) combined.scannedTabs = [...new Set([...(old.scannedTabs ?? []), ...(value.scannedTabs ?? [])])];
    if (old.scannedRanges || value.scannedRanges) combined.scannedRanges = [...new Map([...(old.scannedRanges ?? []), ...(value.scannedRanges ?? [])].map(range => [JSON.stringify(range), range])).values()];
    metadata.set(value.creator, combined);
  }
  return { archive: normalizeXPostsScan({ version: 1, coverage: [...metadata.values()], items: [...posts.values()] }), added, updated, unchanged, conflicts };
}

async function readRegular(root, file, maximum) {
  const target = assertRepoPath(root, file, { mustExist: true });
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await handle.stat();
    assert.ok(info.isFile() && info.size <= maximum, "Invalid or oversized X archive file");
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}

async function readArchive(root) {
  let raw;
  try { raw = await readRegular(root, MANIFEST, X_POSTS_SHARD_BYTES); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    let names = [];
    try { names = await readdir(assertRepoPath(root, DIRECTORY, { mustExist: true })); }
    catch (directoryError) { if (directoryError.code !== "ENOENT") throw directoryError; }
    // Missing metadata must never turn retained post bodies into an empty
    // archive, which an import would then replace and clean up permanently.
    assert.ok(!names.some(name => SHARD_NAME.test(name)), "X archive manifest is missing while post shards remain");
    return { version: 1, coverage: [], items: [] };
  }
  const manifest = record(JSON.parse(raw), "X archive manifest");
  assert.equal(manifest.version, 1, "Unsupported X archive version");
  assert.ok(Number.isSafeInteger(manifest.count) && manifest.count >= 0, "Invalid X archive count");
  const names = new Set(), items = [];
  for (const shard of array(manifest.shards, "X archive shards", 2000)) {
    record(shard, "X archive shard");
    const match = typeof shard.file === "string" && shard.file.match(SHARD_NAME);
    assert.ok(match && match[1] === shard.sha256 && !names.has(shard.file), "Invalid or duplicate X archive shard path/hash");
    names.add(shard.file);
    const source = await readRegular(root, `${DIRECTORY}/${shard.file}`, X_POSTS_SHARD_BYTES);
    assert.equal(digest(source), shard.sha256, "X archive shard hash mismatch");
    const data = record(JSON.parse(source), "X archive shard");
    assert.equal(data.version, 1, "Unsupported X archive shard version");
    assert.ok(Array.isArray(data.items) && data.items.length === shard.count && shard.count > 0, "X archive shard count mismatch");
    items.push(...data.items);
  }
  assert.equal(items.length, manifest.count, "X archive manifest count mismatch");
  const result = normalizeXPostsScan({ version: 1, coverage: manifest.coverage, items });
  assert.deepEqual(result.coverage, manifest.coverage, "X archive coverage summary mismatch");
  return result;
}

export async function readXPostsArchive(root) {
  try {
    assertRepoPath(root, LOCK, { mustExist: true });
    throw new Error("X archive import is in progress");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return readArchive(root);
}

function packArchive(archive) {
  const files = new Map(), shards = [];
  let batch = [];
  const finish = () => {
    if (!batch.length) return;
    const source = serialize({ version: 1, items: batch });
    assert.ok(Buffer.byteLength(source) <= X_POSTS_SHARD_BYTES, "X archive shard exceeds size limit");
    const sha256 = digest(source), file = `posts-${sha256}.json`;
    files.set(file, source); shards.push({ file, count: batch.length, sha256 }); batch = [];
  };
  for (const item of archive.items) {
    if (batch.length && Buffer.byteLength(serialize({ version: 1, items: [...batch, item] })) > X_POSTS_SHARD_BYTES) finish();
    batch.push(item);
  }
  finish();
  const manifest = serialize({ version: 1, count: archive.items.length, coverage: archive.coverage, shards });
  assert.ok(Buffer.byteLength(manifest) <= X_POSTS_SHARD_BYTES, "X archive manifest exceeds size limit");
  files.set("manifest.json", manifest);
  return files;
}

async function atomicWrite(root, relative, source) {
  const destination = assertRepoPath(root, relative);
  const temporary = assertRepoPath(root, `${DIRECTORY}/.write-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o644);
    await handle.writeFile(source, "utf8"); await handle.sync(); await handle.close(); handle = null;
    assertRepoPath(root, relative);
    await rename(temporary, destination);
  } finally { await handle?.close().catch(() => {}); await rm(temporary, { force: true }); }
}

export async function importXPostsScan(root, input) {
  const scan = normalizeXPostsScan(input); // Validate all input before creating output paths.
  const directory = assertRepoPath(root, DIRECTORY);
  await mkdir(directory, { recursive: true });
  const lockPath = assertRepoPath(root, LOCK);
  const lock = await open(lockPath, "wx", 0o600);
  const created = [];
  let committed = false;
  try {
    const previous = await readArchive(root), result = mergeXPostsArchives(previous, scan);
    const files = packArchive(result.archive);
    for (const [file, source] of files) {
      if (file === "manifest.json") continue;
      const relative = `${DIRECTORY}/${file}`;
      try { assert.equal(await readRegular(root, relative, X_POSTS_SHARD_BYTES), source, "Existing X shard differs from its hash"); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        await atomicWrite(root, relative, source); created.push(relative);
      }
    }
    await atomicWrite(root, MANIFEST, files.get("manifest.json")); committed = true;
    // Readers refuse the import lock, so no reader can observe cleanup halfway through.
    for (const name of await readdir(directory)) if (SHARD_NAME.test(name) && !files.has(name)) {
      const target = assertRepoPath(root, `${DIRECTORY}/${name}`, { mustExist: true });
      assert.ok((await lstat(target)).isFile(), "Refusing non-regular stale X shard");
      await rm(target);
    }
    return { ...result, files: [...files.keys()].map(file => `${DIRECTORY}/${file}`) };
  } finally {
    if (!committed) for (const relative of created) await rm(assertRepoPath(root, relative), { force: true });
    await lock.close(); await rm(assertRepoPath(root, LOCK), { force: true });
  }
}
