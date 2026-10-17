const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const sha = prefix => prefix.padEnd(40, "0");
const since = sha("aaaaaaa"), through = sha("fffffff");
const pair = (id, head, created = "2026-10-17T18:00:00Z", extra = {}) => [0, 1].map(index => ({
  id: id + index, name: ["Verify website", "Publish public site"][index], event: "push", head_branch: "main",
  head_sha: head, created_at: created, ...extra
}));
const baseline = () => pair(101, since, "2026-10-16T20:00:00Z");
const fullFirstPage = runs => [...runs, ...Array.from({ length: 100 - runs.length }, (_, i) => ({
  ...pair(10_000 + i, sha("9999999"), runs.at(-1).created_at)[0], name: "Other workflow"
}))];
const row = (head, id, date = "10-17") => `| ${date} | \`${head.slice(0, 7)}\` | Synthetic push | ${id} / ${id + 1} |`;
const table = rows => `## 上线记录\n\n| 日期 | 提交 | 主要内容 | CI（Verify / Publish） |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`;
const baseTable = () => table([row(since, 101, "10-16")]);
const scope = heads => ({ since, through, baselineRunIds: ["101", "102"], ancestorHeads: [...heads, through] });
const load = () => import("../check-changelog-table.mjs");
function api(pages, { total = pages.flat().length, extra = [], calls = [] } = {}) {
  const all = [...pages.flat(), ...extra];
  return async url => {
    calls.push(url);
    const address = new URL(url), page = address.searchParams.get("page");
    const data = page ? { total_count: total, workflow_runs: pages[Number(page) - 1] || [] } :
      all.find(run => run.id === Number(address.pathname.split("/").at(-1)));
    return { ok: Boolean(data), status: data ? 200 : 404, json: async () => data };
  };
}

test("coverage catches five omitted main pushes and exempts only the current checkout head", async () => {
  const { verifyChangelogTable } = await load();
  const missed = ["bbbbbbb", "ccccccc", "ddddddd", "eeeeeee", "1234567"].map(sha);
  const runs = [...pair(900, through), ...missed.flatMap((head, index) => pair(200 + index * 2, head)), ...baseline()];
  await assert.rejects(verifyChangelogTable(baseTable(), { coverage: scope(missed), fetchImpl: api([runs]) }),
    /Missing deployment table rows for 5 main\/push head/u);
  await assert.rejects(verifyChangelogTable(baseTable(), {
    coverage: { ...scope(missed), exemptHeads: missed }, fetchImpl: api([runs])
  }), /Invalid changelog push coverage scope/u);
});

test("only actual ancestor main/push workflow heads need rows; remote advances, dispatches and merged non-push commits do not", async () => {
  const { verifyChangelogTable } = await load();
  const recorded = sha("bbbbbbb"), merged = sha("ccccccc"), dispatched = sha("ddddddd"), remoteAhead = sha("eeeeeee");
  const runs = [...pair(900, remoteAhead), ...pair(800, through), ...pair(700, dispatched, undefined, { event: "workflow_dispatch" }),
    ...pair(600, merged, undefined, { name: "Other workflow" }), ...pair(200, recorded), ...baseline()];
  const result = await verifyChangelogTable(table([row(recorded, 200), row(since, 101, "10-16")]), {
    coverage: scope([recorded, merged, dispatched]), fetchImpl: api([runs])
  });
  assert.deepEqual(result.coverage, { since, through, pushes: 2, recorded: 1, currentHeadExempt: true });
});

test("coverage continues pagination after all row references are found until the baseline is observed", async () => {
  const { verifyChangelogTable } = await load();
  const recorded = sha("bbbbbbb"), omitted = sha("ccccccc");
  const calls = [];
  const fetchImpl = api([fullFirstPage(pair(200, recorded, "2026-10-17T20:00:00Z")),
    [...pair(300, omitted), ...baseline()]], { calls });
  await assert.rejects(verifyChangelogTable(table([row(recorded, 200)]), {
    coverage: scope([recorded, omitted]), fetchImpl
  }), /Missing deployment table rows for 1/u);
  assert.equal(calls.length, 2, "collecting every row ID in page one cannot skip push coverage on page two");
});

test("maxPages, unknown list rows, duplicate pages and missing baseline pairs fail rather than claim coverage", async () => {
  const { verifyChangelogTable } = await load();
  const recorded = sha("bbbbbbb"), markdown = table([row(recorded, 200)]), coverage = scope([recorded]);
  await assert.rejects(verifyChangelogTable(markdown, { coverage, maxPages: 1,
    fetchImpl: api([fullFirstPage(pair(200, recorded)), baseline()]) }), /Incomplete changelog push coverage/u);
  await assert.rejects(verifyChangelogTable(markdown, { coverage,
    fetchImpl: api([[...pair(200, recorded), { id: 999 }, ...baseline()]]) }), /missing or invalid GitHub run fields/u);
  await assert.rejects(verifyChangelogTable(markdown, { coverage,
    fetchImpl: api([fullFirstPage(pair(200, recorded)), [...pair(200, recorded), ...baseline()]]) }), /pagination changed/u);
  await assert.rejects(verifyChangelogTable(baseTable(), { coverage: scope([]),
    fetchImpl: api([[baseline()[0]]], { extra: baseline() }) }), /Incomplete changelog push coverage/u);
});

test("short pages or changing totals cannot hide extra pushes behind an observed baseline", async () => {
  const { verifyChangelogTable } = await load();
  await assert.rejects(verifyChangelogTable(baseTable(), { coverage: scope([]),
    fetchImpl: api([baseline()], { total: 102 }) }), /incomplete GitHub pagination data/u);
  const recorded = sha("bbbbbbb");
  let page = 0;
  await assert.rejects(verifyChangelogTable(table([row(recorded, 200)]), { coverage: scope([recorded]), fetchImpl: async () => {
    const data = ++page === 1 ? { total_count: 102, workflow_runs: fullFirstPage(pair(200, recorded)) } :
      { total_count: 103, workflow_runs: baseline() };
    return { ok: true, status: 200, json: async () => data };
  } }), /pagination changed/u);
});

test("a later push of the baseline SHA cannot replace the original run anchors or hide a missing push", async () => {
  const { verifyChangelogTable } = await load();
  const omitted = sha("bbbbbbb");
  const first = fullFirstPage([...pair(901, through, "2026-10-17T20:00:00Z"),
    ...pair(801, since, "2026-10-17T19:00:00Z")]);
  first.slice(4).forEach(run => { run.created_at = "2026-10-17T18:30:00Z"; });
  const calls = [];
  await assert.rejects(verifyChangelogTable(table([row(through, 901)]), {
    coverage: scope([omitted]), fetchImpl: api([first, [...pair(201, omitted), ...baseline()]], { calls })
  }), /Missing deployment table rows for 1/u);
  assert.equal(calls.length, 2, "only the configured original IDs complete the baseline boundary");
});

test("baseline anchor IDs must be unique and match the baseline commit and workflow/event/branch", async () => {
  const { verifyChangelogTable } = await load();
  for (const ids of [[101, 101], ["101"], ["101", "00102"], ["101", "invalid"], undefined]) {
    await assert.rejects(verifyChangelogTable(baseTable(), { coverage: { ...scope([]), baselineRunIds: ids },
      fetchImpl: api([baseline()]) }), /Invalid changelog push coverage scope/u);
  }
  for (const [patch, message] of [
    [{ head_sha: through }, /baseline anchor commit mismatch/u],
    [{ name: "Publish public site" }, /baseline anchor must be Verify website/u],
    [{ event: "workflow_dispatch" }, /baseline anchor must be a push on main/u],
    [{ head_branch: "feature" }, /baseline anchor must be a push on main/u]
  ]) {
    const runs = baseline(); Object.assign(runs[0], patch);
    await assert.rejects(verifyChangelogTable(baseTable(), { coverage: scope([]), fetchImpl: api([runs]) }), message);
  }
  await assert.rejects(verifyChangelogTable(baseTable(), { coverage: { ...scope([]), baselineRunIds: [201, 202] },
    fetchImpl: api([baseline()]) }), /Incomplete changelog push coverage/u);
});

test("an empty API list cannot become complete coverage through direct row-ID lookups", async () => {
  const { verifyChangelogTable } = await load();
  await assert.rejects(verifyChangelogTable(baseTable(), { coverage: scope([]), fetchImpl: api([[]], { extra: baseline() }) }),
    /Incomplete changelog push coverage/u);
  let requests = 0;
  await assert.rejects(verifyChangelogTable(table([]), { coverage: scope([]), fetchImpl: async () => { requests++; } }), /zero rows/u);
  assert.equal(requests, 0);
});

test("zero new pushes is explicit baseline scope and still requires its two online workflow anchors", async () => {
  const { verifyChangelogTable } = await load();
  const result = await verifyChangelogTable(baseTable(), {
    coverage: { since, through: since, baselineRunIds: ["101", "102"], ancestorHeads: [] }, fetchImpl: api([baseline()])
  });
  assert.deepEqual(result.coverage, { since, through: since, pushes: 0, recorded: 0, currentHeadExempt: false });
  const unpublished = await verifyChangelogTable(baseTable(), { coverage: scope([]), fetchImpl: api([baseline()]) });
  assert.equal(unpublished.coverage.pushes, 0, "a local commit without a push run is not invented as a push");
});

test("the baseline needs a primary row once it is no longer checkout HEAD", async () => {
  const { verifyChangelogTable } = await load();
  const recorded = sha("bbbbbbb");
  await assert.rejects(verifyChangelogTable(table([row(recorded, 200)]), { coverage: scope([recorded]),
    fetchImpl: api([[...pair(200, recorded), ...baseline()]]) }), /Missing deployment table baseline row/u);
  const older = sha("9999999");
  const result = await verifyChangelogTable(table([row(older, 401, "10-15")]), {
    coverage: { since, through: since, baselineRunIds: ["101", "102"], ancestorHeads: [] },
    fetchImpl: api([[...baseline(), ...pair(401, older, "2026-10-15T20:00:00Z")]])
  });
  assert.equal(result.coverage.pushes, 0, "the startup baseline itself may be the current one-row exception");
});

test("a push mentioned only as an earlier commit in a row does not satisfy a missing primary row", async () => {
  const { verifyChangelogTable } = await load();
  const missed = sha("bbbbbbb"), recorded = sha("ccccccc");
  const markdown = table([`| 10-17 | \`${missed.slice(0, 7)}\`、\`${recorded.slice(0, 7)}\` | Combined | 201 / 202 |`, row(since, 101, "10-16")]);
  await assert.rejects(verifyChangelogTable(markdown, { coverage: scope([missed, recorded]),
    fetchImpl: api([[...pair(201, recorded), ...pair(301, missed), ...baseline()]]) }), /Missing deployment table rows for 1/u);
});

test("local coverage uses checked-out Git ancestry and rejects a different GITHUB_SHA or unrelated baseline", async () => {
  const { localChangelogCoverage } = await load();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "station-coverage-git-"));
  const git = args => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = message => git(["-c", "user.name=Synthetic test", "-c", "user.email=synthetic@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-am", message]);
  try {
    git(["init", "--quiet", "--initial-branch=main"]);
    fs.writeFileSync(path.join(directory, "tracked.txt"), "baseline"); git(["add", "tracked.txt"]); commit("baseline");
    const baselineHead = git(["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(directory, "tracked.txt"), "new local commit"); commit("local");
    const head = git(["rev-parse", "HEAD"]);
    assert.deepEqual(localChangelogCoverage({ directory, since: baselineHead, baselineRunIds: [101, 102], githubSha: head }), {
      since: baselineHead, through: head, baselineRunIds: ["101", "102"], ancestorHeads: [head]
    });
    assert.throws(() => localChangelogCoverage({ directory, since: baselineHead, baselineRunIds: [101, 102], githubSha: through }), /does not match/u);
    assert.throws(() => localChangelogCoverage({ directory, since: through, baselineRunIds: [101, 102] }), /fetch the full checkout history/u);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("the real default CLI detects five missing pushes and reports the exact Git coverage scope", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "station-coverage-cli-"));
  const git = args => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = message => git(["-c", "user.name=Synthetic test", "-c", "user.email=synthetic@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-am", message]);
  try {
    fs.mkdirSync(path.join(directory, "tools")); fs.mkdirSync(path.join(directory, "docs"));
    for (const file of ["check-changelog-table.mjs", "github-run-request.mjs"]) {
      fs.copyFileSync(path.join(__dirname, "..", file), path.join(directory, "tools", file));
    }
    fs.writeFileSync(path.join(directory, "history.txt"), "baseline");
    git(["init", "--quiet", "--initial-branch=main"]); git(["add", "history.txt"]); commit("baseline");
    const baselineHead = git(["rev-parse", "HEAD"]), missed = [];
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(path.join(directory, "history.txt"), `local ${i}`); commit(`local ${i}`);
      if (i < 5) missed.push(git(["rev-parse", "HEAD"]));
    }
    const head = git(["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(directory, "tools/changelog-coverage.json"), JSON.stringify({ since: baselineHead, baselineRunIds: [101, 102] }));
    fs.writeFileSync(path.join(directory, "docs/CHANGELOG.md"), table([row(baselineHead, 101, "10-16")]));
    const runs = [...pair(900, head), ...missed.flatMap((sha, i) => pair(200 + i * 2, sha)),
      ...pair(101, baselineHead, "2026-10-16T20:00:00Z")];
    const preload = path.join(directory, "mock-fetch.mjs");
    fs.writeFileSync(preload, `globalThis.fetch=async()=>({ok:true,status:200,json:async()=>(${JSON.stringify({ total_count: runs.length, workflow_runs: runs })})});`);
    const env = { ...process.env, GITHUB_REPOSITORY: "9178osage/inabakumori-site", GITHUB_SHA: head };
    delete env.GITHUB_TOKEN; delete env.GH_TOKEN;
    const run = () => spawnSync(process.execPath, ["--import", preload, path.join(directory, "tools/check-changelog-table.mjs")], {
      cwd: directory, env, encoding: "utf8", timeout: 10_000
    });
    const missing = run();
    assert.ifError(missing.error);
    assert.equal(missing.status, 1, missing.stderr);
    assert.match(missing.stderr, /Missing deployment table rows for 5 main\/push head/u);
    assert.doesNotMatch(missing.stdout, /verified/iu);
    fs.writeFileSync(path.join(directory, "docs/CHANGELOG.md"), table([
      ...missed.map((sha, i) => row(sha, 200 + i * 2)), row(baselineHead, 101, "10-16")
    ]));
    const complete = run();
    assert.ifError(complete.error);
    assert.equal(complete.status, 0, complete.stderr);
    assert.ok(complete.stdout.includes(`Push coverage since ${baselineHead} through ${head}`));
    assert.match(complete.stdout, /6 observed main\/push head\(s\), 5 recorded/u);
    assert.match(complete.stdout, /current push exempt/u);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
