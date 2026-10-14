const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ui = fs.readFileSync(path.join(__dirname, "../..", "js/nknk-gallery-ui.js"), "utf8");

test("the marquee only pauses for focus the visitor created, not for our own focus restore", () => {
  // Keyboard activation is flagged so the reading pause survives; pointer opens are not.
  assert.match(ui, /const openAt = \(nextIndex, source = null, byKeyboard = false\) => \{/);
  assert.match(ui, /openAt\(absoluteIndex, null, true\)/, "keyboard activation passes byKeyboard=true");
  assert.match(ui, /lightboxOpenedByKeyboard = byKeyboard;/);
  // The pause condition ignores in-row focus that came from our own restore.
  assert.match(ui, /row\.paused = [^;]*\(row\.focus && !row\.pointerFocusExempt\)[^;]*;/);
  assert.match(ui, /pointerFocusExempt: false/);
});

test("closing a pointer-opened lightbox exempts the restored focus; leaving the row clears it", () => {
  assert.match(ui, /if \(!lightboxOpenedByKeyboard && ownerRow\) \{/);
  assert.match(ui, /ownerRow\.pointerFocusExempt = true;/);
  assert.match(ui, /if \(suppressFocusPause\) \{ row\.pointerFocusExempt = true; suppressFocusPause = false; \}/);
  assert.match(ui, /if \(!row\.focus\) row\.pointerFocusExempt = false;/);
  // Reduced motion still wins over everything.
  assert.match(ui, /row\.paused = reduced \|\|/);
});

test("a paused row still fetches the thumbs a drag or keyboard jump reveals", () => {
  // The poll timer stops while a row is paused, so the pointer and keyboard paths fetch themselves.
  const reveal = ui.slice(ui.indexOf("const revealFocusedItem"), ui.indexOf("const onPointerMove"));
  assert.match(reveal, /applyTransform\(row\);[\s\S]*?loadThumbsInWindow\(row, true\);/);
  const move = ui.slice(ui.indexOf("const onPointerMove"), ui.indexOf("const onPointerUp"));
  assert.match(move, /applyTransform\(row\);[\s\S]*?loadThumbsInWindow\(row\);/);
  const up = ui.slice(ui.indexOf("const onPointerUp"), ui.indexOf('viewport.addEventListener("pointerdown"'));
  assert.match(up, /loadThumbsInWindow\(row, true\);[\s\S]*?syncPauseState\(\);/);
  // While paused the loader trusts the offset the drag wrote instead of forcing a layout read per move.
  assert.match(ui, /let offsetX = row\.direction < 0 \? -row\.offset : row\.offset;/);
});
