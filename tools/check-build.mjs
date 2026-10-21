import { readFile, readdir, stat, lstat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loopbackCspSources } from "./net-guards.mjs";
import { readXPostsArchive } from "./x-posts-data.mjs";
import { createHash } from "node:crypto";

// Local references in built HTML: src/href values plus every URL inside srcset candidate lists.
function htmlReferences(html) {
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)].map(match => match[1]);
  for (const match of html.matchAll(/\bsrcset="([^"]*)"/gu)) {
    for (const candidate of match[1].split(",")) {
      const url = candidate.trim().split(/\s+/u)[0];
      if (url) refs.push(url);
    }
  }
  return refs;
}
const root = fileURLToPath(new URL("../dist/", import.meta.url));
assert.ok((await lstat(path.resolve(root))).isDirectory(), "Refusing symlink or non-regular build root");
assert.ok((await lstat(path.join(root, "index.html"))).isFile(), "Refusing symlink or non-regular build entry");
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
let bytes = 0, archiveBytes = 0;
// Paginated X archive pages are pre-rendered HTML that grows with the archive; they get their
// own budget so the 12 MiB guard on every other public file (images, fonts, scripts) stays tight.
const ARCHIVE_PAGE = /^updates(?:-(?:inabakumori|nknk))?(?:-page-[0-9]+)?\.html$/u;
async function checkFolder(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = path.relative(root, path.join(folder, entry.name));
    assert.ok(entry.isDirectory() || entry.isFile(), `Refusing symlink or non-regular build path: ${name}`);
    if (entry.name.startsWith(".") && !(folder === root && entry.isFile() && entry.name === ".nojekyll")) {
      throw new Error(`refusing to publish hidden path: ${name}`);
    }
    assert.ok(!/(^|\/)(backend|tools|docs|data|node_modules|trusted-read[^/]*|\.git|\.env)/i.test(name), `Private file in build: ${name}`);
    assert.ok(!/\.(db|mjs|map|md)$/i.test(name), `Non-public file in build: ${name}`);
    if (entry.isDirectory()) await checkFolder(path.join(folder, entry.name));
    else {
      const size = (await stat(path.join(folder, entry.name))).size;
      if (folder === root && ARCHIVE_PAGE.test(entry.name)) archiveBytes += size; else bytes += size;
      if (name.endsWith(".js")) new vm.Script(await readFile(path.join(root, name), "utf8"), { filename: name });
    }
  }
}
await checkFolder(root);
for (const value of htmlReferences(html)) {
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
const updatesHtml = await readFile(path.join(root, "updates.html"), "utf8");
assert.ok(html.includes('id="updates"'), "Homepage must include the updates section");
assert.ok(html.indexOf('id="intro"') < html.indexOf('id="updates"'), "Homepage intro must precede updates");
assert.match(html, /href="#updates"/u, "Homepage navigation must open its own updates section");
assert.doesNotMatch(html, /<!-- (?:HOME-UPDATES|X-POSTS):/u, "Homepage updates must be pre-rendered");
const legacyCount = [...html.matchAll(/class="update-item"/gu)].length;
assert.equal(legacyCount, [...updatesHtml.matchAll(/class="update-item"/gu)].length, "Homepage and archive must contain the same works snapshot");
const visibleArticles = className => [...html.matchAll(/<article\b([^>]*)>/gu)].filter(([, attributes]) => attributes.includes(`class="${className}"`) && !/(?:^|\s)hidden(?:\s|=|$)/u.test(attributes));
assert.equal(visibleArticles("update-item").length, Math.min(3, legacyCount), "Homepage works preview must show at most three entries without JavaScript");
const xArchive = await readXPostsArchive(path.resolve(root, ".."));
const xVersion = createHash("sha256").update(JSON.stringify(xArchive)).digest("hex");
const posts = [...xArchive.items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || (BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0));
const postIds = content => [...content.matchAll(/data-x-post-id="([0-9]+)"/gu)].map(match => match[1]);
const homePostIds = postIds(html);
assert.equal(homePostIds.length, new Set(homePostIds).size, "Homepage X posts must not repeat");
const homeCandidates = new Set(["inabakumori", "nknk"].flatMap(creator => posts.filter(post => post.creator === creator).slice(0, 3).map(post => post.id)));
assert.deepEqual(new Set(homePostIds), homeCandidates, "Homepage filters must contain the latest three posts from each creator");
assert.deepEqual(visibleArticles("x-post").map(([, attributes]) => /data-x-post-id="([0-9]+)"/u.exec(attributes)?.[1]), posts.slice(0, 3).map(post => post.id), "Homepage must show the latest three posts in order without JavaScript");
assert.match(html, new RegExp(`<meta name="x-posts-version" content="${xVersion}"/>`, "u"), "Homepage X snapshot fingerprint must match the source");
const expectedPages = new Set();
for (const creator of ["all", "inabakumori", "nknk"]) {
  const selected = posts.filter(post => creator === "all" || post.creator === creator);
  const seen = [];
  const pageCount = Math.max(1, Math.ceil(selected.length / 30));
  for (let page = 1; page <= pageCount; page++) {
    const name = `updates${creator === "all" ? "" : `-${creator}`}${page === 1 ? "" : `-page-${page}`}.html`;
    expectedPages.add(name);
    const pageHtml = await readFile(path.join(root, name), "utf8");
    assert.ok(pageHtml.includes(`<link rel="canonical" href="https://osagechan.top/${name}"/>`), `Archive canonical must identify its page: ${name}`);
    assert.ok(pageHtml.includes(`<meta property="og:url" content="https://osagechan.top/${name}"/>`), `Archive og:url must identify its page: ${name}`);
    assert.ok(pageHtml.includes(`<meta name="x-posts-version" content="${xVersion}"/>`), `Stale X snapshot fingerprint: ${name}`);
    assert.doesNotMatch(pageHtml, /<!-- (?:UPDATES|X-POSTS):/u, `Unrendered archive placeholder: ${name}`);
    assert.equal([...pageHtml.matchAll(/class="source-status"/gu)].length, 3, `Each works source needs a visible check status: ${name}`);
    // Page 1 carries the works snapshot; later pages link back to it instead of repeating it.
    assert.equal([...pageHtml.matchAll(/class="update-item"/gu)].length, page === 1 ? legacyCount : 0, `Works snapshot must appear only on archive page 1: ${name}`);
    if (page > 1) assert.ok(pageHtml.includes('data-works-list-link><a href="updates.html#feed-title"'), `Later archive pages must link to the works list: ${name}`);
    const updatesCsp = pageHtml.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
    assert.ok(updatesCsp && /script-src 'self';/u.test(updatesCsp) && /connect-src 'self';/u.test(updatesCsp), `Archive must use local scripts and a local snapshot: ${name}`);
    assert.doesNotMatch(updatesCsp, /unsafe-inline|unsafe-eval|localhost|127\.0\.0\.1/iu);
    const pageIds = [...pageHtml.matchAll(/\bid="([^"]+)"/gu)].map(match => match[1]);
    assert.equal(pageIds.length, new Set(pageIds).size, `Duplicate archive HTML IDs: ${name}`);
    for (const value of htmlReferences(pageHtml)) {
      if (value.startsWith("#")) assert.ok(pageIds.includes(value.slice(1)), `Missing archive anchor: ${name} ${value}`);
      else if (!/^(https?:|mailto:)/u.test(value)) {
        const reference = value.split(/[?#]/u)[0];
        assert.ok((await stat(distFile(reference))).isFile(), `Missing archive asset: ${name} ${value}`);
      }
    }
    const actualIds = postIds(pageHtml);
    const expectedIds = selected.slice((page - 1) * 30, page * 30).map(post => post.id);
    assert.deepEqual(actualIds, expectedIds, `Archive page omits, duplicates or misorders X posts: ${name}`);
    seen.push(...actualIds);
  }
  assert.equal(new Set(seen).size, seen.length, `X archive pagination repeats a post: ${creator}`);
  assert.deepEqual(seen, selected.map(post => post.id), `X archive pagination must include every collected post: ${creator}`);
}
const actualPages = (await readdir(root)).filter(name => /^updates(?:-(?:inabakumori|nknk))?(?:-page-[0-9]+)?\.html$/u.test(name));
assert.deepEqual(new Set(actualPages), expectedPages, "Archive must not contain obsolete or unvalidated pages");
const sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");
const sitemapLocations = [...sitemap.matchAll(/<loc>https:\/\/osagechan\.top\/([^<]*)<\/loc>/gu)].map(match => match[1]);
assert.equal(sitemapLocations.length, new Set(sitemapLocations).size, "Sitemap must not repeat a page");
assert.ok(sitemapLocations.includes(""), "Sitemap must list the homepage");
for (const name of expectedPages) assert.ok(sitemapLocations.includes(name), `Sitemap must list archive page: ${name}`);
for (const name of sitemapLocations) assert.ok(name === "" || expectedPages.has(name) || name === "index.html", `Sitemap lists an unknown page: ${name}`);
assert.ok(bytes < 12 * 1024 * 1024, `Public build (excluding archive pages) exceeds 12 MiB: ${bytes}`);
assert.ok(archiveBytes < 20 * 1024 * 1024, `Archive pages exceed 20 MiB: ${archiveBytes}`);
console.log(`Public build verified: references, anchors, JS syntax, metadata, pre-rendering, privacy allowlist; ${(bytes / 1024 / 1024).toFixed(2)} MiB + ${(archiveBytes / 1024 / 1024).toFixed(2)} MiB archive pages.`);
