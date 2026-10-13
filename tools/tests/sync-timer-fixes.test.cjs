const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = file => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");

test("auth-sync storage handler refreshes the UI but never writes auth-sync (no tab ping-pong)", () => {
  const src = read("tools/auth-src.js");
  const handler = src.match(/window\.addEventListener\("storage", event => \{[\s\S]*?\n\}\);/)[0];
  assert.doesNotMatch(handler, /notifyAuthChange|setItem/);
  const writes = [], events = [];
  let updates = 0, listener;
  const storage = { setItem: (key, value) => writes.push([key, value]), getItem: () => null };
  const context = {
    Event: class { constructor(type) { this.type = type; } },
    updateAuthButton: () => { updates++; },
    notifyAuthChange: () => storage.setItem("auth-sync", String(Date.now())),
    window: { siteStorage: storage, addEventListener: (type, fn) => { if (type === "storage") listener = fn; }, dispatchEvent: e => events.push(e.type) }
  };
  vm.runInNewContext(handler, context);
  listener({ key: "auth-sync", newValue: "1" });
  listener({ key: "other", newValue: "x" });
  assert.equal(updates, 1);
  assert.deepEqual(events, ["authchange"]);
  assert.deepEqual(writes, [], "receiving tab must not write auth-sync back");
  // The sending side still notifies other tabs after sign-in/out.
  assert.ok((src.match(/notifyAuthChange\(\);/g) || []).length >= 3);
});

test("the built js/auth.js carries the non-echoing handler", () => {
  const bundle = read("js/auth.js");
  const handler = bundle.match(/addEventListener\("storage",\w+=>\{\w+\.key==="auth-sync"&&\((\w+)\(\),(.*?)\)\}\)/);
  assert.ok(handler, "auth-sync storage handler present in bundle");
  assert.equal(handler[2], 'window.dispatchEvent(new Event("authchange"))', "only updateAuthButton() and the authchange event");
});

test("gallery thumb timer stops once every thumb is fetched", () => {
  const ui = read("js/nknk-gallery-ui.js");
  assert.match(ui, /const hasPendingThumbs = \(\) => rows\.some\(row => row\.track\.querySelector\("img\[data-src\]"\)\);/);
  assert.match(ui, /if \(thumbLoadTimer !== null \|\| !hasPendingThumbs\(\)\) return;/);
  assert.match(ui, /if \(!hasPendingThumbs\(\)\) stopThumbLoadTimer\(\);/);
  assert.match(ui, /mounted = false;\n\s*stopThumbLoadTimer\(\);/, "rebuild teardown stops it too");
});

test("message textarea has no enterkeyhint=send (Enter makes a new line); nickname keeps it", () => {
  const html = read("index.html");
  assert.doesNotMatch(html.match(/<textarea[^>]*id="message-input"[^>]*>/)[0], /enterkeyhint/);
  assert.match(html.match(/<input id="message-name"[^>]*>/)[0], /enterkeyhint="send"/);
});
