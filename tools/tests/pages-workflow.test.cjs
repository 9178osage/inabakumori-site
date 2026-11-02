const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/pages.yml"), "utf8");
const job = name => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `pages.yml needs a ${name} job`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z-]+:\n/u);
  return next < 0 ? rest : rest.slice(0, next + 2);
};
const runs = block => [...block.matchAll(/^      - run: (.+)$/gmu)].map(match => match[1]);

test("the artifact job installs production dependencies only, builds, checks and uploads", () => {
  const build = job("build");
  assert.deepEqual(runs(build), ["npm ci --omit=dev", "npm run build", "node tools/check-build.mjs"]);
  assert.doesNotMatch(build.replace(/^ *#.*$/gmu, ""), /backend|npm run check\b|npm test|test:integration|lint/u);
  assert.match(build, /cache-dependency-path: package-lock\.json\n/u);
  assert.match(build, /assert-dist-hashed/u);
  assert.match(build, /uses: actions\/upload-pages-artifact@/u);
  assert.match(build, /permissions:\n      contents: read\n      pages: read\n/u);
});

test("full dependencies, lint and tests run in a separate verify job that uploads nothing", () => {
  const verify = job("verify");
  assert.deepEqual(runs(verify), ["npm ci", "npm --prefix backend ci", "npm run check", "npm run test:integration"]);
  assert.doesNotMatch(verify, /upload|pages: |id-token|write/u);
  assert.match(verify, /persist-credentials: false/u);
});

test("deployment waits for both the artifact build and the full verification", () => {
  const deploy = job("deploy");
  assert.match(deploy, /needs: \[build, verify\]\n/u);
  assert.match(deploy, /uses: actions\/deploy-pages@/u);
  assert.doesNotMatch(workflow, /continue-on-error:/u);
});
