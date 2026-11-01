const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "..");
const loadSongs = () => {
  const context = {};
  vm.runInNewContext(`${fs.readFileSync(path.join(root, "js/songs.js"), "utf8")}\nthis.SONGS = SONGS;`, context);
  return context.SONGS;
};

test("the phone intro states exactly as many songs as js/songs.js flags mobileFeatured", async () => {
  const { mobileFeaturedCount, renderMobileSongIntro } = await import("../mobile-song-intro.mjs");
  const songs = loadSongs();
  const count = songs.filter(song => song.mobileFeatured === true).length;
  assert.equal(mobileFeaturedCount(songs), count);
  const html = renderMobileSongIntro(count);
  const numbers = [...html.matchAll(/从这 (\d+) 首|この(\d+)曲/gu)].map(match => Number(match[1] ?? match[2]));
  assert.deepEqual(numbers, [count, count, count], "zh text, data-zh and data-ja must all show the flag count");
});

test("the current six featured songs keep the published markup byte for byte", async () => {
  const { mobileFeaturedCount, renderMobileSongIntro } = await import("../mobile-song-intro.mjs");
  assert.equal(mobileFeaturedCount(loadSongs()), 6);
  assert.equal(renderMobileSongIntro(6), '<p class="mobile-song-intro" data-zh="从这 6 首开始听。" data-en="Start listening with these six songs." data-ja="まずは、この6曲から。">从这 6 首开始听。</p>');
});

test("the intro follows a changed flag count and rejects an empty list", async () => {
  const { mobileFeaturedCount, renderMobileSongIntro } = await import("../mobile-song-intro.mjs");
  const songs = loadSongs().map((song, index) => ({ ...song, mobileFeatured: index < 4 ? true : undefined }));
  assert.equal(mobileFeaturedCount(songs), 4);
  assert.match(renderMobileSongIntro(4), /从这 4 首.*these four songs.*この4曲/u);
  assert.match(renderMobileSongIntro(1), /this one song/u);
  assert.match(renderMobileSongIntro(15), /these 15 songs/u);
  assert.throws(() => renderMobileSongIntro(0));
});

test("index.html leaves the intro to the build instead of hard-coding a number", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.equal(html.split("<!-- MOBILE-SONG-INTRO -->").length, 2);
  assert.ok(!html.includes('class="mobile-song-intro"'));
  assert.match(fs.readFileSync(path.join(root, "tools/build-site.mjs"), "utf8"), /fillOnce\(html, "MOBILE-SONG-INTRO", renderMobileSongIntro\(mobileFeaturedCount\(songs\)\)\)/u);
});
