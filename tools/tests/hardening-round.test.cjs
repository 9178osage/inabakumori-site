const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = file => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");

// ---------------------------------------------------------------- paths (item 1)

test("request paths are normalised before the limiters and the backup check decide", async () => {
  const { normalizeRequestPath } = await import("../../backend/services.mjs");
  const cases = [
    ["/auth/signin", "/auth/signin"],
    ["//auth/signin", "/auth/signin"],
    ["///auth//public/signin", "/auth/public/signin"],
    ["\\auth\\public\\signin", "/auth/public/signin"],
    ["/AUTH/Signin", "/auth/signin"],
    ["/outside/../auth/public/signin", "/auth/public/signin"],
    ["/outside/%2e%2e/auth/public/signin", "/auth/public/signin"],
    ["/auth/%73ignin", "/auth/signin"],
    ["/auth/signin?x=1#y", "/auth/signin"],
    ["/api//comments/1", "/api/comments/1"],
    ["/api/admin//backup/", "/api/admin/backup"],
    ["//api//admin//backup/", "/api/admin/backup"]
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeRequestPath(input), expected, input);
  }

  const { isBackupPath } = await import("../../backend/backup-endpoint.mjs");
  for (const spelling of ["/api/admin/backup", "/api/admin/backup/", "//api/admin/backup", "/api//admin//backup/"]) {
    assert.equal(isBackupPath(spelling), true, spelling);
  }
  assert.equal(isBackupPath("/api/admin/backup/extra"), false);

  const server = read("backend/server.mjs");
  assert.doesNotMatch(server, /function normalizedRequestPath/, "the local copy must not come back");
  assert.match(server, /const pathname = normalizeRequestPath\(req\.originalUrl \|\| req\.url\);/,
    "the DELETE limiter uses the shared normaliser");
});

// ------------------------------------------------- comments (items 2 and 3)

test("invisible characters cannot smuggle contact details past the filter or the duplicate check", async () => {
  const { detectCommentSafetyIssue, normalizeCommentForComparison } = await import("../../backend/services.mjs");
  for (const content of [
    "138\u28001234\u28005678",
    "138\u034F1234\u034F5678",
    "微信\u2060：abc123",
    "联系我\ufeff13812345678",
    "加\u2060微信\u00AD：abc"
  ]) {
    assert.equal(detectCommentSafetyIssue(content)?.code, "PROMOTIONAL_CONTENT", JSON.stringify(content));
  }
  // A duplicate written with an invisible character is still the same text.
  assert.equal(
    normalizeCommentForComparison("重复检测\u2060测试"),
    normalizeCommentForComparison("重复检测测试")
  );
  assert.equal(normalizeCommentForComparison("  Rain　station\n"), "rain station");
});

test("line breaks are normalised and capped so one comment cannot stretch the wall", async () => {
  const { validateCommentInput } = await import("../../backend/services.mjs");
  const flood = validateCommentInput({ nickname: "n", content: "首" + "\n".repeat(300) + "尾" });
  assert.equal(flood.ok, true);
  assert.equal(flood.content, "首\n\n尾", "runs of blank lines collapse");

  const many = validateCommentInput({ nickname: "n", content: ("行\n").repeat(17) });
  assert.equal(many.ok, false, "more than 15 breaks is rejected");
  assert.equal(validateCommentInput({ nickname: "n", content: "第一行\n第二行\n第三行" }).ok, true);

  const crlf = validateCommentInput({ nickname: "n", content: "a\r\nb\r\nc" });
  assert.equal(crlf.ok, true);
  assert.equal(crlf.content, "a\nb\nc");
});

test('"代购" only counts as advertising when it solicits contact', async () => {
  const { detectCommentSafetyIssue } = await import("../../backend/services.mjs");
  for (const fanText of ["找代购买了新专辑", "这次周边是找代购帮忙买的", "代购的专辑很好听"]) {
    assert.equal(detectCommentSafetyIssue(fanText), null, fanText);
  }
  for (const ad of ["代购加我微信", "代购 私信我", "代购联系我下单"]) {
    assert.equal(detectCommentSafetyIssue(ad)?.code, "PROMOTIONAL_CONTENT", ad);
  }
});

// ---------------------------------------------------------------- storage (item 4)

function storageHarness({ refuseWrites = false } = {}) {
  const store = new Map();
  const localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      if (refuseWrites) throw new Error("quota");
      store.set(key, String(value));
    }
  };
  const document = { documentElement: { dataset: {} }, querySelectorAll: () => [] };
  const window = { siteStorage: null, matchMedia: () => ({ matches: false }) };
  window.top = window;
  window.self = window;
  vm.runInNewContext(read("js/preferences.js"), { window, document, localStorage, Map, String });
  return { storage: window.siteStorage, store };
}

test("siteStorage sees writes made by other tabs instead of shadowing them in memory", () => {
  const { storage, store } = storageHarness();
  storage.setItem("language", "zh");
  assert.equal(storage.getItem("language"), "zh");
  store.set("language", "ja");                       // another tab wrote
  assert.equal(storage.getItem("language"), "ja", "no stale in-memory copy may shadow storage");
});

test("siteStorage still serves values when the browser refuses to write", () => {
  const { storage } = storageHarness({ refuseWrites: true });
  storage.setItem("theme", "dark");
  assert.equal(storage.getItem("theme"), "dark", "private mode keeps working for this session");
});

// ---------------------------------------------------------------- frontend (items 5-8)

test("wall, share links, dialogs and gallery follow the hardening rules", () => {
  const script = read("script.js");
  assert.match(script, /element\.refreshLanguage = \(deferLayout = false\) => \{/);
  assert.match(script, /floatingMessages\.forEach\(\(element\) => element\.refreshLanguage\?\.\(true\)\);/);
  assert.match(script, /if \(!deferLayout && wall\.firstChild && typeof wall\.insertBefore === "function"\) wall\.insertBefore\(element, wall\.firstChild\);/);
  assert.match(script, /removeExpiredMessages\(\); \}, 30000\);/);

  const experience = read("js/experience.js");
  assert.match(experience, /if \(lightbox && !lightbox\.hidden\) return;/);
  assert.match(experience, /document\.getElementById\("easter-egg-overlay"\)\?\.classList\.contains\("show"\)/);
  assert.match(experience, /url\.search = "";/);

  const comments = read("js/comments.js");
  const personalRemove = comments.slice(comments.indexOf("async function remove(id) {"), comments.indexOf("document.addEventListener(\"DOMContentLoaded\""));
  assert.match(personalRemove, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(personalRemove, /if \(current === version\) render\(\);/);

  const gallery = read("js/nknk-gallery-ui.js");
  assert.match(gallery, /const MAX_PRELOAD_CACHE = 6;/);
  assert.match(gallery, /while \(preloadCache\.size > MAX_PRELOAD_CACHE\) preloadCache\.delete\(preloadCache\.keys\(\)\.next\(\)\.value\);/);
  assert.match(gallery, /preloadCache\.clear\(\);/);
  assert.match(gallery, /if \(!force && now - row\.lastThumbLoad < THUMB_LOAD_INTERVAL_MS\) return;/);
  assert.doesNotMatch(gallery, /\n    let lastThumbLoad = 0;/);

  const auth = read("tools/auth-src.js");
  assert.match(auth, /const switchButton = document\.getElementById\("auth-switch"\);/);
  assert.match(auth, /const needsRuleHint = authMode === "reset" \|\| authMode === "signup";/);
  assert.match(auth, /if \(\(submittedMode === "signup" \|\| submittedMode === "reset"\) &&/);
});

test("asset versions and localised copy stay aligned", () => {
  const html = read("index.html");
  assert.match(html, /href="site\.webmanifest\?v=3"/);
  assert.match(html, /href="favicon\.ico\?v=3"/);
  assert.equal((html.match(/src="images\/fandom\.png\?v=3"/g) || []).length, 2);
  assert.match(html, /<a class="skip-link" href="#main-content" data-zh="[^"]+" data-en="[^"]+" data-ja="[^"]+">/);
  assert.doesNotMatch(html, /\?v=2"/, "no reference may lag a version behind");

  const readme = read("README.md");
  assert.match(readme, /ゲスト投稿は6か月（半年）で期限切れ/);
  assert.doesNotMatch(readme, /ゲスト投稿は30日後に期限切れ/);

  const manifest = JSON.parse(read("site.webmanifest"));
  for (const icon of manifest.icons) assert.match(icon.src, /\?v=3$/);
});
