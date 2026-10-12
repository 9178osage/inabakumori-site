const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const gallery = fs.readFileSync("js/nknk-gallery-ui.js", "utf8");
const script = fs.readFileSync("script.js", "utf8");

test("lightbox adds one history entry so Back closes it, and removes it on other closes", () => {
  assert.match(gallery, /history\.pushState\(\{ \.\.\.\(history\.state \|\| \{\}\), nknkLightbox: true \}, "", location\.href\)/, "same-URL entry, hash untouched");
  assert.match(gallery, /addEventListener\("popstate", \(\) => \{[\s\S]{0,400}closeLightbox\(\{ deferFocus: true \}\)/);
  assert.match(gallery, /if \(history\.state\?\.nknkLightbox\) \{ ignoreNextPop = true; history\.back\(\); \}/, "Escape/close/backdrop pop our entry");
  assert.match(gallery, /keepScroll = \(y\) => requestAnimationFrame\(/, "reader stays where the lightbox was opened");
});

test("tap-opened lightbox returns focus to the tapped original and survives the follow-up click", () => {
  assert.match(gallery, /openAt\(absoluteIndex, originalButton\(shouldClick\)\)/);
  assert.match(gallery, /previousFocus = source \|\| \(active && active !== document\.body \? active : null\)/);
  assert.match(gallery, /if \(performance\.now\(\) < ignoreBackdropUntil\) return;/);
});

test("language switch keeps the element under the nav at the same screen position", () => {
  const fn = script.match(/function captureReadingPosition\(\) \{[\s\S]*?\n\}\n/)[0];
  let scrollY = 1000;
  let shift = 0;
  const node = (top, parent = null) => ({ top, parentElement: parent, isConnected: true, closest: () => ({}), getClientRects: () => [1], getBoundingClientRect() { return { top: this.top + shift, bottom: 0 }; } });
  const main = node(-500);
  const row = node(130, main);
  const leaf = node(130, row);
  const context = {
    window: { scrollY, innerWidth: 400, innerHeight: 800, scrollTo: ({ top }) => { shift -= top - context.window.scrollY; context.window.scrollY = top; } },
    document: { body: {}, elementFromPoint: () => leaf, querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 120 }) }) }
  };
  vm.runInNewContext(`${fn}; this.capture = captureReadingPosition;`, context);
  const restore = context.capture();
  shift = 60;                 // text above grew by 60px after the switch
  leaf.isConnected = false;   // innermost element was re-rendered
  restore();
  assert.equal(context.window.scrollY, 1060, "scrolls by the shift of the closest surviving ancestor");
  assert.equal(row.getBoundingClientRect().top, 130);
});
