import { build, transform } from "esbuild";
import { readFile, writeFile, mkdir, readdir, copyFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "dist");
await build({ entryPoints: [path.join(root, "tools/auth-src.js")], bundle: true, platform: "browser", format: "iife", minify: true, legalComments: "inline", outfile: path.join(root, "js/auth.js") });
// dist is generated exclusively by this script. Only explicitly public assets are copied.
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const scripts = ["script.js", ...["preferences", "config", "network", "i18n", "auth", "songs", "nknk-gallery", "nknk-gallery-ui", "experience", "comments"].map(name => `js/${name}.js`)];
const css = ["style.css", "fonts/fonts.css"];
const hashes = new Map();
for (const file of [...scripts, ...css]) {
  const source = await readFile(path.join(root, file), "utf8");
  const { code } = await transform(source, { loader: file.endsWith(".css") ? "css" : "js", minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, legalComments: "inline", target: ["es2022"] });
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await writeFile(path.join(out, file), code);
  hashes.set(file, createHash("sha256").update(code).digest("hex").slice(0, 12));
}
async function copyPublicFolder(folder, allowed) {
  await mkdir(path.join(out, folder), { recursive: true });
  for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory()) await copyPublicFolder(file, allowed);
    else if (entry.isFile() && allowed.test(entry.name)) await copyFile(path.join(root, file), path.join(out, file));
  }
}
await copyPublicFolder("images/optimized", /\.webp$/i);
await copyPublicFolder("images/icons", /\.(png|ico)$/i);
await copyPublicFolder("images/memes", /\.png$/i);
await copyPublicFolder("fonts", /\.(woff2|txt)$/i);
for (const entry of await readdir(path.join(root, "images"), { withFileTypes: true })) {
  if (entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)) await copyFile(path.join(root, "images", entry.name), path.join(out, "images", entry.name));
}
for (const file of ["favicon.ico", "site.webmanifest", "robots.txt", "sitemap.xml", "404.html"]) await copyFile(path.join(root, file), path.join(out, file));
await writeFile(path.join(out, ".nojekyll"), "");

const context = vm.createContext({});
vm.runInContext(await readFile(path.join(root, "js/songs.js"), "utf8"), context);
const songs = vm.runInContext("SONGS", context);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let html = await readFile(path.join(root, "index.html"), "utf8");
// Real links are present before JS starts and remain available without JavaScript.
const archive = songs.map((song, index) => `<a href="${escape(song.youtube)}" target="_blank" rel="noopener noreferrer" data-album="${escape(song.album)}" data-song-title="${escape(song.title)}">${String(index + 1).padStart(2, "0")}　${escape(song.title)}</a>`).join("\n");
html = html.replace('<div class="song-scroll song-list" id="song-list"></div>', `<div class="song-scroll song-list" id="song-list">${archive}</div>`);
// The source CSP allows a local API for development; the published CSP must not.
// Set KEEP_LOCAL_API_CSP=1 to preview dist against a backend on localhost:3001.
if (process.env.KEEP_LOCAL_API_CSP !== "1") {
  html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (match, start, policy, end) =>
    start + policy.replace(/\s+http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?=[\s;]|$)/g, "") + end);
}
html = html.replace(/(src|href)="([^"?]+)(?:\?[^"\s]*)?"/g, (match, attribute, file) => hashes.has(file) ? `${attribute}="${file}?v=${hashes.get(file)}"` : match);
await writeFile(path.join(out, "index.html"), html);
let bytes = 0, files = 0;
async function measure(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await measure(file); else { bytes += (await stat(file)).size; files++; }
  }
}
await measure(out);
console.log(`Built dist: ${files} public files, ${(bytes / 1024 / 1024).toFixed(2)} MiB, ${songs.length} pre-rendered songs.`);
