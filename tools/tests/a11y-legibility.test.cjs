const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const js = fs.readFileSync(path.join(root, "script.js"), "utf8");

test("site controls are a labelled region landmark", () => {
  assert.match(html, /<div class="site-controls" role="region" aria-label="页面设置">/);
  assert.match(js, /\.site-controls"\)\?\.setAttribute\("aria-label", currentLanguage === "ja" \? "ページ設定" : currentLanguage === "en" \? "Page controls" : "页面设置"\)/);
});

test("song view counts never drop below 12px", () => {
  for (const m of css.matchAll(/\.song-views\s*\{[^}]*?font-size:\s*(\d+(?:\.\d+)?)px/g)) {
    assert.ok(Number(m[1]) >= 12, `.song-views font-size ${m[1]}px`);
  }
  assert.doesNotMatch(css, /\.song-views\s*\{\s*font-size:\s*10px/);
});
