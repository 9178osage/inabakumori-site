// Generates songs.html and song-<videoId>.html, plus a redirect page for each retired song address.
import { archivePageShell, cspMetaFrom } from "./archive-page-shell.mjs";
import { linkPosts, renderSongIndex, renderSongPage, songPageName, validateSongDetails, validateSongRedirects, youtubeId } from "./song-archive.mjs";

const escape = value => String(value).replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const tri = (tag, [zh, en, ja], attributes = "") => `<${tag}${attributes} data-zh="${escape(zh)}" data-en="${escape(en)}" data-ja="${escape(ja)}">${escape(zh)}</${tag}>`;

// Dates are the archive's reported public dates, not necessarily the date of a later
// album or streaming release. The detail page carries the source and any uncertainty.
function renderYears(songs, details) {
  const groups = new Map();
  for (const song of songs) {
    const releasedAt = details[youtubeId(song.youtube)]?.releasedAt;
    const stamp = releasedAt ? Date.parse(releasedAt) : NaN;
    const year = Number.isFinite(stamp) ? String(new Date(stamp + 9 * 3_600_000).getUTCFullYear()) : "unknown";
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(song);
  }
  const years = [...groups.keys()].filter(year => year !== "unknown").sort((a, b) => Number(b) - Number(a));
  if (groups.has("unknown")) years.push("unknown");
  return `<section class="song-years" aria-labelledby="song-years-title">${tri("h2", ["按年份浏览", "Browse by year", "年別に見る"], ' id="song-years-title"')}${tri("p", ["按档案记载的公开年份分组；具体版本、日期精度及待确认的信息请查看歌曲详情。", "Grouped by the public year recorded in the archive. See each song for its version, date precision and uncertainties.", "アーカイブに記載された公開年で分類しています。版・日付の精度・未確認情報は各曲の詳細をご覧ください。"], ' class="song-years-note"')}${years.map(year => {
    const entries = groups.get(year);
    const label = year === "unknown" ? tri("span", ["年份待确认", "Year unconfirmed", "年未確認"]) : escape(year);
    return `<details class="song-year"><summary>${label} <span class="song-year-count">${entries.length}</span></summary><ul>${entries.map(song => {
      const inferred = details[youtubeId(song.youtube)]?.releaseConfidence === "inferred"
        ? tri("span", ["日期推定", "Date inferred", "日付は推定"], ' class="song-year-inferred"') : "";
      return `<li><a href="${songPageName(song)}" lang="ja">${escape(song.title)}</a>${inferred}</li>`;
    }).join("")}</ul></details>`;
  }).join("")}</section>`;
}

// A song page and its redirect pages describe the same song: search results and share cards
// must show the same title, description and cover whichever address they were reached through.
const songMeta = song => ({
  title: { zh: `${song.title} · 歌曲观测档案`, en: `${song.title} · Song archive`, ja: `${song.title} · 楽曲観測アーカイブ` },
  description: { zh: `${song.title} 的发布资料与相关 X 帖子。`, en: `Release details and related X posts for ${song.title}.`, ja: `${song.title} の公開情報と関連するX投稿。` },
  shareImage: { url: `https://i.ytimg.com/vi/${youtubeId(song.youtube)}/hqdefault.jpg`, alt: `${song.title} · 稲葉曇` }
});

// Visible only when a browser ignores the instant redirect (reader modes, text browsers).
function renderMovedNotice(song) {
  return `<section class="updates-intro archive-intro" aria-labelledby="song-moved-title"><div class="observation-label"><span class="observation-dot" aria-hidden="true"></span><span>SONG OBSERVATION</span><span class="observation-number" aria-hidden="true">MOVED</span></div>${tri("h1", ["页面已移动", "This page has moved", "ページは移動しました"], ' id="song-moved-title"')}${tri("p", ["正在跳转到新页面。如果没有自动跳转，请点击下面的链接。", "Taking you to the new page. If nothing happens, use the link below.", "新しいページへ移動しています。自動で移動しない場合は、下のリンクをご利用ください。"], ' class="updates-description"')}<p class="song-sources"><a href="${songPageName(song)}" lang="ja">${escape(song.title)}</a></p></section>`;
}

export function renderArchivePages({ songs, xPosts, xTranslations, xPostsRenderer, songDetailsSource, songRedirectsSource = { version: 1, redirects: {} }, updatesHtml, contactAddress }) {
  const csp = cspMetaFrom(updatesHtml);
  const details = validateSongDetails(songDetailsSource, songs);
  const redirectSources = validateSongRedirects(songRedirectsSource, songs);
  const files = new Map();
  const linked = linkPosts(songs, xPostsRenderer.posts(), details);
  const checkedCount = Object.keys(details).length;
  files.set("songs.html", archivePageShell({ csp, name: "songs.html",
    title: { zh: "歌曲观测档案 · 气象观测站", en: "Song archive · Weather Observation Station", ja: "楽曲観測アーカイブ · 気象観測所" },
    description: { zh: "稲葉曇每首歌的发布资料与相关 X 帖子。", en: "Release details and related X posts for each Inabakumori song.", ja: "稲葉曇さんの各曲の公開情報と関連するX投稿。" },
    body: `<section class="updates-intro archive-intro" aria-labelledby="songs-title"><div class="observation-label"><span class="observation-dot" aria-hidden="true"></span><span>SONG OBSERVATION</span><span class="observation-number" aria-hidden="true">NO. 04</span></div>${tri("h1", ["歌曲观测档案", "Song archive", "楽曲観測アーカイブ"], ' id="songs-title"')}${tri("p", [`已逐首核对 ${checkedCount} / ${songs.length} 首的发布资料与相关来源。无法确认的栏目仍标为“未核对”；官方来源未列出的演唱，只在能注明出处时标为“非官方记载”。专辑音轨、合作串烧和非官方转载分别注明，发行日期的版本与精度见各页说明。`, `Checked release information and listed sources for ${checkedCount} / ${songs.length} songs. Unconfirmed fields remain marked. A vocal that official sources do not list appears only as a labelled “unofficial record” with its reference. Album audio, collaborative medleys and unofficial reuploads are identified; each page explains the release version and date precision.`, `${songs.length}曲中${checkedCount}曲の公開情報と出典を曲ごとに確認しました。確認できない欄は「未確認」のままです。公式の出典に記載のないボーカルは、出典を示せる場合に限り「非公式の記載」として表示します。アルバム音源・合作メドレー・非公式転載を区別し、公開日の版と精度を各ページに記載しています。`], ' class="updates-description"')}</section>${renderYears(songs, details)}${renderSongIndex(songs, details, linked)}` }));
  songs.forEach((song, position) => {
    const id = youtubeId(song.youtube);
    const name = songPageName(song);
    files.set(name, archivePageShell({ csp, name, ...songMeta(song),
      body: renderSongPage(song, position, { details: details[id], linked: linked.get(id), renderPost: xPostsRenderer.renderPost, contactAddress }) }));
  });
  // Kept apart from `files`: these pages stay out of the sitemap, which lists only the real page.
  const redirects = new Map();
  for (const [from, to] of Object.entries(redirectSources)) {
    const song = songs.find(item => youtubeId(item.youtube) === to);
    const name = `song-${from}.html`;
    redirects.set(name, archivePageShell({ csp, name, canonicalName: songPageName(song), refreshTo: songPageName(song), ...songMeta(song), body: renderMovedNotice(song) }));
  }
  return { files, redirects, linked, details };
}
