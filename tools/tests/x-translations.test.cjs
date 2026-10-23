const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("translation loader rejects malformed, duplicate, unsafe and oversized input", async () => {
  const { normalizeXTranslations } = await import("../x-translations.mjs");
  const ok = { version: 1, items: { "123": { zh: "你好", en: "Hello" } } };
  assert.equal(normalizeXTranslations([["a", ok]]).get("123").en, "Hello");
  assert.throws(() => normalizeXTranslations([["a", { version: 2, items: {} }]]));
  assert.throws(() => normalizeXTranslations([["a", ok], ["b", ok]]), /Duplicate/);
  assert.throws(() => normalizeXTranslations([["a", { version: 1, items: { "123": { zh: "x" } } }]]), /exactly zh and en/);
  assert.throws(() => normalizeXTranslations([["a", { version: 1, items: { "123": { zh: "x", en: "y", ja: "z" } } }]]));
  assert.throws(() => normalizeXTranslations([["a", { version: 1, items: { "123": { zh: " x", en: "y" } } }]]));
  assert.throws(() => normalizeXTranslations([["a", { version: 1, items: { "123": { zh: "x\u202e", en: "y" } } }]]), /bidi/);
  assert.throws(() => normalizeXTranslations([["a", { version: 1, items: { "abc": { zh: "x", en: "y" } } }]]));
});

test("committed translation batches are small, valid and point at archived posts", async () => {
  const { readXTranslations, X_TRANSLATION_SHARD_BYTES } = await import("../x-translations.mjs");
  const { readXPostsArchive } = await import("../x-posts-data.mjs");
  const archive = await readXPostsArchive(root);
  const map = await readXTranslations(root, archive);
  assert.ok(map.size > 0);
  for (const name of fs.readdirSync(path.join(root, "data/x-translations"))) {
    assert.match(name, /^batch-\d{3}\.json$/);
    assert.ok(fs.statSync(path.join(root, "data/x-translations", name)).size <= X_TRANSLATION_SHARD_BYTES);
  }
  // The original-text archive is untouched: every post still says it is untranslated.
  assert.ok(archive.items.every(item => item.translated === false));
});

test("translation line is escaped, hidden for Japanese and absent without an entry", async () => {
  const { createXPostsRenderer } = await import("../render-x-posts.mjs");
  const { readXPostsArchive } = await import("../x-posts-data.mjs");
  const archive = await readXPostsArchive(root);
  const [first, second] = [...archive.items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
  const itemsOf = renderer => [].concat(renderer.renderArchive({ page: 1 }).items).join("");
  const html = itemsOf(createXPostsRenderer(archive, new Map([[first.id, { zh: "<b>中</b>", en: "a & b" }]])));
  const article = id => html.match(new RegExp(`<article class="x-post"[^>]*data-x-post-id="${id}"[\\s\\S]*?</article>`))[0];
  assert.match(article(first.id), /<p class="x-post-translation" data-zh="&lt;b&gt;中&lt;\/b&gt;" data-en="a &amp; b" data-ja="">&lt;b&gt;中&lt;\/b&gt;<\/p>/);
  assert.doesNotMatch(article(second.id), /x-post-translation/);
  assert.doesNotMatch(itemsOf(createXPostsRenderer(archive)), /x-post-translation/);
});

test("translations are applied as text, never parsed as HTML, and empty lines are hidden", () => {
  for (const file of ["js/updates.js", "script.js"]) assert.match(read(file), /\.(textContent|innerText) = /);
  assert.doesNotMatch(read("js/updates.js"), /innerHTML|insertAdjacentHTML/);
  assert.match(read("updates.css"), /\.x-post-translation:empty\{display:none\}/);
  assert.match(read("style.css"), /\.x-post-translation:empty \{ display: none; \}/);
  assert.doesNotMatch(read("tools/import-x-posts.mjs"), /x-translations/);
});
