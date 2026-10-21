import assert from "node:assert/strict";

const escape = value => String(value).replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const creators = { inabakumori: "稲葉曇", nknk: "NKNK" };
const sources = {
  youtube: { creator: "inabakumori", label: "YouTube", url: "https://www.youtube.com/@inabakumori" },
  pixiv: { creator: "nknk", label: "pixiv", url: "https://www.pixiv.net/users/27327959" },
  campfire: { creator: "nknk", label: "CAMPFIRE Creation", url: "https://camp-fire.jp/projects/970332/view/activities" }
};
const text = (tag, values, attributes = "") => `<${tag}${attributes} data-zh="${escape(values[0])}" data-en="${escape(values[1])}" data-ja="${escape(values[2])}">${escape(values[0])}</${tag}>`;
const date = value => {
  assert.ok(typeof value === "string" && Number.isFinite(Date.parse(value)), "Invalid update timestamp");
  return new Date(value).toISOString();
};
const time = (value, precision) => `<time datetime="${date(value)}">${precision === "day" ? date(value).slice(0, 10) : new Date(value).toLocaleString("sv-SE", { timeZone: "Asia/Tokyo", hour12: false }).slice(0, 16) + " JST"}</time>`;

export function renderCreatorUpdates(snapshot) {
  assert.equal(snapshot?.version, 1, "Unsupported updates snapshot");
  assert.ok(Array.isArray(snapshot.sources) && snapshot.sources.length === 3 && Array.isArray(snapshot.items), "Invalid updates snapshot");
  const seenSources = new Set();
  const status = snapshot.sources.map(source => {
    const known = sources[source.id];
    assert.ok(known && known.creator === source.creator && !seenSources.has(source.id), "Unknown or duplicate update source");
    assert.ok(["ok", "error"].includes(source.status), "Invalid update source status");
    assert.ok(source.status !== "ok" || source.checkedAt, "Successful source needs a check time");
    seenSources.add(source.id);
    const successful = source.checkedAt ? `${text("span", ["上次成功检查", "Last successful check", "最終確認"])} ${time(source.checkedAt)}` : text("span", ["尚未成功读取，请查看官方账号。", "No successful check yet. Visit the official account.", "まだ取得できていません。公式アカウントをご確認ください。"]);
    const error = source.status === "error" ? text("p", ["本次读取失败，保留上次内容；请以官方发布为准。", "The latest check failed. Previous entries are retained; please check the official source.", "今回の取得に失敗しました。前回の内容を保持しています。公式発表をご確認ください。"], ' class="source-error"') : "";
    const attempt = source.status === "error" && source.lastAttemptAt ? `<p>${text("span", ["最近尝试", "Last attempt", "最終取得試行"])} ${time(source.lastAttemptAt)}</p>` : "";
    return `<article class="source-status" data-state="${source.status}" data-source="${source.id}" data-checked-at="${source.checkedAt ? date(source.checkedAt) : ""}"><h3>${creators[source.creator]} · ${known.label}</h3><p>${successful}</p>${error}${attempt}<p class="source-stale" hidden>${text("span", ["超过 72 小时未成功检查，内容可能尚未更新。", "No successful check in over 72 hours. New posts may be missing.", "72時間以上確認できていないため、新しい投稿が未掲載の可能性があります。"])} <a href="${known.url}" target="_blank" rel="noopener noreferrer">${escape(known.label)} ↗</a></p></article>`;
  }).join("\n");
  const seenItems = new Set();
  const ordered = [...snapshot.items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || String(a.id).localeCompare(String(b.id)));
  const items = ordered.map((item, index) => {
    const known = sources[item.source];
    assert.ok(known && known.creator === item.creator && seenSources.has(item.source), "Update source/creator mismatch");
    assert.ok(typeof item.title === "string" && item.title.trim().length > 0 && item.title.length <= 2000, "Invalid update title");
    assert.ok(!seenItems.has(item.id), "Duplicate update item");
    seenItems.add(item.id);
    const url = new URL(item.url);
    const valid = item.source === "youtube"
      ? /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/u.test(url.href)
      : item.source === "pixiv" ? /^https:\/\/www\.pixiv\.net\/artworks\/\d+$/u.test(url.href)
      : /^https:\/\/camp-fire\.jp\/projects\/970332\/view\/activities\/\d+$/u.test(url.href);
    assert.ok(valid, "Invalid update destination");
    const description = item.source === "youtube" ? ["稲葉曇官方频道发布的视频。标题保留原文，详情请查看原始发布。", "A video from Inabakumori’s official channel. Original title; follow the source for details.", "稲葉曇さんの公式チャンネルの動画です。原題を掲載しています。詳細は公開元をご覧ください。"] : item.source === "pixiv" ? ["NKNK 本人在 pixiv 发布的插画。此日期为作品发布时间，更多近况请查看作者的 X。", "An illustration published by NKNK on pixiv. This is the work’s publication date; visit X for other news.", "NKNKさんがpixivに投稿した作品です。作品の公開日を掲載しています。その他の近況はXをご覧ください。"] : ["NKNK 合作项目主办方的公告，并非作者本人发帖。本轮众筹已于 2026 年 9 月 23 日结束。", "An announcement from the organizer of NKNK’s collaboration, rather than a personal post. This campaign ended on September 23, 2026.", "NKNKさんのコラボ企画の主催者によるお知らせです。ご本人の投稿ではありません。この募集は2026年9月23日に終了しました。"];
    return `<article class="update-item" data-creator="${item.creator}" data-source="${item.source}"><span class="update-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><div class="update-content"><div class="update-meta">${time(item.publishedAt, item.datePrecision)}<span class="update-source">${creators[item.creator]} / ${known.label}</span></div><h3><a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer" lang="ja">${escape(item.title)}</a></h3>${text("p", description, ' class="update-summary"')}</div>${text("a", ["查看原文 ↗", "View original ↗", "公開元を見る ↗"], ` class="update-link" href="${escape(url.href)}" target="_blank" rel="noopener noreferrer"`)}</article>`;
  });
  const homeItems = items.map((item, index) => index < 3 ? item : item.replace('<article class="update-item"', '<article class="update-item" hidden')).join("\n");
  return { status, items: items.join("\n"), homeItems };
}
