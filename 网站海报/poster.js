// Offline snapshot. The poster test checks these readings against the site data.
const READINGS = [55, 107, 6112];

const COPY = {
  zh: {
    obs: "REPORT 001 / 003 · ZH",
    title: ["气象观测站"],
    tagline: "在声音与线条之间，记录新的消息。",
    intro: ["一个因为太喜欢稲葉曇", "所以做出来的网站。"],
    panelK: "LATEST READINGS / 观测读数",
    reads: [
      ["首歌曲", "SONGS", "附 MV 链接、专辑、歌手与标签，可搜索、筛选、随机播放"],
      ["幅插画", "ARTWORKS", "ぬくぬくにぎりめし（NKNK）插画库"],
      ["条帖子", "POSTS", "稲葉曇与 NKNK 的公开帖子，保留原文与来源"],
    ],
    menu: [["01", "简介", "THE ARTIST"], ["02", "最新动态", "LATEST"], ["03", "NKNK 插画", "ARTWORK"], ["04", "歌曲", "DISCOGRAPHY"], ["05", "留言墙", "MESSAGES"], ["☂", "神秘小日历", "CALENDAR"]],
    footK: "VISIT THE STATION / 进入观测站",
    feat: "歌曲 · 动态 · 插画 · 留言墙 　|　 中文 · English · 日本語",
    note: "本站为非官方粉丝站，与创作者及官方厂牌／平台无关。",
    scan: "扫码进入观测站",
  },
  en: {
    obs: "REPORT 002 / 003 · EN",
    title: ["WEATHER", "OBSERVATION", "STATION"],
    tagline: "New signals, between sound and line.",
    intro: ["A website made because", "I really love Inabakumori."],
    panelK: "LATEST READINGS",
    reads: [
      ["songs", "SONGS", "MV links, albums, vocalists, tags, random picks"],
      ["artworks", "GALLERY", "Art by Nukunuku Nigirimeshi (NKNK)"],
      ["posts", "ARCHIVE", "Public posts by Inabakumori & NKNK, with sources"],
    ],
    menu: [["01", "Intro", "THE ARTIST"], ["02", "Latest updates", "LATEST"], ["03", "NKNK artwork", "ARTWORK"], ["04", "Songs", "DISCOGRAPHY"], ["05", "Message Wall", "MESSAGES"], ["☂", "Secret little calendar", "CALENDAR"]],
    footK: "VISIT THE STATION",
    feat: "Songs · Updates · Artwork · Message Wall 　|　 中文 · English · 日本語",
    note: "An unofficial fan site, unaffiliated with the creators or any official label or platform.",
    scan: "Scan to visit",
  },
  ja: {
    obs: "REPORT 003 / 003 · JA",
    title: ["気象観測所"],
    tagline: "音と線のあいだで、新しい知らせを記録する。",
    intro: ["稲葉曇さんが大好きで", "作ったファンサイトです。"],
    panelK: "LATEST READINGS / 観測値",
    reads: [
      ["曲", "SONGS", "MV・アルバム・ボーカル・タグ、検索とランダム再生"],
      ["点のイラスト", "ARTWORKS", "ぬくぬくにぎりめし（NKNK）さんのイラスト集"],
      ["件の投稿", "POSTS", "稲葉曇さん・NKNKさんの公開投稿を原文のまま"],
    ],
    menu: [["01", "紹介", "THE ARTIST"], ["02", "最新情報", "LATEST"], ["03", "NKNKイラスト", "ARTWORK"], ["04", "楽曲", "DISCOGRAPHY"], ["05", "メッセージウォール", "MESSAGES"], ["☂", "ひみつの小さなカレンダー", "CALENDAR"]],
    footK: "VISIT THE STATION / 観測所へ",
    feat: "楽曲・最新情報・イラスト・メッセージウォール 　|　 中文 · English · 日本語",
    note: "本サイトは非公式ファンサイトであり、クリエイターや公式レーベル・プラットフォームとは関係ありません。",
    scan: "読み取って観測所へ",
  },
};
const rawLang = new URLSearchParams(location.search).get("lang");
const lang = ["zh", "en", "ja"].includes(rawLang) ? rawLang : "zh";
const c = COPY[lang];
document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
const $ = id => document.getElementById(id);
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
$("obs").textContent = c.obs;
c.title.forEach((text, index) => {
  if (index) $("title").append(element("br"));
  const span = element("span", "g", text);
  span.dataset.t = text;
  $("title").append(span);
});
$("tagline").textContent = c.tagline;
c.intro.forEach((text, index) => {
  if (index) $("intro").append(element("br"));
  $("intro").append(document.createTextNode(text));
});
$("panel-k").textContent = c.panelK;
c.reads.forEach(([unit, label, description], index) => {
  const row = element("div", "read");
  const unitNode = element("span", "unit", unit);
  unitNode.append(element("small", "", label));
  row.append(element("span", "n", READINGS[index].toLocaleString("en-US")), unitNode, element("p", "d", description));
  $("reads").append(row);
});
c.menu.forEach(([number, text, label], index) => {
  const calendar = index === c.menu.length - 1;
  const row = element("div", calendar ? "cal" : "");
  const title = element("span");
  if (calendar) title.append(element("em", "", text));
  else title.textContent = text;
  row.append(element("span", "", number), title, element("span", "", label));
  $("menu").append(row);
});
$("foot-k").textContent = c.footK;
$("feat").textContent = c.feat;
$("note").textContent = c.note;
$("scan").textContent = c.scan;
document.querySelectorAll("#langs span").forEach(s => s.classList.toggle("on", s.dataset.l === lang));

// Deterministic rain, kept clear of every text block so readings stay legible.
let seed = 20261103;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rain = $("rain");
const pad = 28;
const blocks = [...document.querySelectorAll(".bar, .sub-bar, .eyebrow, h1 .g, .tagline, .intro, .panel")].map(el => el.getBoundingClientRect());
const clear = (x, y, h) => blocks.every(r => x < r.left - pad || x > r.right + pad || y + h < r.top - pad || y > r.bottom + pad);
for (let placed = 0, tries = 0; placed < 96 && tries < 8000; tries++) {
  const x = rnd() * 2400, y = rnd() * 2700 - 120, h = 70 + rnd() * 150, light = rnd() < .4, o = .35 + rnd() * .55;
  if (!clear(x, y, h)) continue;
  const i = document.createElement("i");
  if (light) i.className = "l";
  i.style.left = `${x.toFixed(0)}px`;
  i.style.top = `${y.toFixed(0)}px`;
  i.style.height = `${h.toFixed(0)}px`;
  i.style.opacity = o.toFixed(2);
  rain.append(i);
  placed++;
}
