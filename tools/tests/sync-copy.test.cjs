const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "../..");
const OUT = "inabakumori-site-all-code";
const GUIDE = "0-使用说明.txt";
const X_POSTS_CAP = 140_000_000;
const CAP = 130_000;
const exclusions = ["js/auth.js", "package-lock.json", "backend/package-lock.json", ".env.fixture",
  "backend/comments.db", "keys/private-key.pem", "dist/generated.js", "images/picture.png", "binary.dat"];

function fixture(extra = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "station-copy-tool-")));
  const root = path.join(directory, "repo");
  fs.mkdirSync(root);
  const sources = new Set();
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1", PYTHONDONTWRITEBYTECODE: "1" };
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8", timeout: 10000 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), value); sources.add(name);
  };
  const commit = () => {
    git("add", "--", ...sources);
    git("-c", "user.name=Copy fixture", "-c", "user.email=copy@example.test", "commit", "-qm", "Synthetic fixture");
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main"); git("config", "core.autocrlf", "false");
  write(".gitignore", OUT + "/\n");
  write("tools/sync-copy.py", fs.readFileSync(path.join(repo, "tools/sync-copy.py")));
  write("index.html", Buffer.from("  <p>原始缩进</p>\r\n\t<p>无末尾换行</p>"));
  write("tools/example.py", "if True:\n    print('keep four spaces')\n");
  write("docs/note.md", "# Synthetic documentation\n");
  for (const name of exclusions) write(name, name === "binary.dat" ? Buffer.from([0, 1, 255]) : "EXCLUDED_SYNTHETIC_FIXTURE\n");
  for (const [name, value] of Object.entries(extra)) write(name, value);
  const base = commit();
  write("docs/note.md", "# Synthetic documentation\nA committed change.\n"); commit();
  return { root, directory, base, sources, write, commit, git, env,
    output: path.join(root, OUT),
    close() { fs.rmSync(directory, { recursive: true, force: true }); },
    run(args = [], legacy = false, timeout = 10000) {
      const entry = path.join(root, legacy ? `${OUT}/sync.py` : "tools/sync-copy.py");
      const result = spawnSync("python3", [entry, ...args], { cwd: directory, env, encoding: "utf8", timeout });
      assert.ifError(result.error); return result;
    }
  };
}
function passed(result) { assert.equal(result.status, 0, result.stderr + result.stdout); }
function failed(result, message) {
  assert.notEqual(result.status, 0, result.stderr + result.stdout);
  if (message) assert.match(result.stderr + result.stdout, message);
}
function textFiles(box) { return fs.readdirSync(box.output).filter(name => name.endsWith(".txt")); }
function copySections(box) {
  const found = new Map();
  for (const name of textFiles(box).filter(name => /^[1-4]-/.test(name))) {
    const blob = fs.readFileSync(path.join(box.output, name));
    assert.ok(blob.length <= (name.startsWith("4-x-posts-") ? X_POSTS_CAP : CAP), name);
    let offset = 0;
    while (offset < blob.length) {
      const header = /^===== ([^\n]+) =====\n/u.exec(blob.subarray(offset).toString("utf8"));
      assert.ok(header, name);
      const file = header[1];
      assert.ok(box.sources.has(file), file); assert.ok(!exclusions.includes(file), file);
      assert.ok(!found.has(file), `${file} appears once`);
      const original = fs.readFileSync(path.join(box.root, file));
      offset += Buffer.byteLength(header[0]);
      assert.deepEqual(blob.subarray(offset, offset + original.length), original, file);
      offset += original.length;
      assert.deepEqual(blob.subarray(offset, offset + 2), Buffer.from("\n\n"), file); offset += 2;
      const group = /^data\/x-posts\/posts-[^/]+\.json$/u.test(file) ? "4-x-posts" : file.endsWith(".md") ? "3-docs" : file === "index.html" || file.startsWith("js/") || file.startsWith("backend/") || file.startsWith("data/") ? "1-app-code" : "2-tools-tests";
      assert.ok(name.startsWith(group), `${file} in ${group}`); found.set(file, name);
    }
  }
  return found;
}

test("tracked generator creates the ignored output, exports itself and preserves exact source bytes", () => {
  const box = fixture();
  try {
    passed(box.run()); passed(box.run(["--check"]));
    const sections = copySections(box);
    assert.equal(sections.size, box.sources.size - exclusions.length);
    assert.ok(sections.has("tools/sync-copy.py"), "the versioned generator is reviewed with the tools");
    assert.ok(!fs.readdirSync(path.join(box.root, "tools")).some(name => name.endsWith(".txt")), "output is never placed in tools/");
    const head = box.git("rev-parse", "--short", "HEAD");
    assert.match(fs.readFileSync(path.join(box.output, GUIDE), "utf8"), new RegExp(`对应提交：${head}`));
    assert.match(fs.readFileSync(path.join(box.output, GUIDE), "utf8"), /python3 tools\/sync-copy\.py/u);
    for (const name of textFiles(box)) assert.ok(fs.statSync(path.join(box.output, name)).size <= CAP, name);
    assert.match(fs.readFileSync(path.join(box.output, GUIDE), "utf8"), /每个 txt 不超过 130,000 字节/u);
    assert.doesNotMatch(fs.readFileSync(path.join(box.output, GUIDE), "utf8"), /150,000|优先控制在 10/u);
    assert.equal(fs.existsSync(path.join(box.output, ".review-base")), false, "default fallback does not invent a saved baseline");
  } finally { box.close(); }
});

test("existing review base is retained, including when an explicit alternate base is used", () => {
  const box = fixture();
  try {
    fs.mkdirSync(box.output); fs.writeFileSync(path.join(box.output, ".review-base"), box.base + "\n");
    passed(box.run());
    assert.ok(fs.readFileSync(path.join(box.output, "changes.txt"), "utf8").startsWith(`# changes ${box.base}..`));
    assert.equal(fs.readFileSync(path.join(box.output, ".review-base"), "utf8"), box.base + "\n");
    passed(box.run(["HEAD~1"])); passed(box.run(["--check"]));
    assert.equal(fs.readFileSync(path.join(box.output, ".review-base"), "utf8"), box.base + "\n");
  } finally { box.close(); }
});

test("restored code limit repacks an old large volume and removes obsolete data volumes", () => {
  const box = fixture({ "js/one.js": "x".repeat(90000), "js/two.js": "y".repeat(90000) });
  try {
    passed(box.run());
    const volumes = textFiles(box).filter(name => name.startsWith("1-app-code-"));
    const combined = Buffer.concat(volumes.map(name => fs.readFileSync(path.join(box.output, name))));
    assert.ok(combined.length > CAP);
    fs.writeFileSync(path.join(box.output, volumes[0]), combined);
    for (const name of volumes.slice(1)) fs.unlinkSync(path.join(box.output, name));
    fs.writeFileSync(path.join(box.output, "4-x-posts-2.txt"), "STALE_OLD_VOLUME\n");
    failed(box.run(["--check"]));
    passed(box.run()); passed(box.run(["--check"]));
    const sections = copySections(box);
    assert.notEqual(sections.get("js/one.js"), sections.get("js/two.js"));
    assert.equal(fs.existsSync(path.join(box.output, "4-x-posts-2.txt")), false);
    assert.equal(sections.size, box.sources.size - exclusions.length);
  } finally { box.close(); }
});

test("X shards stay separate from complete code and tests; their manifest stays in group one", () => {
  const first = postShard("雨", "\r\n"), second = postShard("雪");
  const manifest = Buffer.from(JSON.stringify({ version: 1, shards: [first, second].map(value => ({ file: path.basename(value.file), sha256: value.hash })) }, null, 2) + "\n");
  const box = fixture({ [first.file]: first.source, [second.file]: second.source, "data/x-posts/manifest.json": manifest,
    "backend/server.mjs": "export const alive = true;\n", "tools/tests/example.test.cjs": "// Test source must be included.\n" });
  try {
    fs.mkdirSync(box.output);
    fs.writeFileSync(path.join(box.output, ".review-base"), box.base + "\n");
    passed(box.run()); passed(box.run(["--check"]));
    const sections = copySections(box);
    assert.equal(sections.size, box.sources.size - exclusions.length);
    assert.ok(sections.get("backend/server.mjs").startsWith("1-app-code-"));
    assert.ok(sections.get("tools/tests/example.test.cjs").startsWith("2-tools-tests-"));
    assert.ok(sections.get("data/x-posts/manifest.json").startsWith("1-app-code-"));
    assert.equal(sections.get(first.file), "4-x-posts-1.txt");
    assert.equal(sections.get(second.file), "4-x-posts-1.txt");
    assert.ok(fs.statSync(path.join(box.output, "4-x-posts-1.txt")).size > CAP);
    assert.equal(fs.readFileSync(path.join(box.output, ".review-base"), "utf8"), box.base + "\n");
    const guide = fs.readFileSync(path.join(box.output, GUIDE), "utf8");
    assert.match(guide, /日常前后端源码、测试与文档体检/u);
    assert.match(guide, /第 4 组帖子正文每个 txt 不超过 140,000,000 字节（140 MB）/u);
    assert.ok(guide.indexOf("4-x-posts-1.txt") > guide.indexOf("需要复核帖子正文或提供全部文本时"));
    for (const name of textFiles(box).filter(name => !name.startsWith("4-x-posts-"))) assert.ok(fs.statSync(path.join(box.output, name)).size <= CAP);
    const dataVolume = path.join(box.output, "4-x-posts-1.txt");
    fs.appendFileSync(dataVolume, "TAMPERED");
    failed(box.run(["--check"]), /不一致/u);
    passed(box.run());
    const codeVolume = path.join(box.output, sections.get("data/x-posts/manifest.json"));
    fs.appendFileSync(codeVolume, fs.readFileSync(dataVolume));
    fs.unlinkSync(dataVolume);
    failed(box.run(["--check"]), /分组错误/u);
  } finally { box.close(); }
});

function postShard(character, newline = "\n") {
  const source = Buffer.from(JSON.stringify({ version: 1, items: [{ id: "2073256048929148966", text: `\t${character.repeat(30000)}\r\n原文の末尾 ` }] }, null, 2).replace(/\n/g, newline));
  const hash = createHash("sha256").update(source).digest("hex");
  return { file: `data/x-posts/posts-${hash}.json`, source, hash };
}

test("committed X post shards and their manifest are exported whole with exact UTF-8 bytes", () => {
  const first = postShard("雨", "\r\n"), second = postShard("雪");
  const manifest = Buffer.from(JSON.stringify({ version: 1, shards: [first, second].map(value => ({ file: path.basename(value.file), sha256: value.hash })) }, null, 2) + "\n");
  const box = fixture({ [first.file]: first.source, [second.file]: second.source, "data/x-posts/manifest.json": manifest });
  try {
    for (const item of [first, second]) assert.ok(item.source.length <= 120000);
    passed(box.run()); passed(box.run(["--check"]));
    const sections = copySections(box);
    for (const item of [first, second]) {
      const volume = sections.get(item.file);
      assert.ok(volume?.startsWith("4-x-posts-"), `${item.file} must remain in the complete data copy`);
      const expected = Buffer.concat([Buffer.from(`===== ${item.file} =====\n`), item.source, Buffer.from("\n\n")]);
      assert.ok(fs.readFileSync(path.join(box.output, volume)).includes(expected), `${item.file} preserves every source byte in one section`);
    }
    assert.equal(sections.get(first.file), sections.get(second.file), "small X shards are combined in the separate data group");
    assert.ok(sections.has("data/x-posts/manifest.json"));
    assert.equal(sections.size, box.sources.size - exclusions.length);
    for (const name of textFiles(box)) assert.ok(fs.statSync(path.join(box.output, name)).size <= (name.startsWith("4-x-posts-") ? X_POSTS_CAP : CAP), name);
  } finally { box.close(); }
});

test("large X post shard changes stay out of changes.txt, are listed by name, and remain in the data group", () => {
  const box = fixture();
  try {
    fs.mkdirSync(box.output); fs.writeFileSync(path.join(box.output, ".review-base"), box.base + "\n");
    passed(box.run());
    const shards = [postShard("雨"), postShard("雪")];
    for (const item of shards) box.write(item.file, item.source);
    box.commit();
    passed(box.run());
    const changes = fs.readFileSync(path.join(box.output, "changes.txt"), "utf8");
    assert.ok(Buffer.byteLength(changes) <= CAP, "post data no longer inflates changes.txt");
    for (const item of shards) {
      assert.ok(changes.includes(`# 帖子正文分片有变化（未列入差异，见第 4 组）: ${item.file}\n`), item.file);
      assert.ok(!changes.includes(`+++ b/${item.file}`), "shard bodies are not diffed");
    }
    assert.ok(textFiles(box).some(name => name.startsWith("4-x-posts-")), "shards are still exported in group 4");
    assert.equal(fs.readFileSync(path.join(box.output, ".review-base"), "utf8"), box.base + "\n");
    passed(box.run(["--check"]));
  } finally { box.close(); }
});

test("the changed-shard note lists at most 10 names and counts the rest", () => {
  const box = fixture();
  try {
    fs.mkdirSync(box.output); fs.writeFileSync(path.join(box.output, ".review-base"), box.base + "\n");
    passed(box.run());
    const shards = [..."一二三四五六七八九十百千万"].map(character => postShard(character));
    for (const item of shards) box.write(item.file, item.source);
    box.commit();
    passed(box.run());
    const changes = fs.readFileSync(path.join(box.output, "changes.txt"), "utf8");
    const listed = changes.split("\n").filter(line => line.startsWith("# 帖子正文分片有变化（未列入差异，见第 4 组）: "));
    assert.equal(listed.length, 10);
    assert.deepEqual(listed.map(line => line.split(": ")[1]), shards.map(item => item.file).sort().slice(0, 10));
    assert.ok(changes.includes("# 另有 3 个帖子正文分片有变化（未逐一列出）\n"));
    passed(box.run(["--check"]));
  } finally { box.close(); }
});

test("tampered copy bytes and uncommitted source changes fail without rewriting existing copies", () => {
  const box = fixture();
  try {
    passed(box.run());
    const volume = textFiles(box).find(name => name.startsWith("1-app-code-"));
    fs.appendFileSync(path.join(box.output, volume), "tampered");
    failed(box.run(["--check"]), /不一致/u);
    passed(box.run());
    const before = fs.readFileSync(path.join(box.output, volume));
    fs.appendFileSync(path.join(box.root, "index.html"), " uncommitted");
    failed(box.run(), /未提交改动/u);
    assert.deepEqual(fs.readFileSync(path.join(box.output, volume)), before);
  } finally { box.close(); }
});

test("whole-source packing keeps each volume below 130000 bytes and rejects oversize sources and diffs", () => {
  const packed = fixture({ "js/one.js": "x".repeat(90000), "js/two.js": "y".repeat(90000) });
  try {
    passed(packed.run()); const sections = copySections(packed);
    assert.notEqual(sections.get("js/one.js"), sections.get("js/two.js"));
  } finally { packed.close(); }
  const source = fixture({ "js/large.js": "x".repeat(131000) });
  try { failed(source.run(), /单个文件就超过 130,000 字节/u); } finally { source.close(); }
  const diff = fixture();
  try {
    diff.write("js/one.js", "x".repeat(65000)); diff.write("js/two.js", "y".repeat(65000)); diff.commit();
    const bytes = Buffer.byteLength(diff.git("diff", "--no-ext-diff", diff.base, "HEAD"));
    assert.ok(bytes > CAP && bytes < 150000, "the diff fits the old cap but exceeds the new one");
    fs.mkdirSync(diff.output); fs.writeFileSync(path.join(diff.output, ".review-base"), diff.base + "\n");
    failed(diff.run(), /changes\.txt.*超过 130,000 字节/u);
    assert.equal(fs.readFileSync(path.join(diff.output, ".review-base"), "utf8"), diff.base + "\n", "oversize diff never advances the saved base");
  } finally { diff.close(); }
});

test("TXT count follows capacity beyond fifteen with complete unique source sections", () => {
  for (const count of [8, 12]) {
    const extra = Object.fromEntries(Array.from({ length: count }, (_, i) => [`js/part-${i}.js`, "x".repeat(80000)]));
    const box = fixture(extra);
    try {
      const result = box.run();
      passed(result); passed(box.run(["--check"]));
      assert.doesNotMatch(result.stdout, /首选|超过.*个 txt/u);
      assert.equal(copySections(box).size, box.sources.size - exclusions.length);
      assert.ok(textFiles(box).length > (count === 8 ? 10 : 15));
      for (const name of textFiles(box)) assert.ok(fs.statSync(path.join(box.output, name)).size <= CAP, name);
      const numeric = names => [...names].sort((a, b) => Number(a.match(/-(\d+)\.txt$/u)[1]) - Number(b.match(/-(\d+)\.txt$/u)[1]));
      const listed = [...fs.readFileSync(path.join(box.output, GUIDE), "utf8").matchAll(/^  (1-app-code-\d+\.txt)$/gmu)].map(match => match[1]);
      const printed = [...result.stdout.matchAll(/^  (1-app-code-\d+\.txt)\s+\d+ B$/gmu)].map(match => match[1]);
      assert.deepEqual(listed, numeric(listed), "the guide orders volumes 2 before 10");
      assert.deepEqual(printed, numeric(printed), "the console uses the same numeric volume order");
    } finally { box.close(); }
  }
});

test("Finder metadata is detected then removed on sync, while unknown TXT attachments are retained and rejected", () => {
  const box = fixture();
  try {
    passed(box.run()); fs.writeFileSync(path.join(box.output, ".DS_Store"), "synthetic metadata");
    failed(box.run(["--check"]), /DS_Store/u); passed(box.run());
    assert.equal(fs.existsSync(path.join(box.output, ".DS_Store")), false);
    fs.writeFileSync(path.join(box.output, "unknown.txt"), "KEEP");
    failed(box.run(), /额外 txt/u);
    assert.equal(fs.readFileSync(path.join(box.output, "unknown.txt"), "utf8"), "KEEP");
  } finally { box.close(); }
});

test("numbered changes files are rejected without silently deleting or rewriting them", () => {
  const box = fixture();
  try {
    passed(box.run());
    const before = fs.readFileSync(path.join(box.output, "changes.txt"));
    for (const content of ["", "LEGACY_DIFF\n"]) {
      const extra = path.join(box.output, "changes-1.txt");
      fs.writeFileSync(extra, content);
      failed(box.run(["--check"]), /额外 txt.*changes-1\.txt/u);
      failed(box.run(), /额外 txt.*changes-1\.txt/u);
      assert.equal(fs.readFileSync(extra, "utf8"), content);
      assert.deepEqual(fs.readFileSync(path.join(box.output, "changes.txt")), before);
    }
  } finally { box.close(); }
});

test("empty volumes fail explicitly in every group and a sync regenerates valid output", () => {
  const box = fixture();
  try {
    passed(box.run());
    for (const name of ["1-app-code-1.txt", "2-tools-tests-99.txt", "3-docs-99.txt", "4-x-posts-99.txt"]) {
      fs.writeFileSync(path.join(box.output, name), "");
      failed(box.run(["--check"]), new RegExp(`空分卷: ${name.replace(/\./gu, "\\.")}`, "u"));
      passed(box.run()); passed(box.run(["--check"]));
    }
  } finally { box.close(); }
});

test("output directory, generated files and saved baseline cannot redirect writes through symlinks", { skip: process.platform === "win32" }, () => {
  for (const target of ["directory", "changes.txt", ".review-base", "4-x-posts-1.txt"]) {
    const box = fixture();
    try {
      const outside = path.join(box.directory, "outside"); fs.mkdirSync(outside);
      const sentinel = path.join(outside, "sentinel"); fs.writeFileSync(sentinel, "KEEP");
      if (target === "directory") fs.symlinkSync(outside, box.output);
      else { fs.mkdirSync(box.output); fs.symlinkSync(sentinel, path.join(box.output, target)); }
      failed(box.run(), /符号链接/u);
      assert.equal(fs.readFileSync(sentinel, "utf8"), "KEEP");
      assert.deepEqual(fs.readdirSync(outside), ["sentinel"]);
    } finally { box.close(); }
  }
});

test("the short legacy launcher forwards arguments to the tracked generator without duplicating rules", () => {
  const box = fixture();
  try {
    fs.mkdirSync(box.output);
    fs.writeFileSync(path.join(box.output, "sync.py"), 'import os, runpy\nrunpy.run_path(os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "tools", "sync-copy.py"), run_name="__main__")\n');
    passed(box.run([], true)); passed(box.run(["--check"], true));
    if (process.platform !== "win32") {
      const link = path.join(box.directory, "linked-sync.py");
      fs.symlinkSync(path.join(box.output, "sync.py"), link);
      const linked = spawnSync("python3", [link, "--check"], { cwd: box.directory, env: box.env, encoding: "utf8", timeout: 10000 });
      assert.ifError(linked.error); passed(linked);
    }
    assert.ok(copySections(box).has("tools/sync-copy.py"));
    assert.equal(fs.existsSync(path.join(box.root, "tools", OUT)), false);
  } finally { box.close(); }
});


test("a tampered diff header cannot turn a baseline into a git output option", () => {
  const box = fixture();
  try {
    passed(box.run());
    const escaped = path.join(box.directory, "unexpected..HEAD");
    const baseOption = "--output=" + path.join(box.directory, "unexpected");
    fs.writeFileSync(path.join(box.output, "changes.txt"), `# changes ${baseOption}..1234567\n`);
    failed(box.run(["--check"]), /无效的复核基线/u);
    assert.equal(fs.existsSync(escaped), false);
  } finally { box.close(); }
});

for (const change of ["staged deletion", "staged rename", "missing source"]) {
  test(`HEAD export fails instead of silently dropping a ${change}`, () => {
    const box = fixture();
    try {
      passed(box.run());
      const before = fs.readFileSync(path.join(box.output, "1-app-code-1.txt"));
      if (change === "staged deletion") box.git("rm", "--", "index.html");
      else if (change === "staged rename") box.git("mv", "index.html", "relocated.html");
      else fs.unlinkSync(path.join(box.root, "index.html"));
      failed(box.run(), /index\.html.*(?:缺失|不可读)/u);
      failed(box.run(["--check"]), /index\.html.*(?:缺失|不可读)/u);
      assert.deepEqual(fs.readFileSync(path.join(box.output, "1-app-code-1.txt")), before);
    } finally { box.close(); }
  });
}

test("untracked and index-added sources never replace the committed HEAD manifest", () => {
  const box = fixture();
  try {
    passed(box.run());
    box.write("tools/untracked.py", "UNTRACKED_FIXTURE\n");
    box.write("tools/staged.py", "STAGED_BUT_UNCOMMITTED_FIXTURE\n");
    box.git("add", "--", "tools/staged.py");
    passed(box.run()); passed(box.run(["--check"]));
    const sections = copySections(box);
    assert.equal(sections.has("tools/untracked.py"), false);
    assert.equal(sections.has("tools/staged.py"), false);
    assert.ok(sections.has("tools/sync-copy.py"));
  } finally { box.close(); }
});

for (const kind of ["symlink", "fifo"]) {
  test(`source ${kind} is rejected before reading through the committed path`, { skip: process.platform === "win32" }, () => {
    const box = fixture();
    try {
      passed(box.run());
      const target = path.join(box.root, "index.html");
      const original = fs.readFileSync(target); fs.unlinkSync(target);
      if (kind === "symlink") {
        const outside = path.join(box.directory, "outside-source.html");
        fs.writeFileSync(outside, original); fs.symlinkSync(outside, target);
      } else {
        const created = spawnSync("mkfifo", [target], { encoding: "utf8" });
        assert.ifError(created.error); assert.equal(created.status, 0, created.stderr);
      }
      const before = fs.readFileSync(path.join(box.output, "1-app-code-1.txt"));
      failed(box.run([], false, 1000), /index\.html.*(?:普通|链接)/u);
      failed(box.run(["--check"], false, 1000), /index\.html.*(?:普通|链接)/u);
      assert.deepEqual(fs.readFileSync(path.join(box.output, "1-app-code-1.txt")), before);
    } finally { box.close(); }
  });
}


test("a whole source section may exactly fill 130000 bytes without splitting", () => {
  const file = "js/boundary.js";
  const framing = Buffer.byteLength(`===== ${file} =====\n\n\n`);
  const box = fixture({ [file]: "x".repeat(CAP - framing) });
  try {
    passed(box.run()); passed(box.run(["--check"]));
    const volume = copySections(box).get(file);
    assert.equal(fs.statSync(path.join(box.output, volume)).size, CAP);
  } finally { box.close(); }
});

test("check rejects an otherwise intact code volume over 130000 bytes", () => {
  const box = fixture({ "js/one.js": "x".repeat(70000), "js/two.js": "y".repeat(70000) });
  try {
    passed(box.run());
    const volumes = textFiles(box).filter(name => name.startsWith("1-app-code-")).sort();
    const combined = Buffer.concat(volumes.map(name => fs.readFileSync(path.join(box.output, name))));
    assert.ok(combined.length > CAP && combined.length < 150000);
    fs.writeFileSync(path.join(box.output, volumes[0]), combined);
    for (const name of volumes.slice(1)) fs.unlinkSync(path.join(box.output, name));
    failed(box.run(["--check"]), /1-app-code-1\.txt 超过 130,000 字节/u);
  } finally { box.close(); }
});
