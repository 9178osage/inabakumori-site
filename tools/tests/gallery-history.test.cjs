const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const gallery = fs.readFileSync("js/nknk-gallery-ui.js", "utf8");

test("lightbox history entry records the image index and follows navigation (audit A3)", () => {
  assert.match(gallery, /nknkLightbox: true, nknkLightboxIndex: \(nextIndex \+ items\.length\) % items\.length/);
  assert.match(gallery, /if \(lightboxOpen\) \{\s*showLightbox\(nextIndex\);\s*recordHistoryIndex\(\);/);
  assert.match(gallery, /history\.replaceState\(\{ \.\.\.history\.state, nknkLightboxIndex: lightboxIndex \}/);
});

test("Forward onto a lightbox entry reopens that image without pushing another entry (audit A3)", () => {
  assert.match(gallery, /if \(!lightboxOpen\) \{\s*const index = historyIndex\(event\.state\);\s*if \(index !== null\) openAt\(index, null, false, \{ fromHistory: true \}\);/);
  assert.match(gallery, /if \(!fromHistory\) history\.pushState\(/);
  assert.match(gallery, /Number\.isInteger\(index\) && index >= 0 && index < items\.length/, "stale or foreign indexes are ignored");
  assert.match(gallery, /delete rest\.nknkLightboxIndex;\s*delete rest\.nknkLightbox;/, "reload cleanup drops the index too");
});

test("reload cleanup gives scroll restoration back to the browser", () => {
  assert.match(gallery, /history\.replaceState\(Object\.keys\(rest\)\.length \? rest : null, "", location\.href\);[\s\S]{0,300}if \("scrollRestoration" in history\) history\.scrollRestoration = "auto";\s*\}/);
  assert.equal((gallery.match(/scrollRestoration = "manual"/g) || []).length, 1, "manual is only set while the lightbox entry exists");
});
