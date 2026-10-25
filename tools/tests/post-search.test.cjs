const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../../js/post-search-core.js");

const repo = path.resolve(__dirname, "../..");
const record = (id, creator, at, text, zh = "", en = "") => [id, creator, at, text, zh, en];

test("folding ignores width, case, kana type and spacing", () => {
  assert.equal(core.foldText("ﾛｽﾄ アンブレラ ＡＢＣ ｶﾞ"), "ろすとあんぶれらabcが");
  assert.equal(core.foldText("LAGTRAIN"), core.foldText("ｌａｇｔｒａｉｎ"));
  assert.equal(core.foldText("ラグトレイン"), core.foldText("らぐとれいん"));
});

test("highlights map back onto the original characters, including spaced-out titles", () => {
  const source = "新曲『 ロ ス ト ア ン ブ レ ラ 』です";
  const folded = core.fold(source);
  const ranges = core.findRanges(folded, core.terms("ロストアンブレラ"));
  assert.ok(ranges);
  const marked = core.segments(source, ranges).filter(piece => piece.mark).map(piece => piece.text).join("");
  assert.equal(marked.replace(/\s/gu, ""), "ロストアンブレラ");
  assert.equal(core.findRanges(core.fold("abc"), core.terms("abc xyz")), null, "every term must match");
});

test("search filters by author and Japan-time year and reports which field matched", () => {
  const posts = core.prepare([
    record("1", 0, "2020-07-16T11:05:00.000Z", "ラグトレイン 投稿しました", "发布了 Lagtrain", "Posted Lagtrain"),
    record("2", 1, "2019-12-31T16:00:00.000Z", "イラスト描きました", "画了插画", "Drew an illustration"),
    record("3", 0, "2018-02-27T13:00:00.000Z", "こんばんは", "晚上好", "")
  ]);
  const zh = core.search(posts, "插画");
  assert.deepEqual(zh.map(result => [result.post.id, result.fields]), [["2", ["zh"]]]);
  assert.deepEqual(core.search(posts, "lagtrain").map(result => result.fields), [["zh", "en"]]);
  assert.deepEqual(core.search(posts, "らぐとれいん").map(result => result.fields), [["text"]]);
  assert.equal(core.search(posts, "イラスト", { creator: "inabakumori" }).length, 0);
  assert.equal(core.search(posts, "イラスト", { creator: "nknk", year: "2020" }).length, 1, "2019-12-31T16:00Z is 2020 in Japan");
  assert.equal(core.search(posts, "イラスト", { year: "2019" }).length, 0);
  assert.deepEqual(core.search(posts, "   "), []);
});

test("the index covers every post in small year chunks built from the data, not by hand", async () => {
  const { buildPostSearchIndex, POST_SEARCH_CHUNK_LIMIT } = await import("../post-search-index.mjs");
  const { readXPostsArchive } = await import("../x-posts-data.mjs");
  const { readXTranslations } = await import("../x-translations.mjs");
  const archive = await readXPostsArchive(repo);
  const translations = await readXTranslations(repo, archive);
  const { manifest, files, totalBytes } = buildPostSearchIndex(archive, translations);
  assert.equal(manifest.count, archive.items.length);
  assert.equal(manifest.translated, archive.items.filter(post => translations.has(post.id)).length);
  let count = 0;
  for (const entry of manifest.years) {
    assert.match(entry.file, /^posts-\d{4}-[a-f0-9]{12}\.json$/u);
    const body = files.get(entry.file);
    assert.ok(Buffer.byteLength(body) < POST_SEARCH_CHUNK_LIMIT);
    count += JSON.parse(body).records.length;
  }
  assert.equal(count, archive.items.length);
  assert.ok(totalBytes < 4 * 1024 * 1024, `search index grew to ${totalBytes} bytes`);
  // A new translation batch changes the content hash, so browsers never keep a stale chunk.
  const first = manifest.years.at(-1);
  const extra = new Map(translations);
  const post = archive.items.find(item => buildPostSearchIndex({ version: 1, items: [item] }).manifest.years[0].year === first.year);
  extra.set(post.id, { zh: "新增译文", en: "new translation" });
  assert.notEqual(buildPostSearchIndex(archive, extra).manifest.years.at(-1).file, first.file);
});

test("search and archive scripts build results with text nodes only", () => {
  for (const file of ["js/post-search-core.js", "js/archive-pages.js", "js/updates.js"]) {
    const source = fs.readFileSync(path.join(repo, file), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/u, file);
  }
  const pages = fs.readFileSync(path.join(repo, "js/archive-pages.js"), "utf8");
  assert.match(pages, /credentials: "omit"/u, "index requests carry no cookies");
  assert.match(pages, /textContent/u);
});
