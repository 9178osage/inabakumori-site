import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const html = await readFile(path.join(root, "index.html"), "utf8");
let bytes = 0;
async function checkFolder(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = path.relative(root, path.join(folder, entry.name));
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
  const file = value.split("?")[0];
  assert.ok((await stat(path.join(root, file))).isFile(), `Missing asset: ${file}`);
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, "Duplicate HTML IDs");
for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]), `Missing anchor ${match[1]}`);
const songsSource = await readFile(path.join(root, "js/songs.js"), "utf8");
const songContext = vm.createContext({});
vm.runInContext(songsSource, songContext);
assert.equal([...html.matchAll(/data-song-title=/g)].length, vm.runInContext("SONGS.length", songContext), "Songs must be pre-rendered");
const metadata = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert.equal(JSON.parse(metadata[1])["@type"], "WebSite");
const manifest = JSON.parse(await readFile(path.join(root, "site.webmanifest"), "utf8"));
for (const icon of manifest.icons) await stat(path.join(root, icon.src.split("?")[0]));
assert.ok(bytes < 7 * 1024 * 1024, `Public build exceeds 7 MiB: ${bytes}`);
console.log(`Public build verified: references, anchors, JS syntax, metadata, pre-rendering, privacy allowlist; ${(bytes / 1024 / 1024).toFixed(2)} MiB.`);
