const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function loadCalendar() {
  const window = { siteStorage: { getItem: () => null, setItem() {} }, addEventListener() {} };
  const document = { readyState: "loading", addEventListener() {} };
  vm.runInNewContext(read("js/calendar.js"), { window, document, Intl, Date, Math, Number, String });
  return window.inabakumoriCalendar;
}

test("calendar counts whole Japan-time days since the release and never goes negative", () => {
  const { daysSince } = loadCalendar();
  const release = Date.parse("2026-03-08T10:00:07.000Z"); // 19:00 JST, 3/8
  assert.equal(daysSince(release, Date.parse("2026-03-08T14:59:59.000Z")), 0); // 23:59 JST same day
  assert.equal(daysSince(release, Date.parse("2026-03-08T15:00:00.000Z")), 1); // JST midnight
  assert.equal(daysSince(release, Date.parse("2026-10-22T15:00:00.000Z")), 229);
  assert.equal(daysSince(release, release - 86_400_000), 0);
});

test("calendar page is hidden, CSP-safe, localized and motion-aware", () => {
  const html = read("calendar.html");
  assert.match(html, /<meta name="robots" content="noindex, nofollow"\/>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.match(html, /script-src 'self';/);
  assert.match(html, /<!-- CALENDAR:SHEET -->/);
  for (const element of html.match(/data-zh="[^"]*"[^>]*>/g)) assert.match(element, /data-en="[^"]+"[^>]*data-ja="[^"]+"/);
  assert.doesNotMatch(read("sitemap.xml"), /calendar/);
  const css = read("calendar.css");
  assert.match(css, /@media\(prefers-reduced-motion:no-preference\)\{\.calendar-sheet\[data-flip\]\{animation/);
  assert.doesNotMatch(css.replace(/@media\(prefers-reduced-motion:no-preference\)\{[^}]*\}\}/, ""), /animation:/);
  const js = read("js/calendar.js");
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write/);
});

test("homepage reaches the calendar through a labelled entry beside the station mark only", () => {
  const html = read("index.html");
  assert.match(html, /<div class="station-brand"><a class="station-mark" href="#top">[\s\S]*?<\/a><a class="station-calendar" href="calendar\.html"><svg[^>]*aria-hidden="true"[\s\S]*?<span data-zh="神秘小日历" data-en="Secret Calendar" data-ja="秘密のカレンダー">神秘小日历<\/span><\/a><\/div>/);
  assert.equal(html.split('href="calendar.html"').length, 2);
  assert.doesNotMatch(html, /footer-calendar/);
  for (const nav of html.match(/<nav[\s\S]*?<\/nav>/g) || []) assert.doesNotMatch(nav, /calendar/);
  const css = read("style.css");
  assert.match(css, /\.station-calendar \{[^}]*min-height: 44px/);
  assert.match(css, /\.station-calendar:focus-visible \{ outline:/);
  assert.match(read("tools/build-site.mjs"), /"CALENDAR:SHEET"/);
});

test("calendar counts only YouTube uploads that are songs in js/songs.js", async () => {
  const { newestSongRelease } = await import("../calendar-song.mjs");
  const songs = [{ title: "ユレール" }, { title: "ロストアンブレラ" }, { title: "たびのまえ、たびのあと (tabitabi Remix)" }];
  const video = (title, publishedAt, extra = {}) => ({ creator: "inabakumori", source: "youtube", title, publishedAt, url: "https://www.youtube.com/watch?v=x", ...extra });
  const items = [
    video("稲葉曇『ユレール』Vo. 弦巻マキ", "2026-03-08T10:00:07.000Z"),
    video("【告知】新アルバム クロスフェード", "2026-09-01T10:00:00.000Z"),
    video("稲葉曇『まだ無い曲』Vo. 歌愛ユキ", "2026-08-01T10:00:00.000Z"),
    video("ロストアンブレラ", "2026-07-01T10:00:00.000Z", { creator: "nknk" }),
    video("稲葉曇『ロストアンブレラ』Live", "not a date")
  ];
  const match = newestSongRelease(items, songs);
  assert.equal(match.song, "ユレール");
  assert.equal(match.item.publishedAt, "2026-03-08T10:00:07.000Z");
  assert.equal(newestSongRelease([video("『たびのまえ、たびのあと (tabitabi Remix)』feat. 初音ミク", "2024-11-13T10:00:08.000Z")], songs).song, "たびのまえ、たびのあと (tabitabi Remix)");
  assert.equal(newestSongRelease([items[1]], songs), null);
});

test("calendar keeps theme-color and description in step with its toggles", () => {
  const source = read("js/calendar.js");
  assert.match(source, /meta\[name="theme-color"\][\s\S]*?#171b1f[\s\S]*?#c4c4c0/u);
  assert.match(source, /meta\[name="description"\][\s\S]*?description\.content = text\(/u);
});
