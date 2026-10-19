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
