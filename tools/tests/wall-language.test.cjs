const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const experience = fs.readFileSync("js/experience.js", "utf8");
const script = fs.readFileSync("script.js", "utf8");

test("a language switch lays out the message wall once, after the text is rewritten (audit C5)", () => {
  assert.match(experience, /window\.addEventListener\("languagechange", \(\) => updateWallMode\(\{ relayout: false \}\)\);/);
  assert.doesNotMatch(experience, /addEventListener\("languagechange", updateWallMode\)/);
  assert.match(experience, /if \(relayout\) document\.querySelectorAll\("\.floating-message"\)\.forEach\(element => element\.refreshLayout\(\)\);/);
  // applyLanguage keeps the single rewrite-then-measure pass.
  assert.match(script, /floatingMessages\.forEach\(\(element\) => element\.refreshLanguage\?\.\(true\)\);\s*floatingMessages\.forEach\(\(element\) => element\.refreshLayout\?\.\(\)\);/);
  // Motion and button changes still relayout (an event object leaves the default on).
  assert.match(experience, /reducedMotionQuery\.addEventListener\("change", updateWallMode\)/);
});
