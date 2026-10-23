#!/usr/bin/env node
// Public creator metadata only. A failed source keeps its last successful snapshot.
import { readFile, mkdir, open, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertRepoPath } from "./safe-fs.mjs";
import { FORBIDDEN_TITLE_CHARACTERS } from "./text-guards.mjs";

const CHANNEL_ID = "UCNElM45JypxqAR73RoUQ10g";
const PIXIV_USER_ID = "27327959";
const SOURCES = Object.freeze([
  Object.freeze({ id: "youtube", creator: "inabakumori", label: "YouTube", url: "https://www.youtube.com/@inabakumori" }),
  Object.freeze({ id: "pixiv", creator: "nknk", label: "pixiv", url: `https://www.pixiv.net/users/${PIXIV_USER_ID}` }),
  Object.freeze({ id: "campfire", creator: "nknk", label: "CAMPFIRE Creation", url: "https://camp-fire.jp/projects/970332/view/activities" })
]);
const ITEM_LIMIT = 12;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC_ERROR = "Official source could not be checked. Previous entries are retained.";

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid publication timestamp");
  }
  if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("Invalid calendar date");
  return new Date(value).toISOString();
}
function titleText(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new Error("Invalid work title");
  // Titles come from XML entities, CDATA or JSON; reject exactly what the build renderer rejects
  // (C0/C1 controls incl. CR, bidi overrides), so a bad title fails only its source here.
  if (FORBIDDEN_TITLE_CHARACTERS.test(value)) throw new Error("Invalid work title");
  return value.trim();
}
function decodeXml(value) {
  const text = value.trim();
  if (text.startsWith("<![CDATA[") && text.endsWith("]]>")) return text.slice(9, -3);
  if (text.includes("<")) throw new Error("Unexpected nested XML field");
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&([^;\s]+);/gu, (_match, entity) => {
    if (Object.hasOwn(entities, entity)) return entities[entity];
    const numeric = /^#(?:x[\da-f]+|\d+)$/iu.test(entity);
    const point = numeric ? entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)) : NaN;
    if (!Number.isInteger(point) || point < 1 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error("Invalid XML entity");
    return String.fromCodePoint(point);
  });
}
function xmlField(block, name) {
  const matches = [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "gu"))];
  if (matches.length !== 1) throw new Error("Missing or duplicate feed field");
  return decodeXml(matches[0][1]);
}

export function parseYouTubeFeed(xml) {
  if (typeof xml !== "string" || !/<feed\b/u.test(xml) || !/<\/feed>\s*$/u.test(xml) || /<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new Error("Invalid YouTube feed");
  const blocks = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gu)].map(match => match[1]);
  if (!blocks.length || blocks.length !== (xml.match(/<entry(?:\s|>)/gu) || []).length) throw new Error("Empty or incomplete YouTube feed");
  const header = xml.slice(0, xml.indexOf("<entry"));
  // The feed header also uses the channel ID without its UC prefix; entry authors
  // still need to match the full, fixed channel ID below.
  const feedChannel = xmlField(header, "yt:channelId");
  if (feedChannel !== CHANNEL_ID && feedChannel !== CHANNEL_ID.slice(2)) throw new Error("Unexpected YouTube channel");
  return blocks.map(block => {
    if (xmlField(block, "yt:channelId") !== CHANNEL_ID) throw new Error("Unexpected video author");
    const video = xmlField(block, "yt:videoId");
    if (!/^[A-Za-z0-9_-]{11}$/u.test(video)) throw new Error("Invalid YouTube video id");
    return { id: `youtube:${video}`, creator: "inabakumori", source: "youtube", title: titleText(xmlField(block, "title")), publishedAt: timestamp(xmlField(block, "published")), url: `https://www.youtube.com/watch?v=${video}` };
  });
}

export function parsePixivProfile(data) {
  if (!data || data.error !== false || !data.body || typeof data.body !== "object") throw new Error("Invalid pixiv profile");
  const ids = [];
  for (const category of ["illusts", "manga"]) {
    const works = data.body[category];
    if (!works || typeof works !== "object" || (Array.isArray(works) && works.length)) throw new Error("Invalid pixiv work list");
    for (const id of Object.keys(works)) {
      if (!/^[1-9]\d{0,14}$/u.test(id)) throw new Error("Invalid pixiv work id");
      ids.push(id);
    }
  }
  if (!ids.length) throw new Error("Empty pixiv profile");
  return [...new Set(ids)].sort((a, b) => Number(b) - Number(a)).slice(0, ITEM_LIMIT);
}

export function parsePixivWork(data, expectedId) {
  const work = data?.body;
  if (data?.error !== false || !work || String(work.userId) !== PIXIV_USER_ID || String(work.id) !== expectedId) throw new Error("Unexpected pixiv work or author");
  if (work.xRestrict !== undefined && work.xRestrict !== 0) throw new Error("Restricted pixiv work is not a public update");
  return { id: `pixiv:${expectedId}`, creator: "nknk", source: "pixiv", title: titleText(work.title), publishedAt: timestamp(work.createDate), url: `https://www.pixiv.net/artworks/${expectedId}` };
}

// Extract only the JSON assignment; never evaluate a platform script.
function parseEmbeddedJson(html, variable) {
  if (typeof html !== "string" || !["ytInitialData", "ytInitialPlayerResponse"].includes(variable)) throw new Error("Invalid embedded data");
  const startPattern = new RegExp(`(?:var\\s+)?${variable}\\s*=\\s*`, "gu");
  const match = startPattern.exec(html);
  if (!match || html[startPattern.lastIndex] !== "{") throw new Error("Missing official video metadata");
  const start = startPattern.lastIndex;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const character = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '\"') quoted = false;
    } else if (character === '\"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error("Incomplete official video metadata");
}
function visitObjects(value, callback) {
  if (!value || typeof value !== "object") return;
  callback(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(item => visitObjects(item, callback));
    else if (child && typeof child === "object") visitObjects(child, callback);
  }
}
export function parseYouTubeChannelPage(html) {
  const data = parseEmbeddedJson(html, "ytInitialData");
  if (data.metadata?.channelMetadataRenderer?.externalId !== CHANNEL_ID) throw new Error("Unexpected YouTube channel page");
  const ids = [];
  visitObjects(data.contents, value => {
    const video = value.videoRenderer;
    const lockup = value.lockupViewModel;
    if (lockup?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
      if (!/^[A-Za-z0-9_-]{11}$/u.test(lockup.contentId)) throw new Error("Invalid channel video id");
      ids.push(lockup.contentId);
    }
    if (!video) return;
    if (!/^[A-Za-z0-9_-]{11}$/u.test(video.videoId)) throw new Error("Invalid channel video id");
    ids.push(video.videoId);
  });
  if (!ids.length) throw new Error("Empty official channel video list");
  return [...new Set(ids)].slice(0, ITEM_LIMIT);
}
export function parseYouTubeWatchPage(html, expectedId) {
  const data = parseEmbeddedJson(html, "ytInitialPlayerResponse");
  const details = data.videoDetails;
  const microformat = data.microformat?.playerMicroformatRenderer;
  if (details?.channelId !== CHANNEL_ID || details.videoId !== expectedId || !microformat) throw new Error("Unexpected video metadata or author");
  const rawDate = microformat.publishDate || microformat.uploadDate;
  const dayOnly = typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(rawDate);
  return { id: `youtube:${expectedId}`, creator: "inabakumori", source: "youtube", title: titleText(details.title), publishedAt: timestamp(dayOnly ? `${rawDate}T00:00:00Z` : rawDate), url: `https://www.youtube.com/watch?v=${expectedId}`, ...(dayOnly ? { datePrecision: "day" } : {}) };
}

export function parseCampfireActivities(html) {
  if (typeof html !== "string") throw new Error("Invalid project activity page");
  const entries = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/giu)].map(match => match[1]);
  const items = [];
  for (const entry of entries) {
    const title = /<a\b[^>]*href=["'](?:https:\/\/camp-fire\.jp\/projects\/970332\/view\/)?activities\/([1-9]\d*)(?:#main)?["'][^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/iu.exec(entry);
    if (!title) continue;
    const date = /<div\b[^>]*class=["'][^"']*\btime\b[^"']*["'][^>]*>\s*(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s*<\/div>/iu.exec(entry);
    if (!date) throw new Error("Missing project publication date");
    const id = title[1];
    items.push({ id: `campfire:${id}`, creator: "nknk", source: "campfire", title: titleText(decodeXml(title[2])), publishedAt: timestamp(`${date[1]}-${date[2]}-${date[3]}T${date[4]}:${date[5]}:00+09:00`), url: `https://camp-fire.jp/projects/970332/view/activities/${id}` });
  }
  if (!items.length) throw new Error("Empty or unrecognized project activity page");
  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 5);
}

function canonicalItem(item) {
  const source = SOURCES.find(candidate => candidate.id === item?.source);
  if (!source || item.creator !== source.creator || typeof item.id !== "string") throw new Error("Invalid update source");
  const id = item.id.slice(source.id.length + 1);
  if (item.id !== `${source.id}:${id}` || !(source.id === "youtube" ? /^[A-Za-z0-9_-]{11}$/u : /^[1-9]\d{0,14}$/u).test(id)) throw new Error("Invalid update id");
  const url = source.id === "youtube" ? `https://www.youtube.com/watch?v=${id}` : source.id === "pixiv" ? `https://www.pixiv.net/artworks/${id}` : `https://camp-fire.jp/projects/970332/view/activities/${id}`;
  if (item.url !== url) throw new Error("Unexpected update URL");
  return { id: item.id, creator: source.creator, source: source.id, title: titleText(item.title), publishedAt: timestamp(item.publishedAt), url, ...(item.datePrecision === "day" ? { datePrecision: "day" } : {}) };
}
export function normalizeUpdates(data) {
  if (data?.version !== 1 || !Array.isArray(data.sources) || !Array.isArray(data.items)) throw new Error("Invalid update snapshot");
  const items = new Map();
  for (const item of data.items) {
    const valid = canonicalItem(item);
    items.set(valid.id, valid);
  }
  const sorted = [...items.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  const counters = new Map();
  return {
    version: 1,
    sources: SOURCES.map(source => {
      const previous = data.sources.find(entry => entry.id === source.id);
      const checkedAt = previous?.checkedAt ? timestamp(previous.checkedAt) : null;
      const lastAttemptAt = previous?.lastAttemptAt ? timestamp(previous.lastAttemptAt) : null;
      const status = checkedAt && previous?.status === "ok" ? "ok" : "error";
      return { ...source, checkedAt, lastAttemptAt, status, ...(status === "error" ? { message: PUBLIC_ERROR } : {}) };
    }),
    items: sorted.filter(item => {
      const count = (counters.get(item.source) || 0) + 1;
      counters.set(item.source, count);
      return count <= (item.source === "campfire" ? 5 : ITEM_LIMIT);
    })
  };
}

async function responseText(response) {
  const length = response.headers?.get?.("content-length");
  if (length && Number(length) > MAX_BODY_BYTES) throw new Error("Official response exceeds limit");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error("Official response exceeds limit");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error("Official response exceeds limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => {}); }
}
async function request(url, { fetchImpl, sleep }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), redirect: "error", headers: { "User-Agent": "inabakumori-site-updates/1.0 (+https://osagechan.top/)", Accept: url.includes("/feeds/") ? "application/atom+xml" : url.includes("pixiv.net") ? "application/json" : "text/html", ...(url.includes("pixiv.net") ? { Referer: "https://www.pixiv.net/" } : {}) } });
    } catch {
      if (attempt === 0) { await sleep(750); continue; }
      throw new Error("Official source request failed");
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      if (attempt === 0 && response.status >= 500) { await sleep(750); continue; }
      throw new Error(`Official source HTTP ${response.status}`);
    }
    return responseText(response);
  }
  throw new Error("Official source request failed");
}

export async function refreshCreatorUpdates(previous, { fetchImpl = fetch, now = new Date().toISOString(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const attemptedAt = timestamp(now);
  const data = normalizeUpdates(previous || { version: 1, sources: [], items: [] });
  const errors = [];
  const options = { fetchImpl, sleep };
  for (const source of data.sources) {
    source.lastAttemptAt = attemptedAt;
    try {
      let items;
      if (source.id === "youtube") {
        try {
          items = parseYouTubeFeed(await request(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`, options));
        } catch {
          const ids = parseYouTubeChannelPage(await request("https://www.youtube.com/@inabakumori/videos", options));
          items = [];
          for (const id of ids) items.push(parseYouTubeWatchPage(await request(`https://www.youtube.com/watch?v=${id}`, options), id));
        }
      } else if (source.id === "pixiv") {
        const ids = parsePixivProfile(JSON.parse(await request(`https://www.pixiv.net/ajax/user/${PIXIV_USER_ID}/profile/all`, options)));
        items = [];
        for (const id of ids) items.push(parsePixivWork(JSON.parse(await request(`https://www.pixiv.net/ajax/illust/${id}`, options)), id));
      } else {
        items = parseCampfireActivities(await request(source.url, options));
      }
      // Keep the previous recent works too: feed windows may temporarily omit a video.
      data.items = [...data.items, ...items];
      source.checkedAt = attemptedAt;
      source.status = "ok";
      delete source.message;
    } catch (error) {
      source.status = "error";
      source.message = PUBLIC_ERROR;
      errors.push({ source: source.id, message: error instanceof SyntaxError ? "Official source returned invalid JSON" : error.message });
    }
  }
  return { data: normalizeUpdates(data), errors };
}

export async function writeUpdatesSnapshot(root, data, { renameImpl = rename } = {}) {
  const directory = assertRepoPath(root, "data");
  const destination = assertRepoPath(root, "data/creator-updates.json");
  await mkdir(directory, { recursive: true });
  const temporary = assertRepoPath(root, `data/.creator-updates-${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temporary, "wx", 0o644);
    await file.writeFile(`${JSON.stringify(normalizeUpdates(data), null, 2)}\n`, "utf8");
    await file.sync();
    await file.close();
    file = null;
    assertRepoPath(root, "data/creator-updates.json");
    await renameImpl(temporary, destination);
  } finally {
    await file?.close().catch(() => {});
    await rm(temporary, { force: true });
  }
}

// A successful check only advances checkedAt; committing that alone every run would create a
// bot commit (and a publish) per schedule. Rewrite the snapshot when items, statuses or messages
// change, or as a heartbeat once the stored successful check is older than HEARTBEAT_MS, so the
// public "last successful check" stays inside STALE_MS without a daily timestamp-only commit.
export const HEARTBEAT_MS = 36 * 60 * 60 * 1000;
export const STALE_MS = 72 * 60 * 60 * 1000;
// A single failed check is routine (platform hiccups); only a source whose last successful
// check is older than this fails the scheduled job, so a red run means a real, lasting outage.
export const FAILURE_GRACE_MS = 48 * 60 * 60 * 1000;
export function persistentSourceFailures(data, errors, { now = new Date().toISOString(), graceMs = FAILURE_GRACE_MS } = {}) {
  const current = Date.parse(timestamp(now));
  return errors.filter(error => {
    const checkedAt = data.sources.find(source => source.id === error.source)?.checkedAt;
    return !checkedAt || current - Date.parse(checkedAt) > graceMs;
  });
}
const withoutTimes = data => JSON.stringify({ ...data, sources: data.sources.map(({ checkedAt: _checked, lastAttemptAt: _attempt, ...rest }) => rest) });
export function snapshotNeedsWrite(previous, next, { now = new Date().toISOString(), heartbeatMs = HEARTBEAT_MS } = {}) {
  if (!previous) return true;
  let before;
  try { before = normalizeUpdates(previous); } catch { return true; }
  const after = normalizeUpdates(next);
  if (withoutTimes(before) !== withoutTimes(after)) return true;
  const current = Date.parse(timestamp(now));
  return after.sources.some(source => {
    if (source.status !== "ok") return false;
    const stored = before.sources.find(entry => entry.id === source.id)?.checkedAt;
    return !stored || current - Date.parse(stored) >= heartbeatMs;
  });
}

async function main() {
  const snapshot = assertRepoPath(ROOT, "data/creator-updates.json");
  let previous;
  try { previous = JSON.parse(await readFile(snapshot, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const now = new Date().toISOString();
  const { data, errors } = await refreshCreatorUpdates(previous, { now });
  if (snapshotNeedsWrite(previous, data, { now })) await writeUpdatesSnapshot(ROOT, data);
  else console.log("No update, status or heartbeat change; snapshot left untouched.");
  for (const source of data.sources) console.log(`${source.label}: ${source.status}, ${data.items.filter(item => item.source === source.id).length} retained updates; last successful check ${source.checkedAt || "never"}.`);
  const persistent = new Set(persistentSourceFailures(data, errors, { now }));
  for (const error of errors) {
    if (persistent.has(error)) console.error(`::error::${error.source}: ${error.message} (no successful check for over 48 hours)`);
    else console.log(`::warning::${error.source}: ${error.message} (last successful check is recent; retrying next run)`);
  }
  if (persistent.size) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
