const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ID = "UnIhRpIT7nc";
const ACCEPTED = [
  [`https://youtu.be/${ID}`, ID], [`https://youtu.be/${ID}?t=20`, ID],
  [`https://youtube.com/watch?v=${ID}`, ID], [`https://www.youtube.com/watch?v=${ID}&t=20`, ID],
  [`https://m.youtube.com/watch?v=${ID}`, ID], [`https://WWW.YouTube.com/watch?v=${ID}`, ID],
  [`https://www.youtube.com/embed/${ID}`, ID], [`https://www.youtube.com/shorts/${ID}`, ID]
];
const REJECTED = [
  `https://evil.example/?v=${ID}`, `https://youtube.com.evil.example/watch?v=${ID}`, `https://notyoutube.com/watch?v=${ID}`,
  `https://evil.example/youtu.be/${ID}`, `https://www.youtu.be/${ID}`, `https://youtu.be.evil.example/${ID}`,
  `https://www.youtube.com/playlist?v=${ID}`, `https://youtube.com/?v=${ID}`, `https://youtu.be/${ID}/extra`,
  `https://www.youtube.com/embed/${ID}/extra`, `https://www.youtube.com/evil/embed/${ID}`, `https://www.youtube.com/watch?x=embed/${ID}`,
  `https://user@youtu.be/${ID}`, `https://user:password@www.youtube.com/watch?v=${ID}`,
  `https://youtube.com@evil.example/watch?v=${ID}`, `https://www.youtube.com:444/watch?v=${ID}`,
  `http://youtu.be/${ID}`, `ftp://www.youtube.com/watch?v=${ID}`, `javascript:alert(1)?v=${ID}`,
  `https://www.youtube.com/watch?v=${ID}&v=AAAAAAAAAAA`, `https://youtu.be/${ID}x`, `https://youtu.be/short`,
  "not a url", "", undefined, null
];

function browserParser() {
  const source = fs.readFileSync("script.js", "utf8");
  const start = source.indexOf("function youtubeVideoId(value) {");
  const end = source.indexOf("\nfunction getSongThumbnailUrl", start);
  assert.ok(start >= 0 && end > start, "script.js defines youtubeVideoId before getSongThumbnailUrl");
  const context = { URL };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.parse = youtubeVideoId;`, context);
  return context.parse;
}

test("build tools and the browser share one strict YouTube video-ID rule set", async () => {
  const { youtubeVideoId } = await import("../youtube-id.mjs");
  const { youtubeId } = await import("../song-archive.mjs");
  const browser = browserParser();
  for (const [url, id] of ACCEPTED) {
    assert.equal(youtubeVideoId(url), id, url);
    assert.equal(browser(url), id, `browser: ${url}`);
    assert.equal(youtubeId(url), id, `archive: ${url}`);
  }
  for (const url of REJECTED) {
    assert.equal(youtubeVideoId(url), null, String(url));
    assert.equal(browser(url), null, `browser: ${url}`);
    assert.throws(() => youtubeId(url), /Invalid YouTube URL/u, `archive: ${url}`);
  }
});

test("every current song link parses identically everywhere", async () => {
  const { youtubeVideoId } = await import("../youtube-id.mjs");
  const browser = browserParser();
  const context = {};
  vm.runInNewContext(`${fs.readFileSync("js/songs.js", "utf8")}\nthis.songs = SONGS;`, context);
  const links = context.songs.map(song => song.youtube).filter(Boolean);
  assert.ok(links.length > 0);
  for (const url of links) {
    assert.ok(youtubeVideoId(url), url);
    assert.equal(browser(url), youtubeVideoId(url), url);
  }
});

test("the refresh tool no longer carries its own loose parser", () => {
  const tool = fs.readFileSync("tools/refresh-youtube-views.mjs", "utf8");
  assert.doesNotMatch(tool, /hostname\.includes\(/u);
  assert.match(tool, /import \{ youtubeVideoId \} from "\.\/youtube-id\.mjs";/u);
});
