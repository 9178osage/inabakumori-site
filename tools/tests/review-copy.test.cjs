const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const COPY = "inabakumori-site-all-code";
const CAP = 250_000;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "station-review-range-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "test repo");
  fs.mkdirSync(root);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" };
  function git(...args) {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8", timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  function write(name, data) {
    const destination = path.join(root, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
  }
  function commit() {
    git("add", "-A");
    git("-c", "user.name=Review fixture", "-c", "user.email=review@example.test", "commit", "-qm", "Synthetic fixture");
    return git("rev-parse", "HEAD");
  }
  git("init", "-q", "-b", "main");
  write(".gitignore", `${COPY}/\n`);
  for (const file of ["review-copy.py", "sync-copy.py"]) {
    write(`tools/${file}`, fs.readFileSync(path.join(__dirname, "..", file)));
  }
  return { root, git, write, commit, review: (...args) => {
    const result = spawnSync("python3", [path.join(root, "tools/review-copy.py"), ...args], {
      cwd: directory, env, encoding: "utf8", timeout: 10_000
    });
    assert.ifError(result.error);
    return result;
  } };
}

function diff(result, base, head) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.startsWith(`# changes ${base}..${head}（`), result.stdout.slice(0, 200));
  assert.ok(Buffer.byteLength(result.stdout) <= CAP);
  return result.stdout;
}

function fails(result, diagnostic) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, diagnostic);
  assert.equal(result.stdout, "", "a failing range must not emit a partial diff");
}

test("independent adjacent ranges use pinned historical commits, filter private data and preserve the formal copy", t => {
  const box = fixture(t);
  const note = value => `far above\nnear above\n${value}\nnear below\nfar below\n`;
  const shard = "data/x-posts/posts-fixture.json";
  box.write("docs/note.md", note("old line"));
  box.write(".env.fixture", "PRIVATE_OLD\n");
  box.write(shard, '{"text":"POST_BODY_OLD"}\n');
  const base = box.commit();

  box.write("docs/note.md", note("first interval"));
  box.write(".env.fixture", "PRIVATE_NEW\n");
  box.write("js/auth.js", "GENERATED_AUTH\n");
  box.write("images/test.png", "BINARY_BY_EXTENSION\n");
  box.write("js/binary.js", Buffer.from("BINARY_BY_CONTENT\0"));
  box.write(shard, '{"text":"POST_BODY_NEW"}\n');
  box.write("data/x-posts/manifest.json", '{"version":1}\n');
  const middle = box.commit();
  box.git("tag", "review-middle", middle);
  box.write("docs/next.md", "second interval\n");
  const head = box.commit();
  box.write("docs/note.md", note("UNCOMMITTED_EDIT"));
  const official = { ".review-base": `${base}\n`, "changes.txt": "official changes\n", "1-app-code-1.txt": "official volume\n" };
  for (const [name, content] of Object.entries(official)) box.write(`${COPY}/${name}`, content);

  const first = diff(box.review(base.slice(0, 12), "review-middle"), base, middle);
  assert.match(first, /^\+first interval$/mu);
  assert.match(first, /^ near above\n-old line\n\+first interval\n near below$/mu);
  assert.match(first, /^# 帖子正文分片有变化.*data\/x-posts\/posts-fixture\.json$/mu);
  assert.match(first, /^diff --git a\/data\/x-posts\/manifest\.json /mu);
  assert.doesNotMatch(first, /^ far (?:above|below)$/mu);
  assert.doesNotMatch(first, /second interval|UNCOMMITTED_EDIT|PRIVATE_|POST_BODY_|GENERATED_AUTH|BINARY_BY_/u);
  const second = diff(box.review("review-middle", "HEAD"), middle, head);
  assert.match(second, /^\+second interval$/mu);
  assert.doesNotMatch(second, /first interval|UNCOMMITTED_EDIT/u);
  assert.deepEqual(fs.readdirSync(path.join(box.root, COPY)).sort(), Object.keys(official).sort());
  for (const [name, content] of Object.entries(official)) assert.equal(fs.readFileSync(path.join(box.root, COPY, name), "utf8"), content);
  assert.equal(box.git("status", "--porcelain"), "M docs/note.md");
});

test("oversize ranges produce no diff and can be split at an explicit intermediate commit", t => {
  const box = fixture(t);
  const base = box.commit();
  box.write("js/one.js", "甲".repeat(42_000) + "\n");
  const middle = box.commit();
  box.write("js/two.js", "乙".repeat(42_000) + "\n");
  const head = box.commit();
  fails(box.review(base, head), /超过 250,000 字节.*分成更短的连续区间/u);
  assert.match(diff(box.review(base, middle), base, middle), /\+甲/u);
  assert.match(diff(box.review(middle, head), middle, head), /\+乙/u);
  assert.equal(fs.existsSync(path.join(box.root, COPY)), false);
});

test("both endpoints must resolve to commits and the base must be an ancestor", t => {
  const box = fixture(t);
  const base = box.commit();
  box.write("docs/main.md", "main branch\n");
  const head = box.commit();
  box.git("checkout", "--detach", base);
  box.write("docs/side.md", "side branch\n");
  const side = box.commit();
  box.git("checkout", "main");
  fails(box.review("missing-base", head), /无效的区间起点/u);
  fails(box.review(base, "HEAD:docs/main.md"), /无效的区间终点/u);
  fails(box.review(head, base), /区间起点必须是终点的祖先/u);
  fails(box.review(side, head), /区间起点必须是终点的祖先/u);
  assert.doesNotMatch(diff(box.review(head, head), head, head), /diff --git/u);
});
