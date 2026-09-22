import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const roots = ["images/hero", "images/hero-mobile", "images/memes"];
const sourceExtensions = new Set([".png", ".jpg", ".jpeg"]);

async function convert(source, target) {
  await new Promise((resolve, reject) => {
    const process = spawn("cwebp", ["-quiet", "-q", "82", source, "-o", target], { stdio: "inherit" });
    process.once("error", reject);
    process.once("close", code => code === 0 ? resolve() : reject(new Error(`cwebp exited with ${code}`)));
  });
}

let converted = 0;
for (const root of roots) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!sourceExtensions.has(extension)) continue;
    const source = path.join(root, entry.name);
    const target = path.join(root, `${path.basename(entry.name, extension)}.webp`);
    await convert(source, target);
    converted++;
  }
}
console.log(`✅ 已生成 ${converted} 个 WebP 优化图，原图已保留。`);
