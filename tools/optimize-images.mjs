import { readdir, mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const jobs = [];
for (const folder of ["hero", "hero-mobile"]) {
  const source = path.join(root, "images", folder);
  const target = path.join(root, "images/optimized", folder);
  await mkdir(target, { recursive: true });
  for (const file of await readdir(source)) {
    if (!/\.(png|jpe?g)$/i.test(file)) continue;
    jobs.push({ source: path.join(source, file), target: path.join(target, file.replace(/\.[^.]+$/, ".webp")) });
  }
}
let cursor = 0, before = 0, after = 0;
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    await new Promise((resolve, reject) => {
      const child = spawn("cwebp", ["-quiet", "-q", "82", "-m", "6", job.source, "-o", job.target], { stdio: "inherit" });
      child.once("error", error => reject(new Error(error.code === "ENOENT" ? "Install the WebP cwebp command before running optimize:images." : error.message)));
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`cwebp exited with ${code}`)));
    });
    before += (await stat(job.source)).size;
    after += (await stat(job.target)).size;
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
console.log(`${jobs.length} images: ${before} → ${after} bytes (${Math.round((1 - after / before) * 100)}% smaller). Original images retained.`);
