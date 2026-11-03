const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const fonts = read("fonts/fonts.css");

function declarations(css, selector) {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)];
  const matched = rules.filter(([, selectors]) => selectors.replace(/\/\*[\s\S]*?\*\//gu, "").trim().split(/\s*,\s*/u).includes(selector));
  assert.ok(matched.length, `Missing typography rule for ${selector}`);
  return Object.fromEntries(matched.flatMap(([, , body]) => [...body.matchAll(/([\w-]+)\s*:\s*([^;{}]+)(?:;|$)/gu)].map(([, property, value]) => [property, value.trim()])));
}

test("station typography uses a bounded rem scale and medium headings without downloading fonts", () => {
  const tokens = declarations(fonts, ":root");
  assert.equal(tokens["--type-weight-body"], "400");
  assert.equal(tokens["--type-weight-heading"], "500");
  assert.equal(tokens["--type-weight-ui"], "500");
  for (const role of ["hero", "page", "section"]) {
    assert.match(tokens[`--type-size-${role}`], /^clamp\([\d.]+rem,\s*[\d.]+rem \+ [\d.]+vw,\s*[\d.]+rem\)$/u);
  }
  assert.equal(tokens["--type-size-body"], "1rem");
  assert.equal(tokens["--type-size-small"], ".875rem");
  assert.equal(tokens["--type-size-meta"], ".75rem");
  assert.doesNotMatch(fonts, /@font-face|@import|url\(/iu);
});

test("language-scoped font roles stay unified while CJK and English keep their own reading rhythm", () => {
  assert.match(declarations(fonts, ":lang(zh)")["--site-font"], /^-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC"/u,
    "native UI numerals precede PingFang, whose digits do not support tabular widths");
  for (const [language, family, leading] of [
    ["zh", "PingFang SC", "1.85"],
    ["ja", "Hiragino Kaku Gothic ProN", "1.85"],
    ["en", "-apple-system", "1.75"]
  ]) {
    const rule = declarations(fonts, `:lang(${language})`);
    assert.ok(rule["--site-font"].includes(family), language);
    for (const role of ["body", "heading", "title", "song", "data"]) {
      assert.equal(rule[`--font-${role}`], "var(--site-font)", `${language}: ${role}`);
    }
    assert.equal(rule["--type-body-leading"], leading);
    assert.equal(rule["font-family"], "var(--site-font)");
    assert.match(rule["--type-display-space"], /^[\d.]+em$/u);
  }
});

test("all page families apply the shared hierarchy and readable original and translated text", () => {
  const home = read("style.css"), archive = read("archive.css"), updates = read("updates.css"), calendar = read("calendar.css");
  assert.equal(declarations(home, ".hero-content h1")["font-size"], "var(--type-size-hero)");
  assert.equal(declarations(home, ".hero-content h1")["font-weight"], "var(--type-weight-heading)");
  assert.equal(declarations(home, ".home-page .home-updates .x-post-text")["font-size"], "var(--type-size-body)");
  assert.equal(declarations(home, ".home-page .home-updates .x-post-translation")["font-size"], "var(--type-size-small)");
  assert.equal(declarations(updates, ".updates-intro h1")["font-size"], "var(--type-size-page)");
  assert.equal(declarations(updates, ".x-post-text")["font-size"], "var(--type-size-body)");
  assert.equal(declarations(updates, ".x-post-translation")["font-size"], "var(--type-size-small)");
  assert.equal(declarations(archive, ".song-title")["font-weight"], "var(--type-weight-heading)");
  assert.equal(declarations(archive, ".song-fact dd")["font-size"], "var(--type-size-body)");
  assert.equal(declarations(calendar, ".calendar-heading")["font-weight"], "var(--type-weight-heading)");
  assert.equal(declarations(calendar, ".calendar-days")["font-weight"], "var(--type-weight-body)");
});

test("observation numbers align within the system font instead of switching to a monospaced family", () => {
  for (const [file, selector] of [
    ["fonts/fonts.css", "time"],
    ["style.css", ".song-views"],
    ["style.css", "#message-counter"],
    ["updates.css", ".update-index"],
    ["updates.css", ".updates-count"],
    ["archive.css", ".song-index-list"],
    ["calendar.css", ".calendar-days"],
    ["calendar.css", ".calendar-date"]
  ]) {
    assert.equal(declarations(read(file), selector)["font-variant-numeric"], "lining-nums tabular-nums", `${file}: ${selector}`);
  }
});
