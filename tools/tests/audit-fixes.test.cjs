const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const read = file => fs.readFileSync(file, "utf8");

test("tag lookup maps have no prototype, so searching for constructor or __proto__ finds nothing", () => {
  const script = read("script.js");
  for (const name of ["TAG_ALIASES", "TAG_DISPLAY_NAMES"]) {
    const source = script.match(new RegExp(`const ${name} = (Object\\.assign\\(Object\\.create\\(null\\), \\{[^\\n]*\\}\\));`, "u"))?.[1];
    assert.ok(source, name);
    const map = vm.runInNewContext(`(${source})`);
    assert.equal(Object.getPrototypeOf(map), null, name);
    assert.equal(map.constructor, undefined, name);
  }
});

test("reading position also works on extensionless archive URLs", () => {
  assert.match(read("js/updates.js"), /const page = lastSegment\.endsWith\("\.html"\) \? lastSegment : `\$\{lastSegment\}\.html`;/u);
});

test("pages follow OS theme changes and re-read preferences after a bfcache restore", () => {
  const script = read("script.js");
  assert.match(script, /systemDarkQuery\.addEventListener\("change", resyncThemeFromPreferences\)/u);
  assert.match(script, /addEventListener\?\.\("pageshow", event => \{\s*if \(!event\.persisted\) return;\s*resyncThemeFromPreferences\(\);/u);
  for (const file of ["js/calendar.js", "js/archive-pages.js"]) {
    const source = read(file);
    assert.match(source, /systemTheme\.addEventListener\("change", applyTheme\)/u, file);
    assert.match(source, /else systemTheme\?\.addListener\?\.\(applyTheme\)/u, file);
    assert.match(source, /addEventListener\("pageshow", event => \{ if \(event\.persisted\) \{ language = readLanguage\(\); applyLanguage\(\); \} \}\)/u, file);
  }
});

test("hash-only history steps do not overwrite an unsynced library search", () => {
  const source = read("js/experience.js");
  assert.match(source, /if \(appliedSearch !== null && window\.location\.search === appliedSearch\) return;/u);
  assert.match(source, /appliedSearch = window\.location\.search;\s*\}/u, "syncUrl records what it wrote");
});

test("a reload while the lightbox was open drops the stale history marker", () => {
  assert.match(read("js/nknk-gallery-ui.js"), /if \(history\.state\?\.nknkLightbox\) \{\s*const rest = \{ \.\.\.history\.state \};\s*(?:delete rest\.nknkLightboxIndex;\s*)?delete rest\.nknkLightbox;\s*history\.replaceState/u);
});

test("MediaQueryList listeners fall back to addListener and dvh has a vh fallback", () => {
  for (const file of ["script.js", "js/experience.js"]) {
    const bare = read(file).match(/^\s*\w+Query\?\.addEventListener\("change"/gmu);
    assert.equal(bare, null, `${file}: unguarded MediaQueryList.addEventListener`);
  }
  const css = read("style.css");
  for (const match of css.matchAll(/^(\s*)max-height: ([^;]*?)dvh([^;]*);$/gmu)) {
    if (match[2].includes("var(")) continue;
    const before = css.slice(0, match.index).trimEnd().split("\n").pop().trim();
    assert.equal(before, `max-height: ${match[2]}vh${match[3]};`, `missing vh fallback before ${match[0].trim()}`);
  }
});

test("the lightbox allows pinch zoom and ignores multi-touch or zoomed swipes", () => {
  assert.match(read("style.css"), /\.nknk-lightbox-image \{[^}]*touch-action: pan-y pinch-zoom;/u);
  const gallery = read("js/nknk-gallery-ui.js");
  assert.match(gallery, /if \(event\.touches\.length !== 1\) \{ touchStartX = null; return; \}/u);
  assert.match(gallery, /touchStartX === null \|\| event\.touches\.length !== 0/u);
  assert.match(gallery, /visualViewport\?\.scale \|\| 1\) > 1\.01\) \{ touchStartX = null; return; \}/u);
});

test("the visual-viewport height is not overwritten while the page is pinch-zoomed", () => {
  assert.match(read("script.js"), /function syncVisualViewportHeight\(\) \{[^}]*visualViewport\?\.scale \|\| 1\) > 1\.01\) return;/u);
});

test("every workflow job is time-boxed and only pushing jobs keep checkout credentials", () => {
  const dir = ".github/workflows";
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith(".yml"))) {
    const source = read(`${dir}/${file}`);
    const jobs = source.slice(source.indexOf("\njobs:\n")).split(/\n(?=  [a-z][\w-]*:\n)/u).slice(1);
    assert.ok(jobs.length, file);
    for (const job of jobs) {
      const name = job.match(/^  ([\w-]+):/u)[1];
      assert.match(job, /\n    timeout-minutes: \d+\n/u, `${file}: ${name} needs timeout-minutes`);
      if (!job.includes("actions/checkout@") || /git push /u.test(job)) continue;
      assert.match(job, /actions\/checkout@[^\n]*\n        with:\n(?:          [^\n]*\n)*?          persist-credentials: false\n/u, `${file}: ${name} must not persist credentials`);
    }
  }
});

test("published PNGs carry no text metadata (editor XMP, screen-capture window titles)", () => {
  const { execFileSync } = require("node:child_process");
  for (const file of execFileSync("git", ["ls-files", "-z", "*.png"], { encoding: "utf8" }).split("\0").filter(Boolean)) {
    const data = fs.readFileSync(file);
    for (let offset = 8; offset < data.length;) {
      const length = data.readUInt32BE(offset);
      const type = data.toString("latin1", offset + 4, offset + 8);
      assert.ok(!["tEXt", "iTXt", "zTXt"].includes(type), `${file}: ${type} chunk`);
      offset += length + 12;
    }
  }
});
