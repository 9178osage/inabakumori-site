import { build, transform } from "esbuild";
import { readFile, writeFile, mkdir, readdir, copyFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { assertRepoPath } from "./safe-fs.mjs";
import { stripLoopbackCspSources } from "./net-guards.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "dist");
// Every source read and output write must be a real path inside the repo (no symlinks).
const source = file => assertRepoPath(root, file, { mustExist: true });
const output = file => assertRepoPath(root, file);
// The source CSP allows a local API for development; the published CSP must not.
// `npm run build:local` / `npm run preview` pass --keep-local-api-csp (KEEP_LOCAL_API_CSP=1
// also works) so a local dist can talk to a backend on localhost:3001. CI refuses it.
const keepLocalApiCsp = process.argv.includes("--keep-local-api-csp") || process.env.KEEP_LOCAL_API_CSP === "1";
if (keepLocalApiCsp && (process.env.CI || process.env.GITHUB_ACTIONS)) {
  console.error("Refusing a local-API CSP build in CI: published builds must use npm run build.");
  process.exit(1);
}
await build({ entryPoints: [source("tools/auth-src.js")], bundle: true, platform: "browser", format: "iife", minify: true, legalComments: "inline", outfile: output("js/auth.js") });
// dist is generated exclusively by this script. Only explicitly public assets are copied.
await rm(output("dist"), { recursive: true, force: true });
await mkdir(out, { recursive: true });
const scripts = ["script.js", ...["preferences", "config", "network", "i18n", "auth", "songs", "nknk-gallery", "nknk-gallery-ui", "experience", "comments"].map(name => `js/${name}.js`)];
const css = ["style.css", "fonts/fonts.css"];
const hashes = new Map();
for (const file of [...scripts, ...css]) {
  const text = await readFile(source(file), "utf8");
  const { code } = await transform(text, { loader: file.endsWith(".css") ? "css" : "js", minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, legalComments: "inline", target: ["es2022"] });
  await mkdir(output(path.dirname(`dist/${file}`)), { recursive: true });
  await writeFile(output(`dist/${file}`), code);
  hashes.set(file, createHash("sha256").update(code).digest("hex").slice(0, 12));
}
async function copyPublicFolder(folder, allowed) {
  await mkdir(output(`dist/${folder}`), { recursive: true });
  // withFileTypes does not follow symlinks: linked files and folders are never copied.
  for (const entry of await readdir(source(folder), { withFileTypes: true })) {
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory()) await copyPublicFolder(file, allowed);
    // Dotfiles (.DS_Store from Finder, editor leftovers) are never public assets.
    else if (entry.isFile() && !entry.name.startsWith(".") && allowed.test(entry.name)) await copyFile(source(file), output(`dist/${file}`));
  }
}
await copyPublicFolder("images/optimized", /\.webp$/i);
await copyPublicFolder("images/icons", /\.(png|ico)$/i);
await copyPublicFolder("images/memes", /\.png$/i);
await copyPublicFolder("fonts", /\.(woff2|txt)$/i);
for (const entry of await readdir(source("images"), { withFileTypes: true })) {
  if (entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)) await copyFile(source(`images/${entry.name}`), output(`dist/images/${entry.name}`));
}
for (const file of ["favicon.ico", "site.webmanifest", "robots.txt", "sitemap.xml", "404.html", "CNAME"]) await copyFile(source(file), output(`dist/${file}`));
await writeFile(output("dist/.nojekyll"), "");

// dist is not wiped between builds, so a Finder visit can leave .DS_Store files behind; they would
// be counted as public files and shipped in the Pages artifact. Remove them before the artifact is
// assembled (`.nojekyll` is the only dotfile we publish on purpose).
async function removeStrayDotfiles(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) { await removeStrayDotfiles(`${folder}/${entry.name}`); continue; }
    if (entry.isFile() && entry.name.startsWith(".") && entry.name !== ".nojekyll") await rm(`${folder}/${entry.name}`);
  }
}
await removeStrayDotfiles(out);

const context = vm.createContext({});
vm.runInContext(await readFile(source("js/songs.js"), "utf8"), context);
const songs = vm.runInContext("SONGS", context);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let html = await readFile(source("index.html"), "utf8");
// Share-tracking parameters (?si=...) identify who shared a link; published links never carry them.
const cleanSongUrl = value => {
  const url = new URL(value);
  for (const key of ["si", "feature", "pp"]) url.searchParams.delete(key);
  return url.href;
};
// Real links are present before JS starts and remain available without JavaScript.
const archive = songs.map((song, index) => `<a href="${escape(cleanSongUrl(song.youtube))}" target="_blank" rel="noopener noreferrer" data-album="${escape(song.album)}" data-song-title="${escape(song.title)}">${String(index + 1).padStart(2, "0")}　${escape(song.title)}</a>`).join("\n");
html = html.replace('<div class="song-scroll song-list" id="song-list"></div>', `<div class="song-scroll song-list" id="song-list">${archive}</div>`);
if (!keepLocalApiCsp) {
  // Parse every source expression: any loopback spelling ([::1], LOCALHOST, 127.1, *.localhost, ...) is removed.
  html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (match, start, policy, end) =>
    start + stripLoopbackCspSources(policy) + end);
}
html = html.replace(/(src|href)="([^"?]+)(?:\?[^"\s]*)?"/g, (match, attribute, file) => hashes.has(file) ? `${attribute}="${file}?v=${hashes.get(file)}"` : match);
await writeFile(output("dist/index.html"), html);
let bytes = 0, files = 0;
async function measure(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await measure(file); else { bytes += (await stat(file)).size; files++; }
  }
}
await measure(out);
console.log(`Built dist: ${files} public files, ${(bytes / 1024 / 1024).toFixed(2)} MiB, ${songs.length} pre-rendered songs.`);
if (keepLocalApiCsp) console.log("Local build: CSP keeps http://127.0.0.1:3001 and http://localhost:3001 — do not deploy this dist.");
