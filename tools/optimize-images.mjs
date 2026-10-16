import { readdir, mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertRepoPath } from "./safe-fs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = file => assertRepoPath(root, file, { mustExist: true });
const outputPath = file => assertRepoPath(root, file);
const jobs = [];
for (const folder of ["hero", "hero-mobile"]) {
  const source = sourcePath(path.join("images", folder));
  const target = outputPath(path.join("images/optimized", folder));
  await mkdir(target, { recursive: true });
  for (const file of await readdir(source)) {
    if (!/\.(png|jpe?g)$/i.test(file)) continue;
    jobs.push({ source: sourcePath(path.join(source, file)), target: outputPath(path.join(target, file.replace(/\.[^.]+$/, ".webp"))) });
  }
}
let cursor = 0, before = 0, after = 0;
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    // Recheck immediately before cwebp reads or writes, including every parent folder.
    const source = sourcePath(job.source);
    const target = outputPath(job.target);
    await new Promise((resolve, reject) => {
      const child = spawn("cwebp", ["-quiet", "-q", "82", "-m", "6", source, "-o", target], { stdio: "inherit" });
      child.once("error", error => reject(new Error(error.code === "ENOENT" ? "Install the WebP cwebp command before running optimize:images." : error.message)));
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`cwebp exited with ${code}`)));
    });
    before += (await stat(job.source)).size;
    after += (await stat(job.target)).size;
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
console.log(`${jobs.length} images: ${before} → ${after} bytes (${Math.round((1 - after / before) * 100)}% smaller). Original images retained.`);
