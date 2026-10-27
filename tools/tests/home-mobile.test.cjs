const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function home(mobile = true, hash = "") {
  const pending = new Set();
  const events = {};
  const makeFold = id => {
    let open = true;
    const fold = {
      id, listeners: {}, child: { id: `${id}-content`, contains: () => false },
      contains(target) { return target === this || target === this.child; },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      get open() { return open; },
      set open(value) { if (open !== value) { open = value; pending.add(this); } }
    };
    return fold;
  };
  const folds = [makeFold("about"), makeFold("compose")];
  const targets = new Map(folds.flatMap(fold => [[fold.id, fold], [fold.child.id, fold.child]]));
  const media = { matches: mobile, addEventListener(type, handler) { this[type] = handler; } };
  const location = { hash };
  vm.runInNewContext(fs.readFileSync("js/home-mobile.js", "utf8"), {
    document: { querySelectorAll: () => folds, getElementById: id => targets.get(id) },
    window: { matchMedia: () => media, location, addEventListener(type, handler) { events[type] = handler; } }
  });
  const flush = () => { const toggles = [...pending]; pending.clear(); toggles.forEach(fold => fold.listeners.toggle?.()); };
  return { folds, media, location, events, flush };
}

test("phone disclosures start closed, remain readable when opened and preserve their state across desktop resize", () => {
  const app = home();
  app.flush();
  assert.ok(app.folds.every(fold => !fold.open));
  app.folds[0].open = true;
  // Deliberately resize before the browser dispatches its asynchronous native toggle.
  app.media.matches = false;
  app.media.change();
  app.flush();
  assert.ok(app.folds.every(fold => fold.open));
  app.media.matches = true;
  app.media.change();
  app.flush();
  assert.deepEqual(app.folds.map(fold => fold.open), [true, false]);
  app.folds[0].open = false;
  app.flush();
  app.media.matches = false;
  app.media.change();
  app.flush();
  app.media.matches = true;
  app.media.change();
  assert.ok(app.folds.every(fold => !fold.open), "a deliberately closed phone disclosure stays closed");
});

test("desktop disclosures stay expanded and first resize to phone compacts them", () => {
  const app = home(false);
  assert.ok(app.folds.every(fold => fold.open));
  app.media.matches = true;
  app.media.change();
  assert.ok(app.folds.every(fold => !fold.open));
});

test("direct and later anchors reveal their containing disclosure, ignoring malformed or missing targets", () => {
  const app = home(true, "#about-content");
  assert.deepEqual(app.folds.map(fold => fold.open), [true, false]);
  app.location.hash = "#compose-content";
  app.events.hashchange();
  assert.equal(app.folds[1].open, true);
  for (const hash of ["#%E0%A4%A", "#missing", ""]) {
    app.location.hash = hash;
    assert.doesNotThrow(() => app.events.hashchange());
  }
});
