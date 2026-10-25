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
    ["credited and unverified", entry => { entry.unverified = ["movie"]; }],
    ["bad date", entry => { entry.releasedAt = "soon"; }]
  ]) assert.throws(() => validateSongDetails(mutate(change), list), undefined, name);
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
  const other = list.find(song => !details[song.youtube.slice(-11)]);
  const plain = renderSongPage(other, 1, { details: undefined, linked: [], renderPost: () => "" });
  assert.doesNotMatch(plain, /ぬくぬくにぎりめし|<time/u);
  assert.equal((plain.match(/class="song-unverified"/gu) || []).length, 4, "release date and three credits stay blank");
  assert.match(plain, /站内歌曲表/u);
  const hostile = renderSongPage({ ...other, title: '<img src=x onerror=alert(1)>"' }, 1, { details: undefined, linked: [], renderPost: () => "" });
  assert.doesNotMatch(hostile, /<img src=x/u);
});
