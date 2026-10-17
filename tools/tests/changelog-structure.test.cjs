const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const valid = `# Changelog

## 上线记录

| 日期 | 提交 | 主要内容 | CI（Verify / Publish） |
| --- | --- | --- | --- |
| 10-17 | \`bbbbbbb\`、\`ccccccc\` | Synthetic release | 201 / 202（\`bbbbbbb\` 的运行失败：203 / 204） |
| 10-16 | \`aaaaaaa\` | Synthetic baseline | 101 / 102 |
`;

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "station-changelog-structure-"));
  fs.mkdirSync(path.join(directory, "tools")); fs.mkdirSync(path.join(directory, "docs"));
  for (const file of ["check-changelog-table.mjs", "github-run-request.mjs"]) {
    fs.copyFileSync(path.join(__dirname, "..", file), path.join(directory, "tools", file));
  }
  const document = path.join(directory, "docs/CHANGELOG.md");
  fs.writeFileSync(document, valid);
  const marker = path.join(directory, "unexpected-online-context.txt");
  const preload = path.join(directory, "forbid-online-context.mjs");
  fs.writeFileSync(preload, `
import { appendFileSync } from "node:fs";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const forbidden = label => {
  appendFileSync(${JSON.stringify(marker)}, label + "\\n");
  throw new Error("Offline structure check accessed online context: " + label);
};
globalThis.fetch = async () => forbidden("fetch");
const originalEnv = process.env;
process.env = new Proxy(originalEnv, { get(target, key) {
  if (["GITHUB_TOKEN", "GH_TOKEN", "GITHUB_REPOSITORY", "GITHUB_SHA"].includes(key)) forbidden("environment");
  return Reflect.get(target, key);
} });
for (const method of ["readFile", "lstat", "open", "mkdir", "rename", "unlink"]) {
  const original = promises[method];
  promises[method] = (...args) => {
    const name = String(args[0]).replaceAll("\\\\", "/");
    if (name.endsWith("/changelog-coverage.json") || /\\/artifacts(?:\\/|$)/u.test(name)) forbidden("cache-or-coverage");
    return original(...args);
  };
}
syncBuiltinESMExports();
`);
  return {
    directory, document, marker,
    run(args = ["--structure-only"]) {
      const result = spawnSync(process.execPath, ["--import", preload, path.join(directory, "tools/check-changelog-table.mjs"), ...args], {
        cwd: directory, encoding: "utf8", timeout: 5000,
        env: { PATH: process.env.PATH, GITHUB_REPOSITORY: "invalid-repository", GITHUB_SHA: "invalid-head", GITHUB_TOKEN: "synthetic-private-token" }
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      assert.equal(fs.existsSync(marker), false, "no fetch, token, coverage or cache access is allowed");
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic-private-token/u);
      return result;
    },
    close() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

test("structure-only runs the real table parser without Git, coverage configuration, token reads or requests", () => {
  const app = fixture();
  try {
    assert.equal(fs.existsSync(path.join(app.directory, ".git")), false);
    assert.equal(fs.existsSync(path.join(app.directory, "tools/changelog-coverage.json")), false);
    const result = app.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /structure verified offline: 2 rows, 6 run ID references/u);
    assert.match(result.stdout, /GitHub metadata and push coverage were not checked/u);
    assert.doesNotMatch(result.stdout, /verified online|Push coverage since/u);
    assert.equal(fs.existsSync(path.join(app.directory, "artifacts")), false);
  } finally { app.close(); }
});

test("structure-only ignores malformed or linked cache paths and bad coverage configuration without touching them", () => {
  for (const linked of [false, true]) {
    const app = fixture();
    try {
      const coverage = path.join(app.directory, "tools/changelog-coverage.json");
      fs.writeFileSync(coverage, "{invalid coverage");
      const outside = path.join(app.directory, "outside");
      fs.mkdirSync(outside);
      const artifacts = path.join(app.directory, "artifacts");
      if (linked) fs.symlinkSync(outside, artifacts, "dir");
      else fs.mkdirSync(artifacts);
      const cache = path.join(artifacts, "changelog-api-cache.json");
      fs.writeFileSync(cache, "{invalid cache, must remain untouched");
      const result = app.run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(coverage, "utf8"), "{invalid coverage");
      assert.equal(fs.readFileSync(cache, "utf8"), "{invalid cache, must remain untouched");
      assert.equal(fs.lstatSync(artifacts).isSymbolicLink(), linked);
      assert.deepEqual(fs.readdirSync(artifacts), ["changelog-api-cache.json"]);
    } finally { app.close(); }
  }
});

test("structure-only rejects empty or malformed actual tables instead of reporting an offline success", () => {
  const app = fixture();
  try {
    const broken = [
      "# No deployment section", valid.replace(/\| 10-.*\n/gu, ""),
      valid.replace("`aaaaaaa`", "`ccccccc`"), valid.replace("101 / 102", "201 / 102"),
      valid.replace("201 / 202", "not-a-pair"), valid.replace("CI（Verify / Publish）", "CI（Publish / Verify）"),
      valid.replace("`bbbbbbb` 的运行失败", "`ddddddd` 的运行失败")
    ];
    for (const markdown of broken) {
      fs.writeFileSync(app.document, markdown);
      const result = app.run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Deployment table check failed:/u);
      assert.doesNotMatch(result.stdout, /verified/iu);
    }
  } finally { app.close(); }
});

test("CLI flags remain mutually exclusive and reject unknown or repeated arguments", () => {
  const app = fixture();
  try {
    for (const args of [["--structure-only", "--no-cache"], ["--no-cache", "--structure-only"],
      ["--structure-only", "--structure-only"], ["--no-cache", "--no-cache"], ["--unknown"], ["--structure-only=true"]]) {
      const result = app.run(args);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Usage:/u);
      assert.doesNotMatch(result.stdout, /verified/iu);
    }
  } finally { app.close(); }
});

test("npm check actually runs the offline structural gate between lint and tests without adding the online gate", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
  assert.equal(pkg.scripts["check:changelog:structure"], "node tools/check-changelog-table.mjs --structure-only");
  const chain = pkg.scripts.check.split("&&").map(command => command.trim());
  const lint = chain.indexOf("npm run lint"), structure = chain.indexOf("npm run check:changelog:structure"), tests = chain.indexOf("npm test");
  assert.ok(lint >= 0 && structure > lint && tests > structure, "the actual PR check chain must execute structure validation");
  assert.equal(chain.includes("npm run check:changelog"), false, "the full online gate stays independent");
});
