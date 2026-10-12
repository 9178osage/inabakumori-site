const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Readable } = require("node:stream");
const { gzipSync, deflateSync, brotliCompressSync } = require("node:zlib");
const express = require("../../backend/node_modules/express");

const read = file => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
const script = read("script.js");
const html = read("index.html");

async function parserError(data, encoding) {
  const req = Readable.from([data]);
  req.method = "POST";
  req.headers = { "content-type": "application/json", "content-length": String(data.length), "content-encoding": encoding };
  try {
    return await new Promise(resolve => express.json({ limit: "20kb" })(req, {}, resolve));
  } finally { req.destroy(); }
}

test("1: corrupt compressed JSON bodies keep body-parser's 4xx status with a generic message", async () => {
  const { clientErrorResponse } = await import("../../backend/services.mjs");
  const valid = Buffer.from('{"a":1}');
  for (const [encoding, compressed] of [["gzip", gzipSync(valid)], ["deflate", deflateSync(valid)], ["br", brotliCompressSync(valid)]]) {
    const corrupt = Buffer.from(compressed);
    corrupt.fill(0x41, 2, Math.min(corrupt.length, 12));
    const error = await parserError(corrupt, encoding);
    assert.ok(error, `${encoding} body must be rejected`);
    const result = clientErrorResponse(error);
    assert.ok(result, `${encoding}: ${error.status} ${error.type}`);
    assert.equal(result.status, 400, encoding);
    assert.deepEqual(result.body, { error: "请求无法处理，请刷新页面后重试", code: "BAD_REQUEST" });
    assert.ok(!JSON.stringify(result.body).includes(error.message), "the parser's own message never leaks");
  }
});

test("1: only 400-499 statuses are passed through; everything else stays a 500", async () => {
  const { clientErrorResponse } = await import("../../backend/services.mjs");
  assert.equal(clientErrorResponse({ status: 404 }).status, 404);
  assert.equal(clientErrorResponse({ statusCode: 422 }).status, 422);
  for (const err of [new Error("boom"), { status: 500 }, { status: 302 }, { status: "400x" }, { statusCode: 499.5 }, null, undefined]) {
    assert.equal(clientErrorResponse(err), null, JSON.stringify(err));
  }
  const server = read("backend/server.mjs");
  assert.match(server, /const clientError = clientErrorResponse\(err\);\n\s*if \(clientError\) return res\.status\(clientError\.status\)\.json\(clientError\.body\);/);
  assert.ok(server.indexOf("clientErrorResponse(err)") < server.indexOf('console.error("Internal server error"'), "checked before the 500 path");
});

test("2: every pageText message the client shows has a Japanese translation", () => {
  const context = { window: {}, localStorage: { getItem: () => null } };
  vm.runInNewContext(read("js/i18n.js"), context);
  const source = ["script.js", "js/comments.js", "js/experience.js", "js/nknk-gallery-ui.js"].map(read).join("\n");
  const keys = [...new Set([...source.matchAll(/pageText\(\s*"([^"]+)",\s*"([^"]+)"/g)].map(m => m[1]))];
  assert.ok(keys.includes("内容包含无效字符，请删除后重试。"));
  for (const key of keys) assert.notEqual(context.window.siteText(key, "\u0000EN", "ja"), "\u0000EN", `missing ja: ${key}`);
});

function inputHarness() {
  const listeners = {};
  const field = id => ({ id, value: "", addEventListener: (type, fn) => { (listeners[id] ||= {})[type] = fn; } });
  const name = field("message-name"), message = field("message-input");
  const block = 'const nameInput = document.getElementById("message-name"); const messageInput = document.getElementById("message-input");\n' +
    script.match(/  const trimCommentFields = [\s\S]*?messageInput\?\.addEventListener\("compositionend", trimAfterComposition\);/)[0];
  const helpers = [/const MAX_NICKNAME_LENGTH = \d+;/, /const MAX_COMMENT_LENGTH = \d+;/, /function unicodeLength\(value\) \{[\s\S]*?\n\}/, /function enforceCommentFieldLimits\([\s\S]*?\n\}/]
    .map(re => script.match(re)[0]).join("\n");
  const feedback = [];
  const context = { document: { getElementById: id => id === "message-name" ? name : id === "message-input" ? message : null }, showLengthFeedback: field => feedback.push(field) };
  vm.runInNewContext(`${helpers}\n(() => {\n${block}\n})();`, context);
  return { name, message, listeners, feedback };
}

test("3: typing via an IME is never trimmed mid-composition; the limit applies on compositionend", () => {
  const { message, listeners, feedback } = inputHarness();
  message.value = "あ".repeat(501);
  listeners["message-input"].input({ isComposing: true });
  assert.equal(message.value.length, 501, "untouched while composing");
  assert.deepEqual(feedback, []);
  listeners["message-input"].compositionend({});
  assert.equal(Array.from(message.value).length, 500);
  assert.deepEqual(feedback, ["content"]);
  message.value = "x".repeat(600);
  listeners["message-input"].input({ isComposing: false });
  assert.equal(message.value.length, 500, "ordinary typing/paste is still limited");
});

test("4: the back-to-top label follows the language through data-aria-*", () => {
  const tag = html.match(/<a href="#top" class="back-top"[^>]*>/)[0];
  assert.match(tag, /data-aria-zh="返回顶部"/);
  assert.match(tag, /data-aria-en="Back to top"/);
  assert.match(tag, /data-aria-ja="トップへ戻る"/);
  assert.match(script, /querySelectorAll\("\[data-aria-zh\]"\)/);
});

test("5: the noscript notice includes Japanese", () => {
  const notice = html.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
  assert.match(notice, /JavaScript を有効にしてください/);
  assert.match(notice, /Enable JavaScript/);
});

test("6: theme-color follows the OS without JS; manual theme still overrides both tags", () => {
  assert.match(html, /<meta name="theme-color" content="#c4c4c0" media="\(prefers-color-scheme: light\)"\/>/);
  assert.match(html, /<meta name="theme-color" content="#171b1f" media="\(prefers-color-scheme: dark\)"\/>/);
  assert.match(script, /querySelectorAll\?\.\('meta\[name="theme-color"\]'\)\.forEach/);
  assert.match(read("js/preferences.js"), /querySelectorAll\('meta\[name="theme-color"\]'\)/);
  assert.doesNotMatch(html, /<style|style="/, "no inline styles added");
});
