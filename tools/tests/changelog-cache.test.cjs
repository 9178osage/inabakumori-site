const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const repo = "9178osage/inabakumori-site";
const endpoint = "?branch=main&event=push&per_page=100&page=1";
const markdown = "# Changelog\n\n## 上线记录\n\n| 日期 | 提交 | 主要内容 | CI（Verify / Publish） |\n| --- | --- | --- | --- |\n| 10-16 | `aaaaaaa` | Synthetic release | 101 / 102 |\n\n## Other\n";

// Every child process installs this fetch implementation before importing the CLI.
// All modes are synthetic; the original fetch is never called.
const preload = `
import { appendFileSync } from "node:fs";
const runs = [101, 102].map((id, index) => ({
  id, name: ["Verify website", "Publish public site"][index], event: "push", head_branch: "main",
  head_sha: "aaaaaaa".padEnd(40, "0"), created_at: "2026-10-17T06:59:59Z"
}));
globalThis.fetch = async (url, options = {}) => {
  const headers = new Headers(options.headers);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  appendFileSync(process.env.CACHE_TEST_LOG, JSON.stringify({
    url: String(url), conditional: headers.get("if-none-match"),
    authorized: headers.has("authorization"),
    authorizationMatches: Boolean(token) && headers.get("authorization") === "Bearer " + token
  }) + "\\n");
  const mode = process.env.CACHE_TEST_MODE;
  if (mode === "network") throw new Error("synthetic network failure " + (token || ""));
  if (mode === "304") return new Response(null, { status: 304, headers: { ETag: '"fixture-v1"' } });
  if (["403", "429", "500"].includes(mode)) return new Response("{}", {
    status: Number(mode), headers: { "Retry-After": "60", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60) }
  });
  if (mode !== "200") throw new Error("unexpected synthetic fetch mode");
  const address = new URL(url);
  const data = address.searchParams.has("page")
    ? { total_count: runs.length, workflow_runs: runs }
    : runs.find(run => String(run.id) === address.pathname.split("/").at(-1));
  return new Response(JSON.stringify(data), { status: data ? 200 : 404, headers: { ETag: '"fixture-v1"', "Content-Type": "application/json" } });
};
`;

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "station-changelog-cache-"));
  fs.mkdirSync(path.join(directory, "tools"));
  fs.mkdirSync(path.join(directory, "docs"));
  for (const file of ["check-changelog-table.mjs", "github-run-request.mjs"]) {
    fs.copyFileSync(path.join(__dirname, "..", file), path.join(directory, "tools", file));
  }
  fs.writeFileSync(path.join(directory, "docs/CHANGELOG.md"), markdown);
  const mock = path.join(directory, "mock-fetch.mjs");
  fs.writeFileSync(mock, preload);
  const log = path.join(directory, "requests.jsonl");
  const cache = path.join(directory, "artifacts/changelog-api-cache.json");
  const env = { ...process.env, GITHUB_REPOSITORY: repo, CACHE_TEST_LOG: log };
  for (const key of ["GITHUB_TOKEN", "GH_TOKEN", "CI", "GITHUB_ACTIONS"]) delete env[key];
  const script = path.join(directory, "tools/check-changelog-table.mjs");
  return {
    directory, cache, script,
    close() { fs.rmSync(directory, { recursive: true, force: true }); },
    calls() { return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : []; },
    readCache() { return JSON.parse(fs.readFileSync(cache, "utf8")); },
    writeCache(value) { fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, JSON.stringify(value)); },
    run(mode = "200", args = [], extraEnv = {}, stdinImport = false) {
      fs.rmSync(log, { force: true });
      const argv = stdinImport
        ? ["--import", mock, "--input-type=module", "-"]
        : ["--import", mock, script, ...args];
      const result = spawnSync(process.execPath, argv, {
        cwd: directory, env: { ...env, CACHE_TEST_MODE: mode, ...extraEnv }, encoding: "utf8", timeout: 10000,
        ...(stdinImport ? { input: `await import(${JSON.stringify(pathToFileURL(script).href)}); console.log("import completed");\n` } : {})
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      return result;
    }
  };
}

function passed(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified/iu);
}
function rejected(result) {
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /verified/iu);
}
function responseEntry(cache) {
  assert.equal(cache.version, 1);
  assert.equal(cache.repo, repo);
  assert.ok(cache.responses[endpoint], "the CLI caches the requested page endpoint");
  return cache.responses[endpoint];
}

test("CLI persists a 200 ETag and revalidates cached metadata through an actual HTTP 304", () => {
  const app = fixture();
  try {
    passed(app.run());
    assert.equal(app.calls().length, 1);
    assert.equal(app.calls()[0].conditional, null);
    const cached = app.readCache();
    const entry = responseEntry(cached);
    assert.equal(entry.etag, '"fixture-v1"');
    assert.equal(entry.data.workflow_runs.length, 2);
    if (process.platform !== "win32") assert.equal(fs.statSync(app.cache).mode & 0o777, 0o600);
    passed(app.run("304"));
    assert.equal(app.calls().length, 1, "304 still requires one actual fetch call");
    assert.equal(app.calls()[0].conditional, entry.etag);
    assert.ok(app.calls()[0].url.endsWith(endpoint));
  } finally { app.close(); }
});

test("CLI never falls back to cached success after 403, 429, network errors or 500", () => {
  const app = fixture();
  try {
    passed(app.run());
    const cached = app.readCache();
    for (const mode of ["403", "429", "network", "500"]) {
      app.writeCache(cached); // Each case must exercise HTTP, rather than a previous case's cooldown.
      rejected(app.run(mode));
      assert.ok(app.calls().length >= 1 && app.calls().length <= 3, `${mode} reaches HTTP with bounded retries`);
      assert.ok(app.calls().every(call => call.conditional === '"fixture-v1"'));
    }
  } finally { app.close(); }
});

test("a 304 does not let cached metadata bypass commit validation", () => {
  const app = fixture();
  try {
    passed(app.run());
    const cached = app.readCache();
    responseEntry(cached).data.workflow_runs[0].head_sha = "bbbbbbb".padEnd(40, "0");
    app.writeCache(cached);
    const result = app.run("304");
    rejected(result);
    assert.match(result.stderr, /commit mismatch/iu);
    assert.equal(app.calls().length, 1);
    assert.equal(app.calls()[0].conditional, '"fixture-v1"');
  } finally { app.close(); }
});

test("corrupt JSON cache is discarded and cannot create a success without fetching", () => {
  const app = fixture();
  try {
    fs.mkdirSync(path.dirname(app.cache));
    fs.writeFileSync(app.cache, "{broken cache");
    passed(app.run());
    assert.equal(app.calls().length, 1);
    assert.equal(app.calls()[0].conditional, null);
    assert.equal(responseEntry(app.readCache()).data.workflow_runs.length, 2);
    fs.writeFileSync(app.cache, "{broken again");
    rejected(app.run("403"));
    assert.equal(app.calls().length, 1);
    assert.equal(app.calls()[0].conditional, null);
  } finally { app.close(); }
});

test("semantically invalid cache is discarded before making fresh unconditional requests", () => {
  const app = fixture();
  try {
    passed(app.run());
    const original = app.readCache();
    for (const corrupt of [
      value => { responseEntry(value).etag = "invalid-etag"; },
      value => { value.unrecognized = "must-not-survive"; },
      value => { value.cooldownUntil = 8_640_000_000_000_001; },
      value => { value.repo = "different/repository"; }
    ]) {
      const cached = structuredClone(original);
      corrupt(cached);
      app.writeCache(cached);
      passed(app.run());
      assert.equal(app.calls().length, 1);
      assert.equal(app.calls()[0].conditional, null, "invalid cache must not provide an ETag");
      const repaired = app.readCache();
      assert.equal(responseEntry(repaired).etag, '"fixture-v1"');
      assert.deepEqual(Object.keys(repaired).sort(), ["repo", "responses", "version"]);
    }
  } finally { app.close(); }
});

test("anonymous cooldown stops requests, but either supported token can retry without leaking", () => {
  const app = fixture();
  try {
    rejected(app.run("429"));
    assert.equal(app.calls().length, 1);
    const cooled = app.readCache();
    assert.ok(cooled.cooldownUntil > Date.now(), "the real CLI persists the anonymous rate-limit cooldown");
    rejected(app.run());
    assert.equal(app.calls().length, 0, "an active anonymous cooldown skips HTTP entirely");
    for (const key of ["GH_TOKEN", "GITHUB_TOKEN"]) {
      const token = `synthetic-private-${key}-17`;
      app.writeCache(cooled);
      const result = app.run("200", [], { [key]: token });
      passed(result);
      assert.equal(app.calls().length, 1);
      assert.equal(app.calls()[0].authorized, true);
      assert.equal(app.calls()[0].authorizationMatches, true);
      assert.ok(!result.stdout.includes(token));
      assert.ok(!result.stderr.includes(token));
      assert.ok(!fs.readFileSync(app.cache, "utf8").includes(token));
      const failure = app.run("network", [], { [key]: token });
      rejected(failure);
      assert.ok(app.calls().length >= 1 && app.calls().length <= 3);
      assert.ok(!failure.stdout.includes(token));
      assert.ok(!failure.stderr.includes(token), "raw network errors must not expose the token");
      assert.ok(!fs.readFileSync(app.cache, "utf8").includes(token));
    }
  } finally { app.close(); }
});

test("--no-cache ignores existing cache data and cooldown and performs no cache writes", () => {
  const app = fixture();
  try {
    passed(app.run());
    const cached = app.readCache();
    responseEntry(cached).data.workflow_runs[0].head_sha = "bbbbbbb".padEnd(40, "0");
    cached.cooldownUntil = Date.now() + 60000;
    app.writeCache(cached);
    const before = fs.readFileSync(app.cache);
    passed(app.run("200", ["--no-cache"]));
    assert.equal(app.calls().length, 1);
    assert.equal(app.calls()[0].conditional, null, "no If-None-Match is derived from the existing cache");
    assert.deepEqual(fs.readFileSync(app.cache), before);
    rejected(app.run("403", ["--no-cache"]));
    assert.equal(app.calls().length, 1);
    assert.deepEqual(fs.readFileSync(app.cache), before, "rate-limit cooldown is not persisted with --no-cache");
  } finally { app.close(); }
});

test("--no-cache does not create a cache directory or file", () => {
  const app = fixture();
  try {
    passed(app.run("200", ["--no-cache"]));
    assert.equal(app.calls().length, 1);
    assert.equal(fs.existsSync(path.dirname(app.cache)), false);
  } finally { app.close(); }
});

for (const target of ["directory", "file"]) {
  test(`CLI refuses a symbolic-link cache ${target} without reading or changing its target`, () => {
    const app = fixture();
    try {
      const outside = path.join(app.directory, `external-${target}`);
      const sentinel = JSON.stringify({ version: 1, repo, responses: {}, cooldownUntil: Date.now() + 60000 });
      let protectedFile;
      if (target === "directory") {
        fs.mkdirSync(outside);
        protectedFile = path.join(outside, "changelog-api-cache.json");
        fs.writeFileSync(protectedFile, sentinel);
        fs.symlinkSync(outside, path.dirname(app.cache), "dir");
      } else {
        fs.mkdirSync(path.dirname(app.cache));
        protectedFile = outside;
        fs.writeFileSync(protectedFile, sentinel);
        fs.symlinkSync(protectedFile, app.cache);
      }
      const result = app.run();
      rejected(result);
      assert.equal(app.calls().length, 0);
      assert.equal(fs.readFileSync(protectedFile, "utf8"), sentinel);
      assert.equal(fs.lstatSync(target === "directory" ? path.dirname(app.cache) : app.cache).isSymbolicLink(), true);
      passed(app.run("200", ["--no-cache"]));
      assert.equal(app.calls().length, 1, "--no-cache bypasses cache paths entirely");
      assert.equal(fs.readFileSync(protectedFile, "utf8"), sentinel);
    } finally { app.close(); }
  });
}

test("importing the CLI from module stdin is safe and does not execute checks or create cache", () => {
  const app = fixture();
  try {
    const result = app.run("403", [], {}, true);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /import completed/u);
    assert.doesNotMatch(result.stdout, /verified/iu);
    assert.equal(app.calls().length, 0);
    assert.equal(fs.existsSync(path.dirname(app.cache)), false);
  } finally { app.close(); }
});
