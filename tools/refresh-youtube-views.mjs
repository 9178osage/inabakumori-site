#!/usr/bin/env node
/**
 * Refresh YouTube viewCount + viewsCheckedAt in js/songs.js via Data API v3.
 *
 * Usage:
 *   YOUTUBE_API_KEY=... node tools/refresh-youtube-views.mjs
 *
 * Never put the API key in tracked files. On failure for a video, keeps the
 * previous viewCount (does not invent numbers).
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SONGS_PATH = path.join(ROOT, "js", "songs.js");
const BATCH_SIZE = 50;
const API_BASE = "https://www.googleapis.com/youtube/v3/videos";

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

async function fetchStatistics(ids) {
  const params = new URLSearchParams({
    part: "statistics",
    id: ids.join(","),
    key: apiKey
  });
  const res = await fetch(`${API_BASE}?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`YouTube API error: ${data.error.message || JSON.stringify(data.error)}`);
  }
  const map = new Map();
  for (const item of data.items || []) {
    const views = item?.statistics?.viewCount;
    if (views != null && /^\d+$/.test(String(views))) {
      map.set(item.id, Number(views));
    }
  }
  return map;
}

const source = await readFile(SONGS_PATH, "utf8");
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

await writeFile(SONGS_PATH, formatSongsFile(songs), "utf8");

console.log("\n--- summary ---");
console.log(`songs total:     ${songs.length}`);
console.log(`with video id:   ${withIds.length}`);
console.log(`updated:         ${updated}`);
console.log(`already current: ${unchanged}`);
console.log(`failed/skipped:  ${failed + missingId.length}`);
console.log(`viewsCheckedAt:  ${today}`);
console.log(`wrote:           ${SONGS_PATH}`);
