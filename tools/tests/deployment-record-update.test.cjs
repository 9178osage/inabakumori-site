const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const load = () => import("../record-current-deployment.mjs");
const HEAD = "abcdef0" + "1".repeat(33);
const table = (rows = ["| 10-15 | `1111111` | Prior release | 11 / 12 |"], newline = "\n") => ["# 更新日志", "", "## 上线记录", "", "| 日期 | 提交 | 主要内容 | CI（Verify / Publish） |", "| --- | --- | --- | --- |", ...rows, "", "## 其他", "Keep this section.", ""].join(newline);
const pair = (event = "push", extra = {}) => [
  { id: 101, name: "Verify website", created_at: "2026-10-17T06:59:59Z" },
  { id: 102, name: "Publish public site", created_at: "2026-10-17T07:00:01Z" }
].map(run => ({ head_sha: HEAD, head_branch: "main", status: "completed", conclusion: "success", event, ...run, ...extra }));
function fetcher(push = pair(), dispatched = [], seen = []) {
  return async (value, options) => {
    const url = new URL(value);
    seen.push({ url, options });
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(url.pathname, "/repos/9178osage/inabakumori-site/actions/runs");
    assert.equal(url.searchParams.get("head_sha"), HEAD);
    assert.equal(url.searchParams.get("branch"), "main");
    assert.equal(url.searchParams.get("per_page"), "100");
    const runs = url.searchParams.get("event") === "push" ? push : dispatched;
    const start = (Number(url.searchParams.get("page")) - 1) * 100;
    return { ok: true, status: 200, json: async () => ({ total_count: runs.length, workflow_runs: runs.slice(start, start + 100) }) };
  };
}
async function sandbox(markdown = table()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deployment-record-"));
  await fs.mkdir(path.join(directory, "docs"));
  const file = path.join(directory, "docs/CHANGELOG.md");
  await fs.writeFile(file, markdown);
  return { directory, file, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
}

test("current deployment row uses real push IDs, earlier Pacific date and preserves other markdown", async () => {
  const { prepareCurrentDeploymentRecord } = await load();
  const seen = [];
  const before = table();
  const result = await prepareCurrentDeploymentRecord(before, HEAD, { fetchImpl: fetcher(pair(), [], seen), token: "synthetic-secret" });
  assert.equal(result.changed, true);
  assert.equal(result.date, "10-16");
  assert.deepEqual(result.runIds, ["101", "102"]);
  assert.match(result.markdown, /\| 10-16 \| `abcdef0` \| 补记前次发布，供定时动态同步前核对 \| 101 \/ 102 \|\n\| 10-15/u);
  assert.equal(result.markdown.replace(/^\| 10-16.*\n/mu, ""), before);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].options.headers.Authorization, "Bearer synthetic-secret");
});

test("existing primary HEAD row is idempotent before networking, including multi-commit rows", async () => {
  const { prepareCurrentDeploymentRecord } = await load();
  for (const commit of ["`abcdef0`", "`2222222`、`abcdef0`", `\`${HEAD}\``]) {
    const markdown = table([`| 10-16 | ${commit} | Existing release | 101 / 102 |`]);
    const result = await prepareCurrentDeploymentRecord(markdown, HEAD, { fetchImpl: async () => { throw new Error("must not fetch"); } });
    assert.equal(result.changed, false);
    assert.equal(result.reason, "already-recorded");
    assert.equal(result.markdown, markdown);
  }
});

test("current HEAD in a historical position is refused instead of duplicating it", async () => {
  const { prepareCurrentDeploymentRecord } = await load();
  await assert.rejects(prepareCurrentDeploymentRecord(table(["| 10-16 | `abcdef0`、`2222222` | Existing | 101 / 102（`abcdef0` 的推送：103 / 104） |"]), HEAD), /historical commit/u);
});

test("both successful dispatches exempt only a HEAD with zero push targets", async () => {
  const { prepareCurrentDeploymentRecord } = await load();
  const markdown = table();
  const seen = [];
  const result = await prepareCurrentDeploymentRecord(markdown, HEAD, { fetchImpl: fetcher([], pair("workflow_dispatch"), seen) });
  assert.equal(result.reason, "dispatch-only");
  assert.equal(result.markdown, markdown);
  assert.equal(result.changed, false);
  assert.deepEqual(seen.map(call => call.url.searchParams.get("event")), ["push", "workflow_dispatch"]);
});

test("a single, pending or failed push cannot be hidden by a successful dispatch pair", async () => {
  const { prepareCurrentDeploymentRecord } = await load();
  for (const runs of [pair().slice(0, 1), pair("push", { status: "in_progress", conclusion: null }), pair("push", { conclusion: "failure" })]) {
    const seen = [];
    await assert.rejects(prepareCurrentDeploymentRecord(table(), HEAD, { fetchImpl: fetcher(runs, pair("workflow_dispatch"), seen) }), /incomplete|not completed successfully/u);
    assert.equal(seen.length, 1, "dispatch lookup must not excuse incomplete or failed pushes");
  }
});

test("missing, partial, pending or failed dispatch evidence never creates a bot exemption", async () => {
  const { prepareCurrentDeploymentRecord } = await load();
  for (const runs of [[], pair("workflow_dispatch").slice(1), pair("workflow_dispatch", { status: "queued", conclusion: null }), pair("workflow_dispatch", { conclusion: "cancelled" })]) {
    await assert.rejects(prepareCurrentDeploymentRecord(table(), HEAD, { fetchImpl: fetcher([], runs) }), /incomplete|not completed successfully/u);
  }
});

test("all filtered pages are read before choosing workflow runs", async () => {
  const { prepareCurrentDeploymentRecord } = await load();
  const other = Array.from({ length: 100 }, (_, i) => ({ ...pair()[0], id: i + 200, name: "Unrelated workflow" }));
  const seen = [];
  const result = await prepareCurrentDeploymentRecord(table(), HEAD, { fetchImpl: fetcher([...other, ...pair()], [], seen) });
  assert.equal(result.changed, true);
  assert.deepEqual(seen.map(call => call.url.searchParams.get("page")), ["1", "2"]);
});

test("latest target run must succeed even when an older run for the same SHA did succeed", async () => {
  const { prepareCurrentDeploymentRecord } = await load();
  const runs = [...pair(), { ...pair()[0], id: 103, created_at: "2026-10-17T08:00:00Z", status: "in_progress", conclusion: null }];
  await assert.rejects(prepareCurrentDeploymentRecord(table(), HEAD, { fetchImpl: fetcher(runs) }), /not completed successfully/u);
});

test("API response scope mismatches, invalid fields and incomplete pagination fail closed", async () => {
  const { prepareCurrentDeploymentRecord } = await load();
  for (const patch of [{ head_sha: "1".repeat(40) }, { head_branch: "feature" }, { event: "workflow_dispatch" }, { created_at: "2026-02-30T00:00:00Z" }, { status: null }, { id: "101" }]) {
    const runs = pair();
    Object.assign(runs[0], patch);
    await assert.rejects(prepareCurrentDeploymentRecord(table(), HEAD, { fetchImpl: fetcher(runs) }), /Invalid or mismatched/u);
  }
  const nonJson = pair();
  nonJson[0].status = undefined;
  await assert.rejects(prepareCurrentDeploymentRecord(table(), HEAD, { fetchImpl: fetcher(nonJson) }), /invalid GitHub JSON/u);
  for (const data of [{ total_count: 2, workflow_runs: pair().slice(0, 1) }, { total_count: 1001, workflow_runs: [] }, { total_count: 2, workflow_runs: [pair()[0], pair()[0]] }]) {
    await assert.rejects(prepareCurrentDeploymentRecord(table(), HEAD, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => data }) }), /Invalid|Incomplete|Duplicate/u);
  }
});

test("network and API failures do not expose token or untrusted response bodies", async () => {
  const { prepareCurrentDeploymentRecord } = await load();
  for (const fetchImpl of [async () => { throw new Error("synthetic-secret response"); }, async () => ({ status: 403, ok: false, json: async () => { throw new Error("synthetic-secret body"); } })]) {
    await assert.rejects(prepareCurrentDeploymentRecord(table(), HEAD, { token: "synthetic-secret", fetchImpl, maxRetries: 0 }), error => !error.message.includes("synthetic-secret") && /network|HTTP 403/u.test(error.message));
  }
});

test("atomic updater writes once and a second invocation leaves exact bytes unchanged without fetching", async () => {
  const { recordCurrentDeployment } = await load();
  const before = table(undefined, "\r\n");
  const box = await sandbox(before);
  try {
    const first = await recordCurrentDeployment({ directory: box.directory, readHead: () => HEAD, fetchImpl: fetcher() });
    const saved = await fs.readFile(box.file, "utf8");
    assert.equal(first.changed, true);
    assert.equal(saved.replace(/\r\n/gu, "").includes("\n"), false, "preserve CRLF line endings");
    const second = await recordCurrentDeployment({ directory: box.directory, readHead: () => HEAD, fetchImpl: async () => { throw new Error("must not fetch"); } });
    assert.equal(second.changed, false);
    assert.equal(await fs.readFile(box.file, "utf8"), saved);
    assert.deepEqual(await fs.readdir(path.dirname(box.file)), ["CHANGELOG.md"]);
  } finally { await box.cleanup(); }
});

test("failed API validation or atomic rename preserves existing changelog bytes", async () => {
  const { recordCurrentDeployment } = await load();
  const box = await sandbox();
  try {
    const before = await fs.readFile(box.file, "utf8");
    await assert.rejects(recordCurrentDeployment({ directory: box.directory, readHead: () => HEAD, fetchImpl: fetcher(pair("push", { conclusion: "failure" })) }), /not completed/u);
    assert.equal(await fs.readFile(box.file, "utf8"), before);
    await assert.rejects(recordCurrentDeployment({ directory: box.directory, readHead: () => HEAD, fetchImpl: fetcher(), renameImpl: async () => { throw new Error("disk full"); } }), /disk full/u);
    assert.equal(await fs.readFile(box.file, "utf8"), before);
    assert.deepEqual(await fs.readdir(path.dirname(box.file)), ["CHANGELOG.md"]);
  } finally { await box.cleanup(); }
});

test("concurrent HEAD or changelog edits are preserved and block stale replacement", async () => {
  const { recordCurrentDeployment } = await load();
  const box = await sandbox();
  try {
    const before = await fs.readFile(box.file, "utf8");
    let calls = 0;
    await assert.rejects(recordCurrentDeployment({ directory: box.directory, readHead: () => ++calls === 1 ? HEAD : "9".repeat(40), fetchImpl: fetcher() }), /changed while preparing/u);
    assert.equal(await fs.readFile(box.file, "utf8"), before);
    const changed = before + "Concurrent maintainer note.\n";
    await assert.rejects(recordCurrentDeployment({ directory: box.directory, readHead: () => HEAD, fetchImpl: async (...args) => { await fs.writeFile(box.file, changed); return fetcher()(...args); } }), /changed while preparing/u);
    assert.equal(await fs.readFile(box.file, "utf8"), changed);
    assert.deepEqual(await fs.readdir(path.dirname(box.file)), ["CHANGELOG.md"]);
  } finally { await box.cleanup(); }
});

test("symlinked changelog is rejected before fetching or overwriting target", async () => {
  const { recordCurrentDeployment } = await load();
  const box = await sandbox();
  try {
    const victim = path.join(box.directory, "victim.md");
    await fs.rename(box.file, victim);
    await fs.symlink(victim, box.file);
    await assert.rejects(recordCurrentDeployment({ directory: box.directory, readHead: () => HEAD, fetchImpl: async () => { throw new Error("must not fetch"); } }), /symlinked path/u);
    assert.equal(await fs.readFile(victim, "utf8"), table());
  } finally { await box.cleanup(); }
});

test("checkout helper reads the actual committed Git HEAD and refuses a non-repository", async () => {
  const { currentCheckoutHead } = await load();
  const box = await sandbox();
  try {
    assert.throws(() => currentCheckoutHead(box.directory), /Cannot read/u);
    const git = args => execFileSync("git", args, { cwd: box.directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(["init", "--quiet", "--initial-branch=main"]);
    git(["add", "docs/CHANGELOG.md"]);
    git(["-c", "user.name=Synthetic test", "-c", "user.email=synthetic@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "Synthetic baseline"]);
    assert.equal(currentCheckoutHead(box.directory), git(["rev-parse", "HEAD"]));
    const syntax = spawnSync(process.execPath, ["--check", path.resolve(__dirname, "../record-current-deployment.mjs")], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
  } finally { await box.cleanup(); }
});
