const test = require("node:test");
const assert = require("node:assert/strict");

test("creator archives show headlines that link to each post's place in the all-posts archive", async () => {
  const { createXPostsRenderer } = await import("../render-x-posts.mjs");
  const at = n => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
  const items = Array.from({ length: 5 }, (_, n) => {
    const creator = n % 2 ? "nknk" : "inabakumori";
    const handle = creator === "nknk" ? "NKNK_NGRMS" : "inabakumori";
    const id = String(100 + n);
    return { id, creator, handle, url: `https://x.com/${handle}/status/${id}`, translated: false, text: n === 0 ? "" : `line ${n} ${"あ".repeat(80)}\nsecond line`, publishedAt: at(n), collectedAt: at(n), links: [], media: [], relatedUrls: [] };
  });
  const renderer = createXPostsRenderer({ version: 1, items });
  const all = renderer.renderArchive({ creator: "all", page: 1, pageSize: 2 }).items;
  assert.match(all, /second line/u, "all-posts archive keeps full text");
  const nknk = renderer.renderArchive({ creator: "nknk", page: 1, pageSize: 2 }).items;
  assert.doesNotMatch(nknk, /second line/u);
  // Sorted newest first: 104,103,102,101,100 → 103 on all page 1, 101 on all page 2.
  assert.match(nknk, /href="updates\.html#x-post-103"/u);
  assert.match(nknk, /href="updates-page-2\.html#x-post-101"/u);
  assert.match(nknk, /data-x-post-id="103"[^>]*>.*<time datetime=/u);
  assert.match(nknk, /data-zh="在全部帖子中阅读全文 →" data-en="Read in all posts →" data-ja="すべての投稿で全文を読む →"/u);
  assert.match(nknk, /lang="ja"/u);
  assert.match(nknk, /…<\/p>/u);
  const ina = renderer.renderArchive({ creator: "inabakumori", page: 2, pageSize: 2 }).items;
  assert.match(ina, /updates-page-3\.html#x-post-100/u);
  assert.match(ina, /data-zh="媒体帖子"/u);
});
