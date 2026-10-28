const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

async function fixture() {
  const { buildAssetPilot, PILOT_SOURCES } = await import("../build-asset-pilot.mjs");
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "station-asset-pilot-")));
  const root = path.join(directory, "repo");
  fs.mkdirSync(root);
  for (const [index, name] of [...PILOT_SOURCES, "fonts/ibm-plex-mono-OFL.txt"].entries()) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), Buffer.from(`synthetic public asset ${index}\0\n`));
  }
  fs.mkdirSync(path.join(root, "backend"));
  fs.writeFileSync(path.join(root, "backend/.env"), "PRIVATE_NOT_FOR_EXPORT");
  fs.writeFileSync(path.join(root, "index.html"), "PRIVATE_SITE_SOURCE_NOT_FOR_EXPORT");
  return { root, directory, sources: PILOT_SOURCES, build: () => buildAssetPilot(root), close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
const hash = data => createHash("sha256").update(data).digest("hex");

test("the pilot exports only eight selected binaries, preserves bytes and builds a valid reproducible ZIP", async () => {
  const box = await fixture();
  try {
    const result = await box.build();
    assert.equal(Object.keys(result.manifest.assets).length, 8);
    for (const source of box.sources) {
      const info = result.manifest.assets[source];
      const original = fs.readFileSync(path.join(box.root, source));
      assert.match(info.path, /^assets\/[a-z0-9-]+-[a-f0-9]{16}\.(?:webp|woff2)$/u);
      assert.equal(info.sha256, hash(original));
      assert.equal(info.bytes, original.length);
      assert.deepEqual(fs.readFileSync(path.join(result.directory, info.path)), original);
    }
    const headers = fs.readFileSync(path.join(result.directory, "_headers"), "utf8");
    assert.match(headers, /Access-Control-Allow-Origin: \*/u);
    assert.match(headers, /\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable/u);
    assert.doesNotMatch(headers.split("/assets/*")[0], /Cache-Control/u, "global no-store must not conflict with the immutable asset rule");
    assert.ok(fs.existsSync(path.join(result.directory, "404.html")), "missing assets must not become SPA HTML");
    assert.match(fs.readFileSync(path.join(result.directory, "index.html"), "utf8"), /name="robots" content="noindex"/u);
    const zipped = spawnSync("python3", ["-c", "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))", result.zip], { encoding: "utf8", timeout: 10000 });
    assert.ifError(zipped.error); assert.equal(zipped.status, 0, zipped.stderr);
    const names = JSON.parse(zipped.stdout);
    assert.equal(names.length, 13);
    assert.ok(names.every(name => !name.includes("backend") && !name.includes(".env")));
    assert.ok(names.includes("licenses/ibm-plex-mono-OFL.txt"));
    assert.doesNotMatch(fs.readFileSync(result.zip).toString("utf8"), /PRIVATE_/u);
    assert.equal((await box.build()).zipSha256, result.zipSha256);
    fs.appendFileSync(path.join(box.root, box.sources[0]), "changed");
    const updated = await box.build();
    assert.notEqual(updated.manifest.assets[box.sources[0]].path, result.manifest.assets[box.sources[0]].path);
    assert.equal(updated.manifest.assets[box.sources[1]].path, result.manifest.assets[box.sources[1]].path);
  } finally { box.close(); }
});

test("the pilot refuses linked source assets and source directories", async () => {
  for (const linked of ["fonts/station-mono.woff2", "images/optimized/nknk/mobile"]) {
    const box = await fixture();
    try {
      const outside = path.join(box.directory, "outside");
      if (path.extname(linked)) fs.writeFileSync(outside, "PRIVATE_CANARY");
      else { fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "1.webp"), "PRIVATE_CANARY"); }
      fs.rmSync(path.join(box.root, linked), { recursive: true, force: true });
      fs.symlinkSync(outside, path.join(box.root, linked));
      await assert.rejects(box.build(), /Refusing symlinked path/u);
      assert.equal(fs.existsSync(path.join(box.root, "artifacts/cloudflare-assets-pilot/pilot.zip")), false);
    } finally { box.close(); }
  }
});

test("the pilot refuses linked output parents, ZIP files and nested paths before clearing existing output", async () => {
  for (const linked of ["artifacts", "artifacts/cloudflare-assets-pilot/public/assets", "artifacts/cloudflare-assets-pilot/pilot.zip"]) {
    const box = await fixture();
    try {
      const outside = path.join(box.directory, "outside");
      fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "keep.txt"), "KEEP");
      const target = linked.endsWith(".zip") ? path.join(outside, "keep.txt") : outside;
      const destination = path.join(box.root, linked);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.symlinkSync(target, destination);
      await assert.rejects(box.build(), /Refusing symlinked path/u);
      assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "KEEP");
    } finally { box.close(); }
  }
});
