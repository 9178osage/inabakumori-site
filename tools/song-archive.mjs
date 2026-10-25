// Song observation archive: one generated page per song in js/songs.js. Verified facts come
// only from data/song-archive.json (checked against official pages); linked posts are matched
// from the collected X archive at build time by video ID or title, so daily imports flow in.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { foldText } = require("../js/post-search-core.js");
const escape = value => String(value).replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const tri = (tag, [zh, en, ja], attributes = "") => `<${tag}${attributes} data-zh="${escape(zh)}" data-en="${escape(en)}" data-ja="${escape(ja)}">${escape(zh)}</${tag}>`;
const ROLES = {
  music: ["作曲", "Music", "作曲"],
  illustration: ["插画", "Illustration", "イラスト"],
  animation: ["动画", "Animation", "アニメーション"],
  movie: ["影像", "Movie", "映像"]
};
const ALBUMS = {
  ANTICYCLONE: { name: "アンチサイクロン", kind: ["1st 专辑", "1st album", "1stアルバム"] },
  "WEATHER STATION": { name: "ウェザーステーション", kind: ["2nd 专辑", "2nd album", "2ndアルバム"] }
};
const MILESTONE = /再生|views|殿堂入り|伝説入り|まいりす|みりおん/u;
const RELEASE = /新曲|投稿しました|ぷれみあ公開|配信開始|公開しました/u;
export const SONG_POST_LIMIT = 60;

export function youtubeId(url) {
  const parsed = new URL(url);
  assert.ok(parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port, `Invalid YouTube URL ${url}`);
  const id = parsed.hostname === "youtu.be" ? parsed.pathname.slice(1)
    : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(parsed.hostname) && parsed.pathname === "/watch" && parsed.searchParams.getAll("v").length === 1
      ? parsed.searchParams.get("v") : null;
  assert.match(id ?? "", /^[A-Za-z0-9_-]{11}$/u, `Invalid YouTube URL ${url}`);
  return id;
}
export const songPageName = song => `song-${youtubeId(song.youtube)}.html`;

export function validateSongDetails(data, songs) {
  assert.equal(data?.version, 1, "Unsupported song archive data");
  const known = new Set(songs.map(song => youtubeId(song.youtube)));
  for (const [id, entry] of Object.entries(data.songs)) {
    assert.ok(known.has(id), `Song details for unknown video ${id}`);
    assert.ok(Number.isFinite(Date.parse(entry.releasedAt)), `Invalid release time for ${id}`);
    assert.ok(Array.isArray(entry.credits) && entry.credits.every(credit => Object.hasOwn(ROLES, credit.role) && typeof credit.name === "string" && credit.name), `Invalid credits for ${id}`);
    for (const credit of entry.credits) if (credit.url) assert.match(credit.url, /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/u, `Invalid credit link for ${id}`);
    assert.ok(Array.isArray(entry.sources) && entry.sources.length && entry.sources.every(source => /^https:\/\/(?:www\.youtube\.com|x\.com)\//u.test(source.url)), `Every verified song needs an official source: ${id}`);
    assert.ok(Array.isArray(entry.unverified) && entry.unverified.every(role => Object.hasOwn(ROLES, role) && !entry.credits.some(credit => credit.role === role)), `Invalid unverified list for ${id}`);
    assert.match(entry.checkedAt, /^\d{4}-\d{2}-\d{2}$/u, `Invalid check date for ${id}`);
  }
  return data.songs;
}

// Titles with a parenthetical (remixes, covers, versions) match by video ID only; short titles
// need 『』 quotes so everyday words such as 「もち」 are not mistaken for the song.
function matchers(song, details) {
  const id = youtubeId(song.youtube);
  const plain = /\(|（/u.test(song.title) ? [] : [foldText(song.title)];
  const quoted = plain.length ? [`『${foldText(song.title)}』`] : [];
  const loose = plain.filter(title => Array.from(title).length >= 4);
  const aliases = (details?.aliases ?? []).map(foldText);
  return { id, terms: [...loose, ...quoted, ...aliases] };
}

export function linkPosts(songs, posts, details = {}) {
  const prepared = posts.map(post => ({ post, folded: foldText(post.text), refs: post.links.map(link => `${link.label} ${link.url}`).join(" ") + post.text }));
  const result = new Map();
  for (const song of songs) {
    const { id, terms } = matchers(song, details[youtubeId(song.youtube)]);
    const released = details[id] ? Date.parse(details[id].releasedAt) : NaN;
    const linked = [];
    for (const { post, folded, refs } of prepared) {
      const byId = refs.includes(id);
      if (!byId && !terms.some(term => folded.includes(term))) continue;
      const at = Date.parse(post.publishedAt);
      const category = MILESTONE.test(folded) ? "milestone"
        : RELEASE.test(folded) || (Number.isFinite(released) && at >= released - 86_400_000 && at <= released + 2 * 86_400_000) ? "release" : "note";
      linked.push({ id: post.id, publishedAt: post.publishedAt, category, byId });
    }
    linked.sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : 0));
    result.set(id, linked);
  }
  return result;
}

const date = value => new Date(Date.parse(value) + 9 * 3_600_000).toISOString().slice(0, 10);
const UNVERIFIED = tri("span", ["未核对", "Unverified", "未確認"], ' class="song-unverified"');
const row = (label, value) => `<div class="song-fact"><dt>${tri("span", label)}</dt><dd>${value}</dd></div>`;

export function renderSongPage(song, index, { details, linked, renderPost }) {
  const id = youtubeId(song.youtube);
  const album = ALBUMS[song.album];
  const verified = Boolean(details);
  const releaseValue = verified
    ? `<time datetime="${escape(new Date(details.releasedAt).toISOString())}" data-local-time>${escape(date(details.releasedAt))} JST</time>${details.releaseNote ? tri("small", [details.releaseNote.zh, details.releaseNote.en, details.releaseNote.ja], ' class="song-fact-note"') : ""}`
    : `<span>—</span> ${UNVERIFIED}`;
  const albumValue = album
    ? `<span lang="ja">${escape(album.name)}</span> ${tri("span", album.kind, ' class="song-fact-note"')}${verified && details.albumRelease ? ` <span class="song-fact-note">${escape(details.albumRelease)}</span>` : ""}`
    : tri("span", ["单曲 / 其他", "Single / other", "シングル・その他"]);
  const vocalValue = verified ? `<span lang="ja">${escape(details.vocal)}</span>`
    : song.singers.length ? `${escape(song.singers.join(" / "))} ${tri("span", ["站内歌曲表", "site song list", "サイト楽曲表"], ' class="song-fact-note"')}` : `<span>—</span> ${UNVERIFIED}`;
  const creditRows = Object.entries(ROLES).filter(([role]) => role !== "music").map(([role, label]) => {
    const credit = details?.credits.filter(entry => entry.role === role) ?? [];
    const value = credit.length
      ? credit.map(entry => entry.url ? `<a href="${escape(entry.url)}" target="_blank" rel="noopener noreferrer" lang="ja">${escape(entry.name)} <span aria-hidden="true">↗</span></a>` : `<span lang="ja">${escape(entry.name)}</span>`).join(" / ")
      : `<span>—</span> ${UNVERIFIED}`;
    return row(label, value);
  }).join("");
  const facts = `<dl class="song-facts">${row(["发布日期", "Released", "公開日"], releaseValue)}${row(["收录", "Album", "収録"], albumValue)}${row(["演唱", "Vocal", "ボーカル"], vocalValue)}${row(["MV", "MV", "MV"], `<a href="${escape(`https://www.youtube.com/watch?v=${id}`)}" target="_blank" rel="noopener noreferrer">YouTube <span aria-hidden="true">↗</span></a>`)}${creditRows}</dl>`;
  const sources = verified
    ? `<p class="song-sources">${tri("span", [`核对于 ${details.checkedAt}，来源：`, `Checked ${details.checkedAt}. Sources: `, `${details.checkedAt} 確認。出典：`])}${details.sources.map(source => `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)} <span aria-hidden="true">↗</span></a>`).join(" · ")}</p>`
    : tri("p", ["这首歌尚未逐项核对官方资料：标为“未核对”的栏目暂时留空，演唱来自本站歌曲表。", "This song has not been checked field by field yet: “Unverified” fields stay blank, and the vocal comes from this site’s song list.", "この曲は公式情報をまだ項目ごとに確認していません。「未確認」の欄は空欄で、ボーカルはサイトの楽曲表によるものです。"], ' class="song-sources"');
  const groups = [["release", ["发布消息", "Release announcements", "公開のお知らせ"]], ["milestone", ["播放里程碑", "View milestones", "再生数の節目"]], ["note", ["创作笔记与其他提及", "Creative notes and other mentions", "制作メモ・その他の言及"]]];
  const shown = linked.slice(0, SONG_POST_LIMIT);
  const postSections = groups.map(([category, label]) => {
    const items = shown.filter(post => post.category === category);
    return items.length ? `<section class="song-posts-group" aria-label="${escape(label[0])}" data-aria-zh="${escape(label[0])}" data-aria-en="${escape(label[1])}" data-aria-ja="${escape(label[2])}">${tri("h3", [`${label[0]}（${items.length}）`, `${label[1]} (${items.length})`, `${label[2]}（${items.length}）`])}<div class="x-posts-feed">${items.map(post => renderPost(post.id)).join("\n")}</div></section>` : "";
  }).join("");
  const searchLink = `search.html?q=${encodeURIComponent(song.title)}`;
  const more = linked.length > shown.length ? tri("p", [`另有 ${linked.length - shown.length} 条匹配帖子未在此列出。`, `${linked.length - shown.length} more matching posts are not listed here.`, `ほかに一致した投稿が${linked.length - shown.length}件あります。`], ' class="song-posts-more"') : "";
  const posts = linked.length
    ? `${tri("p", ["按视频 ID 或曲名从已收录的 X 帖子中自动匹配，分类依据帖子用词，可能包含同名专辑等其他话题。", "Matched automatically from the collected X posts by video ID or title; categories follow the wording of each post and may include other topics such as an album of the same name.", "収録済みのX投稿から動画IDや曲名で自動的に抽出し、投稿の言葉づかいで分類しています。同名アルバムなど別の話題を含む場合があります。"], ' class="song-posts-note"')}${postSections}${more}`
    : tri("p", ["已收录的 X 帖子中暂未找到与这首歌明确相关的帖子。", "No collected X post clearly mentions this song yet.", "収録済みのX投稿に、この曲に明確に関連するものはまだありません。"], ' class="x-posts-empty"');
  return `<article class="song-record" data-song-id="${id}">
<div class="observation-label"><span class="observation-dot" aria-hidden="true"></span><span>SONG OBSERVATION</span><span class="observation-number" aria-hidden="true">NO. ${String(index + 1).padStart(2, "0")}</span></div>
<h1 class="song-title" lang="ja">${escape(song.title)}</h1>
${facts}
${sources}
<section class="song-posts" aria-labelledby="song-posts-title"><div class="feed-heading"><div><p class="section-kicker">X / LINKED POSTS</p>${tri("h2", ["相关帖子", "Linked posts", "関連する投稿"], ' id="song-posts-title"')}</div>${tri("a", ["在帖子搜索中查看 →", "Open in post search →", "投稿検索で見る →"], ` class="song-search-link" href="${escape(searchLink)}"`)}</div>${posts}</section>
</article>`;
}

export function renderSongIndex(songs, details, linkedMap) {
  const groups = [...new Set(songs.map(song => song.album))];
  return groups.map(album => {
    const entries = songs.map((song, index) => ({ song, index })).filter(entry => entry.song.album === album);
    const heading = ALBUMS[album] ? `<span lang="ja">${escape(ALBUMS[album].name)}</span>` : tri("span", ["单曲与其他", "Singles and more", "シングル・その他"]);
    return `<section class="song-index-group"><h2>${heading}</h2><ol class="song-index-list">${entries.map(({ song, index }) => {
      const id = youtubeId(song.youtube);
      const badge = details[id] ? tri("span", ["已核对", "Checked", "確認済み"], ' class="song-checked"') : "";
      const count = linkedMap.get(id)?.length ?? 0;
      return `<li value="${index + 1}"><a href="${songPageName(song)}" lang="ja">${escape(song.title)}</a>${badge}${tri("span", [`${count} 条相关帖子`, `${count} linked post${count === 1 ? "" : "s"}`, `関連投稿${count}件`], ' class="song-index-count"')}</li>`;
    }).join("")}</ol></section>`;
  }).join("\n");
}
