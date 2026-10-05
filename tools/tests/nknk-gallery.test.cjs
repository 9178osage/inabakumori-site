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
  gallery.forEach((item, index) => {
    assert.equal(item.id, index + 1);
    assert.match(item.thumb, /^images\/optimized\/nknk\/\d+\.webp$/);
    assert.match(item.full, /^images\/optimized\/nknk\/full\/\d+\.webp$/);
    assert.ok(fs.existsSync(item.thumb), item.thumb);
    assert.ok(fs.existsSync(item.full), item.full);
    const stem = path.basename(item.thumb, ".webp");
    assert.equal(stem, String(item.id));
    const originals = [".jpg", ".jpeg", ".png", ".webp", ".gif"].map((ext) => path.join("NKNK", `${item.id}${ext}`));
    assert.ok(originals.some((file) => fs.existsSync(file)), `missing original for ${item.id}`);
  });
});

test("NKNK gallery markup and UI avoid inline handlers", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const ui = fs.readFileSync("js/nknk-gallery-ui.js", "utf8");
  assert.match(html, /id="nknk-gallery"/);
  assert.match(html, /id="nknk-lightbox"/);
  assert.match(html, /js\/nknk-gallery\.js/);
  assert.match(html, /js\/nknk-gallery-ui\.js/);
  assert.doesNotMatch(html, /onclick=/);
  assert.doesNotMatch(ui, /\bonclick\b|\bstyle\s*=/);
  assert.match(ui, /ArrowLeft/);
  assert.match(ui, /Escape/);
  assert.match(ui, /touchstart/);
  assert.match(ui, /NKNK 插画/);
});
