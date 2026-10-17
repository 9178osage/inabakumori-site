import { readFile, mkdir, lstat, open, rename, unlink } from "node:fs/promises";
import { constants, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { requestGithubJson, validateGithubCache } from "./github-run-request.mjs";

const DEFAULT_REPO = "9178osage/inabakumori-site";
const WORKFLOWS = ["Verify website", "Publish public site"];
const SHA = /^[0-9a-f]{7,40}$/u;
const PACIFIC_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", month: "2-digit", day: "2-digit"
});

function rowError(line, message) {
  throw new Error(`CHANGELOG line ${line}: ${message}`);
}

function cells(line) {
  if (!/^\s*\|.*\|\s*$/u.test(line)) return null;
  return line.trim().slice(1, -1).split(/(?<!\\)\|/u).map(cell => cell.trim());
}

function runPair(text, line) {
  const match = /^(\d+)\s*\/\s*(\d+)$/u.exec(text.trim());
  if (!match || match.slice(1).some(id => !/^[1-9]\d*$/u.test(id) || !Number.isSafeInteger(Number(id)))) {
    rowError(line, "expected a Verify / Publish run ID pair");
  }
  return match.slice(1);
}

// Each row has one primary pair for its last commit, plus explicitly attributed
// historical pairs in parentheses. Nothing outside this one table is scanned.
export function parseChangelogTable(markdown) {
  const lines = String(markdown).split(/\r?\n/u);
  const sections = lines.flatMap((line, i) => /^## 上线记录\s*$/u.test(line) ? [i] : []);
  if (sections.length !== 1) throw new Error("Expected exactly one 上线记录 section");
  const start = sections[0] + 1;
  const nextSection = lines.findIndex((line, i) => i >= start && /^##\s/u.test(line));
  const end = nextSection < 0 ? lines.length : nextSection;
  const headers = [];
  for (let i = start; i < end; i++) {
    const row = cells(lines[i]);
    if (row?.[0] === "日期" && row?.[1] === "提交") headers.push(i);
  }
  if (headers.length !== 1) throw new Error("Expected exactly one deployment table");
  const header = headers[0];
  const headings = cells(lines[header]);
  if (headings.length !== 4 || headings[2] !== "主要内容" || !/^CI[（(]Verify\s*\/\s*Publish[）)]$/u.test(headings[3])) {
    rowError(header + 1, "unexpected deployment table headings");
  }
  const separator = cells(lines[header + 1] || "");
  if (separator?.length !== 4 || separator.some(cell => !/^:?-{3,}:?$/u.test(cell))) {
    rowError(header + 2, "missing deployment table separator");
  }

  const rows = [];
  const seenCommits = new Map();
  const seenRuns = new Map();
  let afterTable = false;
  for (let i = header + 2; i < end; i++) {
    const row = cells(lines[i]);
    if (!row) { afterTable = true; continue; }
    if (afterTable) rowError(i + 1, "deployment rows must form one continuous table");
    if (row.length !== 4) rowError(i + 1, "expected four deployment table cells");
    const [date, commitCell, description, ci] = row;
    const line = i + 1;
    if (!/^(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(date) || !description) {
      rowError(line, "missing or invalid date/description");
    }
    const commits = [...commitCell.matchAll(/`([0-9a-f]{7,40})`/giu)].map(match => match[1].toLowerCase());
    if (!commits.length || commitCell.replace(/`[0-9a-f]{7,40}`/giu, "").replace(/[\s、,，]/gu, "")) {
      rowError(line, "commit cell must contain backticked commit SHAs only");
    }
    for (const commit of commits) {
      for (const [seen, seenLine] of seenCommits) {
        if (seen.startsWith(commit) || commit.startsWith(seen)) {
          rowError(line, `commit ${commit} repeats a commit from line ${seenLine}`);
        }
      }
      seenCommits.set(commit, line);
    }
    const primary = /^(\d+\s*\/\s*\d+)(.*)$/u.exec(ci);
    if (!primary) rowError(line, "missing primary Verify / Publish pair");
    const pairs = [{ commit: commits.at(-1), ids: runPair(primary[1], line), primary: true }];
    let tail = primary[2].trim();
    while (tail) {
      const annotation = /^[（(]`([0-9a-f]{7,40})`\s*的(?:运行失败|推送|运行)[：:]\s*(\d+\s*\/\s*\d+)([^（）()]*)[）)]/iu.exec(tail);
      if (!annotation || /\d/u.test(annotation[3])) rowError(line, "unparsed or unattributed historical CI runs");
      const commit = annotation[1].toLowerCase();
      if (!commits.includes(commit)) rowError(line, "historical run commit is missing from the commit cell");
      pairs.push({ commit, ids: runPair(annotation[2], line), primary: false });
      tail = tail.slice(annotation[0].length).trim();
    }
    for (const pair of pairs) {
      for (const id of pair.ids) {
        if (seenRuns.has(id)) rowError(line, `run ${id} repeats line ${seenRuns.get(id)}`);
        seenRuns.set(id, line);
      }
    }
    rows.push({ line, date, commits, pairs });
  }
  if (!rows.length || !seenRuns.size) throw new Error("Deployment table has zero rows or run coverage");
  return rows;
}

function parseRun(data, id) {
  if (!data || typeof data !== "object" || data.id !== Number(id) ||
      typeof data.name !== "string" || typeof data.event !== "string" || typeof data.head_branch !== "string" ||
      typeof data.head_sha !== "string" || !/^[0-9a-f]{40}$/iu.test(data.head_sha) ||
      typeof data.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(data.created_at) ||
      !Number.isFinite(Date.parse(data.created_at)) ||
      new Date(data.created_at).toISOString().replace(".000Z", "Z") !== data.created_at) {
    throw new Error(`Run ${id}: missing or invalid GitHub run fields`);
  }
  return { ...data, head_sha: data.head_sha.toLowerCase(), createdMs: Date.parse(data.created_at) };
}

function pacificDate(time) {
  const parts = PACIFIC_DATE.formatToParts(new Date(time));
  return `${parts.find(part => part.type === "month").value}-${parts.find(part => part.type === "day").value}`;
}

// A push's date/order is the earlier created_at of its primary Verify and Publish
// runs. Thus a pair straddling Pacific midnight belongs to the earlier day.
export async function verifyChangelogTable(markdown, {
  fetchImpl = globalThis.fetch, repo = DEFAULT_REPO, token = "", deadlineMs = 12_000, concurrency = 4,
  lookup = "direct", maxPages = 10, cache, stats, maxRetries = 2, retryBaseMs = 250, maxRetryWaitMs = 2000
} = {}) {
  const rows = parseChangelogTable(markdown);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) throw new Error("Invalid GitHub repository configuration");
  if (typeof token !== "string" || /[\r\n]/u.test(token)) throw new Error("Invalid GitHub token configuration");
  if (typeof fetchImpl !== "function" || !Number.isFinite(deadlineMs) || deadlineMs <= 0 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 ||
      !["direct", "paginated"].includes(lookup) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new Error("Invalid GitHub request configuration");
  }
  const ids = rows.flatMap(row => row.pairs.flatMap(pair => pair.ids));
  const runs = new Map();
  const requestOptions = { fetchImpl, repo, token, deadlineMs, cache, stats, maxRetries, retryBaseMs, maxRetryWaitMs };
  if (lookup === "paginated") {
    const wanted = new Set(ids);
    for (let page = 1; page <= maxPages && runs.size < ids.length; page++) {
      const data = await requestGithubJson(`?branch=main&event=push&per_page=100&page=${page}`, `Runs page ${page}`, requestOptions);
      if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || !Array.isArray(data.workflow_runs) ||
          data.workflow_runs.some(run => !Number.isSafeInteger(run?.id) || run.id <= 0)) {
        throw new Error(`Runs page ${page}: missing or invalid GitHub list fields`);
      }
      for (const run of data.workflow_runs) {
        const id = String(run.id);
        if (wanted.has(id)) runs.set(id, parseRun(run, id));
      }
      if (!data.workflow_runs.length || page * 100 >= data.total_count) break;
    }
  }
  // A filtered list can omit a wrong-branch/event ID, or age past the page limit.
  // Fetch every missing ID directly: incomplete list coverage can never pass.
  const missing = ids.filter(id => !runs.has(id));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
    while (next < missing.length) {
      const id = missing[next++];
      runs.set(id, parseRun(await requestGithubJson(`/${id}`, `Run ${id}`, requestOptions), id));
    }
  }));
  if (runs.size !== ids.length || !runs.size) throw new Error("Incomplete or zero GitHub run coverage");
  let previousTime = Infinity;
  for (const row of rows) {
    let primaryTime;
    for (const pair of row.pairs) {
      const pairRuns = pair.ids.map(id => runs.get(id));
      pairRuns.forEach((run, i) => {
        if (run.name !== WORKFLOWS[i]) rowError(row.line, `run ${pair.ids[i]} must be ${WORKFLOWS[i]}`);
        if (run.event !== "push" || run.head_branch !== "main") rowError(row.line, `run ${pair.ids[i]} must be a push on main`);
        if (!SHA.test(pair.commit) || !run.head_sha.startsWith(pair.commit)) rowError(row.line, `run ${pair.ids[i]} commit mismatch`);
      });
      if (pairRuns[0].head_sha !== pairRuns[1].head_sha) rowError(row.line, "Verify / Publish runs have different commits");
      const time = Math.min(...pairRuns.map(run => run.createdMs));
      if (pair.primary) primaryTime = time;
      else if (time > primaryTime) rowError(row.line, "historical runs are newer than the primary push");
    }
    if (row.date !== pacificDate(primaryTime)) rowError(row.line, `date must be ${pacificDate(primaryTime)} in America/Los_Angeles`);
    if (primaryTime > previousTime) rowError(row.line, "pushes must be ordered newest to oldest by created_at");
    previousTime = primaryTime;
  }
  return { rows: rows.length, runs: runs.size };
}

const cacheDirectory = fileURLToPath(new URL("../artifacts/", import.meta.url));
const cacheFile = path.join(cacheDirectory, "changelog-api-cache.json");
const plainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

async function regularPath(file, directory = false) {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !(directory ? info.isDirectory() : info.isFile())) {
      throw new Error("Unsafe changelog cache path; use --no-cache to check without the cache");
    }
    return info;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function loadCache(repo, token) {
  const empty = { version: 1, repo, responses: {} };
  if (!await regularPath(cacheDirectory, true) || !await regularPath(cacheFile)) return empty;
  const source = await open(cacheFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await source.stat();
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error("Invalid cache size");
    const data = JSON.parse(await source.readFile("utf8"));
    if (data.version !== 1 || data.repo !== repo || !plainObject(data.responses) ||
        Object.keys(data.responses).length > 1000 ||
        (data.cooldownUntil !== undefined && (!Number.isSafeInteger(data.cooldownUntil) || data.cooldownUntil < 0))) {
      throw new Error("Invalid cache format");
    }
    for (const [endpoint, entry] of Object.entries(data.responses)) {
      if (!/^(?:\/[1-9]\d*|\?branch=main&event=push&per_page=100&page=[1-9]\d*)$/u.test(endpoint) ||
          !plainObject(entry) || typeof entry.etag !== "string" || !entry.etag || entry.etag.length > 1024 ||
          /[\r\n]/u.test(entry.etag) || !plainObject(entry.data)) throw new Error("Invalid cached response");
    }
    validateGithubCache(data, repo, token);
    return data;
  } catch {
    console.error("Ignoring invalid changelog cache; online verification is required.");
    return empty;
  } finally { await source.close(); }
}

// Persist only the public fields that table validation needs, never credentials
// or arbitrary response properties. A cached response still requires HTTP 304.
function cacheSnapshot(cache) {
  const fields = ["id", "name", "event", "head_branch", "head_sha", "created_at"];
  const run = data => Object.fromEntries(fields.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
  const entries = Object.entries(cache.responses).filter(([endpoint, entry]) => plainObject(entry?.data) &&
    (!endpoint.startsWith("?") || (Array.isArray(entry.data.workflow_runs) && entry.data.workflow_runs.every(plainObject))));
  const responses = Object.fromEntries(entries.map(([endpoint, entry]) => [endpoint, {
    etag: entry.etag,
    data: endpoint.startsWith("?") ? { total_count: entry.data.total_count, workflow_runs: entry.data.workflow_runs?.map(run) } : run(entry.data)
  }]));
  return { version: 1, repo: cache.repo, responses, ...(cache.cooldownUntil ? { cooldownUntil: cache.cooldownUntil } : {}) };
}

async function saveCache(cache) {
  if (!await regularPath(cacheDirectory, true)) await mkdir(cacheDirectory, { mode: 0o700 });
  await regularPath(cacheFile);
  const temporary = path.join(cacheDirectory, `.changelog-api-cache-${randomUUID()}.tmp`);
  try {
    const target = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await target.writeFile(JSON.stringify(cacheSnapshot(cache))); } finally { await target.close(); }
    await regularPath(cacheDirectory, true);
    await regularPath(cacheFile);
    await rename(temporary, cacheFile);
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--no-cache") || args.length > 1) throw new Error("Usage: npm run check:changelog -- [--no-cache]");
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  const cache = args.includes("--no-cache") ? undefined : await loadCache(repo, token);
  const stats = { networkRequests: 0, revalidatedResponses: 0, retries: 0 };
  const markdown = await readFile(new URL("../docs/CHANGELOG.md", import.meta.url), "utf8");
  let result, failure;
  try { result = await verifyChangelogTable(markdown, { repo, token, lookup: "paginated", cache, stats }); }
  catch (error) { failure = error; }
  try { if (cache) await saveCache(cache); }
  catch (error) {
    if (!failure) throw error;
    console.error("Could not save changelog cache; the original verification failure is preserved.");
  }
  if (failure) {
    console.error(`GitHub verification: ${stats.networkRequests} requests, ${stats.revalidatedResponses} HTTP 304 revalidations, ${stats.retries} retries; not completed.`);
    throw failure;
  }
  console.log(`Deployment table verified online: ${result.rows} rows, ${result.runs} GitHub runs; ${stats.networkRequests} requests, ${stats.revalidatedResponses} HTTP 304 revalidations, ${stats.retries} retries; dates in America/Los_Angeles (earlier primary run).`);
}

if (process.argv[1] && process.argv[1] !== "-" && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try { await main(); }
  catch (error) { console.error(`Deployment table check failed: ${error.message}`); process.exitCode = 1; }
}
