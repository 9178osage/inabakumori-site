const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

function snapshot() {
  return {
    version: 1,
    sources: [
      { id: "youtube", creator: "inabakumori", status: "ok", checkedAt: "2026-10-17T12:00:00Z" },
      { id: "pixiv", creator: "nknk", status: "ok", checkedAt: "2026-10-17T12:00:00Z" },
      { id: "campfire", creator: "nknk", status: "error", checkedAt: null, lastAttemptAt: "2026-10-17T12:00:00Z" }
    ],
    items: [
      { id: "pixiv:123", creator: "nknk", source: "pixiv", title: '<img src=x onerror="alert(1)"> & 雨', publishedAt: "2026-01-01T15:00:00Z", url: "https://www.pixiv.net/artworks/123" },
      { id: "youtube:AAAAAAAAAAA", creator: "inabakumori", source: "youtube", title: "$& 新しい曲", publishedAt: "2026-10-01T15:00:00Z", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" }
    ]
  };
}

test("the supplied X accounts are prominent original-post links with an explicit collection limit", () => {
  const html = fs.readFileSync("updates.html", "utf8");
  const primary = html.slice(html.indexOf('<section class="x-accounts"'), html.indexOf('<div class="updates-layout"'));
  for (const account of ["inabakumori", "NKNK_NGRMS"]) assert.ok(primary.includes(`href="https://x.com/${account}"`));
  assert.match(primary, /X 帖子暂未自动收录/u);
  assert.match(primary, /noopener noreferrer/u);
});

test("updates render publication order, escaped external titles, JST and source failures", async () => {
  const { renderCreatorUpdates } = await import("../render-creator-updates.mjs");
  const result = renderCreatorUpdates(snapshot());
  assert.ok(result.items.indexOf("$&amp; 新しい曲") < result.items.indexOf("&lt;img"));
  assert.doesNotMatch(result.items, /<img|onerror="/u);
  assert.match(result.items, /2026-10-02 00:00 JST/u);
  assert.match(result.status, /data-state="error" data-source="campfire" data-checked-at=""/u);
  assert.match(result.status, /本次读取失败/u);
  assert.match(result.status, /尚未成功读取/u);
  assert.doesNotMatch(result.status, /<p><p>/u);
  assert.match(result.items, /rel="noopener noreferrer"/u);
});

test("unknown creators, executable destinations, duplicates and invalid dates fail the build", async () => {
  const { renderCreatorUpdates } = await import("../render-creator-updates.mjs");
  for (const mutate of [
    data => { data.items[0].url = "javascript:alert(1)"; },
    data => { data.items[0].creator = "inabakumori"; },
    data => { data.items[0].publishedAt = "not-a-date"; },
    data => { data.sources[0].checkedAt = null; },
    data => { data.sources[0].id = "unknown"; },
    data => { data.items.push({ ...data.items[0] }); }
  ]) {
    const data = snapshot(); mutate(data);
    assert.throws(() => renderCreatorUpdates(data));
  }
});

test("day-precision publication does not invent an hour or timezone", async () => {
  const { renderCreatorUpdates } = await import("../render-creator-updates.mjs");
  const data = snapshot();
  data.items = [{ ...data.items[1], datePrecision: "day", publishedAt: "2026-10-01T00:00:00Z" }];
  const { items } = renderCreatorUpdates(data);
  assert.match(items, />2026-10-01<\/time>/u);
  assert.doesNotMatch(items, /09:00|JST/u);
});

test("preview allows the page resources while keeping raw data private", async () => {
  const { publicPath } = await import("../static-server.mjs");
  for (const file of ["updates.html", "updates.css", "js/updates.js"]) assert.equal(publicPath(`/${file}`), file);
  assert.equal(publicPath("/data/creator-updates.json"), null);
});

test("automated refresh checks all gates before upload and uses separate write permissions", () => {
  const workflow = fs.readFileSync(".github/workflows/refresh-creator-updates.yml", "utf8");
  const refresh = workflow.split("  commit:")[0];
  for (const command of ["npm test", "npm run check", "npm run test:integration", "npm run check:changelog"]) {
    assert.ok(refresh.indexOf(`run: ${command}\n`) > 0, command);
    assert.ok(refresh.indexOf(`run: ${command}\n`) < refresh.indexOf("name: creator-updates-snapshot"), command);
  }
  assert.match(refresh, /node tools\/record-current-deployment\.mjs/u);
  assert.doesNotMatch(refresh, /contents: write|actions: write/u);
  assert.match(workflow, /gh run watch "\$VERIFY_RUN" --exit-status/u);
  assert.match(workflow, /gh run watch "\$PUBLISH_RUN" --exit-status/u);
  assert.match(workflow, /creator-updates-version/u);
  const weekly = fs.readFileSync(".github/workflows/refresh-youtube-views.yml", "utf8");
  assert.match(weekly, /gh workflow run check\.yml --ref main/u, "weekly bot commits also provide the Verify evidence needed by the next creator refresh");
  assert.match(weekly, /gh workflow run pages\.yml --ref main/u);
});
