const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");

test("all-posts pages carry native fragment targets for every creator-page link (audit #09)", async () => {
  const { readXPostsArchive } = await import("../x-posts-data.mjs");
  const { createXPostsRenderer } = await import("../render-x-posts.mjs");
  const renderer = createXPostsRenderer(await readXPostsArchive(repo));
  const all = renderer.renderArchive({ creator: "all", page: 2 });
  const ids = [...all.items.matchAll(/<article class="x-post" id="x-post-(\d+)" data-x-post-id="(\d+)"/gu)];
  assert.equal(ids.length, 30);
  for (const match of ids) assert.equal(match[1], match[2]);
  const creator = renderer.renderArchive({ creator: "nknk", page: 1 });
  assert.doesNotMatch(creator.items, /\sid="x-post-/u, "creator pages only link; the id lives on the all-posts page");
  const [, href, fragment] = /href="(updates[^"#]*\.html)#x-post-(\d+)"/u.exec(creator.items);
  const page = Number(/-page-(\d+)/u.exec(href)?.[1] || 1);
  assert.match(renderer.renderArchive({ creator: "all", page }).items, new RegExp(`id="x-post-${fragment}"`, "u"));
  // Song pages and the homepage reuse the article markup without ids, so no page repeats one.
  const firstId = ids[0][1];
  assert.doesNotMatch(renderer.renderPost(firstId), /\sid=/u);
});

test("creator pages share one ID position map per build snapshot (audit #14)", async () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(path.join(repo, "tools/render-x-posts.mjs"), "utf8");
  const renderArchive = source.slice(source.indexOf("function renderArchive("), source.indexOf("// One renderer belongs"));
  assert.doesNotMatch(renderArchive, /new Map\(/u, "renderArchive must not rebuild the position map per page");
  assert.equal((source.match(/const allIndex = new Map\(posts\.map/gu) || []).length, 1);
});
