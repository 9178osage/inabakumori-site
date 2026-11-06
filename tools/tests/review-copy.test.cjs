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
  function reviewAt(entry, ...args) {
    const result = spawnSync("python3", [entry, ...args], {
      cwd: directory, env, encoding: "utf8", timeout: 10_000
    });
    assert.ifError(result.error);
    return result;
  }
  return { directory, root, git, write, commit, reviewAt, review: (...args) => reviewAt(path.join(root, "tools/review-copy.py"), ...args) };
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
  assert.equal(diff(box.review(base, middle, "--part", "1"), base, middle), first);
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

test("part selection exports one complete patch volume even when the range is a single commit", t => {
  const box = fixture(t);
  const base = box.commit();
  box.write("js/one.js", "甲".repeat(42_000) + "\n");
  box.write("js/two.js", "乙".repeat(42_000) + "\n");
  box.write("data/x-posts/posts-fixture.json", '"SHARD_BODY"\n');
  const head = box.commit();

  const unselected = box.review(base, "HEAD");
  fails(unselected, /超过 250,000 字节.*--part 按卷导出（共 2 卷）/u);
  assert.ok(unselected.stderr.includes(`python3 tools/review-copy.py ${base} ${head} --part 1`));
  const first = diff(box.review(base, head, "--part", "1"), base, head);
  const second = diff(box.review(base, head, "--part", "2"), base, head);
  for (const [index, part] of [first, second].entries()) {
    assert.ok(part.includes(`# sync-copy changes v1 part ${index + 1}/2 ${base}..${head}\n`));
    assert.doesNotMatch(part, /SHARD_BODY/u);
  }
  assert.match(first, /# 帖子正文分片有变化.*posts-fixture\.json/u);
  assert.doesNotMatch(second, /posts-fixture\.json/u);
  const patches = [first, second].map(part => part.slice(part.indexOf("diff --git "))).join("");
  assert.equal(patches.trimEnd(), box.git("diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--unified=1", `${base}..${head}`, "--", "js/one.js", "js/two.js"));
  fails(box.review(base, head, "--part", "0"), /--part 必须是从 1 开始/u);
  fails(box.review(base, head, "--part", "3"), /共 2 卷/u);
  assert.equal(fs.existsSync(path.join(box.root, COPY)), false);
  assert.equal(box.git("status", "--porcelain"), "");
});

test("a single oversized patch remains pending with no partial output", t => {
  const box = fixture(t);
  const base = box.commit();
  box.write("js/too-large.js", "甲".repeat(84_000) + "\n");
  const head = box.commit();
  for (const part of [[], ["--part", "1"]]) {
    fails(box.review(base, head, ...part), /差异待处理[^]*"js\/too-large\.js"/u);
  }
});

test("review paths preserve real traversal for dotdots and relative entry links", { skip: process.platform === "win32" }, t => {
  const box = fixture(t);
  const base = box.commit();
  const tools = path.join(box.root, "tools");
  fs.mkdirSync(path.join(tools, "sub", "deeper"), { recursive: true });
  const ancestor = path.join(box.directory, "ancestor");
  const sibling = path.join(box.directory, "sibling");
  fs.mkdirSync(ancestor);
  fs.mkdirSync(sibling);
  fs.symlinkSync(sibling, path.join(ancestor, "jump"), "dir");
  fs.symlinkSync(box.directory, path.join(ancestor, "tools"), "dir");
  const entryAlias = path.join(box.directory, "relative-entry.py");
  const relativeEntry = `${path.basename(box.root)}/tools/sub/../review-copy.py`;
  fs.symlinkSync(`ancestor/jump/../${relativeEntry}`, entryAlias, "file");
  const baseline = diff(box.review(base, base), base, base);
  for (const entry of [
    relativeEntry,
    `${tools}/sub/deeper/../../review-copy.py`,
    `${ancestor}/jump/../${relativeEntry}`,
    `${ancestor}/tools/${relativeEntry}`,
    entryAlias
  ]) {
    assert.equal(diff(box.reviewAt(entry, base, base), base, base), baseline, entry);
  }
});

test("generator loading allows checkout and entry aliases but refuses symlinked tools and non-regular targets", { skip: process.platform === "win32" }, t => {
  const box = fixture(t);
  const base = box.commit();
  const tools = path.join(box.root, "tools");
  const target = path.join(tools, "sync-copy.py");
  const alias = path.join(box.directory, "checkout-alias");
  fs.symlinkSync(box.root, alias, "dir");
  const entryAlias = path.join(box.directory, "entry-alias.py");
  fs.symlinkSync(path.join(alias, "tools/review-copy.py"), entryAlias, "file");
  const baseline = diff(box.review(base, base), base, base);
  assert.equal(diff(box.reviewAt(path.join(alias, "tools/review-copy.py"), base, base), base, base), baseline);
  assert.equal(diff(box.reviewAt(entryAlias, base, base), base, base), baseline);

  const marker = path.join(box.directory, "UNEXPECTED_EXECUTION");
  const payload = `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text("ran")\n`;
  const sentinel = path.join(box.directory, "sentinel.py");
  fs.writeFileSync(sentinel, payload);
  fs.unlinkSync(target);
  fs.symlinkSync(sentinel, target, "file");
  fails(box.review(base, base), /tools\/sync-copy\.py.*不得使用符号链接/u);
  fs.unlinkSync(target);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "__main__.py"), payload);
  fails(box.review(base, base), /tools\/sync-copy\.py.*必须是普通文件/u);
  fs.rmSync(target, { recursive: true });
  fs.writeFileSync(target, payload);

  const outside = path.join(box.directory, "outside");
  const relocated = path.join(outside, "tools");
  fs.mkdirSync(outside);
  fs.renameSync(tools, relocated);
  fs.mkdirSync(path.join(relocated, "sub"));
  fs.symlinkSync(relocated, tools, "dir");
  fails(box.review(base, base), /tools 必须是真实目录/u);
  fails(box.reviewAt(entryAlias, base, base), /tools 必须是真实目录/u);
  fails(box.reviewAt(`${tools}/sub/../review-copy.py`, base, base), /tools 必须是真实目录/u);
  fails(box.reviewAt(`${tools}/../tools/review-copy.py`, base, base), /tools 必须是真实目录/u);
  if (fs.existsSync(path.join(box.root, "TOOLS"))) {
    fails(box.reviewAt(`${box.root}/TOOLS/../tools/review-copy.py`, base, base), /tools 必须是真实目录/u);
  }
  const cancellingAlias = path.join(box.directory, "cancelling-entry.py");
  fs.symlinkSync("checkout-alias/tools/sub/../../tools/review-copy.py", cancellingAlias, "file");
  fails(box.reviewAt(cancellingAlias, base, base), /tools 必须是真实目录/u);

  fs.unlinkSync(tools);
  fs.mkdirSync(tools);
  fs.symlinkSync(path.join(relocated, "sub"), path.join(tools, "redirect"), "dir");
  fails(box.reviewAt(`${tools}/redirect/../review-copy.py`, base, base), /tools 必须是真实目录/u);
  fails(box.reviewAt(`${tools}/redirect/../../tools/review-copy.py`, base, base), /tools 必须是真实目录/u);
  assert.equal(fs.existsSync(marker), false, "a rejected generator must never run");
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
