import { readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isNonPublicHost } from "./net-guards.mjs";

const timeoutMs = 12_000;
const concurrency = 4;
const maxRedirects = 5;

// Only public http(s) URLs are fetched: no file:, data: or other schemes, credentials,
// or hosts that name/resolve to loopback, private, link-local or other non-public ranges.
export async function assertPublicHttpUrl(value, { resolve = hostname => lookup(hostname, { all: true, verbatim: true }) } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Not a URL: ${value}`); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`Refusing non-HTTP(S) URL: ${url.protocol}`);
  if (url.username || url.password) throw new Error("Refusing URL with credentials");
  if (isNonPublicHost(url.hostname)) throw new Error(`Refusing non-public host: ${url.hostname}`);
  const addresses = await resolve(url.hostname.replace(/^\[(.*)\]$/u, "$1"));
  for (const { address } of [].concat(addresses)) {
    if (isNonPublicHost(address)) throw new Error(`Refusing host that resolves to a non-public address: ${url.hostname}`);
  }
  return url;
}

export async function checkSong(song, { fetchImpl = fetch, resolve } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    // Redirects are followed by hand so every hop passes the same allowlist.
    let url = await assertPublicHttpUrl(song.url, { resolve });
    for (let hop = 0; ; hop++) {
      response = await fetchImpl(url.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "inabakumori-site-link-checker/1.0",
          range: "bytes=0-0"
        }
      });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (!location) break;
      await response.body?.cancel();
      if (hop >= maxRedirects) throw new Error("Too many redirects");
      url = await assertPublicHttpUrl(new URL(location, url).href, { resolve });
    }
    await response.body?.cancel();
    return { ...song, ok: response.status < 400, status: response.status, finalUrl: url.href };
  } catch (error) {
    await response?.body?.cancel().catch(() => {});
    return { ...song, ok: false, status: error.name === "AbortError" ? "TIMEOUT" : error.code || error.name || "ERROR", detail: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const source = await readFile(new URL("../js/songs.js", import.meta.url), "utf8");
  const songs = [...source.matchAll(/"title"\s*:\s*"([^"]+)"[\s\S]*?"youtube"\s*:\s*"([^"]+)"/g)]
    .map((match) => ({ title: match[1], url: match[2] }));
  const strict = process.argv.includes("--strict");
  if (!songs.length) {
    console.error("没有从 js/songs.js 找到歌曲链接。 / No song links found.");
    process.exit(1);
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
    console.log("\n✅ 所有链接都能正常响应；视频是否可播放仍需人工确认。");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
