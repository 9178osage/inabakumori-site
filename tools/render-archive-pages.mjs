// Generates songs.html and song-<videoId>.html.
import { archivePageShell, cspMetaFrom } from "./archive-page-shell.mjs";
import { linkPosts, renderSongIndex, renderSongPage, songPageName, validateSongDetails, youtubeId } from "./song-archive.mjs";

const escape = value => String(value).replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const tri = (tag, [zh, en, ja], attributes = "") => `<${tag}${attributes} data-zh="${escape(zh)}" data-en="${escape(en)}" data-ja="${escape(ja)}">${escape(zh)}</${tag}>`;

export function renderArchivePages({ songs, xPosts, xTranslations, xPostsRenderer, songDetailsSource, updatesHtml }) {
  const csp = cspMetaFrom(updatesHtml);
  const details = validateSongDetails(songDetailsSource, songs);
  const files = new Map();
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
  return { files, linked, details };
}
