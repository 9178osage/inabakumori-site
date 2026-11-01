const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("reserved nicknames cover owner/creator names in every spelling but leave ordinary names alone", async () => {
  const { isReservedNickname } = await import("../../backend/services.mjs");
  for (const name of ["站长", "本站站長", "管 理 员", "稲葉曇", "稻叶昙bot", "いなばくもり", "ｲﾅﾊﾞｸﾓﾘ", "Admin", "ＡＤＭＩＮ", "the_admin", "Inaba Kumori", "inabakumori", "Official", "site owner", "mod"]) {
    assert.equal(isReservedNickname(name), true, name);
  }
  for (const name of ["雨", "测试", "badminton", "modern", "administrate2", "ownership", "稲葉", "kumori fan", "游客"]) {
    assert.equal(isReservedNickname(name), false, name);
  }
});

test("the server rejects reserved nicknames only for non-admins and exposes a boolean badge, never the account ID", () => {
  const server = fs.readFileSync("backend/server.mjs", "utf8");
  assert.match(server, /!isAdmin && isReservedNickname\(nickname\)/u);
  assert.match(server, /code: "RESERVED_NICKNAME"/u);
  assert.match(fs.readFileSync("script.js", "utf8"), /RESERVED_NICKNAME/u);
  const cache = fs.readFileSync("backend/public-comments-cache.mjs", "utf8");
  assert.doesNotMatch(cache, /user_?id/iu, "the public projection must not mention account IDs");
});
