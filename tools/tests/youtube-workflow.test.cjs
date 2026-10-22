const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/refresh-youtube-views.yml"), "utf8");
const refresh = workflow.slice(workflow.indexOf("  refresh:\n"), workflow.indexOf("  commit:\n"));
const commit = workflow.slice(workflow.indexOf("  commit:\n"), workflow.indexOf("  publish:\n"));
const publish = workflow.slice(workflow.indexOf("  publish:\n"));
const commitScript = commit.split("        run: |\n")[1].split("\n").map(line => line.replace(/^ {10}/u, "")).join("\n");

test("YouTube refresh has all four unconditional gates before exporting a read-only snapshot", () => {
  assert.match(refresh, /if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(refresh, /permissions:\n      contents: read\n      actions: read/u);
  assert.match(refresh, /persist-credentials: false/u);
  assert.doesNotMatch(refresh, /contents: write|actions: write/u);
  assert.match(refresh, /node tools\/record-current-deployment\.mjs/u);
  const steps = refresh.split(/(?=^      - )/mu).filter(block => block.startsWith("      - "));
  const uploadIndex = steps.findIndex(step => step.includes("uses: actions/upload-artifact@"));
  for (const command of ["npm test", "npm run check", "npm run test:integration", "npm run check:changelog"]) {
    const stepIndex = steps.findIndex(step => step.startsWith(`      - run: ${command}\n`));
    assert.ok(stepIndex >= 0 && stepIndex < uploadIndex, `${command} must succeed before artifact upload`);
    assert.doesNotMatch(steps[stepIndex], /^        (?:if|continue-on-error):/mu);
  }
  assert.doesNotMatch(refresh, /continue-on-error:/u);
  assert.match(refresh, /sha256sum dist\/js\/songs\.js/u);
  assert.match(refresh, /path: \|\n            js\/songs\.js\n            docs\/CHANGELOG\.md/u);
});

test("write jobs only commit checked files or dispatch and verify the resulting publication", () => {
  assert.match(commit, /needs: refresh/u);
  assert.match(commit, /permissions:\n      contents: write/u);
  for (const job of [commit, publish]) {
    assert.doesNotMatch(job, /(?:^|\n)\s*(?:- run: |run: )?(?:node|npm|npx|python\d?|source)\s/mu);
    assert.doesNotMatch(job, /uses: \.\//u);
    assert.doesNotMatch(job, /YOUTUBE_API_KEY/u);
  }
  assert.doesNotMatch(commit, /git (?:pull|rebase|merge)|git push[^\n]*--force/u);
  assert.match(publish, /needs: \[refresh, commit\]/u);
  assert.match(publish, /if: needs\.commit\.outputs\.changed == 'true'/u);
  assert.match(publish, /gh workflow run check\.yml --ref main/u);
  assert.match(publish, /gh workflow run pages\.yml --ref main/u);
  assert.match(publish, /-f head_sha="\$UPDATE_SHA"/u);
  assert.match(publish, /gh run watch "\$VERIFY_RUN" --exit-status/u);
  assert.match(publish, /gh run watch "\$PUBLISH_RUN" --exit-status/u);
  assert.match(publish, /sha256sum \/tmp\/published-youtube-songs\.js[^\n]*= "\$SNAPSHOT_HASH"/u);
});

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

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "checkout");
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(repo);
  git(root, "init", "--bare", remote);
  git(repo, "init", "-b", "main");
  git(repo, "remote", "add", "origin", remote);
  for (const dir of ["js", "docs", "checked-snapshot/js", "checked-snapshot/docs"]) fs.mkdirSync(path.join(repo, dir), { recursive: true });
  fs.writeFileSync(path.join(repo, "js/songs.js"), "const SONGS = [];\n");
  fs.writeFileSync(path.join(repo, "docs/CHANGELOG.md"), "previous record\n");
  git(repo, "add", "js/songs.js", "docs/CHANGELOG.md");
  git(repo, "commit", "-m", "baseline");
  git(repo, "push", "origin", "HEAD:refs/heads/main");
  const base = git(repo, "rev-parse", "HEAD");
  const output = path.join(root, "outputs");
  fs.writeFileSync(output, "");
  const writeSnapshot = (changed = true) => {
    fs.writeFileSync(path.join(repo, "checked-snapshot/js/songs.js"), changed ? "const SONGS = [{viewCount: 42}];\n" : "const SONGS = [];\n");
    fs.writeFileSync(path.join(repo, "checked-snapshot/docs/CHANGELOG.md"), changed ? "checked deployment record\n" : "previous record\n");
    fs.writeFileSync(path.join(repo, "checked-snapshot/unexpected.txt"), "must not be committed\n");
  };
  return {
    root, repo, remote, base, output, writeSnapshot,
    run: () => command(repo, "bash", ["-e", "-c", commitScript], { GITHUB_SHA: base, GITHUB_OUTPUT: output })
  };
}

test("actual commit step pushes only the checked files and reports the resulting SHA", t => {
  const box = sandbox(t);
  box.writeSnapshot();
  const result = box.run();
  assert.equal(result.status, 0, result.stderr);
  const head = git(box.repo, "rev-parse", "HEAD");
  assert.equal(git(box.root, "--git-dir", box.remote, "rev-parse", "refs/heads/main"), head);
  assert.equal(git(box.repo, "rev-parse", "HEAD^"), box.base);
  assert.deepEqual(git(box.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n"), ["docs/CHANGELOG.md", "js/songs.js"]);
  assert.equal(fs.readFileSync(box.output, "utf8"), `changed=true\nsha=${head}\n`);
});

test("actual commit step does not create a commit or publish unchanged files", t => {
  const box = sandbox(t);
  box.writeSnapshot(false);
  const result = box.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(box.repo, "rev-parse", "HEAD"), box.base);
  assert.equal(fs.readFileSync(box.output, "utf8"), "");
});

test("actual commit step rejects a checkout newer than the validated source", t => {
  const box = sandbox(t);
  box.writeSnapshot();
  fs.writeFileSync(path.join(box.repo, "concurrent.txt"), "new main content\n");
  git(box.repo, "add", "concurrent.txt");
  git(box.repo, "commit", "-m", "main moved during refresh");
  const newer = git(box.repo, "rev-parse", "HEAD");
  const result = box.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /main changed during validation/u);
  assert.equal(git(box.repo, "rev-parse", "HEAD"), newer);
  assert.equal(fs.readFileSync(path.join(box.repo, "js/songs.js"), "utf8"), "const SONGS = [];\n");
  assert.equal(git(box.root, "--git-dir", box.remote, "rev-parse", "refs/heads/main"), box.base);
  assert.equal(fs.readFileSync(box.output, "utf8"), "");
});

test("actual commit step fails instead of rebasing when main advances after checkout", t => {
  const box = sandbox(t);
  box.writeSnapshot();
  const peer = path.join(box.root, "peer");
  git(box.root, "clone", "--branch", "main", box.remote, peer);
  fs.writeFileSync(path.join(peer, "concurrent.txt"), "concurrent remote change\n");
  git(peer, "add", "concurrent.txt");
  git(peer, "commit", "-m", "main moved after checkout");
  git(peer, "push", "origin", "HEAD:refs/heads/main");
  const remoteHead = git(peer, "rev-parse", "HEAD");
  const result = box.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rejected/u);
  assert.equal(git(box.root, "--git-dir", box.remote, "rev-parse", "refs/heads/main"), remoteHead);
  assert.equal(git(box.repo, "rev-parse", "HEAD^"), box.base, "the old snapshot must never be rebased onto unvalidated code");
  assert.equal(fs.readFileSync(box.output, "utf8"), "");
});
