const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");

const table = rows => `# Changelog\n\n## 上线记录\n\n| 日期 | 提交 | 主要内容 | CI（Verify / Publish） |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n\n## Other\n`;
const row = (date, commits, ci) => `| ${date} | ${commits.map(sha => `\`${sha}\``).join("、")} | Synthetic release | ${ci} |`;
const sha = prefix => prefix.padEnd(40, "0");
function pair(ids, commit, created = "2026-10-17T06:59:59Z", extra = {}) {
  return ids.map((id, i) => ({ id, name: ["Verify website", "Publish public site"][i], event: "push", head_branch: "main",
    head_sha: sha(commit), created_at: created, ...extra }));
}
function fetcher(runs, seen = []) {
  return async (url, options) => {
    seen.push({ url, options });
    const id = Number(url.split("/").at(-1));
    const data = runs.find(run => run.id === id);
    return { ok: Boolean(data), status: data ? 200 : 404, json: async () => data };
  };
}
const load = () => import("../check-changelog-table.mjs");

test("deployment table checks every primary and attributed historical run directly", async () => {
  const { verifyChangelogTable } = await load();
  const markdown = table([
    row("10-16", ["aaaaaaa", "bbbbbbb"], "101 / 102（`aaaaaaa` 的运行失败：103 / 104）"),
    row("10-15", ["ccccccc", "ddddddd", "eeeeeee"], "105 / 106（`ddddddd` 的推送：107 / 108，`Publish` 首跑失败）")
  ]);
  const runs = [...pair([101, 102], "bbbbbbb"), ...pair([103, 104], "aaaaaaa", "2026-10-16T22:00:00Z"),
    ...pair([105, 106], "eeeeeee", "2026-10-16T06:59:59Z"), ...pair([107, 108], "ddddddd", "2026-10-16T05:00:00Z")];
  runs[1].created_at = "2026-10-17T07:00:01Z"; // Crosses Pacific midnight: date belongs to earlier run.
  const seen = [];
  assert.deepEqual(await verifyChangelogTable(markdown, { fetchImpl: fetcher(runs, seen), token: "synthetic-token" }), { rows: 2, runs: 8 });
  assert.equal(seen.length, 8);
  assert.ok(seen.every(call => /^https:\/\/api\.github\.com\/repos\/9178osage\/inabakumori-site\/actions\/runs\/\d+$/u.test(call.url)));
  assert.ok(seen.every(call => call.options.headers.Authorization === "Bearer synthetic-token"));
  assert.ok(seen.every(call => call.options.signal instanceof AbortSignal));
});

test("deployment table rejects duplicate commits and run IDs before fetching", async () => {
  const { verifyChangelogTable } = await load();
  for (const rows of [
    [row("10-16", ["aaaaaaa"], "101 / 102"), row("10-15", ["aaaaaaa"], "103 / 104")],
    [row("10-16", ["aaaaaaa"], "101 / 102"), row("10-15", ["bbbbbbb"], "101 / 104")],
    [row("10-16", ["aaaaaaa"], "101 / 101")],
    [row("10-16", ["aaaaaaa", "bbbbbbb"], "101 / 102（`aaaaaaa` 的推送：103 / 101）")]
  ]) {
    let calls = 0;
    await assert.rejects(verifyChangelogTable(table(rows), { fetchImpl: async () => { calls++; } }), /repeats/u);
    assert.equal(calls, 0);
  }
});

test("deployment table rejects primary or historical commit mismatches and swapped workflows", async () => {
  const { verifyChangelogTable } = await load();
  const markdown = table([row("10-16", ["aaaaaaa", "bbbbbbb"], "101 / 102（`aaaaaaa` 的推送：103 / 104）")]);
  const valid = [...pair([101, 102], "bbbbbbb"), ...pair([103, 104], "aaaaaaa", "2026-10-16T20:00:00Z")];
  for (const [index, patch, error] of [
    [0, { head_sha: sha("aaaaaaa") }, /commit mismatch/u],
    [2, { head_sha: sha("bbbbbbb") }, /commit mismatch/u],
    [0, { name: "Publish public site" }, /must be Verify website/u],
    [1, { event: "workflow_dispatch" }, /push on main/u],
    [3, { head_branch: "feature" }, /push on main/u],
    [1, { head_sha: sha("bbbbbbb1") }, /different commits/u]
  ]) {
    const runs = structuredClone(valid);
    Object.assign(runs[index], patch);
    await assert.rejects(verifyChangelogTable(markdown, { fetchImpl: fetcher(runs) }), error);
  }
});

test("deployment table rejects Pacific date errors, reversed time order and newer historical runs", async () => {
  const { verifyChangelogTable } = await load();
  const runs = [...pair([101, 102], "aaaaaaa", "2026-10-17T06:59:59Z"), ...pair([103, 104], "bbbbbbb", "2026-10-16T22:00:00Z")];
  await assert.rejects(verifyChangelogTable(table([row("10-17", ["aaaaaaa"], "101 / 102")]), { fetchImpl: fetcher(runs) }), /date must be 10-16/u);
  await assert.rejects(verifyChangelogTable(table([row("10-16", ["bbbbbbb"], "103 / 104"), row("10-16", ["aaaaaaa"], "101 / 102")]), { fetchImpl: fetcher(runs) }), /newest to oldest/u);
  await assert.rejects(verifyChangelogTable(table([row("10-16", ["aaaaaaa", "bbbbbbb"], "103 / 104（`aaaaaaa` 的推送：101 / 102）")]), { fetchImpl: fetcher(runs) }), /historical runs are newer/u);
});

test("deployment table never passes empty coverage, malformed rows or unparsed old runs", async () => {
  const { verifyChangelogTable } = await load();
  for (const markdown of [
    "# No table", table([]), table([row("10-16", ["aaaaaaa"], "")]),
    table([row("10-16", ["aaaaaaa"], "101 / 102（`bbbbbbb` 的运行失败：103 / 104）")]),
    table([row("10-16", ["aaaaaaa"], "101 / 102（旧运行：103 / 104）")]),
    table([row("10-16", ["aaaaaaa"], "101 / 102（`aaaaaaa` 的推送：103 / 104，漏记 105）")]),
    table([row("10-16", ["aaaaaaa"], "101 / 102"), "", row("10-15", ["bbbbbbb"], "103 / 104")])
  ]) {
    let calls = 0;
    await assert.rejects(verifyChangelogTable(markdown, { fetchImpl: async () => { calls++; } }));
    assert.equal(calls, 0);
  }
});

test("deployment table fails closed for HTTP errors, network failures, invalid JSON and missing fields", async () => {
  const { verifyChangelogTable } = await load();
  const markdown = table([row("10-16", ["aaaaaaa"], "101 / 102")]);
  for (const status of [403, 404, 429, 500]) {
    await assert.rejects(verifyChangelogTable(markdown, { fetchImpl: async () => ({ ok: false, status }) }), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(verifyChangelogTable(markdown, { fetchImpl: async () => { throw new Error("synthetic-token must not be printed"); } }), /request failed \(network\)/u);
  await assert.rejects(verifyChangelogTable(markdown, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("private response body"); } }) }), /invalid GitHub JSON/u);
  for (const field of ["id", "name", "event", "head_branch", "head_sha", "created_at"]) {
    const runs = pair([101, 102], "aaaaaaa");
    delete runs[0][field];
    await assert.rejects(verifyChangelogTable(markdown, { fetchImpl: fetcher(runs) }), /HTTP 404|missing or invalid/u);
  }
});

test("deployment table deadline covers stalled fetch and JSON parsing without relying on abort support", async () => {
  const { verifyChangelogTable } = await load();
  const markdown = table([row("10-16", ["aaaaaaa"], "101 / 102")]);
  for (const fetchImpl of [async () => new Promise(() => {}), async () => ({ ok: true, status: 200, json: async () => new Promise(() => {}) })]) {
    await assert.rejects(verifyChangelogTable(markdown, { fetchImpl, deadlineMs: 20 }), /timed out/u);
  }
});

test("paginated lookup stops at full coverage and directly fetches IDs absent from list pages", async () => {
  const { verifyChangelogTable } = await load();
  const markdown = table([row("10-16", ["aaaaaaa"], "101 / 102")]);
  const runs = pair([101, 102], "aaaaaaa");
  const seen = [];
  const fetchImpl = async url => {
    seen.push(url);
    const address = new URL(url);
    const page = address.searchParams.get("page");
    const data = page === "1" ? { total_count: 200, workflow_runs: [runs[0]] } :
      page === "2" ? { total_count: 200, workflow_runs: [{ id: 999 }] } : runs[1];
    return { ok: true, status: 200, json: async () => data };
  };
  assert.deepEqual(await verifyChangelogTable(markdown, { fetchImpl, lookup: "paginated" }), { rows: 1, runs: 2 });
  assert.equal(seen.length, 3);
  assert.ok(seen[0].endsWith("?branch=main&event=push&per_page=100&page=1"));
  assert.ok(seen[1].endsWith("&page=2"));
  assert.ok(seen[2].endsWith("/102"));
  const complete = [];
  await verifyChangelogTable(markdown, { lookup: "paginated", fetchImpl: async url => {
    complete.push(url);
    return { ok: true, status: 200, json: async () => ({ total_count: 1000, workflow_runs: runs }) };
  } });
  assert.equal(complete.length, 1, "no unnecessary pages after all referenced runs are covered");
});

test("paginated lookup rejects API/list failures and never passes unresolved run IDs", async () => {
  const { verifyChangelogTable } = await load();
  const markdown = table([row("10-16", ["aaaaaaa"], "101 / 102")]);
  for (const data of [{}, { total_count: 2 }, { total_count: -1, workflow_runs: [] }, { total_count: 2, workflow_runs: [{}] }]) {
    await assert.rejects(verifyChangelogTable(markdown, { lookup: "paginated", fetchImpl: async () => ({ ok: true, status: 200, json: async () => data }) }), /invalid GitHub list fields/u);
  }
  let calls = 0;
  await assert.rejects(verifyChangelogTable(markdown, { lookup: "paginated", fetchImpl: async url => {
    calls++;
    return url.includes("?branch=") ? { ok: true, status: 200, json: async () => ({ total_count: 0, workflow_runs: [] }) } : { ok: false, status: 404 };
  } }), /HTTP 404/u);
  assert.equal(calls, 3, "empty list falls back to both direct requests and fails rather than claiming coverage");
  await assert.rejects(verifyChangelogTable(markdown, { lookup: "paginated", fetchImpl: async () => ({ ok: false, status: 429 }) }), /HTTP 429/u);
});

test("real CLI runs through path aliases and exits nonzero for empty tables and HTTP 429", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "station-changelog-cli-"));
  try {
    fs.mkdirSync(path.join(directory, "tools"));
    fs.mkdirSync(path.join(directory, "docs"));
    const script = path.join(directory, "tools/check-changelog-table.mjs");
    fs.copyFileSync(path.join(__dirname, "../check-changelog-table.mjs"), script);
    fs.copyFileSync(path.join(__dirname, "../github-run-request.mjs"), path.join(directory, "tools/github-run-request.mjs"));
    const alias = path.join(directory, "checker-link.mjs");
    fs.symlinkSync(script, alias);
    const preload = path.join(directory, "mock-fetch.mjs");
    fs.writeFileSync(preload, "globalThis.fetch = async () => ({ ok: false, status: 429 });\n");
    const git = args => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(["init", "--quiet", "--initial-branch=main"]);
    git(["add", "tools/check-changelog-table.mjs", "tools/github-run-request.mjs"]);
    git(["-c", "user.name=Synthetic test", "-c", "user.email=synthetic@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "Synthetic baseline"]);
    const head = git(["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(directory, "tools/changelog-coverage.json"), JSON.stringify({ since: head, baselineRunIds: [101, 102] }));
    const env = { ...process.env, GITHUB_REPOSITORY: "9178osage/inabakumori-site" };
    env.GITHUB_SHA = head;
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    for (const entry of [script, alias]) {
      fs.writeFileSync(path.join(directory, "docs/CHANGELOG.md"), table([]));
      const empty = spawnSync(process.execPath, [entry], { cwd: directory, env, encoding: "utf8", timeout: 5000 });
      assert.equal(empty.status, 1, empty.stderr);
      assert.match(empty.stderr, /zero rows or run coverage/u);
      assert.doesNotMatch(empty.stdout, /verified/iu);
      fs.writeFileSync(path.join(directory, "docs/CHANGELOG.md"), table([row("10-16", ["aaaaaaa"], "101 / 102")]));
      const limited = spawnSync(process.execPath, ["--import", preload, entry], { cwd: directory, env, encoding: "utf8", timeout: 5000 });
      assert.equal(limited.status, 1, limited.stderr);
      assert.match(limited.stderr, /GitHub HTTP 429/u);
      assert.doesNotMatch(limited.stdout, /verified/iu);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
