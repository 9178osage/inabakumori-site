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
  for (const file of ["tools/check-build.mjs", "tools/net-guards.mjs", "tools/x-posts-data.mjs", "tools/x-translations.mjs", "tools/calendar-song.mjs", "tools/safe-fs.mjs", "tools/song-archive.mjs"]) box.copy(file);
  const authBundle = "/* synthetic public auth bundle */";
  const fingerprint = value => require("node:crypto").createHash("sha256").update(value).digest("hex").slice(0, 12);
  const authLoader = `const bundleUrl = new URL("./auth.js?v=${fingerprint(authBundle)}", document.currentScript.src);`;
  box.write("dist/js/auth.js", authBundle);
  box.write("dist/js/auth-loader.js", authLoader);
  box.write("dist/index.html", `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://inabakumori-backend.vercel.app"/>
<link rel="canonical" href="https://osagechan.top/"/>
<script src="js/auth-loader.js?v=${fingerprint(authLoader)}" defer></script>
<script type="application/ld+json">{"@type":"WebSite"}</script>
<div id="nknk-gallery"></div><div id="nknk-lightbox"></div><section id="updates"><section class="x-posts-home" data-x-posts-home><p data-x-home-count></p><a data-x-archive-link></a><div class="x-posts-feed"></div></section></section><a href="#updates">Updates</a>
${emptyXPostsMeta}<div class="station-brand"><a class="station-mark" href="#updates">INABAKUMORI</a><a class="station-calendar" href="calendar.html">calendar</a></div><a data-song-title="ユレール">ユレール</a>`);
  box.write("data/creator-updates.json", JSON.stringify({ items: [{ creator: "inabakumori", source: "youtube", title: "稲葉曇『ユレール』Vo. 弦巻マキ", publishedAt: "2026-03-08T10:00:07.000Z", url: "https://www.youtube.com/watch?v=2r4W_LoVFxA" }, { creator: "inabakumori", source: "youtube", title: "Live stream", publishedAt: "2026-09-01T10:00:00.000Z" }] }));
  box.write("dist/calendar.html", `<meta name="robots" content="noindex, nofollow"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self';"/>
<article class="calendar-sheet" data-release="2026-03-08T10:00:07.000Z"></article>`);
  box.write("dist/CNAME", "osagechan.top\n"); box.write("dist/site.webmanifest", '{"icons":[]}');
  box.write("dist/sitemap.xml", `<urlset>${["", "updates.html", "updates-inabakumori.html", "updates-nknk.html", "songs.html", "song-2r4W_LoVFxA.html"].map(name => `<url><loc>https://osagechan.top/${name}</loc></url>`).join("")}</urlset>\n`);
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
<article class="update-item"></article><article class="update-item"></article>
<article class="source-status"></article><article class="source-status"></article><article class="source-status"></article>`);
  // Generated song archive pages share the archive CSP.
  for (const name of ["songs.html", "song-2r4W_LoVFxA.html"]) box.write(`dist/${name}`, `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self';"/>\n<main></main>`);
  box.write("dist/js/songs.js", 'const SONGS = [{ "title": "ユレール", "youtube": "https://youtu.be/2r4W_LoVFxA" }];\n');
  box.write("data/song-redirects.json", JSON.stringify({ version: 1, redirects: {} }));
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

test("the build gate requires each retired song address to redirect to its replacement and stay out of the sitemap", () => {
  const OLD = "AAAAAAAAAAA", NEW = "2r4W_LoVFxA", target = `song-${NEW}.html`;
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self';"/>`;
  const page = (to = target, canonical = to) => `${csp}\n<meta http-equiv="refresh" content="0; url=${to}"/>\n<link rel="canonical" href="https://osagechan.top/${canonical}"/>\n<main><a href="${to}">ユレール</a></main>`;
  const cases = [
    ["a complete redirect page", () => {}, null],
    ["a recorded redirect whose page is missing", box => fs.rmSync(path.join(box.root, `dist/song-${OLD}.html`)), /must match js\/songs\.js and data\/song-redirects\.json/u],
    ["a leftover page that no record explains", box => box.write("data/song-redirects.json", JSON.stringify({ version: 1, redirects: {} })), /must match js\/songs\.js and data\/song-redirects\.json/u],
    ["a redirect page listed in the sitemap", box => {
      const file = path.join(box.root, "dist/sitemap.xml");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("</urlset>", `<url><loc>https://osagechan.top/song-${OLD}.html</loc></url></urlset>`));
    }, /Sitemap lists an unknown page|Sitemap must not list the redirect page/u],
    ["a redirect to a different page", box => box.write(`dist/song-${OLD}.html`, page("songs.html")), /must redirect to song-2r4W_LoVFxA\.html/u],
    ["a redirect page that names itself canonical", box => box.write(`dist/song-${OLD}.html`, page(target, `song-${OLD}.html`)), /must name song-2r4W_LoVFxA\.html as canonical/u],
    ["a redirect page without the redirect", box => box.write(`dist/song-${OLD}.html`, page().replace(/<meta http-equiv="refresh"[^>]*>\n/u, "")), /must redirect to song-2r4W_LoVFxA\.html|exactly one redirect/u],
    ["a redirect page with an inline script", box => box.write(`dist/song-${OLD}.html`, `${page()}<script>location.href="x"</script>`), /must not use inline scripts/u],
    ["a redirect whose replacement is not a song", box => box.write("data/song-redirects.json", JSON.stringify({ version: 1, redirects: { [OLD]: "BBBBBBBBBBB" } })), /Redirect target BBBBBBBBBBB is not a song/u]
  ];
  for (const [name, change, failure] of cases) {
    const box = fixture();
    try {
      publicBuild(box);
      box.write("data/song-redirects.json", JSON.stringify({ version: 1, redirects: { [OLD]: NEW } }));
      box.write(`dist/song-${OLD}.html`, page());
      change(box);
      const result = spawnSync(process.execPath, [path.join(box.root, "tools/check-build.mjs")], { cwd: box.root, encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error);
      if (failure) { assert.notEqual(result.status, 0, name); assert.match(result.stderr, failure, name); }
      else assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    } finally { box.close(); }
  }
});

test("the build gate requires the pre-rendered featured marks to match mobileFeatured in js/songs.js", () => {
  const songs = flag => `const SONGS = [{ "title": "ユレール", "youtube": "https://youtu.be/2r4W_LoVFxA"${flag === undefined ? "" : `, "mobileFeatured": ${flag}`} }];\n`;
  const mismatch = /Pre-rendered data-mobile-featured marks must match mobileFeatured in js\/songs\.js/u;
  const cases = [
    ["no song is featured and none is marked", undefined, false, null],
    ["a flagged song carries its mark", "true", true, null],
    ["a flagged song whose mark is missing from the page", "true", false, mismatch],
    ["a mark on a song that js/songs.js does not flag", undefined, true, mismatch],
    ["a mark on a song whose flag is not a plain true", '"true"', true, mismatch]
  ];
  for (const [name, flag, marked, failure] of cases) {
    const box = fixture();
    try {
      publicBuild(box);
      const home = path.join(box.root, "dist/index.html");
      fs.writeFileSync(home, fs.readFileSync(home, "utf8").replace('<a data-song-title="ユレール">', `<a data-song-title="ユレール"${marked ? ' data-mobile-featured="true"' : ""}>`));
      box.write("dist/js/songs.js", songs(flag));
      const result = spawnSync(process.execPath, [path.join(box.root, "tools/check-build.mjs")], { cwd: box.root, encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error);
      if (failure) { assert.notEqual(result.status, 0, name); assert.match(result.stderr, failure, name); }
      else assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    } finally { box.close(); }
  }
});

test("the build gate keeps the X archive link above the feed and rejects the retired works log", () => {
  const section = '<section class="x-posts-home" data-x-posts-home><p data-x-home-count></p><a data-x-archive-link></a><div class="x-posts-feed"></div></section>';
  const misplaced = /archive link must sit inside the X section/u;
  const retired = /Homepage must not include the retired works log/u;
  const cases = [
    ["the expected order", section, null],
    ["the archive link below the feed", section.replace("<a data-x-archive-link></a>", "").replace("</div></section>", "</div><a data-x-archive-link></a></section>"), misplaced],
    ["the archive link outside the X section", `${section.replace("<a data-x-archive-link></a>", "")}<a data-x-archive-link></a>`, misplaced],
    ["the archive link above the post count", section.replace("<a data-x-archive-link></a>", "").replace("<p data-x-home-count>", "<a data-x-archive-link></a><p data-x-home-count>"), misplaced],
    ["a restored works log", `${section}<details class="home-works-log"></details>`, retired],
    ["a restored work entry", `${section}<article class="update-item"></article>`, retired],
    ["a restored source status", `${section}<article class="source-status"></article>`, retired],
    ["a stale works snapshot fingerprint", `${section}<meta name="creator-updates-version" content="stale"/>`, retired]
  ];
  for (const [name, markup, failure] of cases) {
    const box = fixture();
    try {
      publicBuild(box);
      const home = path.join(box.root, "dist/index.html");
      fs.writeFileSync(home, fs.readFileSync(home, "utf8").replace(section, markup));
      const result = spawnSync(process.execPath, [path.join(box.root, "tools/check-build.mjs")], { cwd: box.root, encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error);
      if (failure) { assert.notEqual(result.status, 0, name); assert.match(result.stderr, failure, name); }
      else assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    } finally { box.close(); }
  }
});

test("the build gate rejects a retired homepage works script even when nothing references it", () => {
  const box = fixture();
  try {
    publicBuild(box);
    box.write("dist/js/home-updates.js", "/* retired */");
    const result = spawnSync(process.execPath, [path.join(box.root, "tools/check-build.mjs")], { cwd: box.root, encoding: "utf8", timeout: 10000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Retired homepage works script must not be published/u);
  } finally { box.close(); }
});

test("the build gate still requires the complete works snapshot on every first archive page", () => {
  for (const file of ["dist/updates.html", "dist/updates-nknk.html"]) {
    const box = fixture();
    try {
      publicBuild(box);
      const page = path.join(box.root, file);
      fs.writeFileSync(page, fs.readFileSync(page, "utf8").replace('<article class="update-item"></article>', ""));
      const result = spawnSync(process.execPath, [path.join(box.root, "tools/check-build.mjs")], { cwd: box.root, encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error);
      assert.notEqual(result.status, 0, file);
      assert.match(result.stderr, /The archive must contain the full works snapshot|Works snapshot must appear only on archive page 1/u, file);
    } finally { box.close(); }
  }
});

test("the real build gate accepts trusted watch links and rejects an untrusted video host", () => {
  for (const youtube of ["https://www.youtube.com/watch?v=2r4W_LoVFxA", "https://m.youtube.com/watch?v=2r4W_LoVFxA", "https://evil.example/?v=2r4W_LoVFxA"]) {
    const box = fixture();
    try {
      publicBuild(box);
      box.write("dist/js/songs.js", `const SONGS = ${JSON.stringify([{ title: "ユレール", youtube }])};\n`);
      const result = spawnSync(process.execPath, [path.join(box.root, "tools/check-build.mjs")], { cwd: box.root, encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error);
      if (youtube.includes("evil.example")) {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Invalid YouTube URL/u);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Public build verified/u);
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
