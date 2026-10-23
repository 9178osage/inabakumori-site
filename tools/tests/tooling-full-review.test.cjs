const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "../..");
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "station-full-tooling-")));
  const root = path.join(base, "repo"), outside = path.join(base, "outside");
  fs.mkdirSync(root); fs.mkdirSync(outside);
  const write = (name, data) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data);
  };
  return { base, root, outside, write, copy: name => write(name, fs.readFileSync(path.join(repo, name))), close: () => fs.rmSync(base, { recursive: true, force: true }) };
}
// The actual async HTTP request handler runs without opening a listening port.
function previewRequest(server, url, method = "GET") {
  return new Promise(resolve => {
    const result = { status: 200, headers: {} };
    server.emit("request", { method, url }, {
      setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
      writeHead(status, headers = {}) { result.status = status; Object.assign(result.headers, headers); },
      end(body) { resolve({ ...result, body: body?.toString("utf8") ?? "" }); }
    });
  });
}

test("preview refuses allowlisted symlink files, parent directories and linked 404 fallbacks", async () => {
  const { createStaticServer } = await import("../static-server.mjs");
  const box = fixture();
  try {
    box.write("index.html", "PUBLIC_HOME"); box.write("404.html", "PUBLIC_404");
    fs.mkdirSync(path.join(box.root, "images"));
    const canary = path.join(box.outside, "private-canary.txt");
    fs.writeFileSync(canary, "PRIVATE_CANARY_ONLY_IN_TEMP");
    fs.symlinkSync(canary, path.join(box.root, "script.js"));
    fs.symlinkSync(canary, path.join(box.root, "images/linked.png"));
    fs.symlinkSync(box.outside, path.join(box.root, "images/alias"));
    fs.writeFileSync(path.join(box.outside, "picture.png"), "PRIVATE_DIRECTORY_CANARY");
    const server = createStaticServer(box.root);
    assert.equal((await previewRequest(server, "/")).body, "PUBLIC_HOME");
    for (const url of ["/script.js", "/images/linked.png", "/images/alias/picture.png"]) {
      const response = await previewRequest(server, url);
      assert.equal(response.status, 404, url); assert.equal(response.body, "PUBLIC_404", url);
      assert.doesNotMatch(response.body, /PRIVATE_/u, url);
    }
    fs.unlinkSync(path.join(box.root, "404.html")); fs.symlinkSync(canary, path.join(box.root, "404.html"));
    const response = await previewRequest(server, "/missing");
    assert.equal(response.status, 404);
    assert.equal(response.body, "Not found", "fallback cannot expose the symlink target either");
    assert.equal((await previewRequest(server, "/missing", "HEAD")).body, "");
  } finally { box.close(); }
});

const emptyXPostsMeta = `<meta name="x-posts-version" content="${require("node:crypto").createHash("sha256").update(JSON.stringify({ version: 1, coverage: [], items: [] })).digest("hex")}"/>`;
function publicBuild(box) {
  for (const file of ["tools/check-build.mjs", "tools/net-guards.mjs", "tools/x-posts-data.mjs", "tools/x-translations.mjs", "tools/calendar-song.mjs", "tools/safe-fs.mjs"]) box.copy(file);
  box.write("dist/index.html", `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://inabakumori-site-production.up.railway.app"/>
<link rel="canonical" href="https://osagechan.top/"/>
<script type="application/ld+json">{"@type":"WebSite"}</script>
<div id="nknk-gallery"></div><div id="nknk-lightbox"></div><section id="updates"></section><a href="#updates">Updates</a>
${emptyXPostsMeta}<div class="station-brand"><a class="station-mark" href="#updates">INABAKUMORI</a><a class="station-calendar" href="calendar.html">calendar</a></div><a data-song-title="ユレール">ユレール</a>`);
  box.write("data/creator-updates.json", JSON.stringify({ items: [{ creator: "inabakumori", source: "youtube", title: "稲葉曇『ユレール』Vo. 弦巻マキ", publishedAt: "2026-03-08T10:00:07.000Z" }, { creator: "inabakumori", source: "youtube", title: "Live stream", publishedAt: "2026-09-01T10:00:00.000Z" }] }));
  box.write("dist/calendar.html", `<meta name="robots" content="noindex, nofollow"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self';"/>
<article class="calendar-sheet" data-release="2026-03-08T10:00:07.000Z"></article>`);
  box.write("dist/CNAME", "osagechan.top\n"); box.write("dist/site.webmanifest", '{"icons":[]}');
  box.write("dist/sitemap.xml", `<urlset>${["", "updates.html", "updates-inabakumori.html", "updates-nknk.html"].map(name => `<url><loc>https://osagechan.top/${name}</loc></url>`).join("")}</urlset>\n`);
  // An empty X archive (no data/x-posts) still yields one archive page per author filter.
  const slices = { "updates.html": "", "updates-inabakumori.html": "稲葉曇的 X 帖子", "updates-nknk.html": "NKNK 的 X 帖子" };
  for (const name of ["updates.html", "updates-inabakumori.html", "updates-nknk.html"]) box.write(`dist/${name}`, `${slices[name] ? `<html lang="zh-CN" data-archive-creator="${name.slice(8, -5)}" data-archive-page="1">` : '<html lang="zh-CN">'}
<title>${[slices[name], "最新动态 · 稲葉曇与 NKNK"].filter(Boolean).join(" · ")}</title>
<meta property="og:title" content="${[slices[name], "最新动态 · 稲葉曇与 NKNK"].filter(Boolean).join(" · ")}"/>
<meta name="description" content="${slices[name] ? `${slices[name]}：` : ""}作品动态。"/>
<meta property="og:description" content="${slices[name] ? `${slices[name]}：` : ""}来自官方频道的作品记录。"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self';"/>
<link rel="canonical" href="https://osagechan.top/${name}"/>
<meta property="og:url" content="https://osagechan.top/${name}"/>
${emptyXPostsMeta}
<article class="source-status"></article><article class="source-status"></article><article class="source-status"></article>`);
  box.write("dist/js/songs.js", 'const SONGS = [{ "title": "ユレール" }];\n');
  box.write("dist/js/nknk-gallery.js", 'const NKNK_GALLERY = [{id:1,thumb:"images/picture.webp",full:"images/picture.webp"}];\n');
  box.write("dist/images/picture.webp", "PUBLIC_IMAGE");
}

test("public build check rejects symlinked assets and directories before publication", () => {
  for (const kind of ["regular", "file", "directory", "root"]) {
    const box = fixture();
    try {
      publicBuild(box);
      if (kind === "file") {
        const canary = path.join(box.outside, "private-canary.txt"); fs.writeFileSync(canary, "PRIVATE_BUILD_CANARY");
        fs.symlinkSync(canary, path.join(box.root, "dist/images/linked.webp"));
      } else if (kind === "directory") {
        fs.writeFileSync(path.join(box.outside, "private.txt"), "PRIVATE_DIRECTORY_CANARY");
        fs.symlinkSync(box.outside, path.join(box.root, "dist/images/linked"));
      } else if (kind === "root") {
        const moved = path.join(box.outside, "public-build");
        fs.renameSync(path.join(box.root, "dist"), moved);
        fs.symlinkSync(moved, path.join(box.root, "dist"));
      }
      const result = spawnSync(process.execPath, [path.join(box.root, "tools/check-build.mjs")], { cwd: box.root, encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error);
      if (kind === "regular") assert.equal(result.status, 0, result.stderr);
      else {
        assert.notEqual(result.status, 0, kind); assert.match(result.stderr, /symlink|non-regular/iu, kind);
        assert.doesNotMatch(result.stdout, /Public build verified/u, kind);
      }
    } finally { box.close(); }
  }
});

function refreshFixture() {
  const box = fixture();
  box.copy("tools/refresh-youtube-views.mjs"); box.copy("tools/safe-fs.mjs");
  const original = 'const SONGS = ' + JSON.stringify([
    { title: "Synthetic song", youtube: "https://youtu.be/AAAAAAAAAAA", viewCount: 7, viewsCheckedAt: "2020-01-01" }
  ]) + ';\n';
  box.write("js/songs.js", original);
  box.write("mock.mjs", `
const mode = process.env.REVIEW_MODE;
const token = process.env.YOUTUBE_API_KEY;
const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = milliseconds => {
  if (milliseconds !== 15000) throw new Error("Unexpected deadline");
  return originalTimeout(15);
};
globalThis.fetch = async (_url, options = {}) => {
  if (mode === "timeout" || mode === "body-timeout") {
    const stall = () => new Promise((_resolve, reject) => {
      const keepAlive = setInterval(() => {}, 100);
      options.signal?.addEventListener("abort", () => { clearInterval(keepAlive); reject(new Error("private " + token)); }, { once: true });
    });
    return mode === "timeout" ? stall() : { ok: true, json: stall };
  }
  if (mode === "network") throw new Error("private " + token);
  if (mode === "http") return { ok: false, status: 403, text: async () => "private " + token };
  if (mode === "api-error") return { ok: true, json: async () => ({ error: { message: "private " + token } }) };
  const viewCount = mode === "huge" ? "9".repeat(400) : mode === "unsafe" ? "9007199254740993" : "0";
  return { ok: true, json: async () => ({ items: [{ id: "AAAAAAAAAAA", statistics: { viewCount } }] }) };
};
`);
  return { ...box, original, run(mode) {
    const result = spawnSync(process.execPath, ["--import", path.join(box.root, "mock.mjs"), path.join(box.root, "tools/refresh-youtube-views.mjs")], {
      cwd: box.root, encoding: "utf8", timeout: 2000,
      env: { ...process.env, YOUTUBE_API_KEY: "synthetic-private-review-key", REVIEW_MODE: mode }
    });
    assert.ifError(result.error);
    return result;
  } };
}

test("view-count refresh rejects unsafe integers and keeps the prior file intact", () => {
  for (const mode of ["huge", "unsafe", "zero"]) {
    const box = refreshFixture();
    try {
      const result = box.run(mode);
      const source = fs.readFileSync(path.join(box.root, "js/songs.js"), "utf8");
      if (mode === "zero") {
        assert.equal(result.status, 0, result.stderr);
        assert.match(source, /"viewCount": 0/u, "a genuine zero count stays valid");
      } else {
        assert.equal(result.status, 1, mode);
        assert.equal(source, box.original, mode);
      }
    } finally { box.close(); }
  }
});

test("view-count refresh redacts API and network failures and bounds fetch plus body parsing", () => {
  for (const mode of ["http", "api-error", "network", "timeout", "body-timeout"]) {
    const box = refreshFixture();
    try {
      const result = box.run(mode);
      assert.equal(result.status, 1, mode);
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic-private-review-key/u, mode);
      assert.equal(fs.readFileSync(path.join(box.root, "js/songs.js"), "utf8"), box.original, mode);
      if (mode.endsWith("timeout")) assert.match(result.stderr, /timed out/u, mode);
    } finally { box.close(); }
  }
});


test("public build rejects a FIFO index before reading the entry document", { skip: process.platform === "win32" }, () => {
  const box = fixture();
  try {
    publicBuild(box);
    fs.unlinkSync(path.join(box.root, "dist/index.html"));
    const fifo = spawnSync("mkfifo", [path.join(box.root, "dist/index.html")], { encoding: "utf8" });
    assert.ifError(fifo.error); assert.equal(fifo.status, 0, fifo.stderr);
    const result = spawnSync(process.execPath, [path.join(box.root, "tools/check-build.mjs")], {
      cwd: box.root, encoding: "utf8", timeout: 5000
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-regular build entry/u);
    assert.doesNotMatch(result.stdout, /Public build verified/u);
  } finally { box.close(); }
});

test("preview rejects an allowlisted FIFO without waiting for a writer", { skip: process.platform === "win32" }, () => {
  const box = fixture();
  try {
    box.copy("tools/static-server.mjs"); box.copy("tools/safe-fs.mjs");
    box.write("404.html", "PUBLIC_404");
    const fifo = spawnSync("mkfifo", [path.join(box.root, "script.js")], { encoding: "utf8" });
    assert.ifError(fifo.error); assert.equal(fifo.status, 0, fifo.stderr);
    box.write("request.mjs", `
import { createStaticServer } from "./tools/static-server.mjs";
const server = createStaticServer(${JSON.stringify(box.root)});
let status;
server.emit("request", {method:"GET",url:"/script.js"}, {
  setHeader() {}, writeHead(value) { status=value; }, end(body) { console.log(JSON.stringify({status,body:String(body)})); }
});
`);
    const result = spawnSync(process.execPath, [path.join(box.root, "request.mjs")], { encoding: "utf8", timeout: 1000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { status: 404, body: "PUBLIC_404" });
  } finally { box.close(); }
});
