const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = file => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");

// Pull a top-level function (and the tag alias table) out of script.js and run it for real, rather
// than asserting on the source text.
function scriptContext() {
  const source = read("script.js");
  // The table is one object literal plus a few later assignments, one per line.
  const aliasLines = source.split("\n").filter(line => line.startsWith("const TAG_ALIASES =") || line.startsWith("TAG_ALIASES["));
  assert.ok(aliasLines.length >= 2, "TAG_ALIASES must stay a top-level table");
  const grab = name => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start > 0, `${name} not found`);
    let depth = 0;
    for (let index = source.indexOf("{", start); index < source.length; index++) {
      if (source[index] === "{") depth++;
      else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`${name} is unbalanced`);
  };
  const context = {};
  vm.runInNewContext(`${aliasLines.join("\n")}\n${grab("normalizeTag")}\n${grab("parseTagQuery")}\nthis.parseTagQuery = parseTagQuery;`, context);
  return context;
}

test("a full-width ＋ marks a required search term, like the ASCII plus", () => {
  const { parseTagQuery } = scriptContext();
  // The function answers from another vm realm, so copy its result into this one before comparing.
  const query = value => JSON.parse(JSON.stringify(parseTagQuery(value)));
  for (const plus of ["+", "\uFF0B"]) {
    assert.deepEqual(query(`${plus}歌愛`), { plain: [], required: ["歌愛"] }, `plus ${JSON.stringify(plus)}`);
  }
  assert.deepEqual(query("歌愛, \uFF0Bラグ"), { plain: ["歌愛"], required: ["ラグ"] });
  // Both comma styles separate terms; the ideographic comma is not a separator in this syntax.
  assert.deepEqual(query("\uFF0B歌愛，\uFF0Bラグ"), { plain: [], required: ["歌愛", "ラグ"] });
  assert.deepEqual(query(""), { plain: [], required: [] });
});

test("another tab's language or theme change is followed instead of drifting apart", () => {
  const script = read("script.js");
  assert.match(script, /window\.addEventListener\?\.\("storage", \(event\) => \{/);
  assert.match(script, /if \(event\.key === "language" \|\| event\.key === null\)/);
  assert.match(script, /if \(event\.key === "theme" \|\| event\.key === null\)/);
  assert.match(script, /currentLanguage = nextLanguage;/);
  assert.match(script, /currentTheme = nextTheme;/);
  // The reading position is restored, so a switch does not jump the reader to another section.
  assert.match(script, /const restoreReadingPosition = captureReadingPosition\(\);/);

  // The static reading mode lives in the library script and must follow as well.
  const experience = read("js/experience.js");
  const listener = experience.slice(experience.indexOf('window.addEventListener("storage"'), experience.indexOf('sort.addEventListener("change"'));
  assert.match(listener, /event\.key === "favorite-songs" \|\| event\.key === null/);
  assert.match(listener, /event\.key === "wall-static" \|\| event\.key === null/);
  assert.match(listener, /wallStatic = nextStatic;/);
  assert.match(listener, /updateWallMode\(\);/);

  // The tag input helper strips whichever plus the reader typed.
  assert.match(script, /part\.replace\(\/\^\[\+＋\]\/u, ""\)/);
});

test("a refused delete keeps the message, a lost session drops the stale list", () => {
  const comments = read("js/comments.js");
  const personal = comments.slice(comments.indexOf("async function remove(id) {"), comments.indexOf('document.addEventListener("DOMContentLoaded"'));
  const guard = personal.slice(personal.indexOf("response.status === 401 || response.status === 403"));
  // The panel belongs to whichever load is current: a late answer must not hide a newer one.
  assert.match(guard, /if \(current === version\) \{/);
  assert.match(guard, /if \(response\.status === 401\) \{/);
  assert.ok(guard.indexOf("comments.clear()") < guard.indexOf("state = \"signedOut\""), "the stale list is dropped before the signed-out state");
  assert.match(guard, /document\.getElementById\("my-comments-controls"\)\.hidden = true;/);
  // 403 is a refused request (for example someone else's message), not a dead session.
  const clearing = guard.slice(guard.indexOf("if (response.status === 401) {"), guard.indexOf("document.getElementById"));
  assert.doesNotMatch(clearing, /403/);

  const load = comments.slice(comments.indexOf("async function load(more = false) {"));
  assert.match(load.slice(0, load.indexOf("if (!response.ok)")), /if \(response\.status === 401\) \{\n\s+comments\.clear\(\);/);
});

test("the iOS overflow fallback covers the reader's own comment list and the static wall", () => {
  const css = read("style.css");
  const block = css.slice(css.indexOf("@supports not (overflow-wrap: anywhere)"));
  const list = block.slice(0, block.indexOf("overflow-wrap: break-word"));
  for (const selector of ["#admin-comments-list p", "#my-comments-list p", ".wall-static .floating-message"]) {
    assert.ok(list.includes(selector), `${selector} must be in the fallback list`);
  }
});
