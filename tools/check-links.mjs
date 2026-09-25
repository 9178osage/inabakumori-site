import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../js/songs.js", import.meta.url), "utf8");
const songs = [...source.matchAll(/"title"\s*:\s*"([^"]+)"[\s\S]*?"youtube"\s*:\s*"([^"]+)"/g)]
  .map((match) => ({ title: match[1], url: match[2] }));
const strict = process.argv.includes("--strict");
const timeoutMs = 12_000;
const concurrency = 4;

if (!songs.length) {
  console.error("没有从 js/songs.js 找到歌曲链接。 / No song links found.");
  process.exit(1);
}

async function checkSong(song) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(song.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "inabakumori-site-link-checker/1.0",
        range: "bytes=0-0"
      }
    });
    return { ...song, ok: response.status < 400, status: response.status, finalUrl: response.url };
  } catch (error) {
    return { ...song, ok: false, status: error.name === "AbortError" ? "TIMEOUT" : error.code || error.name || "ERROR", detail: error.message };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
let nextIndex = 0;
async function worker() {
  while (nextIndex < songs.length) {
    const index = nextIndex++;
    results[index] = await checkSong(songs[index]);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, songs.length) }, worker));

console.log(`检查 ${results.length} 个 YouTube 链接：`);
for (const result of results) {
  console.log(`${result.ok ? "✅" : "⚠️"} ${result.title} — ${result.status}${result.detail ? ` (${result.detail})` : ""}`);
}
const failed = results.filter((result) => !result.ok);
if (failed.length) {
  console.error(`\n发现 ${failed.length} 个链接需要人工确认。`);
  if (strict) process.exit(2);
} else {
  console.log("\n✅ 所有链接都能正常响应。");
}
