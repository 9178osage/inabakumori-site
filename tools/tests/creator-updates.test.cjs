const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const load = () => import("../refresh-creator-updates.mjs");
const CHANNEL = "UCNElM45JypxqAR73RoUQ10g";
const VIDEO = "2r4W_LoVFxA";
const NOW = "2026-10-18T06:00:00.000Z";
const BEFORE = "2026-10-17T06:00:00.000Z";
function feed({ channel = CHANNEL, video = VIDEO, title = "ユレール &amp; 雨", published = "2026-03-08T03:00:07-07:00" } = {}) {
  return `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><yt:channelId>${channel}</yt:channelId><entry><yt:videoId>${video}</yt:videoId><yt:channelId>${channel}</yt:channelId><title>${title}</title><published>${published}</published></entry></feed>`;
}
function youtubeItem(overrides = {}) {
  return { id: `youtube:${VIDEO}`, creator: "inabakumori", source: "youtube", title: "ユレール", publishedAt: "2026-03-08T10:00:07.000Z", url: `https://www.youtube.com/watch?v=${VIDEO}`, ...overrides };
}
function profile() { return { error: false, body: { illusts: { "104102788": null }, manga: [] } }; }
function work(overrides = {}) { return { error: false, body: { id: "104102788", userId: "27327959", title: "2🐰23", createDate: "2023-01-01T00:16:00+09:00", xRestrict: 0, ...overrides } }; }
function campfire() {
  return '<article class="activity"><a href="activities/891733#main" class="title line-clamp">【本日クラファン終了！】おさげちゃん</a><div class="time text-gray">2026/09/23 12:00</div></article>';
}
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => typeof body === "string" ? body : JSON.stringify(body) }; }
function fakeFetch(url) {
  if (url.includes("/feeds/")) return response(feed());
  if (url.endsWith("/profile/all")) return response(profile());
  if (url.endsWith("/illust/104102788")) return response(work());
  if (url.includes("camp-fire.jp")) return response(campfire());
  throw new Error("Unexpected URL");
}
function channelPage({ channel = CHANNEL, lockup = true } = {}) {
  const content = lockup ? { lockupViewModel: { contentType: "LOCKUP_CONTENT_TYPE_VIDEO", contentId: VIDEO } } : { videoRenderer: { videoId: VIDEO } };
  return `<script>var ytInitialData = ${JSON.stringify({ metadata: { channelMetadataRenderer: { externalId: channel } }, contents: { items: [content, content] } })};</script>`;
}
function watchPage({ channel = CHANNEL, id = VIDEO, date = "2026-03-08T03:00:07-07:00", title = "ユレール" } = {}) {
  return `<script>var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: id, channelId: channel, title }, microformat: { playerMicroformatRenderer: { publishDate: date } } })};</script>`;
}

test("creator feeds retain original titles safely as data, decode XML and normalize actual publication time", async () => {
  const { parseYouTubeFeed } = await load();
  const [item] = parseYouTubeFeed(feed({ title: '<![CDATA[雨 </script><img onerror="x">]]>' }));
  assert.equal(item.title, '雨 </script><img onerror="x">');
  assert.equal(item.publishedAt, "2026-03-08T10:00:07.000Z");
  assert.equal(item.url, `https://www.youtube.com/watch?v=${VIDEO}`);
  assert.equal(parseYouTubeFeed(feed())[0].title, "ユレール & 雨");
});

test("creator feed rejects wrong authors, incomplete/empty XML and bad dates without manufacturing entries", async () => {
  const { parseYouTubeFeed } = await load();
  for (const xml of [feed({ channel: "OTHER" }), feed({ video: "bad" }), feed({ published: "2026-02-30T00:00:00Z" }), "<feed></feed>", feed().replace("</entry>", ""), feed({ title: "&unknown;" }), '<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///private">]>' + feed()]) assert.throws(() => parseYouTubeFeed(xml));
});

test("YouTube feed accepts the official shortened header ID while verifying every full entry author", async () => {
  const { parseYouTubeFeed } = await load();
  const original = feed();
  const shortened = original.replace(`<yt:channelId>${CHANNEL}</yt:channelId>`, `<yt:channelId>${CHANNEL.slice(2)}</yt:channelId>`);
  assert.deepEqual(parseYouTubeFeed(shortened), parseYouTubeFeed(original));
  assert.throws(() => parseYouTubeFeed(shortened.replace(`<yt:channelId>${CHANNEL}</yt:channelId>`, "<yt:channelId>UCwrong</yt:channelId>")), /Unexpected video author/);
  assert.throws(() => parseYouTubeFeed(shortened.replace(CHANNEL.slice(2), "wrong")), /Unexpected YouTube channel/);
});

test("YouTube HTML fallback reads JSON without executing scripts and supports both official list variants", async () => {
  const { parseYouTubeChannelPage, parseYouTubeWatchPage } = await load();
  assert.deepEqual(parseYouTubeChannelPage(channelPage()), [VIDEO]);
  assert.deepEqual(parseYouTubeChannelPage(channelPage({ lockup: false })), [VIDEO]);
  const tricky = '雨 \\" } <script>doNotExecute()</script>';
  assert.equal(parseYouTubeWatchPage(watchPage({ title: tricky }), VIDEO).title, tricky);
  assert.throws(() => parseYouTubeChannelPage(channelPage({ channel: "OTHER" })));
  assert.throws(() => parseYouTubeWatchPage(watchPage({ channel: "OTHER" }), VIDEO));
  assert.throws(() => parseYouTubeWatchPage(watchPage({ id: "STBoCK69vVQ" }), VIDEO));
  assert.throws(() => parseYouTubeWatchPage(watchPage({ date: "yesterday" }), VIDEO));
  const day = parseYouTubeWatchPage(watchPage({ date: "2026-03-08" }), VIDEO);
  assert.equal(day.datePrecision, "day");
  assert.equal(day.publishedAt, "2026-03-08T00:00:00.000Z");
});

test("pixiv work parsing confirms author/id and does not treat fetch time as artwork publication time", async () => {
  const { parsePixivProfile, parsePixivWork } = await load();
  assert.deepEqual(parsePixivProfile(profile()), ["104102788"]);
  assert.equal(parsePixivWork(work(), "104102788").publishedAt, "2022-12-31T15:16:00.000Z");
  for (const changes of [{ userId: "1" }, { id: "2" }, { xRestrict: 1 }, { createDate: "yesterday" }]) assert.throws(() => parsePixivWork(work(changes), "104102788"));
  for (const bad of [{ error: true }, { error: false, body: { illusts: {}, manga: {} } }, { error: false, body: { illusts: { "../secret": null }, manga: {} } }]) assert.throws(() => parsePixivProfile(bad));
});

test("CAMPFIRE project entries keep their official JST dates and the fixed project URL", async () => {
  const { parseCampfireActivities } = await load();
  const [item] = parseCampfireActivities(campfire());
  assert.equal(item.title, "【本日クラファン終了！】おさげちゃん");
  assert.equal(item.publishedAt, "2026-09-23T03:00:00.000Z");
  assert.equal(item.url, "https://camp-fire.jp/projects/970332/view/activities/891733");
  assert.throws(() => parseCampfireActivities("<html>No activities</html>"));
  assert.throws(() => parseCampfireActivities(campfire().replace("2026/09/23", "2026/02/30")));
});

test("snapshot normalization deduplicates, sorts and caps each source while refusing arbitrary URLs", async () => {
  const { normalizeUpdates } = await load();
  const many = Array.from({ length: 15 }, (_, index) => youtubeItem({ id: `youtube:AAAAAAAAA${String(index).padStart(2, "0")}`, url: `https://www.youtube.com/watch?v=AAAAAAAAA${String(index).padStart(2, "0")}`, publishedAt: `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` }));
  const normalized = normalizeUpdates({ version: 1, sources: [], items: [many[0], ...many] });
  assert.equal(normalized.items.length, 12);
  assert.equal(normalized.items[0].publishedAt, "2026-03-15T00:00:00.000Z");
  assert.equal(normalized.sources.length, 3);
  assert.throws(() => normalizeUpdates({ version: 1, sources: [], items: [youtubeItem({ url: "javascript:alert(1)" })] }));
  assert.throws(() => normalizeUpdates({ version: 1, sources: [], items: [youtubeItem({ creator: "nknk" })] }));
});

test("refresh collects all three public sources and marks only successful checks", async () => {
  const { refreshCreatorUpdates } = await load();
  const urls = [];
  const { data, errors } = await refreshCreatorUpdates(undefined, { now: NOW, fetchImpl: async (url, options) => { urls.push(url); assert.equal(options.redirect, "error"); return fakeFetch(url); } });
  assert.deepEqual(errors, []);
  assert.equal(data.items.length, 3);
  assert.deepEqual(data.items.map(item => item.source), ["campfire", "youtube", "pixiv"]);
  assert.ok(data.sources.every(source => source.checkedAt === NOW && source.lastAttemptAt === NOW && source.status === "ok"));
  assert.ok(urls.every(url => url.startsWith("https://www.youtube.com/") || url.startsWith("https://www.pixiv.net/ajax/") || url === "https://camp-fire.jp/projects/970332/view/activities"));
});

test("RSS unavailable falls back to public creator pages with verified watch metadata", async () => {
  const { refreshCreatorUpdates } = await load();
  const { data, errors } = await refreshCreatorUpdates(undefined, { now: NOW, fetchImpl: async url => {
    if (url.includes("/feeds/")) return response("not found", 404);
    if (url.endsWith("/@inabakumori/videos")) return response(channelPage());
    if (url.includes("/watch?")) return response(watchPage());
    return fakeFetch(url);
  } });
  assert.deepEqual(errors, []);
  assert.equal(data.items.find(item => item.source === "youtube").publishedAt, "2026-03-08T10:00:07.000Z");
});

test("source failure preserves previous work and check time while independent sources still refresh", async () => {
  const { refreshCreatorUpdates } = await load();
  const previous = { version: 1, sources: [{ id: "youtube", status: "ok", checkedAt: BEFORE, lastAttemptAt: BEFORE }], items: [youtubeItem()] };
  const { data, errors } = await refreshCreatorUpdates(previous, { now: NOW, sleep: async () => {}, fetchImpl: async url => url.includes("youtube.com") ? response("unavailable", 403) : fakeFetch(url) });
  assert.equal(errors.length, 1);
  assert.equal(data.items.find(item => item.source === "youtube").title, "ユレール");
  const youtube = data.sources.find(source => source.id === "youtube");
  assert.equal(youtube.checkedAt, BEFORE);
  assert.equal(youtube.lastAttemptAt, NOW);
  assert.equal(youtube.status, "error");
  assert.equal(data.sources.find(source => source.id === "pixiv").checkedAt, NOW);
});

test("partial pixiv metadata failure retains its complete prior snapshot and keeps failure state", async () => {
  const { refreshCreatorUpdates, parsePixivWork } = await load();
  const previous = { version: 1, sources: [{ id: "pixiv", status: "ok", checkedAt: BEFORE }], items: [parsePixivWork(work(), "104102788")] };
  const { data, errors } = await refreshCreatorUpdates(previous, { now: NOW, fetchImpl: async url => url.endsWith("/profile/all") ? response({ error: false, body: { illusts: { "104102788": null, "104102789": null }, manga: {} } }) : url.endsWith("104102789") ? response("blocked", 403) : fakeFetch(url) });
  assert.equal(errors.length, 1);
  assert.equal(data.sources.find(source => source.id === "pixiv").checkedAt, BEFORE);
  assert.equal(data.items.filter(item => item.source === "pixiv").length, 1);
});

test("network and 5xx retries are bounded and cannot turn first-run failure into a successful check", async () => {
  const { refreshCreatorUpdates } = await load();
  const calls = new Map();
  const { data, errors } = await refreshCreatorUpdates(undefined, { now: NOW, sleep: async () => {}, fetchImpl: async url => { calls.set(url, (calls.get(url) || 0) + 1); throw new Error("private network body must not appear"); } });
  assert.equal(errors.length, 3);
  assert.ok([...calls.values()].every(count => count === 2));
  assert.ok(data.sources.every(source => source.status === "error" && source.checkedAt === null));
  assert.ok(errors.every(error => !error.message.includes("private network")));
  assert.deepEqual(data.items, []);
});

test("atomic snapshot failure preserves the previous file and removes temporary files", async () => {
  const { writeUpdatesSnapshot } = await load();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "creator-updates-"));
  try {
    await fs.mkdir(path.join(directory, "data"));
    const destination = path.join(directory, "data/creator-updates.json");
    await fs.writeFile(destination, "PREVIOUS");
    await assert.rejects(writeUpdatesSnapshot(directory, { version: 1, sources: [], items: [] }, { renameImpl: async () => { throw new Error("disk full"); } }), /disk full/);
    assert.equal(await fs.readFile(destination, "utf8"), "PREVIOUS");
    assert.deepEqual(await fs.readdir(path.join(directory, "data")), ["creator-updates.json"]);
    await writeUpdatesSnapshot(directory, { version: 1, sources: [], items: [youtubeItem()] });
    assert.equal(JSON.parse(await fs.readFile(destination, "utf8")).items[0].title, "ユレール");
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("snapshot writer refuses a symlinked destination before touching the target", async () => {
  const { writeUpdatesSnapshot } = await load();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "creator-updates-link-"));
  try {
    await fs.mkdir(path.join(directory, "data"));
    const victim = path.join(directory, "victim.txt");
    await fs.writeFile(victim, "KEEP");
    await fs.symlink(victim, path.join(directory, "data/creator-updates.json"));
    await assert.rejects(writeUpdatesSnapshot(directory, { version: 1, sources: [], items: [] }), /symlinked path/);
    assert.equal(await fs.readFile(victim, "utf8"), "KEEP");
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("an unchanged successful refresh does not rewrite the snapshot until the check-time heartbeat is due", async () => {
  const { refreshCreatorUpdates, snapshotNeedsWrite, HEARTBEAT_MS, STALE_MS } = await load();
  assert.ok(HEARTBEAT_MS + 24 * 60 * 60 * 1000 < STALE_MS, "a skipped daily run must still leave the published check inside the stale window");
  const { data: first } = await refreshCreatorUpdates(undefined, { now: BEFORE, fetchImpl: async url => fakeFetch(url) });
  const { data: second } = await refreshCreatorUpdates(first, { now: NOW, fetchImpl: async url => fakeFetch(url) });
  assert.notEqual(second.sources[0].checkedAt, first.sources[0].checkedAt, "check times still advance in memory");
  assert.equal(snapshotNeedsWrite(first, second, { now: NOW }), false, "timestamp-only changes must not produce a commit");
  const later = new Date(Date.parse(BEFORE) + HEARTBEAT_MS).toISOString();
  const { data: third } = await refreshCreatorUpdates(first, { now: later, fetchImpl: async url => fakeFetch(url) });
  assert.equal(snapshotNeedsWrite(first, third, { now: later }), true, "heartbeat keeps the public check time fresh");
  assert.equal(snapshotNeedsWrite(undefined, first, { now: BEFORE }), true);
  assert.equal(snapshotNeedsWrite({ broken: true }, first, { now: BEFORE }), true);
});

test("new items, changed titles and source failures still rewrite the snapshot immediately", async () => {
  const { refreshCreatorUpdates, snapshotNeedsWrite } = await load();
  const { data: first } = await refreshCreatorUpdates(undefined, { now: BEFORE, fetchImpl: async url => fakeFetch(url) });
  const renamed = await refreshCreatorUpdates(first, { now: NOW, fetchImpl: async url => url.includes("/feeds/") ? response(feed({ title: "新しい題" })) : fakeFetch(url) });
  assert.equal(snapshotNeedsWrite(first, renamed.data, { now: NOW }), true);
  const failed = await refreshCreatorUpdates(first, { now: NOW, sleep: async () => {}, fetchImpl: async url => url.includes("camp-fire.jp") ? response("down", 403) : fakeFetch(url) });
  assert.equal(snapshotNeedsWrite(first, failed.data, { now: NOW }), true, "ok -> error must be published");
  const stillFailed = await refreshCreatorUpdates(failed.data, { now: "2026-10-18T07:00:00.000Z", sleep: async () => {}, fetchImpl: async url => url.includes("camp-fire.jp") ? response("down", 403) : fakeFetch(url) });
  assert.equal(snapshotNeedsWrite(failed.data, stillFailed.data, { now: "2026-10-18T07:00:00.000Z" }), false, "a repeated failure only moves the attempt time");
});

test("creator refresh runs once a day and both pages warn after the shared stale window", async () => {
  const root = path.join(__dirname, "..", "..");
  const workflow = await fs.readFile(path.join(root, ".github/workflows/refresh-creator-updates.yml"), "utf8");
  const crons = [...workflow.matchAll(/cron:\s*"([^"]+)"/gu)].map(match => match[1]);
  assert.deepEqual(crons, ["17 11 * * *"]);
  for (const file of ["js/updates.js", "js/home-updates.js"]) {
    const source = await fs.readFile(path.join(root, file), "utf8");
    assert.match(source, /72 \* 60 \* 60 \* 1000/u, file);
    assert.doesNotMatch(source, /48 \* 60 \* 60 \* 1000/u, file);
  }
  const render = await fs.readFile(path.join(root, "tools/render-creator-updates.mjs"), "utf8");
  assert.match(render, /超过 72 小时/u);
  assert.doesNotMatch(render, /48/u);
});

test("work titles reject C0/C1 control characters from entities or CDATA", async () => {
  const { parseYouTubeFeed } = await load();
  for (const title of ["雨&#1;", "雨&#x7f;", "雨&#x85;", "<![CDATA[雨\u0007]]>"]) assert.throws(() => parseYouTubeFeed(feed({ title })), /Invalid work title/u, title);
  assert.equal(parseYouTubeFeed(feed({ title: "雨&#10;雪" }))[0].title, "雨\n雪");
});
