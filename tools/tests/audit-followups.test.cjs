// Follow-ups to the November 2026 external review (cache, cleanup and workflow findings).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("a cache or background-task failure after a committed write is only logged", () => {
  const server = fs.readFileSync("backend/server.mjs", "utf8");
  const body = server.slice(server.indexOf("function invalidatePublicComments() {"), server.indexOf("const MEMBER_COMMENT_CAP"));
  assert.match(body, /^function invalidatePublicComments\(\) \{\n  try \{\n    publicComments\.invalidate\(\);/u);
  assert.match(body, /waitUntil\(purge\);\n  \} catch \(error\) \{\n    console\.error\("Public comments cache invalidation failed", \{ name: error\?\.name, code: error\?\.code \}\);/u);
});

test("a failed backup temp cleanup leaves a sanitized warning instead of disappearing", () => {
  const source = fs.readFileSync("backend/backup-endpoint.mjs", "utf8");
  assert.doesNotMatch(source, /\.catch\(\(\) => \{\}\)/u);
  assert.match(source, /log\.warn\("Backup temp cleanup failed", \{ requestId: req\.requestId, name: error\?\.name, code: error\?\.code \}\)/u);
});

test("both scheduled refreshes that commit to main share one serial concurrency group", () => {
  const groups = ["refresh-creator-updates", "refresh-youtube-views"].map(name => {
    const workflow = fs.readFileSync(`.github/workflows/${name}.yml`, "utf8");
    const match = workflow.match(/^concurrency:\n  group: ([^\n]+)\n  cancel-in-progress: (\w+)\n/mu);
    assert.ok(match, name);
    assert.equal(match[2], "false", `${name} never cancels a running refresh`);
    return match[1];
  });
  assert.equal(groups[0], groups[1]);
});
