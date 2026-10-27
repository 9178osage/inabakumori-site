// Shared document shell for the generated song and search pages. The CSP is copied verbatim
// from updates.html so these pages can never weaken or diverge from the archive's policy.
import assert from "node:assert/strict";

const escape = value => String(value).replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function cspMetaFrom(updatesHtml) {
  const matches = updatesHtml.match(/<meta http-equiv="Content-Security-Policy" content="[^"]*"\/>/gu) ?? [];
  assert.equal(matches.length, 1, "updates.html must contain exactly one CSP meta tag");
  assert.match(matches[0], /require-trusted-types-for 'script'; trusted-types 'none'/u, "Archive CSP must keep Trusted Types");
  return matches[0];
}

// title/description: { zh, en, ja }. body is trusted markup produced by the build.
export function archivePageShell({ csp, name, title, description, body, scripts = [], shareImage }) {
  assert.match(name, /^[A-Za-z0-9_.-]+\.html$/u, "Invalid generated page name");
  const lang = Object.entries(title).map(([language, value]) => ` data-title-${language}="${escape(value)}"`).join("")
    + Object.entries(description).map(([language, value]) => ` data-description-${language}="${escape(value)}"`).join("");
  return `<!DOCTYPE html>
<html lang="zh-CN"${lang}>
<head>
<meta charset="utf-8"/>
<meta name="referrer" content="no-referrer"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
<meta name="description" content="${escape(description.zh)}"/>
<meta name="theme-color" content="#c4c4c0" media="(prefers-color-scheme: light)"/>
<meta name="theme-color" content="#171b1f" media="(prefers-color-scheme: dark)"/>
<meta name="color-scheme" content="light dark"/>
${csp}
<link rel="canonical" href="https://osagechan.top/${name}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="https://osagechan.top/${name}"/>
<meta property="og:title" content="${escape(title.zh)}"/>
<meta property="og:description" content="${escape(description.zh)}"/>
<meta property="og:site_name" content="气象观测站 · 稲葉曇"/>
${shareImage ? `<meta property="og:image" content="${escape(shareImage.url)}"/>
<meta property="og:image:width" content="480"/>
<meta property="og:image:height" content="360"/>
<meta property="og:image:alt" content="${escape(shareImage.alt)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:image" content="${escape(shareImage.url)}"/>
<meta name="twitter:image:alt" content="${escape(shareImage.alt)}"/>` : ""}
<title>${escape(title.zh)}</title>
<script src="js/preferences.js"></script>
<link rel="stylesheet" href="fonts/fonts.css"/>
<link rel="stylesheet" href="updates.css"/>
<link rel="stylesheet" href="archive.css"/>
<link href="favicon.ico?v=3" rel="icon" type="image/x-icon"/>
<link href="images/icons/apple-touch-icon.png?v=3" rel="apple-touch-icon" sizes="180x180"/>
${[...scripts, "js/archive-pages.js"].map(src => `<script src="${src}" defer></script>`).join("\n")}
</head>
<body${name === "songs.html" ? ' class="song-index-page"' : ""}>
<a class="skip-link" href="#main-content" data-zh="跳到主要内容" data-en="Skip to content" data-ja="メインコンテンツへスキップ">跳到主要内容</a>
<header class="updates-header">
<a class="station-home" href="index.html"><span class="station-icon" aria-hidden="true">☂</span><span>INABAKUMORI<span class="station-home-caption" data-zh="气象观测站" data-en="WEATHER OBSERVATION STATION" data-ja="気象観測所">气象观测站</span></span></a>
<div class="page-controls" role="group" aria-label="页面设置" data-aria-zh="页面设置" data-aria-en="Page settings" data-aria-ja="ページ設定" hidden>
<button type="button" id="archive-lang-btn">English</button>
<button type="button" id="archive-theme-btn" aria-label="深色主题" aria-pressed="false">☾</button>
</div>
</header>
<main id="main-content" class="archive-main" tabindex="-1">
<nav class="updates-navigation archive-navigation" aria-label="网站导航" data-aria-zh="网站导航" data-aria-en="Site navigation" data-aria-ja="サイトナビゲーション">
<a href="index.html"><span aria-hidden="true">← </span><span data-zh="返回首页" data-en="Home" data-ja="ホームへ">返回首页</span></a>
<a href="songs.html" data-zh="歌曲观测档案" data-en="Song archive" data-ja="楽曲観測アーカイブ">歌曲观测档案</a>
<a href="search.html" data-zh="帖子搜索" data-en="Post search" data-ja="投稿検索">帖子搜索</a>
<a href="updates.html" data-zh="最新动态" data-en="Latest updates" data-ja="最新情報">最新动态</a>
</nav>
${body}
</main>
</body>
</html>
`;
}
