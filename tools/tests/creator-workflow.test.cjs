const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..", "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/refresh-creator-updates.yml"), "utf8");
const commit = workflow.slice(workflow.indexOf("  commit:\n"), workflow.indexOf("  publish:\n"));
const publish = workflow.slice(workflow.indexOf("  publish:\n"));
const commitScript = commit.split("        run: |\n")[1].split("\n").map(line => line.replace(/^ {10}/u, "")).join("\n");
const BASE = JSON.parse(fs.readFileSync(path.join(root, "data/creator-updates.json"), "utf8"));
const format = data => `${JSON.stringify(data, null, 2)}\n`;
const recordRow = sha => `| 11-01 | \`${sha.slice(0, 7)}\` | 补记前次发布，供定时动态同步前核对 | 1 / 2 |`;

function command(cwd, executable, args, env) {
  return spawnSync(executable, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
}

function git(cwd, ...args) {
  const result = command(cwd, "git", args, {
    GIT_AUTHOR_NAME: "Workflow test", GIT_AUTHOR_EMAIL: "workflow@example.test",
    GIT_COMMITTER_NAME: "Workflow test", GIT_COMMITTER_EMAIL: "workflow@example.test"
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function refreshed() {
  const data = structuredClone(BASE);
  data.sources[0] = { ...data.sources[0], status: "ok", checkedAt: "2026-11-02T11:20:00.000Z", lastAttemptAt: "2026-11-02T11:20:00.000Z", message: null };
  const oldestYoutube = data.items.findLastIndex(item => item.source === "youtube");
  data.items.splice(oldestYoutube, 1);
  data.items.unshift({ id: "youtube:zzzzzzzzzz_", source: "youtube", creator: "inabakumori", title: "新しい曲", url: "https://www.youtube.com/watch?v=zzzzzzzzzz_", publishedAt: "2026-11-02T10:00:00.000Z" });
  return data;
}

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workflow-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "checkout");
  const remote = path.join(dir, "remote.git");
  fs.mkdirSync(repo);
  git(dir, "init", "--bare", remote);
  git(repo, "init", "-b", "main");
  git(repo, "remote", "add", "origin", remote);
  for (const sub of ["data", "docs", "checked-snapshot/data", "checked-snapshot/docs"]) fs.mkdirSync(path.join(repo, sub), { recursive: true });
  fs.writeFileSync(path.join(repo, "data/creator-updates.json"), format(BASE));
  fs.writeFileSync(path.join(repo, "docs/CHANGELOG.md"), "previous record\n");
  git(repo, "add", "data/creator-updates.json", "docs/CHANGELOG.md");
  git(repo, "commit", "-m", "baseline");
  git(repo, "push", "origin", "HEAD:refs/heads/main");
  const base = git(repo, "rev-parse", "HEAD");
  const output = path.join(dir, "outputs");
  fs.writeFileSync(output, "");
  const writeSnapshot = ({ data = format(refreshed()), changelog = `${recordRow(base)}\nprevious record\n` } = {}) => {
    fs.writeFileSync(path.join(repo, "checked-snapshot/data/creator-updates.json"), data);
    fs.writeFileSync(path.join(repo, "checked-snapshot/docs/CHANGELOG.md"), changelog);
  };
  return {
    dir, repo, remote, base, output, writeSnapshot,
    // GitHub Actions runs `run:` scripts with `bash -e -o pipefail`.
    run: () => command(repo, "bash", ["-e", "-o", "pipefail", "-c", commitScript], { GITHUB_SHA: base, GITHUB_OUTPUT: output })
  };
}

test("creator write jobs run no repository or dependency code", () => {
  for (const job of [commit, publish]) {
    assert.doesNotMatch(job, /(?:^|\n)\s*(?:- run: |run: )?(?:node|npm|npx|python\d?|source)\s/mu);
    assert.doesNotMatch(job, /uses: \.\//u);
  }
});

test("creator commit step pushes a checked snapshot and this commit's record row", t => {
  const box = sandbox(t);
  box.writeSnapshot();
  const result = box.run();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const head = git(box.repo, "rev-parse", "HEAD");
  assert.equal(git(box.dir, "--git-dir", box.remote, "rev-parse", "refs/heads/main"), head);
  assert.deepEqual(git(box.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n"), ["data/creator-updates.json", "docs/CHANGELOG.md"]);
  assert.equal(fs.readFileSync(box.output, "utf8"), `changed=true\nsha=${head}\n`);
});

test("creator commit step accepts a failed source check that keeps previous entries", t => {
  const box = sandbox(t);
  const data = structuredClone(BASE);
  data.sources[1] = { ...data.sources[1], status: "error", lastAttemptAt: "2026-11-02T11:20:00.000Z", message: "Official source could not be checked. Previous entries are retained." };
  box.writeSnapshot({ data: format(data), changelog: "previous record\n" });
  const result = box.run();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.notEqual(git(box.repo, "rev-parse", "HEAD"), box.base);
});

test("creator commit step refuses snapshots outside the refresh tool's output", async t => {
  const edit = mutate => { const data = refreshed(); mutate(data); return format(data); };
  const shape = /unexpected shape, source or link/u;
  const cases = {
    "off-site link": { data: edit(data => { data.items[0].url = "https://evil.example/watch?v=zzzzzzzzzz_"; }), error: shape },
    "javascript link": { data: edit(data => { data.items[0].url = "javascript:alert(1)"; }), error: shape },
    "wrong creator": { data: edit(data => { data.items[0].creator = "nknk"; }), error: shape },
    "unknown source": { data: edit(data => { data.items[0].source = "x"; data.items[0].id = "x:1"; }), error: shape },
    "id outside source": { data: edit(data => { data.items[0].id = "pixiv:1"; }), error: shape },
    "extra item field": { data: edit(data => { data.items[0].html = "<b>x</b>"; }), error: shape },
    "bidi title": { data: edit(data => { data.items[0].title = "abc\u202edef"; }), error: shape },
    "blank title": { data: edit(data => { data.items[0].title = " \n "; }), error: shape },
    "bad date": { data: edit(data => { data.items[0].publishedAt = "yesterday"; }), error: shape },
    "duplicate id": { data: edit(data => { data.items.push({ ...data.items[0] }); }), error: shape },
    "too many campfire items": { data: edit(data => { for (let id = 1; id <= 6; id += 1) data.items.push({ id: `campfire:${id}`, source: "campfire", creator: "nknk", title: "t", url: `https://camp-fire.jp/projects/970332/view/activities/${id}`, publishedAt: "2026-11-02T10:00:00.000Z" }); }), error: shape },
    "too many YouTube items": { data: edit(data => { data.items.push({ id: "youtube:yyyyyyyyyyy", source: "youtube", creator: "inabakumori", title: "t", url: "https://www.youtube.com/watch?v=yyyyyyyyyyy", publishedAt: "2026-11-02T10:00:00.000Z" }); }), error: shape },
    "changed source link": { data: edit(data => { data.sources[0].url = "https://evil.example/"; }), error: shape },
    "free-form source message": { data: edit(data => { data.sources[0].message = "<script>"; }), error: shape },
    "extra top-level key": { data: edit(data => { data.script = "x"; }), error: shape },
    // Audit B5: jq processes every document in a stream, and -e reads only the last result, so a bad
    // document followed by a good one used to pass both the canonical and the shape checks.
    "two JSON documents": { data: format(refreshed()) + format(refreshed()), error: /exactly one JSON document/u },
    "bad document before a good one": { data: edit(data => { data.items[0].url = "javascript:alert(1)"; }) + format(refreshed()), error: /exactly one JSON document/u },
    "empty snapshot": { data: "", error: /exactly one JSON document/u },
    "non-canonical JSON": { data: JSON.stringify(refreshed()), error: /not canonical JSON/u },
    "oversized snapshot": { data: format({ ...refreshed(), padding: "x".repeat(262144) }), error: /too large/u },
    "extra changelog line": { changelog: "added\nanother\nprevious record\n", error: /only add one deployment record row/u },
    "other commit's row": { changelog: "| 11-01 | `deadbee` | 补记前次发布，供定时动态同步前核对 | 1 / 2 |\nprevious record\n", error: /not this commit's deployment record/u }
  };
  for (const [name, { error, ...snapshot }] of Object.entries(cases)) {
    await t.test(name, t => {
      const box = sandbox(t);
      box.writeSnapshot(snapshot);
      const result = box.run();
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, error);
      assert.equal(git(box.repo, "rev-parse", "HEAD"), box.base);
      assert.equal(git(box.dir, "--git-dir", box.remote, "rev-parse", "refs/heads/main"), box.base);
      assert.equal(fs.readFileSync(box.output, "utf8"), "");
    });
  }
});
