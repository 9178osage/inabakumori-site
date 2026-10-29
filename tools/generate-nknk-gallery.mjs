import { readdir, mkdir, writeFile, stat, rm, unlink, lstat, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertRepoPath } from "./safe-fs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// Full-size originals are kept outside the repository (removed from Git history to keep clones
// small). Point NKNK_SOURCE_DIR at them; the default is a sibling folder next to the repo.
// --config-only needs no originals: it rebuilds js/nknk-gallery.js from the committed WebP files.
const DEFAULT_NKNK_SOURCE_DIR = path.join(root, "..", "inabakumori-assets-src", "NKNK");
const sourceDir = path.resolve(process.env.NKNK_SOURCE_DIR || DEFAULT_NKNK_SOURCE_DIR);
const thumbDir = path.join(root, "images/optimized/nknk");
const mobileThumbDir = path.join(thumbDir, "mobile");
const fullDir = path.join(root, "images/optimized/nknk/full");
const configPath = path.join(root, "js/nknk-gallery.js");

const IMAGE_RE = /^(\d+)\.(jpe?g|png|webp|gif)$/i;
const THUMB_WIDTH = 300;
const THUMB_QUALITY = 58;
const MOBILE_THUMB_WIDTH = 220;
const FULL_LONG_EDGE = 1080;
const FULL_QUALITY = 62;
const WEBP_METHOD = 6;
// --config-only rewrites js/nknk-gallery.js from the existing thumbs without re-encoding.
const CONFIG_ONLY = process.argv.includes("--config-only");
// Add mobile assets without changing the established desktop thumbnails or lightbox images.
const MOBILE_ONLY = process.argv.includes("--mobile-only");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.once("error", error => reject(new Error(error.code === "ENOENT" ? `Missing command: ${cmd}` : error.message)));
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)));
  });
}

function jpegSize(filePath) {
  const data = readFileSync(filePath);
  let i = 0;
  while (i < data.length - 8) {
    if (data[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = data[i + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const seglen = data.readUInt16BE(i + 2);
    i += 2 + seglen;
  }
  return null;
}

async function pngSize(filePath) {
  const data = readFileSync(filePath);
  if (data.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function webpSize(data) {
  if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = data.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}

async function imageSize(filePath, ext) {
  if (/jpe?g/i.test(ext)) return jpegSize(filePath);
  if (/png/i.test(ext)) return pngSize(filePath);
  // Fallback: ask sips on macOS when present.
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], { stdio: ["ignore", "pipe", "inherit"] });
      let text = "";
      child.stdout.on("data", chunk => { text += chunk; });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve(text) : reject(new Error(`sips exited ${code}`)));
    });
    const width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1]);
    const height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1]);
    if (width && height) return { width, height };
  } catch {
    // ignore
  }
  return null;
}

// Refuse symlinked folders/files before deleting or writing anything: a linked
// images/optimized/nknk would otherwise get its target's contents removed and replaced.
for (const target of [thumbDir, mobileThumbDir, fullDir, configPath]) assertRepoPath(root, target);
await mkdir(thumbDir, { recursive: true });
await mkdir(fullDir, { recursive: true });
await mkdir(mobileThumbDir, { recursive: true });
for (const target of [thumbDir, mobileThumbDir, fullDir]) assertRepoPath(root, target, { mustExist: true });

const sourceNames = CONFIG_ONLY
  ? (await readdir(thumbDir)).filter(name => /^\d+\.webp$/u.test(name))
  : await readSourceNames();

async function readSourceNames() {
  let info;
  try {
    info = await lstat(sourceDir);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`NKNK originals not found at ${sourceDir}; set NKNK_SOURCE_DIR to the folder of numbered originals`);
    throw error;
  }
  if (!info.isDirectory()) throw new Error(`Refusing non-directory NKNK source: ${sourceDir}`);
  // The originals folder must not live inside the repository, so they cannot be committed again.
  const realRoot = await realpath(root);
  const relative = path.relative(realRoot, await realpath(sourceDir));
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error(`Refusing NKNK source inside the repository: ${sourceDir}`);
  return readdir(sourceDir);
}

const entries = sourceNames
  .map(name => {
    const match = name.match(IMAGE_RE);
    return match ? { id: Number(match[1]), name, ext: match[2].toLowerCase() } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.id - b.id);

// Numbered symlink inputs could make the image tool read outside the gallery source.
if (!CONFIG_ONLY) for (const item of entries) {
  const input = path.join(sourceDir, item.name);
  if (!(await lstat(input)).isFile()) throw new Error(`Refusing non-file gallery source: ${item.name}`);
}

if (!entries.length) throw new Error(`No numbered images found in ${CONFIG_ONLY ? thumbDir : sourceDir}`);
for (let i = 0; i < entries.length; i++) {
  if (entries[i].id !== i + 1) throw new Error(`Expected sequential ids starting at 1; got gap at ${i + 1} (found ${entries[i].id})`);
}

const keepThumbs = new Set(entries.map(item => `${item.id}.webp`));
const keepFull = new Set(entries.map(item => `${item.id}.webp`));
for (const name of await readdir(thumbDir)) {
  const target = path.join(thumbDir, name);
  if (name === "full" || name === "mobile") continue;
  if (keepThumbs.has(name)) {
    // An output that is a symlink would make cwebp write through it.
    if ((await lstat(target)).isSymbolicLink()) await unlink(target);
    continue;
  }
  // rm never follows a symlinked entry: only the link itself is removed.
  await rm(target, { recursive: true, force: true });
}
for (const name of await readdir(fullDir)) {
  const target = path.join(fullDir, name);
  if (!keepFull.has(name) || (await lstat(target)).isSymbolicLink()) await unlink(target).catch(() => {});
}
for (const name of await readdir(mobileThumbDir)) {
  const target = path.join(mobileThumbDir, name);
  if (!keepThumbs.has(name) || (await lstat(target)).isSymbolicLink()) await unlink(target).catch(() => {});
}

let cursor = 0;
let thumbBytes = 0;
let mobileThumbBytes = 0;
let fullBytes = 0;

async function worker() {
  while (cursor < entries.length) {
    const item = entries[cursor++];
    const source = path.join(sourceDir, item.name);
    const thumb = assertRepoPath(root, path.join(thumbDir, `${item.id}.webp`));
    const mobileThumb = assertRepoPath(root, path.join(mobileThumbDir, `${item.id}.webp`));
    const full = assertRepoPath(root, path.join(fullDir, `${item.id}.webp`));
    const size = await imageSize(source, item.ext);
    let fullResize = ["-resize", String(FULL_LONG_EDGE), "0"];
    if (size && size.height > size.width) fullResize = ["-resize", "0", String(FULL_LONG_EDGE)];
    else if (size && size.width === size.height) fullResize = ["-resize", String(FULL_LONG_EDGE), String(FULL_LONG_EDGE)];

    if (!MOBILE_ONLY) {
      await run("cwebp", ["-quiet", "-q", String(THUMB_QUALITY), "-m", String(WEBP_METHOD), "-metadata", "none", "-resize", String(THUMB_WIDTH), "0", source, "-o", thumb]);
      await run("cwebp", ["-quiet", "-q", String(FULL_QUALITY), "-m", String(WEBP_METHOD), "-metadata", "none", ...fullResize, source, "-o", full]);
    }
    await run("cwebp", ["-quiet", "-q", String(THUMB_QUALITY), "-m", String(WEBP_METHOD), "-metadata", "none", "-resize", String(MOBILE_THUMB_WIDTH), "0", source, "-o", mobileThumb]);
    thumbBytes += (await stat(thumb)).size;
    mobileThumbBytes += (await stat(mobileThumb)).size;
    fullBytes += (await stat(full)).size;
  }
}

if (!CONFIG_ONLY) await Promise.all(Array.from({ length: 4 }, worker));

// Thumb dimensions let the marquee reserve each slot before a deferred thumb loads.
for (const item of entries) {
  const size = webpSize(readFileSync(path.join(thumbDir, `${item.id}.webp`)));
  if (!size) throw new Error(`Could not read thumb dimensions for ${item.id}.webp`);
  const mobileSize = webpSize(readFileSync(path.join(mobileThumbDir, `${item.id}.webp`)));
  if (!mobileSize || mobileSize.width !== MOBILE_THUMB_WIDTH) throw new Error(`Could not read mobile thumb dimensions for ${item.id}.webp`);
  item.thumbSize = size;
}

const lines = [
  "/** Auto-generated by tools/generate-nknk-gallery.mjs — do not edit by hand. */",
  `/** thumbs: ${THUMB_WIDTH}px / mobile ${MOBILE_THUMB_WIDTH}px q${THUMB_QUALITY} · full long-edge: ${FULL_LONG_EDGE}px q${FULL_QUALITY} · method ${WEBP_METHOD} · metadata none */`,
  "const NKNK_GALLERY = [",
  ...entries.map(item => `  { id: ${item.id}, thumb: "images/optimized/nknk/${item.id}.webp", full: "images/optimized/nknk/full/${item.id}.webp", w: ${item.thumbSize.width}, h: ${item.thumbSize.height} },`),
  '].map(item => ({ ...item, mobileThumb: `images/optimized/nknk/mobile/${item.id}.webp` }));',
  "if (typeof window !== \"undefined\") window.NKNK_GALLERY = NKNK_GALLERY;",
  ""
];
await writeFile(assertRepoPath(root, configPath), lines.join("\n"));

const mi = n => (n / 1024 / 1024).toFixed(2);
console.log(`NKNK gallery: ${entries.length} images`);
console.log(`Settings: thumb ${THUMB_WIDTH}px / mobile ${MOBILE_THUMB_WIDTH}px q${THUMB_QUALITY}; full long-edge ${FULL_LONG_EDGE}px q${FULL_QUALITY}; -m ${WEBP_METHOD}; metadata none`);
if (!CONFIG_ONLY) console.log(`Thumbs: ${mi(thumbBytes)} MiB · Mobile thumbs: ${mi(mobileThumbBytes)} MiB · Full: ${mi(fullBytes)} MiB · Total optimized: ${mi(thumbBytes + mobileThumbBytes + fullBytes)} MiB`);
console.log(`Wrote ${path.relative(root, configPath)}`);
