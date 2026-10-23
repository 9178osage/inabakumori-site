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

// English titles a gist may use: the artist's own English (seen in their posts) or the site's album names.
// Any other song is named by its Japanese title from js/songs.js, never a made-up romanization.
const ENGLISH_TITLES = {
  "ロストアンブレラ": "Lost Umbrella", "ラグトレイン": "Lagtrain", "電気予報": "Denki Yohou", "リレイアウター": "Relayouter",
  "レイニーブーツ": "Rainy Boots", "ハルノ寂寞": "Haru no Sekibaku", "アンチサイクロン": "ANTICYCLONE", "ウェザーステーション": "WEATHER STATION",
  "たびのまえ、たびのあと (tabitabi Remix)": "Journey's Prequels, Journey's Traces (tabitabi Remix)"
};
const SHORT_FORMS = { "WEATHER STATION": ["ウェザステ"] };
const KNOWN_WRONG = ["Zettai Ansei", "Yureru", "Spotlight", "Eye Pace", "Hadal Zone", "Harunanshiki’", "I'm the Rain", "Kitai Doori", "Float Play", "Yoyuu Yoku", "Kimi ni Kaikisen", "Weather Station", "Kazehiki"];

test("translations name songs by their real titles and never swap one song for another", async () => {
  const { readXTranslations } = await import("../x-translations.mjs");
  const { readXPostsArchive } = await import("../x-posts-data.mjs");
  const archive = await readXPostsArchive(root);
  const text = new Map(archive.items.map(item => [item.id, item.text]));
  const songs = [...read("js/songs.js").matchAll(/"title": "([^"]+)"/g)].map(match => match[1]);
  for (const [id, { zh, en }] of await readXTranslations(root, archive)) {
    const source = text.get(id).toLowerCase();
    for (const wrong of KNOWN_WRONG) assert.ok(!en.includes(wrong), `${id}: “${wrong}” is not an official title`);
    for (const [ja, english] of Object.entries(ENGLISH_TITLES)) {
      if (en.includes(english)) assert.ok(source.includes(ja.toLowerCase()) || source.includes(english.toLowerCase()) || (SHORT_FORMS[english] ?? []).some(short => source.includes(short)), `${id}: mentions ${english} but the post does not`);
    }
    for (const title of songs) {
      if (!source.includes(`『${title.toLowerCase()}』`)) continue;
      assert.ok(zh.includes(title), `${id}: zh should keep 《${title}》`);
      assert.ok(en.includes(title) || en.includes(ENGLISH_TITLES[title] ?? "\u0000"), `${id}: en should name ${title}`);
    }
  }
});
