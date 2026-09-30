const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const i18n = fs.readFileSync(path.join(root, "js/i18n.js"), "utf8");

const EXPECTED_EXTERNAL = [
  "https://www.youtube.com/@inabakumori",
  "https://www.nicovideo.jp/user/42833430",
  "https://space.bilibili.com/26040194",
  "https://twitter.com/inabakumori",
  "https://www.instagram.com/inabakumori/",
  "https://www.tiktok.com/@inabakumori",
  "https://www.pixiv.net/users/16662832",
  "https://zh.wikipedia.org/wiki/稻叶昙",
  "https://en.wikipedia.org/wiki/Inabakumori",
  "https://ja.wikipedia.org/wiki/%E7%A8%B2%E8%91%89%E6%9B%87",
  "https://inabakumori.fandom.com/wiki/Inabakumori_Wiki",
  "https://vocaloid.fandom.com/wiki/Inabakumori"
];

test("intro section includes artist bio and unofficial disclaimer", () => {
  assert.match(html, /id="intro"/);
  assert.match(html, /class="artist-intro"/);
  assert.match(html, /class="unofficial-note"/);
  assert.match(html, /非官方粉丝站/);
  assert.match(html, /unofficial fan site/i);
  assert.match(html, /非公式ファンサイト/);
  assert.match(html, /href="#intro"/);
});

test("related links are categorized and include known destinations only", () => {
  for (const label of ["音乐", "社交", "资料"]) {
    assert.match(html, new RegExp(`data-zh="${label}"`));
  }
  for (const url of EXPECTED_EXTERNAL) {
    assert.ok(html.includes(url), `missing expected URL: ${url}`);
  }
  assert.doesNotMatch(html, /本站资源/);
  assert.doesNotMatch(html, /site-resource-link/);
  assert.doesNotMatch(html, /\?si=/);
  assert.doesNotMatch(html, /spm_id_from=/);

  const aboutBlock = html.match(/id="about"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(aboutBlock, /href="#songs"/);
  assert.doesNotMatch(aboutBlock, /href="#artwork"/);
  assert.doesNotMatch(aboutBlock, /href="#messages"/);
  const hrefs = [...aboutBlock.matchAll(/\bhref="([^"]+)"/g)].map((m) => m[1]);
  const external = hrefs.filter((href) => /^https?:/i.test(href));
  for (const href of external) {
    assert.ok(
      EXPECTED_EXTERNAL.some((known) => href === known || href.startsWith(known)),
      `unexpected external href in about section: ${href}`
    );
  }
});

test("i18n.js includes Japanese copy for intro and link categories", () => {
  for (const key of ["简介", "音乐", "社交", "资料", "非官方粉丝站「气象观测站」"]) {
    assert.ok(i18n.includes(`"${key}`) || i18n.includes(key), `missing i18n coverage for: ${key}`);
  }
  assert.match(i18n, /気象観測所/);
  assert.match(i18n, /非公式ファンサイト/);
});
