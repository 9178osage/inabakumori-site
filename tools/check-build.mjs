import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loopbackCspSources } from "./net-guards.mjs";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const html = await readFile(path.join(root, "index.html"), "utf8");
// A referenced asset must resolve to a file inside dist/, never a sibling or parent path.
function distFile(reference) {
  let decoded;
  try { decoded = decodeURIComponent(reference); } catch { assert.fail(`Undecodable asset reference: ${reference}`); }
  const resolved = path.resolve(root, decoded.replace(/^\/+/u, ""));
  const relative = path.relative(root, resolved);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `Asset reference escapes dist: ${reference}`);
  return resolved;
}
let bytes = 0;
async function checkFolder(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = path.relative(root, path.join(folder, entry.name));
    if (entry.name.startsWith(".") && !(folder === root && entry.isFile() && entry.name === ".nojekyll")) {
      throw new Error(`refusing to publish hidden path: ${name}`);
    }
    assert.ok(!/(^|\/)(backend|tools|docs|node_modules|trusted-read[^/]*|\.git|\.env)/i.test(name), `Private file in build: ${name}`);
    assert.ok(!/\.(db|mjs|map|md)$/i.test(name), `Non-public file in build: ${name}`);
    if (entry.isDirectory()) await checkFolder(path.join(folder, entry.name));
    else {
      bytes += (await stat(path.join(folder, entry.name))).size;
      if (name.endsWith(".js")) new vm.Script(await readFile(path.join(root, name), "utf8"), { filename: name });
    }
  }
}
await checkFolder(root);
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const value = match[1];
  if (/^(https?:|mailto:|#)/.test(value)) continue;
  const file = value.split(/[?#]/u)[0];
  assert.ok((await stat(distFile(file))).isFile(), `Missing asset: ${file}`);
}
const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
assert.ok(csp, "Production CSP meta missing");
assert.match(csp, /connect-src 'self' https:\/\/inabakumori-site-production\.up\.railway\.app/, "Production CSP must allow the Railway API");
// Always enforced, whatever the environment: a published CSP never reaches a loopback service.
assert.deepEqual(loopbackCspSources(csp), [], "Production CSP must not allow local development APIs (dist came from build:local/preview? run npm run build)");
assert.doesNotMatch(csp, /localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0/iu, "Production CSP must not name a loopback host");
// Positive allowlist instead of a blocklist of spellings: the build cannot resolve DNS, so a
// public name that resolves to loopback (localtest.me, *.nip.io, ...) would otherwise ship.
const CONNECT_SRC_ALLOWED = new Set(["'self'", "https://inabakumori-site-production.up.railway.app"]);
for (const source of (/connect-src([^;]*)/u.exec(csp)?.[1] ?? "").trim().split(/\s+/u).filter(Boolean)) {
  assert.ok(CONNECT_SRC_ALLOWED.has(source), `Unexpected connect-src source: ${source}`);
}
assert.match(html, /<link rel="canonical" href="https:\/\/osagechan\.top\/"\/>/, "canonical must point at the custom domain");
assert.ok(!html.includes("9178osage.github.io"), "old GitHub Pages URL must not remain in index.html");
assert.equal((await readFile(path.join(root, "CNAME"), "utf8")).trim(), "osagechan.top", "dist/CNAME must name the custom domain");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, "Duplicate HTML IDs");
for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]), `Missing anchor ${match[1]}`);
const songsSource = await readFile(path.join(root, "js/songs.js"), "utf8");
const songContext = vm.createContext({});
vm.runInContext(songsSource, songContext);
assert.doesNotMatch(html, /[?&](?:si|feature|pp)=/u, "Published links must not carry share-tracking parameters");
assert.doesNotMatch(songsSource, /[?&]si=/u, "Song data must not carry share-tracking parameters");
assert.equal([...html.matchAll(/data-song-title=/g)].length, vm.runInContext("SONGS.length", songContext), "Songs must be pre-rendered");
const metadata = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert.equal(JSON.parse(metadata[1])["@type"], "WebSite");
const manifest = JSON.parse(await readFile(path.join(root, "site.webmanifest"), "utf8"));
for (const icon of manifest.icons) await stat(distFile(icon.src.split("?")[0]));

const nknkSource = await readFile(path.join(root, "js/nknk-gallery.js"), "utf8");
const nknkContext = vm.createContext({});
vm.runInContext(nknkSource, nknkContext);
const nknk = vm.runInContext("NKNK_GALLERY", nknkContext);
assert.ok(Array.isArray(nknk) && nknk.length > 0, "NKNK gallery must be present");
assert.equal(nknk.length, new Set(nknk.map(item => item.id)).size, "NKNK gallery ids must be unique");
for (const item of nknk) {
  assert.equal(item.id, Number(item.id));
  await stat(distFile(item.thumb));
  await stat(distFile(item.full));
}
assert.ok(html.includes('id="nknk-gallery"'), "NKNK gallery mount missing");
assert.ok(html.includes('id="nknk-lightbox"'), "NKNK lightbox missing");
assert.ok(!html.includes('id="nknk-gallery-more"'), "NKNK load-more should be removed");
assert.ok(bytes < 12 * 1024 * 1024, `Public build exceeds 12 MiB: ${bytes}`);
console.log(`Public build verified: references, anchors, JS syntax, metadata, pre-rendering, privacy allowlist; ${(bytes / 1024 / 1024).toFixed(2)} MiB.`);
