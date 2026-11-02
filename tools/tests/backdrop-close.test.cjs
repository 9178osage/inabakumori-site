const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const script = fs.readFileSync("script.js", "utf8");
const gallery = fs.readFileSync("js/nknk-gallery-ui.js", "utf8");

function fakeBackdrop() {
  const listeners = {};
  return {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type, target) { for (const fn of listeners[type] || []) fn({ type, target }); },
  };
}

function loadHelper() {
  const source = script.match(/function onBackdropClick\(backdrop, handler\) \{[\s\S]*?\n\}\n/)[0];
  const context = {};
  vm.runInNewContext(`${source}; this.onBackdropClick = onBackdropClick;`, context);
  return context.onBackdropClick;
}

test("backdrop closes only when pointerdown and click both land on it", () => {
  const onBackdropClick = loadHelper();
  const backdrop = fakeBackdrop();
  const dialog = {};
  let closes = 0;
  onBackdropClick(backdrop, () => { closes += 1; });

  backdrop.fire("pointerdown", dialog); backdrop.fire("click", backdrop);
  assert.equal(closes, 0, "drag from dialog to backdrop keeps it open");
  backdrop.fire("pointerdown", backdrop); backdrop.fire("click", dialog);
  assert.equal(closes, 0, "press on backdrop, release in dialog keeps it open");
  backdrop.fire("click", backdrop);
  assert.equal(closes, 0, "a click with no press on the backdrop (e.g. after opening) keeps it open");
  backdrop.fire("pointerdown", backdrop); backdrop.fire("click", backdrop);
  assert.equal(closes, 1, "a real backdrop click closes");
  backdrop.fire("click", backdrop);
  assert.equal(closes, 1, "press state is consumed by one click");
});

test("auth modal, easter egg and lightbox all use the press-and-click backdrop rule", () => {
  assert.match(script, /onBackdropClick\(authModal, /);
  assert.match(script, /onBackdropClick\(overlay, \(\) => \{\s*if \(Date\.now\(\) < easterEggIgnoreBackdropUntil\) return;\s*closeEasterEgg\(\);/);
  assert.doesNotMatch(script, /overlay\.addEventListener\("click"/);
  assert.match(gallery, /lightbox\.addEventListener\("pointerdown", \(event\) => \{ pressedOnBackdrop = event\.target === lightbox; \}\)/);
  assert.match(gallery, /if \(!pressed\) return;[\s\S]{0,400}if \(event\.target === lightbox\) closeLightbox\(\);/);
});

test("easter egg ignores backdrop clicks briefly after opening, like the gallery lightbox (audit A2)", () => {
  assert.match(script, /const EASTER_EGG_BACKDROP_GRACE_MS = (\d+);/);
  const ms = Number(script.match(/const EASTER_EGG_BACKDROP_GRACE_MS = (\d+);/)[1]);
  assert.ok(ms >= 500 && ms <= 1000, "window covers a few extra quick taps without feeling stuck");
  const show = script.match(/function showEasterEgg\(\) \{[\s\S]*?\n\}\n/)[0];
  assert.match(show, /easterEggIgnoreBackdropUntil = Date\.now\(\) \+ EASTER_EGG_BACKDROP_GRACE_MS;/);
  const close = script.match(/function closeEasterEgg\(\) \{[\s\S]*?\n\}\n/)[0];
  assert.doesNotMatch(close, /easterEggIgnoreBackdropUntil/, "Escape and the close button are not delayed");
});
