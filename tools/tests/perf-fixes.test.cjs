const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
const script = read("script.js");
const gallery = read("js/nknk-gallery-ui.js");
const experience = read("js/experience.js");
const css = read("style.css");
const html = read("index.html");

test("P1: song list is built off-document and inserted once", () => {
  const render = script.match(/function renderSongs\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(render, /createDocumentFragment/);
  assert.match(render, /prepareSongTags\(links\)/, "tags are rendered before the list is attached");
  assert.match(render, /list\.replaceChildren\(fragment\)/);
});

test("P1: wall messages are appended first, then laid out (no layout per message)", () => {
  assert.match(script, /function createFloatingMessage\(message, startInside = false, deferLayout = false\)/);
  assert.match(script, /if \(deferLayout\) return element;/);
  assert.match(script, /createFloatingMessage\(message, true, true\)/);
  assert.match(script, /created\.forEach\(\(element\) => element\.refreshLayout\(\)\)/);
});

test("P2: marquee runs as a Web Animation, not a per-frame JS loop", () => {
  assert.match(gallery, /row\.track\.animate\(/);
  assert.match(gallery, /iterations: Infinity/);
  assert.doesNotMatch(gallery, /rafId|const tick =/, "the 60 fps rAF loop is gone");
  // A drag must start from the live animated position.
  assert.match(gallery, /freezeRow\(row\);\n\s*startOffset = row\.offset;/);
});

test("P5: only the leading gallery thumbs load eagerly, at low priority", () => {
  // The first EAGER_THUMBS illustrations are fetched up front: CSS-transform motion does not count as
  // "near the viewport" for native lazy loading, so lazy thumbs could stay unfetched while already
  // visible on screen. fetchPriority keeps them out of the first-paint race instead.
  assert.match(gallery, /img\.loading = "eager"/);
  assert.match(gallery, /img\.fetchPriority = "low"/);
  assert.match(gallery, /absoluteIndex < EAGER_THUMBS/);
  // Everything past the leading window is still deferred and loaded on demand.
  assert.match(gallery, /img\.dataset\.src = item\.thumb/);
  assert.match(gallery, /img\[data-src\]/);
});

test("P6: fixed-controls band uses a class on the controls, not body:has()", () => {
  assert.doesNotMatch(css, /body:has\(/);
  assert.match(css, /\.site-controls\.hero-out::before/);
  assert.match(experience, /classList\.toggle\("hero-out", out\)/);
});

test("P7: social icons are small enough for their 24-40px slots", () => {
  for (const name of ["X", "bilibili", "instagram", "niconico", "pixiv", "tiktok", "wikipedia", "youtube"]) {
    const buffer = fs.readFileSync(path.join(__dirname, "../../images", `${name}.png`));
    const width = buffer.readUInt32BE(16);
    assert.ok(width <= 72, `${name}.png is ${width}px wide`);
    assert.ok(buffer.length < 8 * 1024, `${name}.png is ${buffer.length} bytes`);
  }
});

test("performance work leaves the CSP untouched (no service worker, no inline styles)", () => {
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
  assert.match(csp, /worker-src 'none'/);
  assert.match(csp, /style-src 'self';/);
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(html, /serviceWorker|<style/);
});
