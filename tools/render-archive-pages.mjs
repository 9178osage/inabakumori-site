// Generates search.html, songs.html and song-<videoId>.html plus the post search index.
import { buildPostSearchIndex, POST_SEARCH_DIRECTORY } from "./post-search-index.mjs";
import { archivePageShell, cspMetaFrom } from "./archive-page-shell.mjs";
import { linkPosts, renderSongIndex, renderSongPage, songPageName, validateSongDetails, youtubeId } from "./song-archive.mjs";

const escape = value => String(value).replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const tri = (tag, [zh, en, ja], attributes = "") => `<${tag}${attributes} data-zh="${escape(zh)}" data-en="${escape(en)}" data-ja="${escape(ja)}">${escape(zh)}</${tag}>`;

export function renderSearchBody(manifest) {
  const years = manifest.years.map(entry => `<option value="${entry.year}">${entry.year}</option>`).join("");
  return `<section class="updates-intro archive-intro" aria-labelledby="post-search-title">
<div class="observation-label"><span class="observation-dot" aria-hidden="true"></span><span>SIGNAL SEARCH</span><span class="observation-number" aria-hidden="true">NO. 03</span></div>
${tri("h1", ["帖子搜索", "Post search", "投稿検索"], ' id="post-search-title"')}
${tri("p", [`在已收录的 ${manifest.count} 条 X 帖子原文及 ${manifest.translated} 条中英译文中搜索。全角半角、大小写、平假名与片假名视为相同。`, `Search ${manifest.count} collected X posts and ${manifest.translated} Chinese/English translations. Full/half width, letter case, hiragana and katakana are treated alike.`, `収録済みのX投稿${manifest.count}件の原文と、${manifest.translated}件の中英訳を検索します。全角・半角、大文字・小文字、ひらがな・カタカナは区別しません。`], ' class="updates-description"')}
</section>
<form class="post-search-form" id="post-search-form" role="search" hidden>
<label class="post-search-field-label" for="post-search-query">${tri("span", ["关键词", "Keywords", "キーワード"])}</label>
<input id="post-search-query" name="q" type="search" maxlength="200" autocomplete="off" spellcheck="false"/>
<label for="post-search-creator">${tri("span", ["作者", "Author", "投稿者"])}</label>
<select id="post-search-creator" name="creator">${tri("option", ["全部", "All", "すべて"], ' value="all"')}<option value="inabakumori">稲葉曇 @inabakumori</option><option value="nknk">NKNK @NKNK_NGRMS</option></select>
<label for="post-search-year">${tri("span", ["年份", "Year", "年"], "")}</label>
<select id="post-search-year" name="year">${tri("option", ["全部年份", "All years", "すべての年"], ' value="all"')}${years}</select>
${tri("button", ["搜索", "Search", "検索"], ' type="submit"')}
</form>
${tri("p", ["帖子搜索需要启用 JavaScript；也可以在“最新动态”中按页浏览全部帖子。", "Post search needs JavaScript; you can also browse every post page by page in Latest updates.", "投稿検索には JavaScript が必要です。「最新情報」ではすべての投稿をページごとに閲覧できます。"], ' class="post-search-status" id="post-search-noscript-note"')}
<p class="post-search-status" id="post-search-status" role="status" aria-live="polite"></p>
<div class="x-posts-feed post-search-results" id="post-search-results"></div>
<button type="button" class="post-search-more" id="post-search-more" hidden></button>`;
}

export function renderArchivePages({ songs, xPosts, xTranslations, xPostsRenderer, songDetailsSource, updatesHtml }) {
  const csp = cspMetaFrom(updatesHtml);
  const details = validateSongDetails(songDetailsSource, songs);
  const index = buildPostSearchIndex(xPosts, xTranslations);
  const files = new Map();
  for (const [name, body] of index.files) files.set(`${POST_SEARCH_DIRECTORY}/${name}`, body);
  files.set(`${POST_SEARCH_DIRECTORY}/manifest.json`, JSON.stringify(index.manifest));
  files.set("search.html", archivePageShell({ csp, name: "search.html", scripts: ["js/post-search-core.js"],
    title: { zh: "帖子搜索 · 气象观测站", en: "Post search · Weather Observation Station", ja: "投稿検索 · 気象観測所" },
    description: { zh: "搜索稲葉曇与 NKNK 已收录的 X 帖子原文和中英译文。", en: "Search the collected X posts of Inabakumori and NKNK, with Chinese and English translations.", ja: "稲葉曇さんとNKNKさんの収録済みX投稿を、原文と中英訳から検索。" },
    body: renderSearchBody(index.manifest) }));
  const linked = linkPosts(songs, xPostsRenderer.posts(), details);
  const checkedCount = Object.keys(details).length;
  files.set("songs.html", archivePageShell({ csp, name: "songs.html",
    title: { zh: "歌曲观测档案 · 气象观测站", en: "Song archive · Weather Observation Station", ja: "楽曲観測アーカイブ · 気象観測所" },
    description: { zh: "稲葉曇每首歌的发布资料与相关 X 帖子。", en: "Release details and related X posts for each Inabakumori song.", ja: "稲葉曇さんの各曲の公開情報と関連するX投稿。" },
    body: `<section class="updates-intro archive-intro" aria-labelledby="songs-title"><div class="observation-label"><span class="observation-dot" aria-hidden="true"></span><span>SONG OBSERVATION</span><span class="observation-number" aria-hidden="true">NO. 04</span></div>${tri("h1", ["歌曲观测档案", "Song archive", "楽曲観測アーカイブ"], ' id="songs-title"')}${tri("p", [`已逐首核对 ${checkedCount} / ${songs.length} 首的发布资料与相关来源。无法确认的栏目仍标为“未核对”；专辑音轨、合作串烧和非官方转载分别注明，发行日期的版本与精度见各页说明。`, `Checked release information and listed sources for ${checkedCount} / ${songs.length} songs. Unconfirmed fields remain marked. Album audio, collaborative medleys and unofficial reuploads are identified; each page explains the release version and date precision.`, `${songs.length}曲中${checkedCount}曲の公開情報と出典を曲ごとに確認しました。確認できない欄は「未確認」のままです。アルバム音源・合作メドレー・非公式転載を区別し、公開日の版と精度を各ページに記載しています。`], ' class="updates-description"')}</section>${renderSongIndex(songs, details, linked)}` }));
  songs.forEach((song, position) => {
    const id = youtubeId(song.youtube);
    const name = songPageName(song);
    files.set(name, archivePageShell({ csp, name,
      title: { zh: `${song.title} · 歌曲观测档案`, en: `${song.title} · Song archive`, ja: `${song.title} · 楽曲観測アーカイブ` },
      description: { zh: `${song.title} 的发布资料与相关 X 帖子。`, en: `Release details and related X posts for ${song.title}.`, ja: `${song.title} の公開情報と関連するX投稿。` },
      shareImage: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: `${song.title} · 稲葉曇` },
      body: renderSongPage(song, position, { details: details[id], linked: linked.get(id), renderPost: xPostsRenderer.renderPost }) }));
  });
  return { files, index, linked, details };
}
