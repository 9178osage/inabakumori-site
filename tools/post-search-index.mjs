// Build-time index for search.html: one JSON chunk per publication year (Japan time),
// regenerated from data/x-posts and data/x-translations on every build, never hand-edited.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export const POST_SEARCH_DIRECTORY = "search-index";
export const POST_SEARCH_CHUNK_LIMIT = 600_000;
const CREATOR_INDEX = { inabakumori: 0, nknk: 1 };
const japanYear = value => new Date(Date.parse(value) + 9 * 3_600_000).toISOString().slice(0, 4);

export function buildPostSearchIndex(archive, translations = new Map()) {
  assert.equal(archive?.version, 1, "Unsupported X post archive");
  const byYear = new Map();
  const ids = new Set();
  for (const post of archive.items) {
    assert.ok(Object.hasOwn(CREATOR_INDEX, post.creator), "Unknown X creator in search index");
    assert.ok(/^\d{1,30}$/u.test(post.id) && !ids.has(post.id), "Invalid or duplicate X post in search index");
    ids.add(post.id);
    const published = new Date(post.publishedAt).toISOString();
    const gist = translations.get(post.id);
    const year = japanYear(published);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push([post.id, CREATOR_INDEX[post.creator], published, post.text, gist?.zh ?? "", gist?.en ?? ""]);
  }
  const files = new Map();
  const years = [];
  for (const year of [...byYear.keys()].sort().reverse()) {
    const records = byYear.get(year).sort((a, b) => (a[2] < b[2] ? 1 : a[2] > b[2] ? -1 : 0));
    const body = JSON.stringify({ version: 1, year, records });
    const bytes = Buffer.byteLength(body);
    assert.ok(bytes <= POST_SEARCH_CHUNK_LIMIT, `Search chunk ${year} exceeds ${POST_SEARCH_CHUNK_LIMIT} bytes`);
    const file = `posts-${year}-${createHash("sha256").update(body).digest("hex").slice(0, 12)}.json`;
    files.set(file, body);
    years.push({ year, count: records.length, file, bytes, gzipBytes: gzipSync(body).length });
  }
  const manifest = { version: 1, count: ids.size, translated: [...ids].filter(id => translations.has(id)).length, years };
  return { manifest, files, totalBytes: years.reduce((sum, entry) => sum + entry.bytes, 0), totalGzipBytes: years.reduce((sum, entry) => sum + entry.gzipBytes, 0) };
}
