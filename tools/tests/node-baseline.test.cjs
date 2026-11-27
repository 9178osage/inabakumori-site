const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");
// 24.22.3 (2026-11-11) carries the HTTP/2, HTTP and TLS security fixes; nothing may pin below it.
const BASELINE = "24.22.3";
const read = file => fs.readFileSync(path.join(repo, file), "utf8");
const json = file => JSON.parse(read(file));
const parts = version => version.replace(/^v/u, "").split(".").map(Number);
function atLeast(version, floor) {
  const [a, b] = [parts(version), parts(floor)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

test("every workflow pins the same patched Node release", () => {
  const folder = path.join(repo, ".github/workflows");
  const pins = [];
  for (const name of fs.readdirSync(folder).filter(file => /\.ya?ml$/u.test(file))) {
    for (const match of read(`.github/workflows/${name}`).matchAll(/node-version:\s*["']?([^\s"']+)/gu)) pins.push([name, match[1]]);
  }
  assert.ok(pins.length >= 7, "expected the known setup-node steps");
  for (const [name, pin] of pins) assert.equal(pin, BASELINE, `${name} pins Node ${pin}`);
});

test("package engines and lock files agree with the patched baseline", () => {
  assert.equal(json("backend/package.json").engines.node, BASELINE);
  assert.equal(json("backend/package-lock.json").packages[""].engines.node, BASELINE);
  assert.equal(json("package.json").engines.node, `>=${BASELINE} <25`);
  assert.equal(json("package-lock.json").packages[""].engines.node, `>=${BASELINE} <25`);
});

test("the checks themselves run on a patched Node", () => {
  assert.ok(atLeast(process.version, BASELINE), `run the checks on Node >= ${BASELINE}, not ${process.version}`);
  assert.equal(atLeast("v24.22.1", BASELINE), false);
  assert.equal(atLeast("v24.23.0", BASELINE), true);
});
