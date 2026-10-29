const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repo = path.resolve(__dirname, "../..");
const songs = () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(repo, "js/songs.js"), "utf8"), context);
  return JSON.parse(JSON.stringify(vm.runInContext("SONGS", context)));
};
const data = () => JSON.parse(fs.readFileSync(path.join(repo, "data/song-archive.json"), "utf8"));
const post = (id, publishedAt, text, links = []) => ({ id, publishedAt, text, links });

test("song video IDs accept trusted short/watch links and reject deceptive origins or URL forms", async () => {
  const { youtubeId, songPageName } = await import("../song-archive.mjs");
  const id = "UnIhRpIT7nc";
  for (const url of [
    `https://youtu.be/${id}`, `https://youtu.be/${id}?t=20`,
    `https://youtube.com/watch?v=${id}`, `https://www.youtube.com/watch?v=${id}&t=20`,
    `https://m.youtube.com/watch?v=${id}`
  ]) {
    assert.equal(youtubeId(url), id, url);
    assert.equal(songPageName({ youtube: url }), `song-${id}.html`);
  }
  for (const url of [
    `https://evil.example/?v=${id}`, `https://youtube.com.evil.example/watch?v=${id}`,
    `https://evil.example/youtu.be/${id}`, `https://www.youtu.be/${id}`,
    `https://youtu.be.evil.example/${id}`, `https://www.youtube.com/playlist?v=${id}`,
    `https://youtube.com/?v=${id}`, `https://youtu.be/${id}/extra`,
    `https://user@youtu.be/${id}`, `https://user:password@www.youtube.com/watch?v=${id}`,
    `https://youtube.com@evil.example/watch?v=${id}`, `https://www.youtube.com:444/watch?v=${id}`,
    `http://youtu.be/${id}`, `ftp://www.youtube.com/watch?v=${id}`,
    `javascript:alert(1)?v=${id}`, `https://www.youtube.com/watch?v=${id}&v=AAAAAAAAAAA`
  ]) assert.throws(() => youtubeId(url), /Invalid YouTube URL/u, url);
  const current = songs();
  assert.ok(current.length > 0);
  assert.equal(new Set(current.map(songPageName)).size, current.length, "all current links retain distinct page paths as songs are added");
});

test("a legal watch link generates the same song page and index path as its short form", async () => {
  const { renderArchivePages } = await import("../render-archive-pages.mjs");
  const song = { title: "Synthetic song", youtube: "https://www.youtube.com/watch?v=UnIhRpIT7nc", singers: [], album: "SINGLES" };
  const result = renderArchivePages({ songs: [song], xPosts: { version: 1, coverage: [], items: [] },
    xTranslations: new Map(), xPostsRenderer: { posts: () => [], renderPost: () => "" },
    songDetailsSource: { version: 1, songs: {} },
    updatesHtml: fs.readFileSync(path.join(repo, "updates.html"), "utf8") });
  assert.ok(result.files.has("song-UnIhRpIT7nc.html"));
  assert.match(result.files.get("songs.html"), /href="song-UnIhRpIT7nc\.html"/u);
  assert.match(result.files.get("song-UnIhRpIT7nc.html"), /data-song-id="UnIhRpIT7nc"/u);
  assert.ok(![...result.files.keys()].some(name => name.includes("undefined")));
});

test("each generated song share card uses its own official MV cover and escaped song title", async () => {
  const { renderArchivePages } = await import("../render-archive-pages.mjs");
  const list = songs();
  list.push({ title: 'A <song> & "cover"', youtube: "https://www.youtube.com/watch?v=AAAAAAAAAAA", singers: [], album: "SINGLES" });
  const result = renderArchivePages({ songs: list, xPosts: { version: 1, coverage: [], items: [] },
    xTranslations: new Map(), xPostsRenderer: { posts: () => [], renderPost: () => "" },
    songDetailsSource: { version: 1, songs: {} },
    updatesHtml: fs.readFileSync(path.join(repo, "updates.html"), "utf8") });
  for (const song of list) {
    const url = new URL(song.youtube);
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
    const page = result.files.get(`song-${id}.html`);
    const expectedCover = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    assert.equal(page.match(/<meta property="og:image" content="([^"]*)"/u)?.[1], expectedCover, song.title);
    assert.equal(page.match(/<meta name="twitter:image" content="([^"]*)"/u)?.[1], expectedCover, song.title);
    assert.match(page, /<meta name="twitter:card" content="summary_large_image"/u);
    assert.match(page, /<meta property="og:image:width" content="480"/u);
    assert.match(page, /<meta property="og:image:height" content="360"/u);
    const alt = page.match(/<meta property="og:image:alt" content="([^"]*)"/u)?.[1];
    assert.equal(page.match(/<meta name="twitter:image:alt" content="([^"]*)"/u)?.[1], alt);
    assert.ok(alt?.endsWith(" · 稲葉曇"), "share image identifies the song and artist");
    assert.equal(page.match(/<meta property="og:title" content="([^"]*)"/u)?.[1], `${alt.slice(0, -" · 稲葉曇".length)} · 歌曲观测档案`);
  }
  assert.match(result.files.get("song-AAAAAAAAAAA.html"), /content="A &lt;song&gt; &amp; &quot;cover&quot; · 稲葉曇"/u);
  for (const name of ["songs.html", "search.html"]) {
    assert.doesNotMatch(result.files.get(name), /(?:og:image|twitter:image|twitter:card)/u, `${name} keeps its default metadata`);
  }
});

test("verified details exist only for checked songs and carry official sources", async () => {
  const { validateSongDetails } = await import("../song-archive.mjs");
  const details = validateSongDetails(data(), songs());
  const lost = details["DeKLpgzh-qQ"], lag = details["UnIhRpIT7nc"];
  assert.equal(lost.releasedAt, "2018-02-27T13:00:36Z");
  assert.equal(lag.releasedAt, "2020-07-16T11:00:13Z");
  for (const entry of [lost, lag]) {
    assert.equal(entry.vocal, "歌愛ユキ");
    assert.ok(entry.sources.some(source => source.url.startsWith("https://www.youtube.com/watch?v=")));
    assert.deepEqual(entry.credits.find(credit => credit.role === "illustration"), { role: "illustration", name: "ぬくぬくにぎりめし", url: "https://x.com/NKNK_NGRMS" });
  }
  assert.deepEqual(lost.unverified, ["movie"], "Lost Umbrella's movie credit was not confirmed and stays blank");
  assert.ok(!lost.credits.some(credit => credit.role === "movie"));
});

test("validation refuses invented or unsourced credits", async () => {
  const { validateSongDetails } = await import("../song-archive.mjs");
  const list = songs();
  const mutate = change => { const copy = data(); change(copy.songs["UnIhRpIT7nc"], copy); return copy; };
  for (const [name, change] of [
    ["unknown song", (_, copy) => { copy.songs.AAAAAAAAAAA = copy.songs["UnIhRpIT7nc"]; }],
    ["unknown role", entry => entry.credits.push({ role: "mixing", name: "someone" })],
    ["non-official credit link", entry => { entry.credits[1].url = "https://example.com/artist"; }],
    ["no sources", entry => { entry.sources = []; }],
    ["fan-wiki source", entry => { entry.sources = [{ label: "wiki", url: "https://example.com/wiki" }]; }],
    ["deceptive niconico source", entry => { entry.sources = [{ label: "niconico", url: "https://www.nicovideo.jp.example.com/watch/sm42576236" }]; }],
    ["credited and unverified", entry => { entry.unverified = ["movie"]; }],
    ["bad date", entry => { entry.releasedAt = "soon"; }]
  ]) assert.throws(() => validateSongDetails(mutate(change), list), undefined, name);
  assert.doesNotThrow(() => validateSongDetails(mutate(entry => {
    entry.sources = [{ label: "niconico", url: "https://www.nicovideo.jp/watch/sm37198038" }];
  }), list));
});

test("release dates keep source precision and the Japanese day at midnight", async () => {
  const { renderSongPage } = await import("../song-archive.mjs");
  const song = songs()[0];
  const details = data().songs["UnIhRpIT7nc"];
  for (const [releasedAt, day] of [["2025-08-01", "2025-08-01"], ["2023-08-05T00:00:00+09:00", "2023-08-05"]]) {
    const page = renderSongPage(song, 0, { details: { ...details, releasedAt }, linked: [], renderPost: () => "" });
    assert.ok(page.includes(`<time datetime="${releasedAt}" data-local-time>${day} JST</time>`), "do not invent a time for day-only evidence or move Japanese midnight to the previous date");
  }
});

test("posts link by video ID or title, short titles only in quotes, and are categorised", async () => {
  const { linkPosts } = await import("../song-archive.mjs");
  const list = [
    { title: "ラグトレイン", youtube: "https://youtu.be/UnIhRpIT7nc", album: "WEATHER STATION", singers: [] },
    { title: "もち", youtube: "https://youtu.be/BBBBBBBBBBB", album: "SINGLES", singers: [] },
    { title: "ラグトレイン (Remix)", youtube: "https://youtu.be/CCCCCCCCCCC", album: "SINGLES", singers: [] }
  ];
  const posts = [
    post("1", "2020-07-16T11:05:00Z", "新曲です", [{ label: "youtu.be/UnIhRpIT7nc", url: "https://youtu.be/UnIhRpIT7nc" }]),
    post("2", "2021-03-01T00:00:00Z", "ﾗｸﾞﾄﾚｲﾝ 1000万回再生ありがとう"),
    post("3", "2022-01-01T00:00:00Z", "ラグトレインのメモ"),
    post("4", "2022-01-02T00:00:00Z", "もちを食べた"),
    post("5", "2022-01-03T00:00:00Z", "『もち』を聴いて")
  ];
  const linked = linkPosts(list, posts, data().songs);
  assert.deepEqual(linked.get("UnIhRpIT7nc").map(item => [item.id, item.category]), [["1", "release"], ["2", "milestone"], ["3", "note"]]);
  assert.deepEqual(linked.get("BBBBBBBBBBB").map(item => item.id), ["5"]);
  assert.deepEqual(linked.get("CCCCCCCCCCC"), [], "versions match by video ID only");
});

test("song pages show blanks as unverified and never fabricate credits", async () => {
  const { renderSongPage } = await import("../song-archive.mjs");
  const details = data().songs;
  const list = songs();
  const lost = list.find(song => song.youtube.endsWith("DeKLpgzh-qQ"));
  const page = renderSongPage(lost, 0, { details: details["DeKLpgzh-qQ"], linked: [], renderPost: () => "" });
  assert.match(page, /ぬくぬくにぎりめし/u);
  assert.match(page, /data-zh="影像"[\s\S]*?未核对/u);
  const other = list.find(song => !details[song.youtube.slice(-11)] && song.singers.length);
  const plain = renderSongPage(other, 1, { details: undefined, linked: [], renderPost: () => "" });
  assert.doesNotMatch(plain, /ぬくぬくにぎりめし|<time/u);
  assert.equal((plain.match(/class="song-unverified"/gu) || []).length, 4, "release date and three credits stay blank");
  assert.match(plain, /站内歌曲表/u);
  const hostile = renderSongPage({ ...other, title: '<img src=x onerror=alert(1)>"' }, 1, { details: undefined, linked: [], renderPost: () => "" });
  assert.doesNotMatch(hostile, /<img src=x/u);
});
