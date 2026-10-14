const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
const lines = n => Array.from({ length: n + 1 }, (_, i) => `第${i}行`).join("\n");

test("too many line breaks get their own error code", async () => {
  const { validateCommentInput } = await import("../../backend/services.mjs");
  const rejected = validateCommentInput({ nickname: "fan", content: lines(16) });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "TOO_MANY_LINE_BREAKS");
  assert.match(rejected.error, /15/);
  assert.equal(validateCommentInput({ nickname: "fan", content: lines(15) }).ok, true);
  // CRLF and blank-line runs are normalised before counting, as before.
  assert.equal(validateCommentInput({ nickname: "fan", content: lines(15).replace(/\n/g, "\r\n") }).ok, true);
});

test("soliciting 代购 is still flagged", async () => {
  const { validateCommentInput } = await import("../../backend/services.mjs");
  assert.equal(validateCommentInput({ nickname: "fan", content: "代购加我微信" }).ok, false);
});

test("frontend maps TOO_MANY_LINE_BREAKS in zh/en/ja and checks it before submitting", () => {
  const script = read("script.js");
  assert.match(script, /TOO_MANY_LINE_BREAKS: \["留言换行太多，最多 15 个换行。"/);
  assert.match(script, /countCommentLineBreaks\(content\) > MAX_COMMENT_LINE_BREAKS/);
  assert.match(read("js/i18n.js"), /"留言换行太多，最多 15 个换行。": "改行が多すぎます/);
});
