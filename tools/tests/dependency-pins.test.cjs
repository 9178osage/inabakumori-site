const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const atLeast = (version, floor) => {
  const a = version.split(".").map(Number), b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

test("eslint's minimatch stays on a release with the GHSA-g3hv-75wg-m249 fix", () => {
  assert.equal(json("package.json").overrides?.minimatch, "^11.0.3");
  const packages = json("package-lock.json").packages;
  const copies = Object.entries(packages).filter(([name]) => name.endsWith("node_modules/minimatch"));
  assert.ok(copies.length > 0);
  for (const [name, entry] of copies) assert.ok(atLeast(entry.version, "11.0.1"), `${name} ${entry.version} is below 11.0.1`);
});

test("the backend's follow-redirects stays on 1.16.2 or later", () => {
  assert.equal(json("backend/package.json").overrides?.["follow-redirects"], "^1.16.2");
  const packages = json("backend/package-lock.json").packages;
  const copies = Object.entries(packages).filter(([name]) => name.endsWith("node_modules/follow-redirects"));
  assert.ok(copies.length > 0);
  for (const [name, entry] of copies) assert.ok(atLeast(entry.version, "1.16.2"), `${name} ${entry.version} is below 1.16.2`);
});
