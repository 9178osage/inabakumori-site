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

test("lookalike letters cannot spell a reserved nickname (audit B6)", async () => {
  const { isReservedNickname, nicknameSkeleton } = await import("../../backend/services.mjs");
  const lookalikes = [
    "аdmin", "АDМІN", "αdmin", "ɑdmin", "ᴀᴅᴍɪɴ", "adm1n", "admín", "àdmïn", "ad\u200bmin", "аdmіn!",
    "rnod", "m0d", "0wner", "оwner", "Оffісіаl", "staｆｆ", "ѕtaff", "ιnabakumοri", "1naba kumor1", "webrnaster",
    "站⻓", "ＩＮＡＢＡＫＵＭＯＲＩ", "ⅰnabakumori"
  ];
  for (const name of lookalikes) assert.equal(isReservedNickname(name), true, name);
  for (const name of ["badmіnton", "modern", "mood", "лето", "Ωmega", "κόσμος", "いなば", "ぱんだ", "user01", "milo", "nikola"]) {
    assert.equal(isReservedNickname(name), false, name);
  }
  assert.equal(nicknameSkeleton("ば"), "ば", "kana voicing marks are kept");
  assert.equal(nicknameSkeleton("аdmin"), nicknameSkeleton("admin"));
});

test("radical forms and a reserved word padded with digits or symbols are caught, ordinary names are not", async () => {
  const { isReservedNickname } = await import("../../backend/services.mjs");
  for (const name of ["站⻑", "本站⻑", "站⻒", "admin1", "admin_", "admin123", "Admin_2024", "1admin", "#admin#", "admin!!", "mod1", "m0d1", "owner99", "staff-01", "站长1", "站⻑123", "official.", "inabakumori2"]) {
    assert.equal(isReservedNickname(name), true, name);
  }
  for (const name of ["Adam", "admiral", "Madmin", "badminton1", "administrate2", "admins_fan", "modem3", "user01", "staffordshire", "長谷川", "长江", "小明", "站台", "店长", "雨天123", "2024", "___", "!!"]) {
    assert.equal(isReservedNickname(name), false, name);
  }
});
