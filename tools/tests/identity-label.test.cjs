const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("guest/member labels are shared and translated in every site language", () => {
  const context = { localStorage: { getItem: () => "zh" }, window: {} };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/i18n.js", "utf8"), context);
  const label = context.siteIdentityLabel;
  assert.equal(label(true, "zh"), " [游客]");
  assert.equal(label(false, "zh"), " [已登录]");
  assert.equal(label(true, "en"), " [Guest]");
  assert.equal(label(false, "en"), " [Signed in]");
  assert.equal(label(true, "ja"), " [ゲスト]");
  assert.equal(label(false, "ja"), " [ログイン済み]");
  assert.equal(label(undefined, "en"), "");
  assert.equal(label(false), " [已登录]", "defaults to the stored language");
  assert.equal(label(false, "zh", true), " [站长]");
  assert.equal(label(false, "en", true), " [Site owner]");
  assert.equal(label(false, "ja", true), " [管理人]");
  assert.equal(label(true, "en", true), " [Guest]", "a guest row can never wear the owner badge");
  const script = fs.readFileSync("script.js", "utf8");
  assert.doesNotMatch(script, /\[Member\]/u, "the message wall uses the shared label");
  assert.match(script, /siteIdentityLabel\?\.\(message\.isGuest, currentLanguage, message\.isAdmin === true\)/u);
  assert.match(fs.readFileSync("js/comments.js", "utf8"), /siteIdentityLabel\?\.\(comment\.isGuest, undefined, comment\.isAdmin === true\)/u);
});
