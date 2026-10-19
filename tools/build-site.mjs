import { build, transform } from "esbuild";
import { readFile, writeFile, mkdir, readdir, copyFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { assertRepoPath } from "./safe-fs.mjs";
import { stripLoopbackCspSources } from "./net-guards.mjs";
import { renderCreatorUpdates } from "./render-creator-updates.mjs";
import { readXPostsArchive } from "./x-posts-data.mjs";
import { renderXPostsHome, renderXPostsArchive } from "./render-x-posts.mjs";

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
const scripts = ["script.js", ...["preferences", "config", "network", "i18n", "auth", "songs", "nknk-gallery", "nknk-gallery-ui", "experience", "comments", "updates", "home-updates", "x-posts-home"].map(name => `js/${name}.js`)];
const css = ["style.css", "updates.css", "fonts/fonts.css"];
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
    // Hidden files and folders (Finder/editor leftovers or private assets) stay local.
    if (entry.name.startsWith(".")) continue;
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory()) await copyPublicFolder(file, allowed);
    else if (entry.isFile() && allowed.test(entry.name)) await copyFile(source(file), output(`dist/${file}`));
  }
}
await copyPublicFolder("images/optimized", /\.webp$/i);
await copyPublicFolder("images/icons", /\.(png|ico)$/i);
await copyPublicFolder("images/memes", /\.png$/i);
await copyPublicFolder("fonts", /\.(woff2|txt)$/i);
for (const entry of await readdir(source("images"), { withFileTypes: true })) {
  if (entry.isFile() && !entry.name.startsWith(".") && /\.(png|jpe?g|webp)$/i.test(entry.name)) await copyFile(source(`images/${entry.name}`), output(`dist/images/${entry.name}`));
}
for (const file of ["favicon.ico", "site.webmanifest", "robots.txt", "404.html", "CNAME"]) await copyFile(source(file), output(`dist/${file}`));
await writeFile(output("dist/.nojekyll"), "");

// dist starts clean, but Finder/editor leftovers can appear while it is being built.
// Only the regular .nojekyll file at the dist root is intentionally public.
async function removeStrayHiddenPaths(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.name.startsWith(".") && !(folder === out && entry.isFile() && entry.name === ".nojekyll")) {
      await rm(file, { recursive: true, force: true });
    } else if (entry.isDirectory()) await removeStrayHiddenPaths(file);
  }
}
await removeStrayHiddenPaths(out);

const context = vm.createContext({});
vm.runInContext(await readFile(source("js/songs.js"), "utf8"), context);
const songs = vm.runInContext("SONGS", context);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const updatesSource = await readFile(source("data/creator-updates.json"), "utf8");
const updatesVersion = createHash("sha256").update(updatesSource).digest("hex");
const updates = renderCreatorUpdates(JSON.parse(updatesSource));
const xPosts = await readXPostsArchive(root);
const xPostsVersion = createHash("sha256").update(JSON.stringify(xPosts)).digest("hex");
function fillOnce(template, marker, content) {
  const placeholder = `<!-- ${marker} -->`;
  if (template.split(placeholder).length !== 2) throw new Error(`Expected one ${marker} placeholder`);
  return template.replace(placeholder, () => content);
}
const fingerprintXPosts = template => template.replace("</head>", `<meta name="x-posts-version" content="${xPostsVersion}"/>\n</head>`);
function fillUpdates(template, prefix, items = updates.items) {
  for (const [marker, content] of [["STATUS", updates.status], ["ITEMS", items]]) {
    const placeholder = `<!-- ${prefix}:${marker} -->`;
    if (template.split(placeholder).length !== 2) throw new Error(`Expected one ${prefix} ${marker} placeholder`);
    template = template.replace(placeholder, () => content);
  }
  return template.replace("</head>", `<meta name="creator-updates-version" content="${updatesVersion}"/>\n</head>`);
}
let html = await readFile(source("index.html"), "utf8");
html = fillUpdates(html, "HOME-UPDATES");
html = fingerprintXPosts(fillOnce(html, "X-POSTS:HOME", renderXPostsHome(xPosts)));
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
const updatesSourceHtml = await readFile(source("updates.html"), "utf8");
const updatesTemplate = fillUpdates(updatesSourceHtml, "UPDATES");
// Archive page 2+ would repeat the full works list on every page; link to it once instead so the
// paginated X history stays within the archive size budget.
const worksListLink = '<p class="updates-note" data-works-list-link><a href="updates.html#feed-title" data-zh="作品与消息列表请见第 1 页" data-en="See page 1 for the works list" data-ja="作品とお知らせの一覧は1ページ目へ">作品与消息列表请见第 1 页</a></p>';
const updatesTemplateLater = fillUpdates(updatesSourceHtml, "UPDATES", worksListLink);
let archivePages = 0;
const archivePageNames = [];
for (const creator of ["all", "inabakumori", "nknk"]) {
  const firstPage = renderXPostsArchive(xPosts, { creator, page: 1, pageSize: 30 });
  if (!Number.isSafeInteger(firstPage.pageCount) || firstPage.pageCount < 1 || firstPage.pageCount > 10000) throw new Error("Invalid X archive page count");
  for (let page = 1; page <= firstPage.pageCount; page++) {
    const rendered = page === 1 ? firstPage : renderXPostsArchive(xPosts, { creator, page, pageSize: 30 });
    const name = `updates${creator === "all" ? "" : `-${creator}`}${page === 1 ? "" : `-page-${page}`}.html`;
    let updatesHtml = page === 1 ? updatesTemplate : updatesTemplateLater;
    for (const marker of ["ITEMS", "STATUS", "PAGINATION"]) updatesHtml = fillOnce(updatesHtml, `X-POSTS:${marker}`, rendered[marker.toLowerCase()]);
    updatesHtml = fingerprintXPosts(updatesHtml).replace('<link rel="canonical" href="https://osagechan.top/updates.html"/>', `<link rel="canonical" href="https://osagechan.top/${name}"/>`)
      .replace('<meta property="og:url" content="https://osagechan.top/updates.html"/>', `<meta property="og:url" content="https://osagechan.top/${name}"/>`);
    updatesHtml = updatesHtml.replace(/(src|href)="([^"?]+)(?:\?[^"\s]*)?"/g, (match, attribute, file) => hashes.has(file) ? `${attribute}="${file}?v=${hashes.get(file)}"` : match);
    await writeFile(output(`dist/${name}`), updatesHtml);
    archivePageNames.push(name);
    archivePages++;
  }
}
// The source sitemap lists the hand-maintained pages; every generated archive page is appended
// with the date its newest post was collected, so search engines can find the paginated history.
const sitemapSource = await readFile(source("sitemap.xml"), "utf8");
if (sitemapSource.split("</urlset>").length !== 2) throw new Error("Expected one </urlset> in sitemap.xml");
const archiveLastmod = (xPosts.items.map(item => item.collectedAt).sort().at(-1) ?? "").slice(0, 10);
const sitemapEntries = archivePageNames.filter(name => !sitemapSource.includes(`<loc>https://osagechan.top/${name}</loc>`)).map(name =>
  `  <url>\n    <loc>https://osagechan.top/${name}</loc>\n${archiveLastmod ? `    <lastmod>${archiveLastmod}</lastmod>\n` : ""}    <changefreq>weekly</changefreq>\n    <priority>${/-page-/u.test(name) ? "0.3" : "0.6"}</priority>\n  </url>\n`).join("");
await writeFile(output("dist/sitemap.xml"), sitemapSource.replace("</urlset>", () => `${sitemapEntries}</urlset>`));
let bytes = 0, files = 0;
async function measure(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await measure(file); else { bytes += (await stat(file)).size; files++; }
  }
}
await measure(out);
console.log(`Built dist: ${files} public files, ${(bytes / 1024 / 1024).toFixed(2)} MiB, ${songs.length} pre-rendered songs, ${xPosts.items.length} X posts across ${archivePages} archive pages.`);
if (keepLocalApiCsp) console.log("Local build: CSP keeps http://127.0.0.1:3001 and http://localhost:3001 — do not deploy this dist.");
