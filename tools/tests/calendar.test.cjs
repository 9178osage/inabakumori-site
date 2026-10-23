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

test("homepage reaches the calendar only through a labelled footer icon", () => {
  const html = read("index.html");
  const footer = html.slice(html.indexOf("<footer>"), html.indexOf("</footer>"));
  assert.match(footer, /<a href="calendar\.html" aria-label="神秘小日历" data-aria-zh="神秘小日历" data-aria-en="[^"]+" data-aria-ja="[^"]+">/);
  assert.equal(html.replace(footer, "").includes("calendar.html"), false);
  assert.match(read("tools/build-site.mjs"), /"CALENDAR:SHEET"/);
});
