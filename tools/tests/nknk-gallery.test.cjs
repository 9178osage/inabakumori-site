const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("NKNK gallery config is sequential and points at optimized webp assets", () => {
  const source = fs.readFileSync("js/nknk-gallery.js", "utf8");
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context);
  const gallery = vm.runInContext("NKNK_GALLERY", context);
  assert.ok(Array.isArray(gallery));
  assert.equal(gallery.length, context.window.NKNK_GALLERY.length);
  assert.ok(gallery.length >= 1);
  let total = 0;
  gallery.forEach((item, index) => {
    assert.equal(item.id, index + 1);
    assert.match(item.thumb, /^images\/optimized\/nknk\/\d+\.webp$/);
    assert.match(item.full, /^images\/optimized\/nknk\/full\/\d+\.webp$/);
    assert.ok(fs.existsSync(item.thumb), item.thumb);
    assert.ok(fs.existsSync(item.full), item.full);
    total += fs.statSync(item.thumb).size + fs.statSync(item.full).size;
    const stem = path.basename(item.thumb, ".webp");
    assert.equal(stem, String(item.id));
    const originals = [".jpg", ".jpeg", ".png", ".webp", ".gif"].map((ext) => path.join("NKNK", `${item.id}${ext}`));
    assert.ok(originals.some((file) => fs.existsSync(file)), `missing original for ${item.id}`);
  });
  assert.ok(total < 5 * 1024 * 1024, `gallery assets should stay under 5 MiB, got ${(total / 1024 / 1024).toFixed(2)} MiB`);
});

test("NKNK gallery uses a single-row marquee with accessible lightbox and CSP-safe bindings", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const ui = fs.readFileSync("js/nknk-gallery-ui.js", "utf8");
  const css = fs.readFileSync("style.css", "utf8");
  const gen = fs.readFileSync("tools/generate-nknk-gallery.mjs", "utf8");
  assert.match(html, /id="nknk-gallery"/);
  assert.match(html, /id="nknk-lightbox"/);
  assert.match(html, /js\/nknk-gallery\.js/);
  assert.match(html, /js\/nknk-gallery-ui\.js/);
  assert.doesNotMatch(html, /nknk-gallery-more/);
  assert.doesNotMatch(html, /onclick=/);
  assert.doesNotMatch(ui, /\bonclick\b/);
  assert.doesNotMatch(css, /nknk-gallery-more/);
  assert.match(ui, /ROW_COUNT = 1/);
  assert.match(ui, /translate3d/);
  assert.match(ui, /requestAnimationFrame/);
  assert.match(ui, /prefers-reduced-motion/);
  assert.match(ui, /IntersectionObserver/);
  assert.match(ui, /Mount immediately|mount\(\)/);
  assert.doesNotMatch(ui, /if \(visible\) mount\(\)/);
  assert.match(ui, /aria-hidden/);
  assert.match(ui, /DRAG_THRESHOLD/);
  assert.match(ui, /pointerdown/);
  assert.match(ui, /ArrowLeft/);
  assert.match(ui, /Escape/);
  assert.match(ui, /preloadAdjacent/);
  assert.match(ui, /NKNK 插画/);
  assert.match(css, /mask-image/);
  assert.match(css, /nknk-marquee/);
  assert.match(css, /scroll-snap-type/);
  assert.match(gen, /THUMB_WIDTH = 300/);
  assert.match(gen, /FULL_LONG_EDGE = 1080/);
  assert.match(gen, /metadata/);
});

function loadGalleryHelpers() {
  const context = vm.createContext({ window: {}, document: { addEventListener() {} } });
  vm.runInContext(fs.readFileSync("js/nknk-gallery-ui.js", "utf8"), context);
  return context.window.NKNKGalleryUI;
}

test("NKNK marquee: keyboard activation opens the lightbox while pointer clicks stay on pointerup", () => {
  const { isKeyboardActivation } = loadGalleryHelpers();
  assert.equal(isKeyboardActivation({ detail: 0 }), true, "Enter/Space click");
  assert.equal(isKeyboardActivation({ detail: 1 }), false, "mouse click");
  assert.equal(isKeyboardActivation({ detail: 2 }), false, "double click");
  assert.equal(isKeyboardActivation(undefined), false);
  const ui = fs.readFileSync("js/nknk-gallery-ui.js", "utf8");
  const click = ui.match(/track\.addEventListener\("click", \(event\) => \{([\s\S]*?)\n      \}\);/);
  assert.ok(click, "track click handler present");
  assert.match(click[1], /if \(!reduced && !isKeyboardActivation\(event\)\)/);
  assert.match(click[1], /openAt\(absoluteIndex\)/);
  // A cancelled pointer (page scroll gesture) must not count as a tap.
  assert.match(ui, /addEventListener\("pointercancel", event => onPointerUp\(event, true\)\)/);
  assert.match(ui, /const shouldClick = !cancelled && !moved && activeButton;/);
});

test("NKNK lightbox traps Tab focus, makes the page inert and restores focus on close", () => {
  const { focusTrapTarget } = loadGalleryHelpers();
  const [close, prev, next] = ["close", "prev", "next"];
  const controls = [close, prev, next];
  assert.equal(focusTrapTarget(controls, next, false), close, "Tab from last wraps to first");
  assert.equal(focusTrapTarget(controls, close, true), next, "Shift+Tab from first wraps to last");
  assert.equal(focusTrapTarget(controls, prev, false), null, "middle Tab moves normally");
  assert.equal(focusTrapTarget(controls, "outside", false), close, "focus outside returns to first");
  assert.equal(focusTrapTarget(controls, "outside", true), next);
  assert.equal(focusTrapTarget([], close, false), null);
  const ui = fs.readFileSync("js/nknk-gallery-ui.js", "utf8");
  assert.match(ui, /event\.key === "Tab"[\s\S]{0,300}focusTrapTarget\(focusables, document\.activeElement, event\.shiftKey\)/);
  assert.match(ui, /node\.inert = true/);
  assert.match(ui, /node\.inert = wasInert/);
  assert.match(ui, /previousFocus\?\.focus\?\.\(\{ preventScroll: true \}\)/);
  assert.match(ui, /image\.addEventListener\("error"/);
  assert.match(ui, /chromeLabel\("error"\)/);
});

test("NKNK marquee defers off-screen thumbs, reserves their slots and keeps one resize listener", () => {
  const { EAGER_THUMBS, THUMB_LOOKAHEAD_PX } = loadGalleryHelpers();
  assert.equal(EAGER_THUMBS, 15);
  assert.ok(THUMB_LOOKAHEAD_PX >= 1000, "thumbs must load well before they scroll into view");
  const ui = fs.readFileSync("js/nknk-gallery-ui.js", "utf8");
  assert.doesNotMatch(ui, /img\.src = item\.thumb;\n\s*img\.alt/, "thumbs must not all load eagerly");
  assert.match(ui, /img\.dataset\.src = item\.thumb/);
  assert.match(ui, /root: row\.viewport, rootMargin: `0px \$\{THUMB_LOOKAHEAD_PX\}px`/);
  assert.match(ui, /img\.style\.aspectRatio/);
  assert.equal((ui.match(/addEventListener\("resize"/g) || []).length, 1, "exactly one resize listener");
  const mount = ui.match(/const mount = \(\) => \{([\s\S]*?)\n    \};/)[1];
  assert.doesNotMatch(mount, /addEventListener\("resize"/, "mount() must not add resize listeners");
  assert.match(ui, /revealFocusedItem/);
  assert.match(ui, /viewport\.scrollLeft = 0/);

  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync("js/nknk-gallery.js", "utf8"), context);
  const gallery = vm.runInContext("NKNK_GALLERY", context);
  for (const item of gallery) {
    const data = fs.readFileSync(item.thumb);
    assert.equal(data.toString("ascii", 0, 4), "RIFF");
    const chunk = data.toString("ascii", 12, 16);
    let size;
    if (chunk === "VP8X") size = { w: 1 + data.readUIntLE(24, 3), h: 1 + data.readUIntLE(27, 3) };
    else if (chunk === "VP8 ") size = { w: data.readUInt16LE(26) & 0x3fff, h: data.readUInt16LE(28) & 0x3fff };
    else { const bits = data.readUInt32LE(21); size = { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) }; }
    assert.deepEqual({ w: item.w, h: item.h }, size, `thumb ${item.id} dimensions`);
  }
});
