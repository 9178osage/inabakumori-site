// Song observation archive: one generated page per song in js/songs.js. Verified facts come
// only from data/song-archive.json (checked against official pages); the one exception is a
// vocal shown as a labelled unofficial record with its reference pages. Linked posts are matched
// from the collected X archive at build time by video ID or title, so daily imports flow in.
import assert from "node:assert/strict";

// Text folding for title matching: NFKC (full/half width), lower case, katakana → hiragana,
// whitespace removed; half-width voiced marks stay with the preceding kana (ｶﾞ → が).
const FOLD_SPACE = /[\s\u200b-\u200d\u2060\ufeff]/u;
const FOLD_VOICE = /^[\uff9e\uff9f\u3099\u309a]$/u;
const foldChar = value => value.normalize("NFKC").toLowerCase().replace(/[\u30a1-\u30f6]/gu, character => String.fromCharCode(character.charCodeAt(0) - 0x60)).normalize("NFC");
export function foldText(source) {
  const characters = Array.from(String(source ?? ""));
  let text = "";
  for (let index = 0; index < characters.length; index++) {
    let unit = characters[index];
    while (index + 1 < characters.length && FOLD_VOICE.test(characters[index + 1])) unit += characters[++index];
    if (FOLD_SPACE.test(unit)) continue;
    for (const piece of foldChar(unit)) if (!FOLD_SPACE.test(piece)) text += piece;
  }
  return text;
}
const escape = value => String(value).replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const tri = (tag, [zh, en, ja], attributes = "") => `<${tag}${attributes} data-zh="${escape(zh)}" data-en="${escape(en)}" data-ja="${escape(ja)}">${escape(zh)}</${tag}>`;
const ROLES = {
  music: ["作曲", "Music", "作曲"],
  lyrics: ["作词", "Lyrics", "作詞"],
  arrangement: ["编曲 / 改编", "Arrangement", "編曲・アレンジ"],
  remix: ["重混", "Remix", "リミックス"],
  illustration: ["插画", "Illustration", "イラスト"],
  animation: ["动画", "Animation", "アニメーション"],
  movie: ["影像", "Movie", "映像"]
};
const ALBUMS = {
  ANTICYCLONE: { name: "アンチサイクロン", slug: "anticyclone", kind: ["1st 专辑", "1st album", "1stアルバム"] },
  "WEATHER STATION": { name: "ウェザーステーション", slug: "weather-station", kind: ["2nd 专辑", "2nd album", "2ndアルバム"] }
};
const SINGLES = ["单曲与其他", "Singles and more", "シングル・その他"];
const MILESTONE = /再生|views|殿堂入り|伝説入り|まいりす|みりおん/u;
const RELEASE = /新曲|投稿しました|ぷれみあ公開|配信開始|公開しました/u;
export const SONG_POST_LIMIT = 60;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;

export function youtubeId(url) {
  const parsed = new URL(url);
  assert.ok(parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port, `Invalid YouTube URL ${url}`);
  const id = parsed.hostname === "youtu.be" ? parsed.pathname.slice(1)
    : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(parsed.hostname) && parsed.pathname === "/watch" && parsed.searchParams.getAll("v").length === 1
      ? parsed.searchParams.get("v") : null;
  assert.match(id ?? "", VIDEO_ID, `Invalid YouTube URL ${url}`);
  return id;
}
export const songPageName = song => `song-${youtubeId(song.youtube)}.html`;

// Exact hosts only: sources include the artists' release projects, shops, official store
// listings, licensed song metadata and first-person interviews as well as their posts.
const SOURCE_HOSTS = new Set(["www.youtube.com", "www.nicovideo.jp", "x.com", "soundcloud.com",
  "booth.pm", "inabakumori.booth.pm", "dokotana.booth.pm", "nbcuni-music.com", "subcul-rise.jp",
  "realsound.jp", "chimera12.com", "youth-compilation.wixsite.com", "trudist.tumblr.com",
  "joysound.com", "www.joysound.com", "prtimes.jp", "www.tunecore.co.jp", "otoiro.co.jp", "piapro.jp", "utaten.com",
  "music.apple.com"]);
function sourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && SOURCE_HOSTS.has(url.hostname);
  } catch { return false; }
}

// Fan databases and third-party store listings are not official sources. They may only back a
// vocal record that the page labels as unofficial, so each host is limited to the URL shape of
// its song pages (the wiki's numeric page ids cannot tell a song page from other pages).
const UNOFFICIAL_SOURCE_URLS = [
  /^https:\/\/vocadb\.net\/S\/\d+$/u,
  /^https:\/\/w\.atwiki\.jp\/hmiku\/pages\/\d+\.html$/u,
  /^https:\/\/music\.163\.com\/song\?id=\d+$/u
];
const unofficialSourceUrl = value => typeof value === "string" && UNOFFICIAL_SOURCE_URLS.some(pattern => pattern.test(value));

export function validateSongDetails(data, songs) {
  assert.equal(data?.version, 1, "Unsupported song archive data");
  const known = new Set(songs.map(song => youtubeId(song.youtube)));
  for (const [id, entry] of Object.entries(data.songs)) {
    assert.ok(known.has(id), `Song details for unknown video ${id}`);
    assert.ok(entry.releasedAt == null || Number.isFinite(Date.parse(entry.releasedAt)), `Invalid release time for ${id}`);
    assert.ok(entry.releaseConfidence === undefined || entry.releaseConfidence === "inferred", `Invalid release confidence for ${id}`);
    assert.ok(entry.vocal == null || typeof entry.vocal === "string" && entry.vocal.trim(), `Invalid vocal for ${id}`);
    if (entry.unofficialVocal !== undefined) {
      const record = entry.unofficialVocal;
      assert.ok(entry.vocal == null, `An official vocal replaces the unofficial record for ${id}`);
      assert.ok(record && typeof record.name === "string" && record.name.trim(), `Invalid unofficial vocal for ${id}`);
      assert.ok(Array.isArray(record.sources) && record.sources.length && record.sources.every(source => typeof source.label === "string" && source.label.trim() && unofficialSourceUrl(source.url)), `Invalid unofficial vocal sources for ${id}`);
    }
    for (const field of ["releaseNote", "creditNote", "videoNote"]) if (entry[field] !== undefined) {
      assert.ok(entry[field] && ["zh", "en", "ja"].every(language => typeof entry[field][language] === "string" && entry[field][language].trim()), `Invalid ${field} for ${id}`);
    }
    assert.ok(entry.videoKind === undefined || ["official", "topic", "reupload", "medley"].includes(entry.videoKind), `Invalid video kind for ${id}`);
    assert.ok(Array.isArray(entry.credits) && entry.credits.every(credit => Object.hasOwn(ROLES, credit.role) && typeof credit.name === "string" && credit.name), `Invalid credits for ${id}`);
    for (const credit of entry.credits) if (credit.url) assert.match(credit.url, /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/u, `Invalid credit link for ${id}`);
    assert.ok(Array.isArray(entry.sources) && entry.sources.length && entry.sources.every(source => typeof source.label === "string" && source.label.trim() && sourceUrl(source.url)), `Every verified song needs an official source: ${id}`);
    if (entry.fieldSources !== undefined) {
      assert.ok(entry.fieldSources && typeof entry.fieldSources === "object" && !Array.isArray(entry.fieldSources), `Invalid field sources for ${id}`);
      for (const [field, labels] of Object.entries(entry.fieldSources)) {
        assert.ok(["releasedAt", "vocal", ...Object.keys(ROLES)].includes(field), `Invalid source field ${field} for ${id}`);
        assert.ok(Array.isArray(labels) && labels.length && labels.every(label => entry.sources.some(source => source.label === label)), `Unknown field source for ${id}`);
      }
    }
    assert.ok(Array.isArray(entry.unverified) && entry.unverified.every(role => Object.hasOwn(ROLES, role) && !entry.credits.some(credit => credit.role === role)), `Invalid unverified list for ${id}`);
    assert.match(entry.checkedAt, /^\d{4}-\d{2}-\d{2}$/u, `Invalid check date for ${id}`);
    // Aliases match X posts as plain substrings, so a one-character or non-string alias would
    // tag unrelated posts (or crash foldText) during the scheduled refresh.
    assert.ok(entry.aliases === undefined || Array.isArray(entry.aliases) && entry.aliases.every(alias => typeof alias === "string" && Array.from(foldText(alias)).length >= 2), `Invalid aliases for ${id}`);
  }
  return data.songs;
}

// A song page is named after its video ID, so changing a song's video link renames the page.
// Each old ID listed here is published as a static redirect page (GitHub Pages cannot send HTTP
// redirects) so bookmarks and shared links keep working. A source is never a current song and a
// target always is, so entries cannot chain, loop or shadow a real page.
export function validateSongRedirects(data, songs) {
  assert.equal(data?.version, 1, "Unsupported song redirect data");
  assert.ok(data.redirects && typeof data.redirects === "object" && !Array.isArray(data.redirects), "Invalid song redirects");
  const known = new Set(songs.map(song => youtubeId(song.youtube)));
  for (const [from, to] of Object.entries(data.redirects)) {
    assert.match(from, VIDEO_ID, `Invalid redirect source ${from}`);
    assert.ok(typeof to === "string" && VIDEO_ID.test(to), `Invalid redirect target for ${from}`);
    assert.ok(!known.has(from), `Redirect source ${from} is still a song`);
    assert.ok(known.has(to), `Redirect target ${to} is not a song`);
  }
  return data.redirects;
}

// Titles with a parenthetical (remixes, covers, versions) match by video ID only; short titles
// need 『』 quotes so everyday words such as 「もち」 are not mistaken for the song.
function matchers(song, details) {
  const id = youtubeId(song.youtube);
  const plain = /\(|（/u.test(song.title) ? [] : [foldText(song.title)];
  const quoted = plain.length ? [`『${foldText(song.title)}』`] : [];
  const loose = plain.filter(title => Array.from(title).length >= 4);
  const aliases = (details?.aliases ?? []).map(foldText);
  const sourcePosts = new Set((details?.sources ?? []).flatMap(source => {
    const match = /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/(\d+)(?:[/?#]|$)/u.exec(source.url);
    return match ? [match[1]] : [];
  }));
  return { id, sourcePosts, terms: [...loose, ...quoted, ...aliases] };
}

export function linkPosts(songs, posts, details = {}) {
  const prepared = posts.map(post => ({ post, folded: foldText(post.text), refs: post.links.map(link => `${link.label} ${link.url}`).join(" ") + post.text }));
  const result = new Map();
  for (const song of songs) {
    const { id, sourcePosts, terms } = matchers(song, details[youtubeId(song.youtube)]);
    const released = details[id] ? Date.parse(details[id].releasedAt) : NaN;
    const linked = [];
    for (const { post, folded, refs } of prepared) {
      const byId = refs.includes(id);
      if (!byId && !sourcePosts.has(post.id) && !terms.some(term => folded.includes(term))) continue;
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
const UNOFFICIAL = tri("span", ["非官方记载", "Unofficial record", "非公式の記載"], ' class="song-unofficial"');
const row = (label, value) => `<div class="song-fact"><dt>${tri("span", label)}</dt><dd>${value}</dd></div>`;

export function renderSongPage(song, index, { details, linked, renderPost, contactAddress }) {
  const id = youtubeId(song.youtube);
  const album = ALBUMS[song.album];
  const verified = Boolean(details);
  const fieldSource = field => {
    if (!details) return "";
    // Page-level sources alone do not establish which individual field they support.
    const labels = details.fieldSources?.[field] ?? [];
    if (!labels.length) return tri("small", ["该项来源待逐项对应", "Field source not yet mapped", "項目別の出典は未整理"], ' class="song-fact-note"');
    const links = labels.map(label => details.sources.find(source => source.label === label)).filter(Boolean)
      .map(source => `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)} ↗</a>`).join(" · ");
    return `<small class="song-fact-note">${tri("span", ["来源：", "Source: ", "出典："])}${links}</small>`;
  };
  const releaseValue = (details?.releasedAt
    ? `<time datetime="${escape(details.releasedAt)}" data-local-time>${escape(date(details.releasedAt))} JST</time>${details.releaseConfidence === "inferred" ? tri("span", ["（推定）", " (estimated)", "（推定）"], ' class="song-fact-note"') : ""}${fieldSource("releasedAt")}`
    : `<span>—</span> ${UNVERIFIED}`) + (details?.releaseNote ? tri("small", [details.releaseNote.zh, details.releaseNote.en, details.releaseNote.ja], ' class="song-fact-note"') : "");
  const albumValue = album
    ? `<span lang="ja">${escape(album.name)}</span> ${tri("span", album.kind, ' class="song-fact-note"')}${verified && details.albumRelease ? ` <span class="song-fact-note">${escape(details.albumRelease)}</span>` : ""}`
    : tri("span", ["单曲 / 其他", "Single / other", "シングル・その他"]);
  const unofficialVocal = details?.unofficialVocal;
  const unofficialLinks = unofficialVocal?.sources.map(source => `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)} <span aria-hidden="true">↗</span></a>`).join(" · ");
  const vocalValue = details?.vocal ? `<span lang="ja">${escape(details.vocal)}</span>${fieldSource("vocal")}`
    : unofficialVocal ? `<span lang="ja">${escape(unofficialVocal.name)}</span> ${UNOFFICIAL}<small class="song-fact-note">${tri("span", ["官方来源未确认。参考：", "Not confirmed by official sources. Reference: ", "公式の出典では未確認。参考："])}${unofficialLinks}</small>`
    : !verified && song.singers.length ? `${escape(song.singers.join(" / "))} ${tri("span", ["站内歌曲表", "this site’s song list", "サイト楽曲表"], ' class="song-fact-note"')}` : `<span>—</span> ${UNVERIFIED}`;
  const creditRows = Object.entries(ROLES).filter(([role]) => ["illustration", "animation", "movie"].includes(role) || details?.unverified.includes(role) || details?.credits.some(credit => credit.role === role)).map(([role, label]) => {
    const credit = details?.credits.filter(entry => entry.role === role) ?? [];
    const value = credit.length
      ? credit.map(entry => entry.url ? `<a href="${escape(entry.url)}" target="_blank" rel="noopener noreferrer" lang="ja">${escape(entry.name)} <span aria-hidden="true">↗</span></a>` : `<span lang="ja">${escape(entry.name)}</span>`).join(" / ") + fieldSource(role)
      : `<span>—</span> ${UNVERIFIED}`;
    return row(label, value);
  }).join("");
  const videoLabel = details?.videoKind === "reupload" ? ["视频（非官方转载）", "Video (unofficial reupload)", "動画（非公式転載）"]
    : details?.videoKind === "topic" ? ["专辑音轨", "Album audio", "アルバム音源"]
      : details?.videoKind === "medley" ? ["合作串烧", "Collaborative medley", "合作メドレー"] : ["MV", "MV", "MV"];
  const videoNote = details?.videoNote ? tri("small", [details.videoNote.zh, details.videoNote.en, details.videoNote.ja], ' class="song-fact-note"') : "";
  const facts = `<dl class="song-facts">${row(["发布日期", "Released", "公開日"], releaseValue)}${row(["收录", "Album", "収録"], albumValue)}${row(["演唱", "Vocal", "ボーカル"], vocalValue)}${row(videoLabel, `<a href="${escape(`https://www.youtube.com/watch?v=${id}`)}" target="_blank" rel="noopener noreferrer">YouTube <span aria-hidden="true">↗</span></a>${videoNote}`)}${creditRows}</dl>`;
  const creditNote = details?.creditNote ? tri("p", [details.creditNote.zh, details.creditNote.en, details.creditNote.ja], ' class="song-sources"') : "";
  const sources = verified
    ? `<p class="song-sources">${tri("span", [`核对于 ${details.checkedAt}，来源：`, `Checked ${details.checkedAt}. Sources: `, `${details.checkedAt} 確認。出典：`])}${details.sources.map(source => `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)} <span aria-hidden="true">↗</span></a>`).join(" · ")}</p>`
    : tri("p", ["这首歌尚未逐项核对官方资料：标为“未核对”的栏目暂时留空，演唱来自本站歌曲表。", "This song has not been checked field by field yet: “Unverified” fields stay blank, and the vocal comes from this site’s song list.", "この曲は公式情報をまだ項目ごとに確認していません。「未確認」の欄は空欄で、ボーカルはサイトの楽曲表によるものです。"], ' class="song-sources"');
  const feedbackSubject = encodeURIComponent(`Song archive feedback: ${song.title}`);
  const feedbackBody = encodeURIComponent(`Song / 曲名: ${song.title}\nVideo ID: ${id}\n\nField / 待核对项目:\nCorrection / 建议修改:\nSource / 参考来源:\n`);
  const feedback = contactAddress ? `<p class="song-sources"><a href="mailto:${escape(contactAddress)}?subject=${feedbackSubject}&amp;body=${feedbackBody}">${tri("span", ["提供资料或纠错", "Suggest a source or correction", "情報提供・訂正を提案"])}</a></p>` : "";
  const groups = [["release", ["发布消息", "Release announcements", "公開のお知らせ"]], ["milestone", ["播放里程碑", "View milestones", "再生数の節目"]], ["note", ["创作笔记与其他提及", "Creative notes and other mentions", "制作メモ・その他の言及"]]];
  const shown = linked.slice(0, SONG_POST_LIMIT);
  const postSections = groups.map(([category, label]) => {
    const items = shown.filter(post => post.category === category);
    return items.length ? `<section class="song-posts-group" aria-label="${escape(label[0])}" data-aria-zh="${escape(label[0])}" data-aria-en="${escape(label[1])}" data-aria-ja="${escape(label[2])}">${tri("h3", [`${label[0]}（${items.length}）`, `${label[1]} (${items.length})`, `${label[2]}（${items.length}）`])}<div class="x-posts-feed">${items.map(post => renderPost(post.id)).join("\n")}</div></section>` : "";
  }).join("");
  const more = linked.length > shown.length ? tri("p", [`另有 ${linked.length - shown.length} 条匹配帖子未在此列出。`, `${linked.length - shown.length} more matching posts are not listed here.`, `ほかに一致した投稿が${linked.length - shown.length}件あります。`], ' class="song-posts-more"') : "";
  const posts = linked.length
    ? `${tri("p", ["按视频 ID、已核对的来源帖或曲名从已收录的 X 帖子中匹配，分类依据帖子用词，可能包含同名专辑等其他话题。", "Matched from collected X posts by video ID, checked source posts or title; categories follow the wording and may include other topics such as a same-named album.", "収録済みのX投稿から動画ID・確認済みの出典投稿・曲名で抽出しています。分類は投稿の言葉づかいによるもので、同名アルバムなど別の話題を含む場合があります。"], ' class="song-posts-note"')}${postSections}${more}`
    : tri("p", ["已收录的 X 帖子中暂未找到与这首歌明确相关的帖子。", "No collected X post clearly mentions this song yet.", "収録済みのX投稿に、この曲に明確に関連するものはまだありません。"], ' class="x-posts-empty"');
  return `<article class="song-record" data-song-id="${id}">
<div class="observation-label"><span class="observation-dot" aria-hidden="true"></span><span>SONG OBSERVATION</span><span class="observation-number" aria-hidden="true">NO. ${String(index + 1).padStart(2, "0")}</span></div>
<h1 class="song-title" lang="ja">${escape(song.title)}</h1>
${facts}
${creditNote}
${sources}
${feedback}
<section class="song-posts" aria-labelledby="song-posts-title"><div class="feed-heading"><div><p class="section-kicker">X / LINKED POSTS</p>${tri("h2", ["相关帖子", "Linked posts", "関連する投稿"], ' id="song-posts-title"')}</div></div>${posts}</section>
</article>`;
}

// Dates are the archive's reported public dates, not necessarily the date of a later
// album or streaming release. The detail page carries the source and any uncertainty.
export function releaseYear(entry) {
  const stamp = entry?.releasedAt ? Date.parse(entry.releasedAt) : NaN;
  return Number.isFinite(stamp) ? String(new Date(stamp + 9 * 3_600_000).getUTCFullYear()) : "unknown";
}

// One list in archive order. Each entry shows its year and album, so nothing is lost without
// JavaScript; js/archive-pages.js reveals a single filter menu (album or year, then one value)
// and saves the choice in the URL.
export function renderSongIndex(songs, details, linkedMap) {
  const entries = songs.map((song, index) => {
    const id = youtubeId(song.youtube);
    const album = ALBUMS[song.album];
    return { song, index, id, year: releaseYear(details[id]), album: album?.slug ?? "singles",
      albumLabels: album ? [album.name, album.name, album.name] : SINGLES,
      albumHtml: album ? `<span lang="ja">${escape(album.name)}</span>` : tri("span", SINGLES) };
  });
  const tally = key => entries.reduce((counts, entry) => counts.set(entry[key], (counts.get(entry[key]) ?? 0) + 1), new Map());
  const albums = tally("album"), years = tally("year");
  const yearOrder = [...years.keys()].filter(year => year !== "unknown").sort((a, b) => Number(b) - Number(a));
  if (years.has("unknown")) yearOrder.push("unknown");
  const unknownYear = ["年份待确认", "Year unconfirmed", "年未確認"];
  const check = '<span class="song-filter-check" aria-hidden="true">✓</span>';
  const count = value => `<span class="song-filter-count" aria-hidden="true">${value}</span>`;
  const label = (labels, japanese) => japanese ? `<span class="song-filter-text" lang="ja">${escape(labels[0])}</span>` : tri("span", labels, ' class="song-filter-text"');
  // data-label-* gives the trigger button its "Filter: <choice>" text in every language.
  const option = (facet, value, labels, html, total) => `<button type="button" data-song-filter="${facet}" data-value="${escape(value)}" data-label-zh="${escape(labels[0])}" data-label-en="${escape(labels[1])}" data-label-ja="${escape(labels[2])}" aria-pressed="false">${check}${html}${count(total)}</button>`;
  const branch = (facet, labels, options) => `<div class="song-filter-branch"><button type="button" id="song-filter-mode-${facet}" class="song-filter-mode" data-song-mode="${facet}" aria-expanded="false" aria-controls="song-filter-${facet}">${check}${tri("span", labels, ' class="song-filter-text"')}<span class="song-filter-arrow" aria-hidden="true">›</span></button><div id="song-filter-${facet}" class="song-filter-submenu" role="group" aria-labelledby="song-filter-mode-${facet}" hidden>${options.join("")}</div></div>`;
  const albumOptions = [...albums.keys()].map(slug => {
    const { albumLabels } = entries.find(entry => entry.album === slug);
    return option("album", slug, albumLabels, label(albumLabels, slug !== "singles"), albums.get(slug));
  });
  const yearOptions = yearOrder.map(year => {
    const labels = year === "unknown" ? unknownYear : [year, year, year];
    return option("year", year, labels, year === "unknown" ? label(labels) : `<span class="song-filter-text">${escape(year)}</span>`, years.get(year));
  });
  const menu = `<div id="song-filter-menu" class="song-filter-menu" hidden><button type="button" id="song-filter-all" class="song-filter-all" aria-pressed="true">${check}${tri("span", ["全部歌曲", "All songs", "すべての曲"], ' class="song-filter-text"')}${count(entries.length)}</button>${branch("album", ["按专辑", "By album", "アルバムから"], albumOptions)}${branch("year", ["按年份", "By year", "公開年から"], yearOptions)}</div>`;
  const toggle = `<button type="button" id="song-filter-toggle" class="song-filter-toggle" aria-expanded="false" aria-controls="song-filter-menu">${tri("span", ["筛选", "Filter", "絞り込み"], ' id="song-filter-toggle-label"')}<span class="song-filter-caret" aria-hidden="true">▾</span></button>`;
  const filters = `<div id="song-filters" class="song-filters" hidden><div class="song-filter-dropdown">${toggle}${menu}</div><p id="song-filter-status" class="updates-count" role="status" aria-live="polite"></p>${tri("button", ["清除筛选", "Clear filter", "絞り込みを解除"], ' type="button" id="song-filter-reset" class="song-filter-reset" hidden')}</div>`;
  const list = entries.map(({ song, index, id, year, album, albumHtml }) => {
    const badge = details[id] ? tri("span", ["部分资料已核对", "Some sources checked", "一部資料を確認"], ' class="song-checked"') : "";
    const inferred = details[id]?.releaseConfidence === "inferred" ? tri("span", ["日期推定", "Date inferred", "日付は推定"], ' class="song-year-inferred"') : "";
    const yearHtml = year === "unknown" ? tri("span", unknownYear, ' class="song-index-year"') : `<span class="song-index-year">${year}</span>`;
    const count = linkedMap.get(id)?.length ?? 0;
    return `<li value="${index + 1}" data-album="${album}" data-year="${year}"><a href="${songPageName(song)}" lang="ja">${escape(song.title)}</a>${badge}<span class="song-index-meta"><span>${yearHtml}${inferred ? ` ${inferred}` : ""}</span> ${albumHtml} ${tri("span", [`${count} 条相关帖子`, `${count} linked post${count === 1 ? "" : "s"}`, `関連投稿${count}件`], ' class="song-index-count"')}</span></li>`;
  }).join("");
  return `<section class="song-browser" aria-labelledby="song-browser-title">${tri("h2", ["歌曲列表", "Song list", "楽曲一覧"], ' id="song-browser-title"')}${tri("p", ["年份按档案记载的公开日期（日本时间）计算；具体版本、日期精度及待确认的信息请查看歌曲详情。", "Years follow the public date recorded in the archive (Japan time). See each song for its version, date precision and uncertainties.", "公開年はアーカイブに記載された公開日（日本時間）によるものです。版・日付の精度・未確認情報は各曲の詳細をご覧ください。"], ' class="song-browser-note"')}${filters}<ol id="song-list" class="song-index-list">${list}</ol>${tri("p", ["没有符合筛选条件的歌曲。", "No songs match these filters.", "条件に合う曲はありません。"], ' id="song-filter-empty" class="updates-empty" hidden')}</section>`;
}
