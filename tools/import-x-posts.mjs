#!/usr/bin/env node
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importXPostsScan } from "./x-posts-data.mjs";

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0].startsWith("-")) throw new Error("Usage: node tools/import-x-posts.mjs <public-posts-scan.json>");
  const input = path.resolve(args[0]);
  const info = await lstat(input);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw new Error("Scan input must be a regular JSON file no larger than 64 MiB");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await importXPostsScan(root, JSON.parse(await readFile(input, "utf8")));
  console.log(`X archive: ${result.archive.items.length} posts; ${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged; ${result.conflicts.length} conflicts kept for review.`);
  console.log(`History remains partial. Wrote ${result.files.length} archive files; no credentials or network access used.`);
  if (result.conflicts.length) { console.error(`Conflicting post IDs: ${result.conflicts.join(", ")}`); process.exitCode = 1; }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
