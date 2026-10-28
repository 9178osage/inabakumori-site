import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { assertRepoPath } from "./safe-fs.mjs";

// This deliberately small allowlist cannot export backend, credentials or a site copy.
export const PILOT_SOURCES = Object.freeze([
  "images/optimized/hero-mobile/001.webp",
  ...Array.from({ length: 6 }, (_, index) => `images/optimized/nknk/mobile/${index + 1}.webp`),
  "fonts/station-mono.woff2"
]);
const LICENSE = "fonts/ibm-plex-mono-OFL.txt";
const OUTPUT = "artifacts/cloudflare-assets-pilot";
const rootDirectory = fileURLToPath(new URL("../", import.meta.url));
const sha256 = data => createHash("sha256").update(data).digest("hex");

// Stored ZIP entries use a fixed timestamp, making the handoff artifact reproducible.
// No ZIP utility, package install, credentials or outbound access is required.
function storedZip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const filename = Buffer.from(name);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0x0021, 12); // 1980-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0x0021, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function assetName(source, hash) {
  const label = source.replace(/^images\/optimized\//u, "").replace(/^fonts\//u, "")
    .replace(/\.(webp|woff2)$/u, "").replaceAll("/", "-");
  return `assets/${label}-${hash.slice(0, 16)}${path.extname(source)}`;
}

export async function buildAssetPilot(root = rootDirectory) {
  const base = await realpath(root);
  const sourcePath = file => assertRepoPath(base, file, { mustExist: true });
  const outputPath = file => assertRepoPath(base, `${OUTPUT}/${file}`);
  const files = new Map(), assets = {};
  for (const source of PILOT_SOURCES) {
    const file = sourcePath(source);
    if (!(await stat(file)).isFile()) throw new Error(`Pilot input must be a regular file: ${source}`);
    const data = await readFile(file);
    if (!data.length || data.length > 1_000_000) throw new Error(`Unexpected pilot asset size: ${source}`);
    const hash = sha256(data);
    const published = assetName(source, hash);
    files.set(published, data);
    assets[source] = { path: published, sha256: hash, bytes: data.length };
  }
  const license = await readFile(sourcePath(LICENSE));
  files.set("licenses/ibm-plex-mono-OFL.txt", license);
  const manifest = { version: 1, assets };
  files.set("asset-manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  files.set("_headers", Buffer.from(`/*
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/asset-manifest.json
  Cache-Control: no-store
/404.html
  Cache-Control: no-store
/index.html
  Cache-Control: no-store
`));
  files.set("index.html", Buffer.from('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Static asset pilot</title></head><body><h1>Static asset pilot</h1><p>A small, public image and font delivery test. This is not a copy of the website.</p><p><a href="asset-manifest.json">Asset manifest</a></p></body></html>\n'));
  // A top-level 404 prevents Pages from serving index.html for missing image paths.
  files.set("404.html", Buffer.from('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Asset not found</title></head><body><h1>Asset not found</h1></body></html>\n'));

  // Resolve every output before clearing this tool's generated public directory.
  const publicDirectory = outputPath("public");
  const zipPath = outputPath("pilot.zip");
  for (const name of files.keys()) outputPath(`public/${name}`);
  await mkdir(outputPath("."), { recursive: true });
  await rm(publicDirectory, { recursive: true, force: true });
  await mkdir(publicDirectory, { recursive: true });
  for (const [name, data] of files) {
    const destination = outputPath(`public/${name}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }
  const zip = storedZip(files);
  await writeFile(zipPath, zip);
  return { directory: publicDirectory, zip: zipPath, manifest, fileCount: files.size, zipBytes: zip.length, zipSha256: sha256(zip) };
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Usage: node tools/build-asset-pilot.mjs");
  const result = await buildAssetPilot();
  console.log(`Built public asset pilot: ${PILOT_SOURCES.length} binary assets, ${result.fileCount} files, ${result.zipBytes} ZIP bytes.`);
  console.log(`Directory: ${path.relative(rootDirectory, result.directory)}`);
  console.log(`ZIP: ${path.relative(rootDirectory, result.zip)}`);
}
