const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

function post(id, creator, publishedAt, content = "原文  （⩌  ̫ ⩌ ）\n次の行") {
  const handle = creator === "nknk" ? "NKNK_NGRMS" : "inabakumori";
  return { id, creator, handle, url: `https://x.com/${handle}/status/${id}`, text: content, translated: false,
    publishedAt, collectedAt: "2026-10-18T18:36:00.000Z", links: [], media: [], relatedUrls: [], hasVideo: false };
}

function snapshot(coverage = []) {
  return { version: 1, coverage, items: [
    post("2030297425525854218", "inabakumori", "2026-03-07T15:00:02.000Z"),
    post("2025511042638659653", "inabakumori", "2026-02-22T10:00:39.000Z"),
    post("2090365218857848882", "nknk", "2026-08-20T06:00:00.000Z")
  ] };
}

test("home and archive show each creator's saved count and date range in JST", async () => {
  const { renderXPostsHome, renderXPostsArchive } = await import("../render-x-posts.mjs");
  const archive = snapshot();
  for (const html of [renderXPostsHome(archive), renderXPostsArchive(archive).status]) {
    assert.match(html, /稲葉曇：已收录 2 条 · 发布日期范围 2026-02-22 至 2026-03-08（JST）/u);
    assert.match(html, /NKNK：已收录 1 条 · 发布日期范围 2026-08-20 至 2026-08-20（JST）/u);
    assert.match(html, /data-en="稲葉曇: 2 collected · Post date range 2026-02-22 to 2026-03-08 \(JST\)"/u);
    assert.match(html, /data-ja="NKNK：収録1件 · 投稿日の範囲 2026-08-20〜2026-08-20（JST）"/u);
    assert.match(html, /全量历史、回复与转发仍未完整收录/u);
    assert.match(html, /不代表区间内每条都已收录/u);
  }
});

test("stale scan summaries cannot inflate the saved count or extend its dates", async () => {
  const { renderXPostsArchive } = await import("../render-x-posts.mjs");
  const archive = snapshot([{ creator: "inabakumori", count: 999, oldestAt: "2014-01-01T00:00:00.000Z", newestAt: "2026-10-18T18:36:00.000Z", note: '<img src=x onerror="alert(1)">' }]);
  const html = renderXPostsArchive(archive, { creator: "inabakumori" }).status;
  assert.match(html, /稲葉曇：已收录 2 条 · 发布日期范围 2026-02-22 至 2026-03-08/u);
  assert.doesNotMatch(html, /999|2014-01-01|<img|onerror/u);
});

test("empty archives keep both creators and an explicit unknown date range", async () => {
  const { renderXPostsHome, renderXPostsArchive } = await import("../render-x-posts.mjs");
  for (const html of [renderXPostsHome({ version: 1, coverage: [], items: [] }), renderXPostsArchive({ version: 1, coverage: [], items: [] }).status]) {
    assert.match(html, /稲葉曇：已收录 0 条 · 尚无可确认的发布日期范围/u);
    assert.match(html, /NKNK：已收录 0 条 · 尚无可确认的发布日期范围/u);
    assert.doesNotMatch(html, /Invalid Date|undefined|null/u);
  }
});

test("original text keeps whitespace and is escaped before insertion", async () => {
  const { renderXPostsArchive } = await import("../render-x-posts.mjs");
  const content = "  （⩌  ̫ ⩌ ）\n<script>alert(1)</script>";
  const archive = snapshot();
  archive.items[0].text = content;
  const html = renderXPostsArchive(archive).items;
  assert.ok(html.includes("  （⩌  ̫ ⩌ ）\n&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.doesNotMatch(html, /<script>/u);
  const homeCss = fs.readFileSync("style.css", "utf8");
  const archiveCss = fs.readFileSync("updates.css", "utf8");
  assert.match(homeCss, /\.home-updates \.x-post-text \{[^}]*white-space: pre-wrap;/u);
  assert.match(archiveCss, /\.x-post-text\{[^}]*white-space:pre-wrap;/u);
});

test("one build snapshot keeps ordering, author filters and pagination independent", async () => {
  const { createXPostsRenderer } = await import("../render-x-posts.mjs");
  const archive = { version: 1, items: [
    post("101", "inabakumori", "2026-03-01T00:00:00.000Z"),
    post("103", "nknk", "2026-03-02T00:00:00.000Z"),
    post("104", "inabakumori", "2026-03-02T00:00:00.000Z"),
    post("102", "nknk", "2026-03-01T00:00:00.000Z"),
    post("105", "inabakumori", "2026-03-03T00:00:00.000Z")
  ] };
  const renderer = createXPostsRenderer(archive);
  const ids = html => [...html.matchAll(/data-x-post-id="(\d+)"/gu)].map(match => match[1]);
  const first = renderer.renderArchive({ pageSize: 2 });
  assert.deepEqual(ids(first.items), ["105", "104"]);
  assert.equal(first.pageCount, 3);
  assert.match(first.pagination, /href="updates-page-2.html" rel="next"/u);
  const author = renderer.renderArchive({ creator: "inabakumori", pageSize: 2, page: 2 });
  assert.deepEqual(ids(author.items), ["101"]);
  assert.equal(author.total, 3);
  assert.match(author.pagination, /href="updates-inabakumori.html" rel="prev"/u);
  assert.deepEqual(ids(renderer.renderArchive({ pageSize: 2, page: 2 }).items), ["103", "102"]);
  assert.deepEqual(ids(renderer.renderHome()), ["105", "104", "103", "102", "101"]);
  first.items = "caller changed its result";
  assert.deepEqual(ids(renderer.renderArchive({ pageSize: 2 }).items), ["105", "104"]);
  assert.throws(() => renderer.renderArchive({ creator: "toString" }), /author filter/u);
  assert.throws(() => renderer.renderArchive({ page: 0 }), /Invalid X post page/u);
  assert.throws(() => renderer.renderArchive({ page: 4, pageSize: 2 }), /does not exist/u);
  assert.throws(() => renderer.renderArchive({ pageSize: 101 }), /page size/u);
});

test("cached markup cannot be changed by caller mutations or another build", async () => {
  const { createXPostsRenderer } = await import("../render-x-posts.mjs");
  const archive = snapshot();
  archive.items[0].links.push({ url: "https://example.com/original", label: "Original & safe" });
  const renderer = createXPostsRenderer(archive);
  archive.items[0].text = "<script>changed</script>";
  archive.items[0].links[0].url = "javascript:alert(1)";
  archive.items[0].links[0].label = "changed";
  archive.items[0].publishedAt = "not a date";
  archive.items.length = 1;
  const saved = renderer.renderArchive();
  assert.equal(saved.total, 3);
  assert.match(saved.items, /href="https:\/\/example.com\/original"/u);
  assert.match(saved.items, /Original &amp; safe/u);
  assert.doesNotMatch(saved.items, /javascript:|changed|Invalid Date/u);
  assert.match(saved.status, /稲葉曇：已收录 2 条/u);
  const other = snapshot();
  other.items[0].text = "a fresh build";
  assert.match(createXPostsRenderer(other).renderArchive().items, /a fresh build/u);
  assert.doesNotMatch(renderer.renderHome(), /a fresh build/u);
});

test("snapshot validation still rejects unsafe posts outside the visible home preview", async () => {
  const { createXPostsRenderer } = await import("../render-x-posts.mjs");
  const items = Array.from({ length: 8 }, (_, index) => post(String(100 + index), "inabakumori", `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`));
  for (const [change, message] of [
    [entry => { entry.links.push({ url: "javascript:alert(1)", label: "unsafe" }); }, /Invalid X post link/u],
    [entry => { entry.media.push({ url: "https://example.com/media/image.png" }); }, /Invalid X post image/u],
    [entry => { entry.translated = true; }, /must be the original/u],
    [entry => { entry.id = items[1].id; entry.url = items[1].url; }, /duplicate X post ID/u]
  ]) {
    const archive = { version: 1, items: structuredClone(items) };
    change(archive.items[0]);
    assert.throws(() => createXPostsRenderer(archive), message);
  }
});

test("page 2+ status keeps the summary and links coverage details to page 1", async () => {
  const { createXPostsRenderer } = await import("../render-x-posts.mjs");
  const items = Array.from({ length: 31 }, (_, index) => post(String(2030297425525854218n - BigInt(index)), "inabakumori", new Date(Date.UTC(2026, 2, 7) - index * 3600_000).toISOString()));
  const renderer = createXPostsRenderer({ version: 1, coverage: [], items });
  const first = renderer.renderArchive({ page: 1 }).status, second = renderer.renderArchive({ page: 2 }).status;
  assert.match(first, /x-posts-coverage-note/u);
  assert.match(first, /class="x-posts-coverage"/u);
  assert.match(second, /已收录 31 条公开帖子/u);
  assert.doesNotMatch(second, /x-posts-coverage/u);
  assert.match(second, /data-en="See page 1 for collection ranges and notes"/u);
  assert.ok(Buffer.byteLength(second) < Buffer.byteLength(first) / 2);
});

test("archive titles name the creator and page in zh, en and ja", async () => {
  const { xPostsPageTitle } = await import("../render-x-posts.mjs");
  assert.deepEqual(xPostsPageTitle("all", 1).title, { zh: "最新动态 · 稲葉曇与 NKNK", en: "Latest updates · Inabakumori & NKNK", ja: "最新情報 · 稲葉曇・ぬくぬくにぎりめし" });
  assert.deepEqual(xPostsPageTitle("nknk", 4).title, { zh: "NKNK 的 X 帖子 · 第 4 页 · 最新动态 · 稲葉曇与 NKNK", en: "NKNK’s X posts · Page 4 · Latest updates · Inabakumori & NKNK", ja: "NKNKのX投稿 · 4ページ目 · 最新情報 · 稲葉曇・ぬくぬくにぎりめし" });
  assert.match(xPostsPageTitle("all", 2).description.zh, /^第 2 页：稲葉曇与/u);
  assert.match(xPostsPageTitle("inabakumori", 1).description.en, /^Inabakumori’s X posts: New work/u);
  assert.throws(() => xPostsPageTitle("other", 1));
  assert.throws(() => xPostsPageTitle("all", 0));
});

test("post text is marked lang=ja only when it contains kana", async () => {
  const { createXPostsRenderer } = await import("../render-x-posts.mjs");
  const items = [
    post("2030297425525854218", "inabakumori", "2026-03-07T15:00:02.000Z", "新しい曲"),
    post("2030297425525854217", "inabakumori", "2026-03-07T14:00:02.000Z", "100M views!"),
    post("2030297425525854216", "inabakumori", "2026-03-07T13:00:02.000Z", "雨天")
  ];
  const html = createXPostsRenderer({ version: 1, coverage: [], items }).renderArchive({ page: 1 }).items;
  const texts = [...html.matchAll(/<p class="x-post-text"([^>]*)>([^<]*)<\/p>/gu)].map(match => [match[2], match[1]]);
  assert.deepEqual(texts, [["新しい曲", ' lang="ja" dir="auto"'], ["100M views!", ' dir="auto"'], ["雨天", ' dir="auto"']]);
});

test("the homepage carries a hidden empty note for creators without posts", async () => {
  const { createXPostsRenderer } = await import("../render-x-posts.mjs");
  const html = createXPostsRenderer(snapshot()).renderHome();
  assert.match(html, /<p class="x-posts-empty" data-x-home-empty hidden data-zh="这位创作者暂无已收录的帖子。"/u);
});
