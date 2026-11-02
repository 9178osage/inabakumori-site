const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(repo, file), "utf8");

test("public wall GET omits credentials so it can reuse the anonymous preconnect", () => {
  assert.match(read("index.html"), /<link rel="preconnect" href="https:\/\/inabakumori-backend\.vercel\.app" crossorigin\/?>/);
  const script = read("script.js");
  assert.match(script, /\(COMMENTS_API, \{ credentials: "omit", cache: "no-store" \}\)/);
  assert.match(script, /\(COMMENTS_API, \{ method: "POST",[^}]*\}, credentials: "include"/);
});

test("signed-in and admin comment requests keep their credentials", () => {
  const comments = read("js/comments.js");
  assert.equal((comments.match(/credentials: "include"/g) || []).length, 5);
  assert.doesNotMatch(comments, /credentials: "omit"/);
});

test("the public comments endpoint does not read a session", () => {
  const server = read("backend/server.mjs");
  assert.match(server, /app\.get\("\/api\/comments", async \(req, res\) =>/);
  assert.match(server, /getTokenTransferMethod: \(\) => "header"/);
});
