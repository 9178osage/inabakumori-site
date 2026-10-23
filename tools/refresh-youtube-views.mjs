#!/usr/bin/env node
/**
 * Refresh YouTube viewCount + viewsCheckedAt in js/songs.js via Data API v3.
 *
 * Usage:
 *   YOUTUBE_API_KEY=... node tools/refresh-youtube-views.mjs
 *
 * Scheduled: .github/workflows/refresh-youtube-views.yml (weekly cron +
 * workflow_dispatch) reads YOUTUBE_API_KEY from GitHub Actions secrets.
 *
 * Never put the API key in tracked files. On failure for a video, keeps the
 * previous viewCount (does not invent numbers).
 */
import { readFile, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertRepoPath } from "./safe-fs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SONGS_PATH = assertRepoPath(ROOT, "js/songs.js", { mustExist: true });
const BATCH_SIZE = 50;
const API_BASE = "https://www.googleapis.com/youtube/v3/videos";
const MAX_ERROR_BYTES = 16 * 1024;

// Exact Google-defined identifiers only. Messages, metadata, domains and URLs
// may contain private values and must never be copied into workflow logs.
// https://developers.google.com/youtube/data/reference/rest/v3/core_errors
// https://github.com/googleapis/googleapis/blob/master/google/api/error_reason.proto
const ERROR_HINTS = new Map([
  [["keyInvalid", "keyExpired", "API_KEY_INVALID"], "Check or replace the GitHub Actions YOUTUBE_API_KEY secret with a valid Google API key."],
  [["accessNotConfigured", "SERVICE_DISABLED"], "Check that YouTube Data API v3 is enabled and the Google Cloud project is active."],
  [["API_KEY_SERVICE_BLOCKED"], "Allow YouTube Data API v3 in the key's API restrictions."],
  [["API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED"], "Use application restrictions compatible with the GitHub Actions runner; keep the key limited to YouTube Data API v3."],
  [["quotaExceeded", "dailyLimitExceeded", "RESOURCE_QUOTA_EXCEEDED"], "Check the project's YouTube API quota; retry after the quota resets or request more quota."],
  [["rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"], "Wait before retrying and check the project's API rate limits."],
  [["badRequest", "invalidParameter", "invalidFilters", "incompatibleParameters", "invalidValue"], "Check the videos.list parameters and video IDs."],
  [["forbidden", "insufficientPermissions", "unauthorized", "authError"], "Check the Google Cloud project's API access and credential permissions."],
  [["backendError", "internalError"], "Retry later; Google reported a temporary API failure."]
].flatMap(([reasons, hint]) => reasons.map((reason) => [reason, hint])));
const ERROR_STATUSES = new Set([
  "INVALID_ARGUMENT", "FAILED_PRECONDITION", "PERMISSION_DENIED", "UNAUTHENTICATED",
  "RESOURCE_EXHAUSTED", "NOT_FOUND", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED"
]);

const apiKey = process.env.YOUTUBE_API_KEY?.trim();
if (!apiKey) {
  console.error("Missing YOUTUBE_API_KEY env var. Set it for this run only; do not commit it.");
  process.exit(1);
}

function extractVideoId(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id || null;
    }
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      const embedIdx = parts.indexOf("embed");
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1];
      const shortsIdx = parts.indexOf("shorts");
      if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1];
    }
  } catch {
    // fall through
  }
  const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function loadSongs(source) {
  // Evaluate only the SONGS array assignment in a sandbox-ish way
  const match = source.match(/const\s+SONGS\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!match) {
    throw new Error("Could not parse SONGS array from js/songs.js");
  }
  // JSON-compatible enough (double-quoted keys/strings)
  return JSON.parse(match[1]);
}

function formatSongsFile(songs) {
  return `const SONGS = ${JSON.stringify(songs, null, 2)};\n`;
}

function describeApiError(prefix, data) {
  const error = data?.error;
  const candidates = [
    ...(Array.isArray(error?.errors) ? error.errors.map((entry) => entry?.reason) : []),
    ...(Array.isArray(error?.details) ? error.details
      .filter((entry) => entry?.["@type"] === "type.googleapis.com/google.rpc.ErrorInfo")
      .map((entry) => entry?.reason) : [])
  ];
  const reasons = [...new Set(candidates.filter((reason) => ERROR_HINTS.has(reason)))].slice(0, 3);
  const identifiers = reasons.map((reason) => `reason=${reason}`);
  if (ERROR_STATUSES.has(error?.status)) identifiers.push(`status=${error.status}`);
  const hints = [...new Set(reasons.map((reason) => ERROR_HINTS.get(reason)))];
  return prefix + (identifiers.length ? `; ${identifiers.join("; ")}` : "") +
    (hints.length ? `. ${hints.join(" ")}` : "");
}

async function readErrorPayload(response, signal) {
  // Never call text()/json() on an unbounded error response. The original fetch
  // deadline covers headers and this read; the explicit abort race also bounds
  // streams whose read does not itself observe the signal.
  if (!response.body?.getReader) return null;
  const reader = response.body.getReader();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new Error("YouTube API request timed out"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const chunks = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ERROR_BYTES) return null;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.cancel().catch(() => {});
  }
}

async function fetchStatistics(ids) {
  const params = new URLSearchParams({
    part: "statistics",
    id: ids.join(",")
  });
  // Send the key as a header so it never appears in request URLs or access logs.
  // Native fetch keeps this signal attached while the response body is read too.
  const signal = AbortSignal.timeout(15_000);
  let res, data;
  try {
    res = await fetch(`${API_BASE}?${params}`, { headers: { "X-Goog-Api-Key": apiKey }, signal });
  } catch {
    throw new Error(signal.aborted ? "YouTube API request timed out" : "YouTube API request failed");
  }
  if (!res.ok) {
    const errorData = await readErrorPayload(res, signal);
    if (signal.aborted) throw new Error("YouTube API request timed out");
    throw new Error(describeApiError(`YouTube API HTTP ${res.status}`, errorData));
  }
  try { data = await res.json(); }
  catch { throw new Error(signal.aborted ? "YouTube API request timed out" : "YouTube API returned invalid JSON"); }
  if (data?.error) throw new Error(describeApiError("YouTube API reported an error", data));
  if (!Array.isArray(data?.items)) throw new Error("YouTube API returned invalid statistics");
  const map = new Map();
  for (const item of data.items || []) {
    const views = item?.statistics?.viewCount;
    const count = Number(views);
    if (views != null && /^\d+$/.test(String(views)) && Number.isSafeInteger(count) && count >= 0) {
      map.set(item.id, count);
    }
  }
  return map;
}

const source = await readFile(assertRepoPath(ROOT, SONGS_PATH, { mustExist: true }), "utf8");
const songs = loadSongs(source);
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const entries = songs.map((song, index) => ({
  index,
  title: song.title,
  videoId: extractVideoId(song.youtube),
  prev: song.viewCount
}));

const missingId = entries.filter((e) => !e.videoId);
if (missingId.length) {
  console.warn(`⚠️  ${missingId.length} song(s) missing parseable video ID — left unchanged:`);
  for (const e of missingId) console.warn(`   - ${e.title}`);
}

const withIds = entries.filter((e) => e.videoId);
const idToIndices = new Map();
for (const e of withIds) {
  if (!idToIndices.has(e.videoId)) idToIndices.set(e.videoId, []);
  idToIndices.get(e.videoId).push(e.index);
}
const uniqueIds = [...idToIndices.keys()];

let updated = 0;
let unchanged = 0;
let failed = 0;
const statsById = new Map();

for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
  const batch = uniqueIds.slice(i, i + BATCH_SIZE);
  try {
    const map = await fetchStatistics(batch);
    for (const id of batch) {
      if (map.has(id)) {
        statsById.set(id, map.get(id));
      } else {
        console.warn(`⚠️  No statistics returned for ${id} — keeping previous viewCount`);
        failed += idToIndices.get(id).length;
      }
    }
  } catch (err) {
    console.error(`❌ Batch failed (${batch.length} ids): ${err.message}`);
    failed += batch.reduce((n, id) => n + idToIndices.get(id).length, 0);
    // Do not invent numbers — leave those songs alone
  }
}

for (const e of withIds) {
  if (!statsById.has(e.videoId)) continue;
  const next = statsById.get(e.videoId);
  const song = songs[e.index];
  if (song.viewCount === next && song.viewsCheckedAt === today) {
    unchanged += 1;
  } else {
    song.viewCount = next;
    song.viewsCheckedAt = today;
    updated += 1;
    const delta = typeof e.prev === "number" ? next - e.prev : null;
    const deltaStr = delta == null ? "" : ` (${delta >= 0 ? "+" : ""}${delta})`;
    console.log(`✅ ${song.title}: ${e.prev} → ${next}${deltaStr}`);
  }
}

// Every request failing (revoked key, quota, outage) must fail the job instead of silently going stale.
if (withIds.length && statsById.size === 0) {
  console.error(`❌ No view counts were returned for any of ${withIds.length} songs; js/songs.js left unchanged.`);
  process.exit(1);
}

// Write a sibling temp file, fsync, then rename: an interrupted run never leaves a half-written songs.js.
{
  const destination = assertRepoPath(ROOT, SONGS_PATH, { mustExist: true });
  const temporary = assertRepoPath(ROOT, path.join(path.dirname(SONGS_PATH), `.songs-${randomUUID()}.tmp`));
  let file;
  try {
    file = await open(temporary, "wx", 0o644);
    await file.writeFile(formatSongsFile(songs), "utf8");
    await file.sync();
    await file.close();
    file = null;
    assertRepoPath(ROOT, SONGS_PATH, { mustExist: true });
    await rename(temporary, destination);
  } finally {
    await file?.close().catch(() => {});
    await rm(temporary, { force: true });
  }
}

console.log("\n--- summary ---");
console.log(`songs total:     ${songs.length}`);
console.log(`with video id:   ${withIds.length}`);
console.log(`updated:         ${updated}`);
console.log(`already current: ${unchanged}`);
console.log(`failed/skipped:  ${failed + missingId.length}`);
console.log(`viewsCheckedAt:  ${today}`);
console.log(`wrote:           ${SONGS_PATH}`);
