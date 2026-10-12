const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test(":hover styles only apply on hover-capable pointers (no sticky hover after a tap)", () => {
  const css = read("style.css").replace(/\/\*[\s\S]*?\*\//g, "");
  // Track the chain of enclosing block heads; any rule selector with :hover needs an @media (hover: hover) ancestor.
  const stack = [], bad = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      const head = css.slice(start, i).trim();
      if (!head.startsWith("@") && head.includes(":hover") && !stack.some(h => /^@media[^{]*hover:\s*hover/.test(h))) bad.push(head);
      stack.push(head); start = i + 1;
    } else if (ch === "}") { stack.pop(); start = i + 1; }
    else if (ch === ";") start = i + 1;
  }
  assert.deepStrictEqual(bad, []);
  assert.match(css, /@media \(hover: none\)\s*\{[^}]*:active/);
});

test("mobile section width keeps clear of landscape safe-area insets", () => {
  const css = read("style.css");
  assert.ok(!/#songs \{ width: calc\(100% - 36px\); \}/.test(css));
  assert.match(css, /#songs \{ width: calc\(100% - 36px - env\(safe-area-inset-left\) - env\(safe-area-inset-right\)\); \}/);
  assert.match(css, /button, select, a \{ touch-action: manipulation; \}/);
});

test("active section link is scrolled into the narrow nav strip", () => {
  const js = read("js/experience.js");
  assert.match(js, /nav\.scrollWidth > nav\.clientWidth \+ 1/);
  assert.match(js, /nav\.scrollLeft \+=/);
});

test("auth modal restores the page position on close (UI only)", () => {
  const src = read("tools/auth-src.js");
  assert.match(src, /authScrollY = typeof window !== "undefined" \? window\.scrollY : null;/);
  assert.match(src, /window\.scrollTo\?\.\(\{ top: authScrollY, behavior: "instant" \}\)/);
  assert.match(read("js/auth.js"), /authScrollY|scrollTo/);
});

test("social icons are small (<= 256px, < 40 KB)", () => {
  for (const name of ["X", "instagram", "tiktok", "pixiv", "wikipedia", "youtube", "bilibili", "niconico", "fandom"]) {
    const data = fs.readFileSync(path.join(root, "images", `${name}.png`));
    const w = data.readUInt32BE(16), h = data.readUInt32BE(20);
    assert.ok(w <= 256 && h <= 256, `${name}.png is ${w}x${h}`);
    assert.ok(data.length < 40 * 1024, `${name}.png is ${data.length} bytes`);
  }
});
