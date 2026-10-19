import assert from "node:assert/strict";

const creators = {
  inabakumori: { name: "稲葉曇", handle: "inabakumori" },
  nknk: { name: "NKNK", handle: "NKNK_NGRMS" }
};
const escape = value => String(value).replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const text = (tag, values, attributes = "") => `<${tag}${attributes} data-zh="${escape(values[0])}" data-en="${escape(values[1])}" data-ja="${escape(values[2])}">${escape(values[0])}</${tag}>`;
const stamp = value => {
  assert.ok(typeof value === "string" && Number.isFinite(Date.parse(value)), "Invalid X post timestamp");
  return new Date(value).toISOString();
};
const time = value => {
  const iso = stamp(value);
  const label = new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Tokyo", hour12: false }).slice(0, 16) + " JST";
  return `<time datetime="${iso}" data-local-time>${escape(label)}</time>`;
};
const https = value => {
  assert.equal(typeof value, "string", "Invalid X post link");
  const url = new URL(value, "https://x.com");
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.port, "Invalid X post link");
  return url.href;
};

function orderedPosts(archive) {
  assert.equal(archive?.version, 1, "Unsupported X post archive");
  assert.ok(Array.isArray(archive.items), "Invalid X post archive");
  const ids = new Set();
  for (const post of archive.items) {
    const creator = creators[post.creator];
    assert.ok(creator && post.handle === creator.handle, "Unknown X post creator");
    assert.ok(typeof post.id === "string" && /^\d{1,30}$/u.test(post.id) && !ids.has(post.id), "Invalid or duplicate X post ID");
    ids.add(post.id);
    assert.equal(post.url, `https://x.com/${creator.handle}/status/${post.id}`, "Invalid X post source");
    assert.equal(post.translated, false, "X post text must be the original");
    assert.ok(typeof post.text === "string" && post.text.length <= 100_000, "Invalid X post text");
    stamp(post.publishedAt);
    stamp(post.collectedAt);
    assert.ok(Array.isArray(post.links) && Array.isArray(post.media) && Array.isArray(post.relatedUrls), "Invalid X post references");
    for (const link of post.links) {
      https(link.url);
      assert.equal(typeof link.label, "string", "Invalid X post link label");
    }
    for (const medium of post.media) {
      const url = new URL(https(medium.url));
      assert.ok(url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/media/"), "Invalid X post image");
    }
    for (const related of post.relatedUrls) assert.match(https(related), /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/u, "Invalid quoted post link");
  }
  return [...archive.items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (BigInt(a.id) < BigInt(b.id) ? 1 : BigInt(a.id) > BigInt(b.id) ? -1 : 0));
}

export function xPostsPageUrl(creator = "all", page = 1) {
  assert.ok(creator === "all" || Object.hasOwn(creators, creator), "Invalid X post author filter");
  assert.ok(Number.isSafeInteger(page) && page > 0, "Invalid X post page");
  return `updates${creator === "all" ? "" : `-${creator}`}${page === 1 ? "" : `-page-${page}`}.html`;
}

function renderPost(post) {
  const creator = creators[post.creator];
  const links = [...new Map(post.links.map(link => [https(link.url), link])).entries()].map(([url, link]) => {
    const label = link.label.replace(/\s*\n\s*/gu, "").trim() || url;
    return `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} <span aria-hidden="true">↗</span></a>`;
  }).join("");
  const references = [...new Set(post.relatedUrls)].map(url => text("a", ["引用原帖 ↗", "Quoted post ↗", "引用元の投稿 ↗"], ` href="${escape(https(url))}" target="_blank" rel="noopener noreferrer"`)).join("");
  const media = post.media.length ? text("span", [`附 ${post.media.length} 张图片 · 请到原帖查看`, `${post.media.length} image${post.media.length === 1 ? "" : "s"} · View in the original post`, `画像${post.media.length}枚 · 元の投稿で見る`]) : "";
  const video = post.hasVideo ? text("span", ["视频 · 请到原帖播放", "Video · Play in the original post", "動画 · 元の投稿で再生"]) : "";
  const body = post.text ? `<p class="x-post-text" lang="ja" dir="auto">${escape(post.text)}</p>` : text("p", ["这条帖子以媒体为主，请查看原帖。", "This post contains media. View the original post.", "メディアを中心とした投稿です。元の投稿をご覧ください。"], ' class="x-post-text x-post-media-only"');
  return `<article class="x-post" data-x-post-id="${post.id}" data-creator="${post.creator}"><header class="x-post-header"><h3>${escape(creator.name)} <span>@${creator.handle}</span></h3>${time(post.publishedAt)}</header>${body}${links ? `<div class="x-post-links">${links}</div>` : ""}${media || video ? `<p class="x-post-media-note">${media}${media && video ? " · " : ""}${video}</p>` : ""}<footer class="x-post-footer">${text("a", ["查看原帖 ↗", "View original ↗", "元の投稿を見る ↗"], ` class="x-post-source" href="${escape(post.url)}" target="_blank" rel="noopener noreferrer"`)}${references}</footer></article>`;
}

function renderCoverage(archive, posts) {
  return `<ul class="x-posts-coverage">${Object.entries(creators).map(([id, creator]) => {
    const selected = posts.filter(post => post.creator === id);
    const actual = { count: selected.length, oldestAt: selected.at(-1)?.publishedAt ?? null, newestAt: selected[0]?.publishedAt ?? null };
    const recorded = archive.coverage?.find(entry => entry.creator === id);
    // A scan's metadata can be older than a merged archive. Show its summary only when
    // it agrees with the saved posts; the displayed range must never imply gap-free history.
    const coverage = recorded?.count === actual.count && recorded.oldestAt === actual.oldestAt && recorded.newestAt === actual.newestAt ? recorded : actual;
    if (!coverage.count) return text("li", [`${creator.name}：已收录 0 条 · 尚无可确认的发布日期范围`, `${creator.name}: 0 collected · No publication date range yet`, `${creator.name}：収録0件 · 投稿日の範囲はまだありません`]);
    const date = value => new Date(stamp(value)).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    const from = date(coverage.oldestAt), to = date(coverage.newestAt);
    return text("li", [`${creator.name}：已收录 ${coverage.count} 条 · 发布日期范围 ${from} 至 ${to}（JST）`, `${creator.name}: ${coverage.count} collected · Post date range ${from} to ${to} (JST)`, `${creator.name}：収録${coverage.count}件 · 投稿日の範囲 ${from}〜${to}（JST）`]);
  }).join("")}</ul>`;
}

function renderStatus(archive, posts) {
  const last = posts.reduce((latest, post) => latest > post.collectedAt ? latest : post.collectedAt, "");
  const summary = text("p", [`已收录 ${posts.length} 条公开帖子 · 历史仍在补全`, `${posts.length} public posts collected · Historical posts are still being added`, `公開投稿${posts.length}件を収録 · 過去の投稿を引き続き追加中`], ' class="x-posts-summary"');
  const checked = last ? `<p>${text("span", ["最近收录", "Last collected", "最終収録"])} ${time(last)}</p>` : text("p", ["尚未收录帖子，稍后会在本站补充。", "No posts have been collected yet. They will be added here.", "投稿はまだ収録されていません。今後ここに追加します。"]);
  return `${summary}${checked}${renderCoverage(archive, posts)}${text("p", ["全量历史、回复与转发仍未完整收录。日期范围只表示已保存的最早与最新帖子，不代表区间内每条都已收录。正文保留原语言；图片和视频请到原帖查看。", "The full history, replies and reposts are not fully collected. The dates show the earliest and latest saved posts, not complete coverage of every post between them. Text stays in its original language; view images and videos in the original posts.", "過去の全投稿・返信・リポストの収録はまだ完了していません。日付は保存済み投稿の最古と最新を示し、期間内の全投稿の収録を保証するものではありません。本文は原文のまま、画像・動画は元の投稿をご覧ください。"], ' class="x-posts-coverage-note"')}`;
}

function renderAuthorLinks(creator) {
  return `<nav class="x-posts-author-links" aria-label="按创作者浏览帖子" data-aria-zh="按创作者浏览帖子" data-aria-en="Browse posts by creator" data-aria-ja="クリエイター別の投稿">${text("a", ["全部帖子", "All posts", "すべての投稿"], ` href="${xPostsPageUrl("all")}"${creator === "all" ? ' aria-current="true"' : ""}`)}${Object.entries(creators).map(([id, author]) => `<a href="${xPostsPageUrl(id)}"${creator === id ? ' aria-current="true"' : ""}>${escape(author.name)}</a>`).join("")}</nav>`;
}

export function renderXPostsHome(archive) {
  const posts = orderedPosts(archive);
  const latest = new Set(Object.keys(creators).flatMap(creator => posts.filter(post => post.creator === creator).slice(0, 6)).map(post => post.id));
  const selected = posts.filter(post => latest.has(post.id));
  const count = creator => posts.filter(post => post.creator === creator).length;
  const filters = `<div class="x-home-filters" role="group" aria-label="按创作者筛选帖子" data-aria-zh="按创作者筛选帖子" data-aria-en="Filter posts by creator" data-aria-ja="クリエイター別の投稿" hidden>${text("button", ["全部帖子", "All posts", "すべて"], ' type="button" data-x-home-creator="all" aria-pressed="true"')}<button type="button" data-x-home-creator="inabakumori" aria-pressed="false">稲葉曇</button><button type="button" data-x-home-creator="nknk" aria-pressed="false">NKNK</button></div>`;
  return `<section class="x-posts-home" data-x-posts-home data-x-total="${posts.length}" data-x-total-inabakumori="${count("inabakumori")}" data-x-total-nknk="${count("nknk")}" aria-labelledby="home-x-posts-title"><h3 id="home-x-posts-title" class="x-posts-title" data-zh="X 帖子原文" data-en="Original X posts" data-ja="Xの投稿・原文">X 帖子原文</h3><div class="x-posts-status">${renderStatus(archive, posts)}</div>${filters}<p class="x-home-count" data-x-home-count role="status" aria-live="polite" hidden></p><div class="x-posts-feed">${selected.map(renderPost).join("\n") || text("p", ["公开帖子正在补录中。", "Public posts are being collected.", "公開投稿を収録しています。"], ' class="x-posts-empty"')}</div>${text("a", ["在本站浏览已收录的全部帖子 →", "Browse all collected posts on this site →", "サイト内で収録済みの投稿をすべて見る →"], ' class="x-posts-archive-link" data-x-archive-link href="updates.html"')}<noscript>${text("p", ["这里展示近期收录。完整帖子正文可通过上方站内档案分页阅读。", "Recent collected posts are shown here. Read the complete collected text through the archive pages above.", "ここには最近の収録分を表示しています。収録済みの全文は上のリンク先でページごとに読めます。"], ' class="x-posts-coverage-note"')}</noscript></section>`;
}

export function renderXPostsArchive(archive, { page = 1, creator = "all", pageSize = 30 } = {}) {
  const all = orderedPosts(archive);
  xPostsPageUrl(creator, page);
  assert.ok(Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 100, "Invalid X post page size");
  const posts = all.filter(post => creator === "all" || post.creator === creator);
  const pageCount = Math.max(1, Math.ceil(posts.length / pageSize));
  assert.ok(page <= pageCount, "X post page does not exist");
  const items = posts.slice((page - 1) * pageSize, page * pageSize).map(renderPost).join("\n") || text("p", ["这个分类尚未收录帖子。", "No posts have been collected in this category yet.", "この分類の投稿はまだ収録されていません。"], ' class="x-posts-empty"');
  const prev = page > 1 ? text("a", ["← 上一页", "← Previous", "← 前のページ"], ` href="${xPostsPageUrl(creator, page - 1)}" rel="prev"`) : "";
  const next = page < pageCount ? text("a", ["下一页 →", "Next →", "次のページ →"], ` href="${xPostsPageUrl(creator, page + 1)}" rel="next"`) : "";
  const first = page > 2 ? text("a", ["第一页", "First page", "最初のページ"], ` href="${xPostsPageUrl(creator)}"`) : "";
  const last = page < pageCount - 1 ? text("a", ["最后一页", "Last page", "最後のページ"], ` href="${xPostsPageUrl(creator, pageCount)}"`) : "";
  const position = text("span", [`第 ${page} / ${pageCount} 页 · ${posts.length} 条帖子`, `Page ${page} of ${pageCount} · ${posts.length} posts`, `${pageCount}ページ中${page}ページ · 投稿${posts.length}件`], ' class="x-posts-page-position" aria-current="page"');
  const pagination = `<nav class="x-posts-pagination" aria-label="帖子分页" data-aria-zh="帖子分页" data-aria-en="Post pages" data-aria-ja="投稿のページ">${first}${prev}${position}${next}${last}</nav>`;
  return { items, status: `<div class="x-posts-status">${renderStatus(archive, all)}</div>${renderAuthorLinks(creator)}`, pagination, total: posts.length, pageCount, page, creator };
}
