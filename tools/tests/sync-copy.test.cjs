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
const CHANGES_CAP = 250_000;
const limitFor = name => /^changes(?:-\d+)?\.txt$/u.test(name) ? CHANGES_CAP : name.startsWith("4-x-posts-") ? X_POSTS_CAP : CAP;
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
function inspectChanges(box, base, batchBytes = 24000, inspectGap = false) {
  const script = `import json, os, runpy, subprocess, sys
module = runpy.run_path(sys.argv[1])
module["changes"].__globals__["DIFF_PATH_BYTES"] = int(sys.argv[3])
calls = []
environments = []
original = subprocess.Popen
def observed(args, *positional, **keywords):
    calls.append(args)
    env = keywords.get("env") or os.environ
    environments.append([env.get("GIT_" + kind + "_PATHSPECS") for kind in ("LITERAL", "GLOB", "NOGLOB", "ICASE")])
    return original(args, *positional, **keywords)
subprocess.Popen = observed
diff = module["changes"](sys.argv[2])
gap = module["review_gap"](sys.argv[2]) if sys.argv[4] == "true" else None
print(json.dumps({"diff": diff.decode("utf-8"), "calls": calls, "environments": environments, "gap": gap}))
`;
  const result = spawnSync("python3", ["-c", script, path.join(box.root, "tools/sync-copy.py"), base, String(batchBytes), String(inspectGap)], { cwd: box.directory, env: box.env, encoding: "utf8", timeout: 10000, maxBuffer: 4_000_000 });
  assert.ifError(result.error); passed(result);
  return JSON.parse(result.stdout);
}
function textFiles(box) { return fs.readdirSync(box.output).filter(name => name.endsWith(".txt")); }
function copySections(box) {
  const found = new Map();
  for (const name of textFiles(box).filter(name => /^[1-4]-/.test(name))) {
    const blob = fs.readFileSync(path.join(box.output, name));
    assert.ok(blob.length <= limitFor(name), name);
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
      const group = /^data\/x-posts\/posts-[^/]+\.json$/u.test(file) ? "4-x-posts" : file.endsWith(".md") ? "3-docs" : ["index.html", "archive.css", "calendar.html", "calendar.css"].includes(file) || ["js/", "backend/", "data/", "网站海报/"].some(prefix => file.startsWith(prefix)) ? "1-app-code" : "2-tools-tests";
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
    for (const name of textFiles(box)) assert.ok(fs.statSync(path.join(box.output, name)).size <= limitFor(name), name);
    assert.match(fs.readFileSync(path.join(box.output, GUIDE), "utf8"), /每个 txt 不超过 130,000 字节/u);
    assert.match(fs.readFileSync(path.join(box.output, GUIDE), "utf8"), /每个差异附件不超过 250,000 字节/u);
    const guide = fs.readFileSync(path.join(box.output, GUIDE), "utf8");
    assert.match(guide, /python3 tools\/review-copy\.py 起点提交 终点提交/u);
    assert.match(guide, /--part 1/u);
    assert.doesNotMatch(guide, /review-copy\.py[^\n]*[<>]/u);
    assert.doesNotMatch(fs.readFileSync(path.join(box.output, GUIDE), "utf8"), /150,000|优先控制在 10/u);
    assert.equal(fs.existsSync(path.join(box.output, ".review-base")), false, "default fallback does not invent a saved baseline");
  } finally { box.close(); }
});

test("calendar and archive frontend files are exported in the application group", () => {
  const box = fixture({ "archive.css": "/* archive styles */\n", "calendar.html": "<main>calendar</main>\n", "calendar.css": "/* calendar styles */\n" });
  try {
    passed(box.run()); passed(box.run(["--check"]));
    const sections = copySections(box);
    for (const file of ["archive.css", "calendar.html", "calendar.css"]) {
      assert.ok(sections.get(file)?.startsWith("1-app-code-"), `${file} belongs with the application code`);
    }
    assert.ok(sections.get("tools/example.py")?.startsWith("2-tools-tests-"));
  } finally { box.close(); }
});

test("tracked poster text belongs with application code and new top-level paths need an explicit group", () => {
  const box = fixture({ "网站海报/poster.html": "<main>poster</main>\n", "网站海报/qr.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>\n' });
  try {
    passed(box.run()); passed(box.run(["--check"]));
    const sections = copySections(box);
    for (const file of ["网站海报/poster.html", "网站海报/qr.svg"]) assert.ok(sections.get(file)?.startsWith("1-app-code-"));
    const before = fs.readFileSync(path.join(box.output, "changes.txt"));
    box.write("unclassified/file.txt", "new source\n"); box.commit();
    failed(box.run(), /未识别的源码分组: unclassified\/file\.txt/u);
    assert.deepEqual(fs.readFileSync(path.join(box.output, "changes.txt")), before);
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

test("sync and check name the review-base range a later changes.txt start leaves out, without failing", () => {
  const box = fixture();
  try {
    box.write("docs/note.md", "# Synthetic documentation\nA second committed change.\n"); box.commit();
    fs.mkdirSync(box.output);
    const saved = path.join(box.output, ".review-base");
    fs.writeFileSync(saved, box.base + "\n");
    const gap = `\u26a0\ufe0f changes.txt 从 HEAD~1 开始，未覆盖复核基线 ${box.base} 以来的全部改动：${box.base}..HEAD~1（1 个提交）不在差异中`;
    for (const result of [box.run(["HEAD~1"]), box.run(["--check"])]) {
      passed(result); assert.ok(result.stdout.includes(gap), result.stdout);
      assert.match(result.stdout, /✅ 副本与源码逐字节一致/u);
    }
    assert.equal(fs.readFileSync(saved, "utf8"), box.base + "\n", "the warning never moves the saved base");
    const middle = box.git("rev-parse", "--short", "HEAD~1");
    fs.writeFileSync(saved, middle + "\n");
    for (const start of [middle, box.base]) {
      const synced = box.run([start]), checked = box.run(["--check"]);
      for (const result of [synced, checked]) { passed(result); assert.doesNotMatch(result.stdout, /\u26a0/u, `${start} covers the saved base`); }
    }
    fs.writeFileSync(saved, "--output=not-a-commit\n");
    const invalid = box.run(["--check"]); passed(invalid);
    assert.ok(invalid.stdout.includes("\u26a0\ufe0f .review-base 不是有效提交"), invalid.stdout);
    assert.equal(fs.existsSync(path.join(box.root, "not-a-commit")), false);
    fs.unlinkSync(saved);
    const missing = box.run(["--check"]); passed(missing); assert.doesNotMatch(missing.stdout, /\u26a0/u);
  } finally { box.close(); }
});

test("malformed saved baselines fail sync cleanly and warn during read-only check", () => {
  const box = fixture();
  try {
    passed(box.run());
    const saved = path.join(box.output, ".review-base");
    const changes = path.join(box.output, "changes.txt");
    const before = fs.readFileSync(changes);
    for (const invalid of [Buffer.from([0xff, 0x0a]), Buffer.from("HEAD\0\n"), Buffer.from("missing-ref\n"), Buffer.alloc(0)]) {
      fs.writeFileSync(saved, invalid);
      const sync = box.run();
      failed(sync, /\.review-base 不是有效提交/u);
      assert.doesNotMatch(sync.stderr, /Traceback/u);
      const checked = box.run(["--check"]);
      passed(checked);
      assert.match(checked.stdout, /⚠️ \.review-base 不是有效提交/u);
      assert.deepEqual(fs.readFileSync(saved), invalid);
      assert.deepEqual(fs.readFileSync(changes), before);
    }
    const alternate = box.run(["HEAD~1"]);
    passed(alternate);
    assert.match(alternate.stdout, /⚠️ \.review-base 不是有效提交/u);
    assert.deepEqual(fs.readFileSync(saved), Buffer.alloc(0));
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
    for (const name of textFiles(box).filter(name => !name.startsWith("4-x-posts-"))) assert.ok(fs.statSync(path.join(box.output, name)).size <= limitFor(name));
    const dataVolume = path.join(box.output, "4-x-posts-1.txt");
    fs.appendFileSync(dataVolume, "TAMPERED");
    failed(box.run(["--check"]), /不一致/u);
    passed(box.run());
    const codeVolume = path.join(box.output, sections.get("data/x-posts/manifest.json"));
    fs.appendFileSync(codeVolume, Buffer.concat([Buffer.from(`===== ${first.file} =====\n`), first.source, Buffer.from("\n\n")]));
    assert.ok(fs.statSync(codeVolume).size <= CAP, "the misplaced shard is readable within the code volume limit");
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
    for (const name of textFiles(box)) assert.ok(fs.statSync(path.join(box.output, name)).size <= limitFor(name), name);
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
    assert.ok(Buffer.byteLength(changes) <= CHANGES_CAP, "post data no longer inflates changes.txt");
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

test("whole-source packing keeps each volume below 130000 bytes and rejects oversize sources", () => {
  const packed = fixture({ "js/one.js": "x".repeat(90000), "js/two.js": "y".repeat(90000) });
  try {
    passed(packed.run()); const sections = copySections(packed);
    assert.notEqual(sections.get("js/one.js"), sections.get("js/two.js"));
  } finally { packed.close(); }
  const source = fixture({ "js/large.js": "x".repeat(131000) });
  try { failed(source.run(), /单个文件就超过 130,000 字节/u); } finally { source.close(); }
});

test("over-limit changes split into complete patches and safely migrate between single and numbered outputs", () => {
  const box = fixture();
  try {
    box.write("js/one.js", "x".repeat(115000)); box.write("js/two.js", "y".repeat(115000)); box.commit();
    fs.mkdirSync(box.output); fs.writeFileSync(path.join(box.output, ".review-base"), box.base + "\n");
    passed(box.run()); passed(box.run(["--check"]));
    const changePath = path.join(box.output, "changes.txt");
    const before = fs.readFileSync(changePath);
    assert.ok(before.length > 220000 && before.length <= CHANGES_CAP, "diffs above the old limit are retained");
    fs.appendFileSync(changePath, Buffer.alloc(CHANGES_CAP + 1 - before.length, 0x20));
    failed(box.run(["--check"]), /changes\.txt 超过 250,000 字节/u);
    fs.writeFileSync(changePath, before);
    box.write("js/one.js", "x".repeat(125500)); box.write("js/two.js", "y".repeat(125500));
    for (let i = 0; i < 10; i++) box.write(`js/small-${i}.js`, "small change\n");
    const shard = postShard("雨"); box.write(shard.file, shard.source);
    const head = box.commit();
    passed(box.run()); passed(box.run(["--check"]));
    assert.equal(fs.existsSync(changePath), false, "the obsolete single file was removed");
    const names = textFiles(box).filter(name => name.startsWith("changes-")).sort();
    assert.deepEqual(names, ["changes-1.txt", "changes-2.txt"]);
    const parts = names.map((name, i) => {
      const blob = fs.readFileSync(path.join(box.output, name));
      const [range, marker] = blob.toString("utf8").split("\n", 2);
      assert.ok(blob.length <= CHANGES_CAP);
      assert.ok(range.startsWith(`# changes ${box.base}..${head.slice(0, 7)}`));
      assert.equal(marker, `# sync-copy changes v1 part ${i + 1}/2 ${box.base}..${head}`);
      return blob;
    });
    const body = blob => blob.subarray(blob.indexOf(0x0a, blob.indexOf(0x0a) + 1) + 1);
    const ordinary = Buffer.from(inspectChanges(box, box.base).diff);
    assert.deepEqual(Buffer.concat(parts.map(body)), ordinary.subarray(ordinary.indexOf(0x0a) + 1), "parts reassemble every byte after the standard header");
    assert.match(body(parts[0]).toString("utf8"), /帖子正文分片有变化/u);
    assert.doesNotMatch(body(parts[1]).toString("utf8"), /帖子正文分片有变化/u);
    assert.match(body(parts[1]).toString("utf8"), /^diff --git a\/js\/two\.js/u);
    const guideFile = path.join(box.output, GUIDE);
    const explanation = fs.readFileSync(guideFile, "utf8");
    assert.match(explanation, /差异附件（2 份，按顺序）：changes-1\.txt、changes-2\.txt/u);
    const index = copySections(box);
    for (const [file, volume] of index) assert.ok(explanation.includes(`  ${JSON.stringify(file)} → ${volume}\n`));
    fs.writeFileSync(guideFile, explanation.replace('"js/one.js" → 1-app-code-', '"js/one.js" → 2-tools-tests-'));
    failed(box.run(["--check"]), /使用说明未同步/u);
    fs.writeFileSync(guideFile, explanation);

    const second = path.join(box.output, names[1]);
    fs.unlinkSync(second);
    failed(box.run(["--check"]), /差异卷集合不符/u);
    passed(box.run());
    assert.deepEqual(fs.readFileSync(second), parts[1]);

    // b7c0601 wrote zero-padded part numbers and this older command example in its guide.
    const first = path.join(box.output, names[0]);
    const padded = parts[0].toString("utf8").replace("v1 part 1/2", "v1 part 01/02");
    const legacyGuide = explanation.replace(/只核对某段历史：[^\n]+\n请用实际的提交号[^\n]+/u,
      "只核对某段历史：运行 python3 tools/review-copy.py <起点> <终点>，按需另存附件。");
    fs.writeFileSync(first, padded);
    fs.writeFileSync(guideFile, legacyGuide);
    fs.writeFileSync(second, "");
    const empty = box.run(["--check"]);
    failed(empty, /空分卷: changes-2\.txt/u);
    assert.doesNotMatch(empty.stdout, /额外 txt/u);
    assert.equal(fs.statSync(second).size, 0, "check does not rewrite a damaged part");
    passed(box.run());
    assert.deepEqual(fs.readFileSync(first), parts[0]);
    assert.deepEqual(fs.readFileSync(second), parts[1]);

    const broken = Buffer.from("truncated header\n");
    fs.writeFileSync(second, broken);
    const unknownStart = explanation.replace(`实际提交：${box.base}`, `实际提交：${"0".repeat(40)}`);
    for (const invalid of [unknownStart, explanation + " ".repeat(CAP)]) {
      fs.writeFileSync(guideFile, invalid);
      failed(box.run(), /额外 txt.*changes-2\.txt/u);
      assert.deepEqual(fs.readFileSync(second), broken, "an invalid guide does not grant ownership of a broken-looking file");
    }
    fs.writeFileSync(guideFile, explanation);
    failed(box.run(["--check"]), /changes-2\.txt 与 git diff 不一致/u);
    passed(box.run());
    assert.deepEqual(fs.readFileSync(second), parts[1]);

    const extra = path.join(box.output, "changes-3.txt");
    const userFile = "manual notes\n";
    fs.writeFileSync(extra, userFile);
    fs.writeFileSync(guideFile, explanation.replace("（2 份，按顺序）：changes-1.txt、changes-2.txt",
      "（3 份，按顺序）：changes-1.txt、changes-2.txt、changes-3.txt"));
    for (const args of [[], ["--check"]]) failed(box.run(args), /额外 txt.*changes-3\.txt/u);
    assert.equal(fs.readFileSync(extra, "utf8"), userFile, "a forged contiguous list cannot claim an unrelated file");
    fs.unlinkSync(extra);
    fs.writeFileSync(guideFile, explanation);

    fs.writeFileSync(second, Buffer.concat([parts[1], body(parts[0])]));
    failed(box.run(["--check"]), /changes-2\.txt 与 git diff 不一致/u);
    fs.writeFileSync(second, parts[1]);
    fs.writeFileSync(changePath, before);
    fs.writeFileSync(extra, parts[0].toString("utf8").replace("v1 part 1/2", "v1 part 03/03"));
    failed(box.run(["--check"]), /差异卷集合不符/u);
    passed(box.run());
    assert.equal(fs.existsSync(changePath), false);
    assert.equal(fs.existsSync(extra), false, "obsolete numbered files with generated headers can be cleaned up");

    box.write("docs/note.md", "One more committed change.\n"); box.commit();
    failed(box.run(["--check"]), /changes-1\.txt 与 git diff 不一致/u);
    fs.writeFileSync(first, padded);
    fs.writeFileSync(second, broken);
    passed(box.run(["HEAD~1"])); passed(box.run(["--check"]));
    assert.ok(fs.existsSync(changePath));
    assert.deepEqual(textFiles(box).filter(name => name.startsWith("changes-")), []);
    assert.equal(fs.readFileSync(path.join(box.output, ".review-base"), "utf8"), box.base + "\n");
  } finally { box.close(); }
});

test("a single oversized patch leaves the latest source copy intact and explicitly marks changes pending", () => {
  const file = "js/huge-patch.js";
  const box = fixture({ [file]: "x".repeat(126000) + "\n" });
  try {
    passed(box.run());
    const saved = path.join(box.output, ".review-base");
    fs.writeFileSync(saved, box.base + "\n");
    box.write(file, "y".repeat(126000) + "\n");
    const head = box.commit();
    for (const args of [[], ["--check"]]) {
      const result = box.run(args);
      failed(result, /差异待处理/u);
      assert.match(result.stdout, /源码分卷与源码逐字节一致/u);
      assert.match(result.stdout, /"js\/huge-patch\.js"\s+252,[\d]{3} 字节/u);
    }
    assert.ok(copySections(box).has(file));
    assert.deepEqual(textFiles(box).filter(name => name.startsWith("changes")), [], "no stale or partial diff is presented as current");
    const explanation = fs.readFileSync(path.join(box.output, GUIDE), "utf8");
    assert.match(explanation, /差异待处理/u);
    assert.ok(explanation.includes(`${box.base}..${head}`));
    assert.equal(fs.readFileSync(saved, "utf8"), box.base + "\n");
  } finally { box.close(); }
});

test("changes retain all changed lines with one line of surrounding context", () => {
  const box = fixture();
  try {
    box.write("docs/context.md", "pre-three\npre-two\npre-one\nold line\npost-one\npost-two\npost-three\n");
    const base = box.commit();
    box.write("docs/context.md", "pre-three\npre-two\npre-one\nnew line\npost-one\npost-two\npost-three\n"); box.commit();
    passed(box.run([base])); passed(box.run(["--check"]));
    const changes = fs.readFileSync(path.join(box.output, "changes.txt"), "utf8");
    assert.ok(changes.includes(" pre-one\n-old line\n+new line\n post-one\n"));
    // git may echo the line before a hunk in its "@@ … @@" header; only diff body lines count as context.
    assert.ok(!changes.includes("\n pre-two\n") && !changes.includes("\n post-two\n"), "context is limited to one line");
  } finally { box.close(); }
});

test("large changes batch object reads and bound literal diff arguments without losing deletions or text safety", () => {
  const names = Array.from({ length: 190 }, (_, index) => `js/long-${String(index).padStart(3, "0")}-${"p".repeat(150)}.js`);
  const special = ["js/[literal]*?.js", "js/with\nnewline.js", "js/日本語.js", "js/utf8-boundary.js", "js/deleted.js"];
  const extra = Object.fromEntries([...names, ...special].map(file => [file, "old text\n"]));
  extra["js/old-binary.dat"] = Buffer.from([0, 65]);
  extra["js/new-binary.dat"] = "previous text\n";
  extra["js/invalid-utf8.dat"] = "previous valid text\n";
  const box = fixture(extra);
  try {
    const base = box.git("rev-parse", "HEAD");
    for (const file of [...names, ...special.filter(file => file !== "js/deleted.js")]) box.write(file, "new text\n");
    box.write("js/utf8-boundary.js", "a".repeat(65535) + "雨\n");
    box.git("rm", "--", "js/deleted.js"); box.sources.delete("js/deleted.js");
    box.write("js/added.js", "added text\n");
    box.write("js/old-binary.dat", "binary-to-text must remain excluded\n");
    box.write("js/new-binary.dat", Buffer.from([1, 65]));
    box.write("js/invalid-utf8.dat", Buffer.from([0xc3]));
    box.commit();
    const { diff, calls } = inspectChanges(box, base);
    assert.equal(calls.filter(args => args[1] === "cat-file").length, 1, "all old and new blobs use one process");
    assert.equal(calls.filter(args => args[1] === "show").length, 0, "changes never spawns git show per path");
    const batches = calls.filter(args => args[1] === "diff" && !args.includes("--raw"));
    assert.ok(batches.length >= 2, "long path sets are split before they approach the OS argument limit");
    for (const args of batches) assert.ok(args.reduce((size, argument) => size + Buffer.byteLength(argument) + 9, 0) < 26000);
    const expectedPaths = [...names, ...special, "js/added.js"];
    const expected = spawnSync("git", ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--unified=1", `${base}..HEAD`, "--", ...expectedPaths], { cwd: box.root, env: box.env, encoding: "utf8", timeout: 10000 });
    assert.ifError(expected.error); passed(expected);
    const head = box.git("rev-parse", "--short", "HEAD");
    assert.equal(diff, `# changes ${base}..${head}（仅含符合导出规则的文本文件）\n${expected.stdout}`, "batched output matches a complete literal diff byte for byte");
    assert.doesNotMatch(diff, /binary-to-text|old-binary\.dat|new-binary\.dat|invalid-utf8\.dat/u);
  } finally { box.close(); }
});

test("file-directory changes match exact paths without leaking excluded descendants or duplicating patches across batches", () => {
  const parents = ["js/plain", "js/[literal]*?.js", "js/with\nnewline", "js/日本語", "js/back\\slash", "js/closing]", "js/space name", "js/colon:name", "网站海报/中文?[*]\\", "js/ending\\", "js/ending[", "js/ending]", "js/ending?", "js/ending*"];
  const extra = {};
  for (const [index, parent] of parents.entries()) {
    extra[parent] = `REMOVED_PARENT_${index}\n`;
    extra[`js/reversed/${parent}/public.js`] = `PUBLIC_OLD_${index}\n`;
    extra[`js/reversed/${parent}/.env.fixture`] = `SENSITIVE_OLD_${index}\n`;
    extra[`js/reversed/${parent}/binary.dat`] = Buffer.from(`\0BINARY_OLD_${index}\n`);
  }
  const box = fixture(extra);
  try {
    const base = box.git("rev-parse", "HEAD");
    for (const [index, parent] of parents.entries()) {
      box.git("--literal-pathspecs", "rm", "--", parent); box.sources.delete(parent);
      box.write(`${parent}/public.js`, `PUBLIC_NEW_${index}\n`);
      box.write(`${parent}/.env.fixture`, `SENSITIVE_NEW_${index}\n`);
      box.write(`${parent}/binary.dat`, Buffer.from(`\0BINARY_NEW_${index}\n`));
      box.write(`${parent}X`, `PUBLIC_SIBLING_${index}\n`);
      box.write(`${parent}-secret.txt`, `SENSITIVE_SIBLING_${index}\n`);
      const reverse = `js/reversed/${parent}`;
      box.git("--literal-pathspecs", "rm", "-r", "--", reverse);
      for (const suffix of ["public.js", ".env.fixture", "binary.dat"]) box.sources.delete(`${reverse}/${suffix}`);
      box.write(reverse, `PUBLIC_REPLACEMENT_${index}\n`);
    }
    box.commit();
    const normal = inspectChanges(box, base).diff;
    const separate = inspectChanges(box, base, 1).diff;
    assert.equal(separate, normal, "one path per batch produces the same complete diff without repeats");
    assert.doesNotMatch(normal, /SENSITIVE_|BINARY_|\.env\.fixture|binary\.dat/u, "neither side of a file-directory transition reintroduces excluded descendants");
    for (const index of parents.keys()) {
      for (const prefix of ["REMOVED_PARENT", "PUBLIC_NEW", "PUBLIC_OLD", "PUBLIC_REPLACEMENT", "PUBLIC_SIBLING"]) {
        assert.equal(normal.split(`${prefix}_${index}\n`).length - 1, 1, `${prefix}_${index} appears exactly once`);
      }
    }
    for (const name of ["GIT_LITERAL_PATHSPECS", "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"]) {
      box.env[name] = "1";
      assert.equal(inspectChanges(box, base, 1).diff, normal, `${name} cannot override exact path matching`);
      delete box.env[name];
    }
  } finally { box.close(); }
});

test("changes exclude deleted and added symlinks and file type transitions in either direction", { skip: process.platform === "win32" }, () => {
  const toFile = "js/old-link.js", toLink = "js/new-link.js", removed = "js/removed-link.js";
  const added = "js/added-link.js", shard = "data/x-posts/posts-link.json";
  const box = fixture({ [toLink]: "REPLACED_TEXT\n" });
  const remove = file => { fs.unlinkSync(path.join(box.root, file)); box.sources.delete(file); };
  const link = file => {
    const target = path.join(box.root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync("/not/a/public/symlink-target", target);
    box.sources.add(file);
  };
  try {
    link(toFile); link(removed);
    const base = box.commit();
    remove(toFile); remove(toLink);
    box.git("rm", "--", removed); box.sources.delete(removed);
    box.write(toFile, "NEW_TEXT_AT_FORMER_LINK\n");
    link(toLink); link(added); link(shard);
    box.write("js/normal.js", "PUBLISHED_TEXT\n");
    box.commit();
    const { diff } = inspectChanges(box, base);
    assert.match(diff, /\+PUBLISHED_TEXT/u);
    assert.doesNotMatch(diff, /symlink-target|(?:old|new|removed|added)-link\.js|posts-link\.json|REPLACED_TEXT|NEW_TEXT_AT_FORMER_LINK/u);
  } finally { box.close(); }
});

test("HEAD export rejects committed symlinks even when Git checks them out as regular files", () => {
  const box = fixture();
  try {
    passed(box.run());
    const before = fs.readFileSync(path.join(box.output, "changes.txt"));
    const file = "js/flattened-link.js";
    box.git("config", "core.symlinks", "false");
    box.write(file, "/not/a/public/symlink-target");
    const blob = box.git("hash-object", "-w", "--", file);
    box.git("update-index", "--add", "--cacheinfo", `120000,${blob},${file}`);
    box.git("-c", "user.name=Copy fixture", "-c", "user.email=copy@example.test", "commit", "-qm", "Committed symlink");
    assert.ok(fs.lstatSync(path.join(box.root, file)).isFile());
    for (const args of [[], ["--check"]]) failed(box.run(args), /flattened-link\.js.*不得使用符号链接/u);
    assert.deepEqual(fs.readFileSync(path.join(box.output, "changes.txt")), before);
  } finally { box.close(); }
});

test("all Git subprocesses use the same pathspec environment for changes and baseline gaps", () => {
  const box = fixture();
  try {
    box.write("docs/note.md", "# Synthetic documentation\nAnother committed change.\n"); box.commit();
    fs.mkdirSync(box.output);
    fs.writeFileSync(path.join(box.output, ".review-base"), box.base + "\n");
    for (const kind of ["LITERAL", "GLOB", "NOGLOB", "ICASE"]) box.env[`GIT_${kind}_PATHSPECS`] = "1";
    const { calls, environments, gap } = inspectChanges(box, "HEAD~1", 24000, true);
    assert.match(gap, /1 个提交/u);
    for (const command of ["diff", "cat-file", "rev-parse", "merge-base", "rev-list"]) {
      assert.ok(calls.some(args => args[1] === command), command);
    }
    for (const env of environments) assert.deepEqual(env, ["0", "0", "0", "0"]);
  } finally { box.close(); }
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
      for (const name of textFiles(box)) assert.ok(fs.statSync(path.join(box.output, name)).size <= limitFor(name), name);
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
    fs.appendFileSync(path.join(box.output, GUIDE), "差异附件（2 份，按顺序）：changes-1.txt、changes-2.txt\n");
    for (const content of ["", "LEGACY_DIFF\n", before.toString("utf8")]) {
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
  for (const target of ["directory", "changes.txt", "changes-1.txt", ".review-base", "4-x-posts-1.txt", "sync.py"]) {
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

test("sync restricts an existing output directory to 0700 while check reports broad permissions without changing them", { skip: process.platform === "win32" }, () => {
  const box = fixture();
  try {
    fs.mkdirSync(box.output, { mode: 0o755 });
    fs.chmodSync(box.output, 0o755);
    passed(box.run());
    assert.equal(fs.statSync(box.output).mode & 0o777, 0o700);
    fs.chmodSync(box.output, 0o750);
    failed(box.run(["--check"]), /目录权限必须为 0700/u);
    assert.equal(fs.statSync(box.output).mode & 0o777, 0o750, "check remains read-only");
    passed(box.run()); passed(box.run(["--check"]));
    assert.equal(fs.statSync(box.output).mode & 0o777, 0o700);
  } finally { box.close(); }
});

test("the short legacy launcher forwards arguments to the tracked generator without duplicating rules", () => {
  const box = fixture();
  try {
    fs.mkdirSync(box.output);
    fs.writeFileSync(path.join(box.output, "sync.py"), 'import os, runpy\nrunpy.run_path(os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "tools", "sync-copy.py"), run_name="__main__")\n');
    passed(box.run([], true)); passed(box.run(["--check"], true));
    const launcher = fs.readFileSync(path.join(box.output, "sync.py"));
    const rootEntry = path.join(box.root, "sync.py");
    fs.writeFileSync(rootEntry, launcher);
    const rootRun = spawnSync("python3", [rootEntry, "--check"], { cwd: box.directory, env: box.env, encoding: "utf8", timeout: 10000 });
    assert.ifError(rootRun.error); passed(rootRun);
    if (process.platform !== "win32") {
      const link = path.join(box.directory, "linked-sync.py");
      fs.symlinkSync(path.join(box.output, "sync.py"), link);
      const linked = spawnSync("python3", [link, "--check"], { cwd: box.directory, env: box.env, encoding: "utf8", timeout: 10000 });
      assert.ifError(linked.error); passed(linked);
    }
    assert.ok(copySections(box).has("tools/sync-copy.py"));
    assert.equal(fs.existsSync(path.join(box.root, "tools", OUT)), false);
    const localEntry = path.join(box.output, "sync.py");
    for (const bytes of [launcher.subarray(0, -1), Buffer.concat([launcher, Buffer.from("\n")])]) {
      fs.writeFileSync(localEntry, bytes);
      failed(box.run(["--check"]), /兼容入口 sync\.py 未同步/u);
      assert.deepEqual(fs.readFileSync(localEntry), bytes);
    }
    fs.unlinkSync(localEntry);
    failed(box.run(["--check"]), /兼容入口 sync\.py 未同步/u);
    assert.equal(fs.existsSync(localEntry), false);
    passed(box.run()); passed(box.run(["--check"]));
    assert.deepEqual(fs.readFileSync(localEntry), launcher);
  } finally { box.close(); }
});

test("the launcher refuses symlinks and non-regular generators without executing their targets", { skip: process.platform === "win32" }, () => {
  const box = fixture();
  try {
    passed(box.run());
    const tools = path.join(box.root, "tools");
    const generator = path.join(tools, "sync-copy.py");
    const rootEntry = path.join(box.root, "sync.py");
    fs.copyFileSync(path.join(box.output, "sync.py"), rootEntry);
    const external = path.join(box.directory, "external-tools");
    fs.mkdirSync(external);
    const externalScript = path.join(external, "sync-copy.py");
    const marker = path.join(box.directory, "unexpected-launch");
    fs.writeFileSync(externalScript, `with open(${JSON.stringify(marker)}, "w") as marker:\n    marker.write("executed")\n`);
    const assertBlocked = (expected = /Refusing symlink/u) => {
      failed(box.run(["--check"], true, 1000), expected);
      const fromRoot = spawnSync("python3", [rootEntry, "--check"], { cwd: box.directory, env: box.env, encoding: "utf8", timeout: 10000 });
      assert.ifError(fromRoot.error);
      failed(fromRoot, expected);
      assert.equal(fs.existsSync(marker), false);
    };
    fs.unlinkSync(generator);
    fs.symlinkSync(externalScript, generator); assertBlocked();
    fs.unlinkSync(generator);
    fs.symlinkSync(path.join(external, "missing.py"), generator); assertBlocked();
    fs.renameSync(tools, path.join(box.directory, "original-tools"));
    fs.symlinkSync(external, tools); assertBlocked();
    fs.unlinkSync(tools);
    fs.renameSync(path.join(box.directory, "original-tools"), tools);
    fs.unlinkSync(generator);
    fs.mkdirSync(generator); assertBlocked(/Expected a regular file at .*tools\/sync-copy\.py/u);
    fs.rmdirSync(generator);
    const created = spawnSync("mkfifo", [generator], { encoding: "utf8" });
    assert.ifError(created.error); passed(created);
    assertBlocked(/Expected a regular file at .*tools\/sync-copy\.py/u);
    fs.rmSync(tools, { recursive: true });
    fs.writeFileSync(tools, "not a directory");
    assertBlocked(/Expected a directory at .*tools/u);
  } finally { box.close(); }
});


test("a tampered diff header cannot turn a baseline into a git output option", () => {
  const box = fixture();
  try {
    passed(box.run());
    const escaped = path.join(box.directory, "unexpected..HEAD");
    const baseOption = "--output=" + path.join(box.directory, "unexpected");
    fs.writeFileSync(path.join(box.output, "changes.txt"), `# changes ${baseOption}..1234567\n`);
    failed(box.run(["--check"]), /changes\.txt 与 git diff 不一致/u);
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

test("check skips oversized source volumes without treating the bounded read as corrupt or complete", () => {
  const box = fixture({ "js/one.js": "x".repeat(70000), "js/two.js": "y".repeat(70000) });
  try {
    passed(box.run());
    const first = path.join(box.output, "1-app-code-1.txt");
    const second = path.join(box.output, "1-app-code-2.txt");
    const secondBytes = fs.readFileSync(second);
    const combined = Buffer.concat([fs.readFileSync(first), secondBytes]);
    assert.equal(combined[CAP], "y".charCodeAt(0), "the bounded read ends inside an otherwise intact source section");
    fs.writeFileSync(first, combined);
    const checked = box.run(["--check"]);
    failed(checked, /1-app-code-1\.txt 超过 130,000 字节/u);
    assert.match(checked.stdout, /源码索引未核对/u);
    assert.match(checked.stdout, /跳过 1 个超限源码卷/u);
    assert.doesNotMatch(checked.stdout, /中 .*与源码不一致|缺少:|使用说明未同步|\d+\/\d+ 个源文件/u);
    assert.deepEqual(fs.readFileSync(first), combined, "the check does not change the oversized volume");

    // A readable volume in the same group and a missing file in another group still yield actual errors.
    const badSecond = Buffer.from(secondBytes);
    badSecond[badSecond.indexOf(0x0a) + 1] = "z".charCodeAt(0);
    fs.writeFileSync(second, badSecond);
    const docs = path.join(box.output, "3-docs-1.txt");
    fs.unlinkSync(docs);
    const changes = path.join(box.output, "changes.txt");
    fs.appendFileSync(changes, "CORRUPT\n");
    const otherErrors = box.run(["--check"]);
    failed(otherErrors, /1-app-code-2\.txt 中 js\/two\.js 与源码不一致/u);
    assert.match(otherErrors.stdout, /缺少: \['docs\/note\.md'\]/u);
    assert.match(otherErrors.stdout, /changes\.txt 与 git diff 不一致/u);
    assert.match(otherErrors.stdout, /使用说明未同步/u, "the guide still lists the now-missing documentation volume");

    passed(box.run()); passed(box.run(["--check"]));
  } finally { box.close(); }
});
