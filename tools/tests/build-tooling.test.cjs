const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "../..");
// A throwaway copy of just the named tool files; nothing in the real repo is touched.
function sandbox(files) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "station-tooling-")));
  const root = path.join(base, "repo");
  fs.mkdirSync(root);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(repo, file), path.join(root, file));
  }
  const outside = path.join(base, "outside");
  fs.mkdirSync(outside);
  return { base, root, outside, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
function run(root, script, args = [], env = {}) {
  const clean = { ...process.env };
  delete clean.CI; delete clean.GITHUB_ACTIONS; delete clean.KEEP_LOCAL_API_CSP;
  return spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, env: { ...clean, ...env }, encoding: "utf8", timeout: 30_000 });
}
const buildFiles = ["tools/build-site.mjs", "tools/safe-fs.mjs", "tools/net-guards.mjs", "tools/auth-src.js"];

test("assertRepoPath refuses escapes, symlinked files and symlinked parent folders", async () => {
  const { assertRepoPath } = await import("../safe-fs.mjs");
  const box = sandbox([]);
  try {
    fs.mkdirSync(path.join(box.root, "js"));
    fs.writeFileSync(path.join(box.root, "js/ok.js"), "");
    assert.equal(assertRepoPath(box.root, "js/ok.js", { mustExist: true }), path.join(box.root, "js/ok.js"));
    assert.equal(assertRepoPath(box.root, "dist/new/file.js"), path.join(box.root, "dist/new/file.js"), "missing outputs are allowed");
    assert.throws(() => assertRepoPath(box.root, "../outside/x"), /outside the repository/);
    assert.throws(() => assertRepoPath(box.root, "/etc/passwd"), /outside the repository/);
    assert.throws(() => assertRepoPath(box.root, "."), /outside the repository/);
    assert.throws(() => assertRepoPath(box.root, "js/missing.js", { mustExist: true }), /ENOENT/);
    fs.symlinkSync(path.join(box.outside, "target.js"), path.join(box.root, "js/link.js"));
    assert.throws(() => assertRepoPath(box.root, "js/link.js"), /symlinked path: js\/link\.js/);
    fs.symlinkSync(box.outside, path.join(box.root, "images"));
    assert.throws(() => assertRepoPath(box.root, "images/optimized/nknk/1.webp"), /symlinked path: images/);
  } finally { box.cleanup(); }
});

test("build refuses to write the auth bundle through a symlinked js/auth.js", () => {
  const box = sandbox(buildFiles);
  try {
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(box.root, "node_modules"));
    const victim = path.join(box.outside, "victim.txt");
    fs.writeFileSync(victim, "CANARY");
    fs.mkdirSync(path.join(box.root, "js"));
    fs.symlinkSync(victim, path.join(box.root, "js/auth.js"));
    const result = run(box.root, "tools/build-site.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing symlinked path: js\/auth\.js/);
    assert.equal(fs.readFileSync(victim, "utf8"), "CANARY", "link target outside the repo must be untouched");
  } finally { box.cleanup(); }
});

test("build refuses to delete through a symlinked dist/ folder", () => {
  const box = sandbox(buildFiles);
  try {
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(box.root, "node_modules"));
    fs.writeFileSync(path.join(box.outside, "keep.txt"), "KEEP");
    fs.symlinkSync(box.outside, path.join(box.root, "dist"));
    const result = run(box.root, "tools/build-site.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing symlinked path: dist/);
    assert.equal(fs.readFileSync(path.join(box.outside, "keep.txt"), "utf8"), "KEEP");
  } finally { box.cleanup(); }
});

test("NKNK generator refuses symlinked output folders instead of emptying their targets", () => {
  for (const linked of ["images/optimized/nknk", "images/optimized", "images/optimized/nknk/full"]) {
    const box = sandbox(["tools/generate-nknk-gallery.mjs", "tools/safe-fs.mjs"]);
    try {
      fs.mkdirSync(path.join(box.root, "NKNK"));
      fs.writeFileSync(path.join(box.root, "NKNK/1.jpg"), "not really a jpeg");
      fs.writeFileSync(path.join(box.outside, "important.txt"), "KEEP");
      fs.mkdirSync(path.dirname(path.join(box.root, linked)), { recursive: true });
      fs.symlinkSync(box.outside, path.join(box.root, linked));
      const result = run(box.root, "tools/generate-nknk-gallery.mjs", ["--config-only"]);
      assert.notEqual(result.status, 0, linked);
      assert.match(result.stderr, /Refusing symlinked path/, linked);
      assert.deepEqual(fs.readdirSync(box.outside), ["important.txt"], `${linked}: nothing outside the repo may be created or deleted`);
    } finally { box.cleanup(); }
  }
});

test("NKNK generator refuses numbered source-image symlinks", () => {
  const box = sandbox(["tools/generate-nknk-gallery.mjs", "tools/safe-fs.mjs"]);
  try {
    fs.mkdirSync(path.join(box.root, "NKNK"));
    fs.writeFileSync(path.join(box.outside, "image.png"), "private file");
    fs.symlinkSync(path.join(box.outside, "image.png"), path.join(box.root, "NKNK/1.png"));
    const result = run(box.root, "tools/generate-nknk-gallery.mjs", ["--config-only"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing non-file gallery source: 1\.png/);
    assert.equal(fs.readFileSync(path.join(box.outside, "image.png"), "utf8"), "private file");
  } finally { box.cleanup(); }
});

test("view-count updater refuses to replace js/songs.js when it is a symlink", () => {
  const box = sandbox(["tools/refresh-youtube-views.mjs", "tools/safe-fs.mjs"]);
  try {
    fs.mkdirSync(path.join(box.root, "js"));
    const victim = path.join(box.outside, "victim.js");
    fs.writeFileSync(victim, "KEEP");
    fs.symlinkSync(victim, path.join(box.root, "js/songs.js"));
    const result = run(box.root, "tools/refresh-youtube-views.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing symlinked path: js\/songs\.js/);
    assert.equal(fs.readFileSync(victim, "utf8"), "KEEP");
  } finally { box.cleanup(); }
});

test("every loopback spelling is detected and stripped from CSP source lists", async () => {
  const { loopbackCspSources, stripLoopbackCspSources, isLoopbackCspSource } = await import("../net-guards.mjs");
  const variants = ["http://127.0.0.1:3001", "http://localhost:3001", "http://[::1]:3001", "http://LOCALHOST:3001", "http://LocalHost.:3001",
    "http://127.1:3001", "http://127.0.1:3001", "http://0x7f.1:3001", "http://2130706433:3001", "http://017700000001:3001", "http://127.255.255.254",
    "http://0.0.0.0:3001", "http://0:3001", "http://[::]:3001", "http://[::ffff:127.0.0.1]:3001", "http://[0:0:0:0:0:0:0:1]:3001",
    "http://app.localhost:3001", "http://*.localhost:3001", "*.LOCALHOST", "localhost:3001", "127.0.0.1", "ws://localhost:3001", "wss://[::1]",
    "http://*:3001", "*", "http:", "ws:"];
  for (const variant of variants) assert.ok(isLoopbackCspSource(variant), variant);
  for (const safe of ["'self'", "'none'", "https:", "data:", "https://inabakumori-site-production.up.railway.app", "https://i.ytimg.com",
    "https://localhost.example.com", "https://127.0.0.1.example.com", "https://notlocalhost"]) assert.equal(isLoopbackCspSource(safe), false, safe);
  const policy = `default-src 'self'; connect-src 'self' https://inabakumori-site-production.up.railway.app ${variants.join(" ")}; img-src 'self' data:`;
  assert.equal(loopbackCspSources(policy).length, variants.length);
  const stripped = stripLoopbackCspSources(policy);
  assert.equal(stripped, "default-src 'self'; connect-src 'self' https://inabakumori-site-production.up.railway.app; img-src 'self' data:");
  assert.deepEqual(loopbackCspSources(stripped), []);
});

test("check-build rejects loopback CSP sources even with KEEP_LOCAL_API_CSP=1, and CI refuses local-CSP builds", () => {
  for (const variant of ["http://[::1]:3001", "http://LOCALHOST:3001", "http://127.1:3001", "http://0.0.0.0:3001", "http://localhost:3001"]) {
    const box = sandbox(["tools/check-build.mjs", "tools/net-guards.mjs"]);
    try {
      fs.mkdirSync(path.join(box.root, "dist"));
      fs.writeFileSync(path.join(box.root, "dist/index.html"), `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://inabakumori-site-production.up.railway.app ${variant}"/>`);
      for (const env of [{}, { KEEP_LOCAL_API_CSP: "1" }]) {
        const result = run(box.root, "tools/check-build.mjs", [], env);
        assert.notEqual(result.status, 0, variant);
        assert.match(result.stderr, /Production CSP must not/, variant);
      }
    } finally { box.cleanup(); }
  }
  const box = sandbox(buildFiles);
  try {
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(box.root, "node_modules"));
    for (const [args, env] of [[["--keep-local-api-csp"], { CI: "true" }], [[], { KEEP_LOCAL_API_CSP: "1", GITHUB_ACTIONS: "true" }]]) {
      const result = run(box.root, "tools/build-site.mjs", args, env);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Refusing a local-API CSP build in CI/);
    }
  } finally { box.cleanup(); }
});

test("check-build rejects asset references that resolve outside dist/", () => {
  for (const reference of ["../outside.png", "%2e%2e/outside.png", "/../outside.png", "images/../../outside.png"]) {
    const box = sandbox(["tools/check-build.mjs", "tools/net-guards.mjs"]);
    try {
      fs.mkdirSync(path.join(box.root, "dist"));
      fs.writeFileSync(path.join(box.root, "outside.png"), "x");
      fs.writeFileSync(path.join(box.root, "dist/index.html"), `<img src="${reference}">`);
      const result = run(box.root, "tools/check-build.mjs");
      assert.notEqual(result.status, 0, reference);
      assert.match(result.stderr, /Asset reference escapes dist/, reference);
    } finally { box.cleanup(); }
  }
});

test("check-build only allows the known connect-src sources, so a loopback alias cannot ship", () => {
  // These names resolve to 127.0.0.1 for a browser but contain no loopback text, so the
  // spelling blocklist cannot see them; the allowlist must reject them all the same.
  for (const variant of ["http://localtest.me:3001", "http://lvh.me:3001", "http://127-0-0-1.nip.io:3001", "https://cdn.example.com"]) {
    const box = sandbox(["tools/check-build.mjs", "tools/net-guards.mjs"]);
    try {
      fs.mkdirSync(path.join(box.root, "dist"));
      fs.writeFileSync(path.join(box.root, "dist/index.html"), `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://inabakumori-site-production.up.railway.app ${variant}"/>`);
      for (const env of [{}, { KEEP_LOCAL_API_CSP: "1" }]) {
        const result = run(box.root, "tools/check-build.mjs", [], env);
        assert.notEqual(result.status, 0, variant);
        assert.match(result.stderr, /Unexpected connect-src source/, variant);
      }
    } finally { box.cleanup(); }
  }
  // A spelled-out loopback host is caught even earlier, by the loopback assertion.
  const spelled = sandbox(["tools/check-build.mjs", "tools/net-guards.mjs"]);
  try {
    fs.mkdirSync(path.join(spelled.root, "dist"));
    fs.writeFileSync(path.join(spelled.root, "dist/index.html"), `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://inabakumori-site-production.up.railway.app http://127.0.0.1:3001"/>`);
    const result = run(spelled.root, "tools/check-build.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Production CSP must not allow local development APIs/);
  } finally { spelled.cleanup(); }
  // The allowed policy must still pass this assertion (checked via the shipped dist in CI).
  const box = sandbox(["tools/check-build.mjs", "tools/net-guards.mjs"]);
  try {
    fs.mkdirSync(path.join(box.root, "dist"));
    fs.writeFileSync(path.join(box.root, "dist/index.html"), `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://inabakumori-site-production.up.railway.app"/>`);
    const result = run(box.root, "tools/check-build.mjs");
    assert.doesNotMatch(result.stderr, /Unexpected connect-src source/, "the shipped connect-src policy must stay allowed");
  } finally { box.cleanup(); }
});

test("link checker pairs each song with its own youtube URL and fails loudly on a missing link", async () => {
  const { songsFromSource } = await import("../check-links.mjs");
  const file = list => `const SONGS = ${JSON.stringify(list, null, 2)};\n`;
  // singers is an inner array: the array literal must not be cut short at the first "]".
  const complete = file([
    { title: "Alpha", youtube: "https://youtu.be/AAAAAAAAAAA", singers: ["a", "b"] },
    { title: "Gamma", youtube: "https://youtu.be/GGGGGGGGGGG", singers: [] }
  ]);
  assert.deepEqual(songsFromSource(complete), [
    { title: "Alpha", url: "https://youtu.be/AAAAAAAAAAA" },
    { title: "Gamma", url: "https://youtu.be/GGGGGGGGGGG" }
  ]);
  // A song without a link used to silently shift every following title onto the wrong video.
  assert.throws(() => songsFromSource(file([
    { title: "Alpha", youtube: "https://youtu.be/AAAAAAAAAAA" },
    { title: "Beta", album: "x" },
    { title: "Gamma", youtube: "https://youtu.be/GGGGGGGGGGG" }
  ])), /Missing youtube link for: Beta/);
  assert.throws(() => songsFromSource("const SONGS = notJson;"), /Could not find the SONGS array/);
  const real = fs.readFileSync(path.join(repo, "js/songs.js"), "utf8");
  const songs = songsFromSource(real);
  assert.ok(songs.length >= 51, `expected the whole catalogue, got ${songs.length}`);
  for (const song of songs) assert.match(song.url, /^https:\/\/youtu\.be\/[A-Za-z0-9_-]{11}$/u, song.title);
});

test("link checker fetches only public http(s) URLs, including every redirect hop", async () => {
  const { assertPublicHttpUrl, checkSong, createPinnedLookup } = await import("../check-links.mjs");
  const publicResolver = async () => [{ address: "142.250.72.14", family: 4 }];
  assert.equal((await assertPublicHttpUrl("https://youtu.be/abcdefghijk", { resolve: publicResolver })).hostname, "youtu.be");
  for (const url of ["file:///etc/passwd", "data:text/plain,hi", "ftp://example.com/x", "javascript:alert(1)", "http://user:pw@example.com/",
    "http://localhost:3001/", "http://127.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://172.16.0.1/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[::ffff:10.0.0.1]/", "http://router.local/", "http://intranet/", "not a url"]) {
    await assert.rejects(assertPublicHttpUrl(url, { resolve: publicResolver }), /Refusing|Not a URL/, url);
  }
  await assert.rejects(assertPublicHttpUrl("https://rebind.example/", { resolve: async () => [{ address: "127.0.0.1", family: 4 }] }), /resolves to a non-public address/);
  let pinned;
  createPinnedLookup([{ address: "142.250.72.14", family: 4 }, { address: "2607:f8b0:4007:80c::200e", family: 6 }])(
    "rebind.example", { all: true }, (error, addresses) => { assert.ifError(error); pinned = addresses; }
  );
  assert.deepEqual(pinned, [
    { address: "142.250.72.14", family: 4 },
    { address: "2607:f8b0:4007:80c::200e", family: 6 }
  ], "the connector can only see the already-validated DNS answers");
  assert.throws(() => createPinnedLookup([]), /without a validated address/);
  const fetched = [];
  const requestImpl = async (url, addresses) => {
    fetched.push(url.href);
    assert.deepEqual(addresses, [{ address: "142.250.72.14", family: 4 }], "the checked DNS answer is passed to the connector");
    return url.href.startsWith("https://youtu.be/")
      ? { status: 302, headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }), body: { cancel: async () => {} } }
      : { status: 200, headers: new Headers(), body: { cancel: async () => {} } };
  };
  const result = await checkSong({ title: "t", url: "https://youtu.be/abcdefghijk" }, { requestImpl, resolve: publicResolver });
  assert.equal(result.ok, false);
  assert.match(result.detail, /Refusing non-public host: 169\.254\.169\.254/);
  assert.deepEqual(fetched, ["https://youtu.be/abcdefghijk"], "the private redirect target is never requested");
  const okResult = await checkSong({ title: "t", url: "https://www.youtube.com/watch?v=abcdefghijk" }, { requestImpl, resolve: publicResolver });
  assert.equal(okResult.ok, true);
});

test("link checker deadline covers stalled initial and redirect DNS lookups", { timeout: 2000 }, async () => {
  const { checkSong } = await import("../check-links.mjs");
  for (const stallOn of [1, 2]) {
    let lookups = 0;
    let requests = 0;
    let rejectLookup;
    const result = await checkSong({ title: "timeout", url: "https://first.example/" }, {
      deadlineMs: 20,
      resolve: async () => {
        if (++lookups === stallOn) return new Promise((_, reject) => { rejectLookup = reject; });
        return [{ address: "142.250.72.14", family: 4 }];
      },
      requestImpl: async () => {
        requests++;
        return { status: 302, headers: new Headers({ location: "https://second.example/" }), body: { cancel: async () => {} } };
      }
    });
    assert.equal(result.status, "TIMEOUT");
    assert.equal(result.ok, false);
    assert.equal(requests, stallOn - 1, "a stalled DNS lookup must never reach the connector");
    rejectLookup(new Error("late DNS failure"));
    await new Promise(resolve => setImmediate(resolve));
  }
});
