import { readFile, mkdir, lstat, open, rename, unlink } from "node:fs/promises";
import { constants, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { requestGithubJson, validateGithubCache } from "./github-run-request.mjs";

const DEFAULT_REPO = "9178osage/inabakumori-site";
const WORKFLOWS = ["Verify website", "Publish public site"];
const SHA = /^[0-9a-f]{7,40}$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const PACIFIC_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", month: "2-digit", day: "2-digit"
});

class PaginationChangedError extends Error {}

function rowError(line, message) {
  throw new Error(`CHANGELOG line ${line}: ${message}`);
}

function cells(line) {
  if (!/^\s*\|.*\|\s*$/u.test(line)) return null;
  return line.trim().slice(1, -1).split(/(?<!\\)\|/u).map(cell => cell.trim());
}

// A primary pair may write "—" for Publish only when that push really produced no Publish run
// (e.g. the workflow was disabled); the Verify run is still checked online like any other.
function runPair(text, line, { allowMissingPublish = false } = {}) {
  const match = /^(\d+)\s*\/\s*(\d+|—)$/u.exec(text.trim());
  const ids = match ? [match[1], match[2] === "—" ? null : match[2]] : [];
  if (!match || (ids[1] === null && !allowMissingPublish) || ids.some(id => id !== null && (!/^[1-9]\d*$/u.test(id) || !Number.isSafeInteger(Number(id))))) {
    rowError(line, "expected a Verify / Publish run ID pair");
  }
  return ids;
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
    const primary = /^(\d+\s*\/\s*(?:\d+|—))(.*)$/u.exec(ci);
    if (!primary) rowError(line, "missing primary Verify / Publish pair");
    const pairs = [{ commit: commits.at(-1), ids: runPair(primary[1], line, { allowMissingPublish: true }), primary: true }];
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
      for (const id of pair.ids.filter(Boolean)) {
        if (seenRuns.has(id)) rowError(line, `run ${id} repeats line ${seenRuns.get(id)}`);
        seenRuns.set(id, line);
      }
    }
    rows.push({ line, date, commits, pairs });
  }
  if (!rows.length || !seenRuns.size) throw new Error("Deployment table has zero rows or run coverage");
  return rows;
}

const EMPTY_REWRITES = new Map();

function parseRun(data, id, rewrites = EMPTY_REWRITES) {
  if (!data || typeof data !== "object" || data.id !== Number(id) ||
      typeof data.name !== "string" || typeof data.event !== "string" || typeof data.head_branch !== "string" ||
      typeof data.head_sha !== "string" || !/^[0-9a-f]{40}$/iu.test(data.head_sha) ||
      typeof data.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(data.created_at) ||
      !Number.isFinite(Date.parse(data.created_at)) ||
      new Date(data.created_at).toISOString().replace(".000Z", "Z") !== data.created_at) {
    throw new Error(`Run ${id}: missing or invalid GitHub run fields`);
  }
  const recorded = data.head_sha.toLowerCase();
  // GitHub keeps each historical run's original head_sha after a history rewrite;
  // translate it through the tracked old->new commit map so rows, the baseline
  // and ancestry coverage all compare against the current history.
  return { ...data, head_sha: rewrites.get(recorded) || recorded, createdMs: Date.parse(data.created_at) };
}

// Validates tools/changelog-history-rewrites.json: { "commits": { "<old full SHA>": "<new full SHA>" } }.
// Mappings must be one-to-one and unchained, so a run can never resolve ambiguously.
export function parseHistoryRewrites(data) {
  if (data === undefined) return EMPTY_REWRITES;
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 1 || !Object.hasOwn(data, "commits") ||
      !data.commits || typeof data.commits !== "object" || Array.isArray(data.commits)) {
    throw new Error("Invalid changelog history rewrite map");
  }
  const map = new Map();
  for (const [from, to] of Object.entries(data.commits)) {
    if (!/^[0-9a-f]{40}$/u.test(from) || typeof to !== "string" || !/^[0-9a-f]{40}$/u.test(to) || from === to) {
      throw new Error("Invalid changelog history rewrite entry");
    }
    map.set(from, to);
  }
  const targets = new Set(map.values());
  if (targets.size !== map.size || [...map.keys()].some(from => targets.has(from))) {
    throw new Error("Changelog history rewrite map must be one-to-one and unchained");
  }
  return map;
}

function pacificDate(time) {
  const parts = PACIFIC_DATE.formatToParts(new Date(time));
  return `${parts.find(part => part.type === "month").value}-${parts.find(part => part.type === "day").value}`;
}

function coverageScope(coverage) {
  if (coverage === undefined) return null;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage) ||
      Object.keys(coverage).some(key => !["since", "through", "ancestorHeads", "baselineRunIds"].includes(key)) ||
      typeof coverage.since !== "string" || !FULL_SHA.test(coverage.since) ||
      typeof coverage.through !== "string" || !FULL_SHA.test(coverage.through) ||
      !Array.isArray(coverage.baselineRunIds) || coverage.baselineRunIds.length !== 2 ||
      coverage.baselineRunIds.some(id => !["number", "string"].includes(typeof id) || !/^[1-9]\d*$/u.test(String(id)) || !Number.isSafeInteger(Number(id))) ||
      String(coverage.baselineRunIds[0]) === String(coverage.baselineRunIds[1]) ||
      !Array.isArray(coverage.ancestorHeads) || coverage.ancestorHeads.some(head => typeof head !== "string" || !FULL_SHA.test(head)) ||
      new Set(coverage.ancestorHeads).size !== coverage.ancestorHeads.length ||
      coverage.ancestorHeads.includes(coverage.since) ||
      (coverage.since === coverage.through ? coverage.ancestorHeads.length !== 0 : !coverage.ancestorHeads.includes(coverage.through))) {
    throw new Error("Invalid changelog push coverage scope");
  }
  return { ...coverage, baselineRunIds: coverage.baselineRunIds.map(String), heads: new Set(coverage.ancestorHeads) };
}

// Git ancestry bounds the checked checkout, rather than whichever newer push is
// currently visible on GitHub. Side-branch commits are candidates only: a commit
// becomes an actual push head only when the Actions list supplies a main/push run.
export function localChangelogCoverage({ directory, since, baselineRunIds, githubSha = "" }) {
  if (typeof since !== "string" || !FULL_SHA.test(since) || typeof githubSha !== "string" || githubSha && !FULL_SHA.test(githubSha.toLowerCase())) {
    throw new Error("Invalid changelog Git coverage configuration");
  }
  const git = (...args) => {
    try {
      return execFileSync("git", args, { cwd: directory, encoding: "utf8", timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch { throw new Error("Cannot establish changelog coverage from Git history; fetch the full checkout history and its configured baseline"); }
  };
  const through = git("rev-parse", "--verify", "HEAD^{commit}").toLowerCase();
  if (!FULL_SHA.test(through)) throw new Error("Invalid Git checkout HEAD for changelog coverage");
  if (githubSha && githubSha.toLowerCase() !== through) throw new Error("GITHUB_SHA does not match the checked out HEAD for changelog coverage");
  git("merge-base", "--is-ancestor", since, through);
  const ancestors = git("log", "--format=%H", `${since}..${through}`);
  const coverage = { since, through, baselineRunIds, ancestorHeads: ancestors ? ancestors.split("\n") : [] };
  const validated = coverageScope(coverage);
  return { ...coverage, baselineRunIds: validated.baselineRunIds };
}

// A push's date/order is the earlier created_at of its primary Verify and Publish
// runs. Thus a pair straddling Pacific midnight belongs to the earlier day.
export async function verifyChangelogTable(markdown, {
  fetchImpl = globalThis.fetch, repo = DEFAULT_REPO, token = "", deadlineMs = 12_000, concurrency = 4,
  lookup = "direct", maxPages = 10, cache, stats, maxRetries = 2, retryBaseMs = 250, maxRetryWaitMs = 2000,
  coverage, rewrites = EMPTY_REWRITES
} = {}) {
  const rows = parseChangelogTable(markdown);
  const scope = coverageScope(coverage);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) throw new Error("Invalid GitHub repository configuration");
  if (typeof token !== "string" || /[\r\n]/u.test(token)) throw new Error("Invalid GitHub token configuration");
  if (typeof fetchImpl !== "function" || !Number.isFinite(deadlineMs) || deadlineMs <= 0 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 ||
      !["direct", "paginated"].includes(lookup) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new Error("Invalid GitHub request configuration");
  }
  const ids = rows.flatMap(row => row.pairs.flatMap(pair => pair.ids.filter(Boolean)));
  const runs = new Map();
  const pushHeads = new Set();
  const publishHeads = new Set();
  const baselineAnchors = new Set();
  let completeScope = false;
  const requestOptions = { fetchImpl, repo, token, deadlineMs, cache, stats, maxRetries, retryBaseMs, maxRetryWaitMs };
  if (lookup === "paginated" || scope) {
    const wanted = new Set(ids);
    // A new push can move page boundaries while we read them. Discard the entire
    // partial scan and retry once; never merge pages from different attempts.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const listed = new Set();
        let previousCreated = Infinity;
        let listedTotal;
        for (let page = 1; page <= maxPages; page++) {
          const data = await requestGithubJson(`?branch=main&event=push&per_page=100&page=${page}`, `Runs page ${page}`, requestOptions);
          if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || !Array.isArray(data.workflow_runs) ||
              data.workflow_runs.some(run => !Number.isSafeInteger(run?.id) || run.id <= 0) ||
              scope && (data.workflow_runs.length > 100 || data.total_count < data.workflow_runs.length)) {
            throw new Error(`Runs page ${page}: missing or invalid GitHub list fields`);
          }
          if (scope) {
            if (listedTotal !== undefined && listedTotal !== data.total_count) throw new PaginationChangedError("GitHub run pagination changed; coverage is incomplete");
            listedTotal = data.total_count;
            if (data.workflow_runs.length !== Math.min(100, Math.max(0, listedTotal - (page - 1) * 100))) {
              throw new Error(`Runs page ${page}: incomplete GitHub pagination data for push coverage`);
            }
          }
          for (const run of data.workflow_runs) {
            const id = String(run.id);
            const parsed = scope || wanted.has(id) ? parseRun(run, id, rewrites) : null;
            if (scope) {
              if (listed.has(id) || parsed.createdMs > previousCreated) throw new PaginationChangedError("GitHub run pagination changed or is out of order; coverage is incomplete");
              listed.add(id);
              previousCreated = parsed.createdMs;
              const baselineIndex = scope.baselineRunIds.indexOf(id);
              if (baselineIndex >= 0) {
                if (parsed.head_sha !== scope.since) throw new Error(`Run ${id}: baseline anchor commit mismatch`);
                if (parsed.name !== WORKFLOWS[baselineIndex]) throw new Error(`Run ${id}: baseline anchor must be ${WORKFLOWS[baselineIndex]}`);
                if (parsed.event !== "push" || parsed.head_branch !== "main") throw new Error(`Run ${id}: baseline anchor must be a push on main`);
                baselineAnchors.add(id);
              }
              if (parsed.event === "push" && parsed.head_branch === "main" && WORKFLOWS.includes(parsed.name)) {
                if (scope.heads.has(parsed.head_sha)) pushHeads.add(parsed.head_sha);
                if (parsed.name === WORKFLOWS[1]) publishHeads.add(parsed.head_sha);
              }
            }
            if (wanted.has(id)) runs.set(id, parsed);
          }
          if (scope && baselineAnchors.size === WORKFLOWS.length) completeScope = true;
          if (runs.size === ids.length && (!scope || completeScope)) break;
          if (!data.workflow_runs.length || page * 100 >= data.total_count) break;
        }
        break;
      } catch (error) {
        if (!(error instanceof PaginationChangedError) || attempt === 1) throw error;
        runs.clear();
        pushHeads.clear();
        publishHeads.clear();
        baselineAnchors.clear();
        completeScope = false;
        // Keep rate-limit cooldowns and direct lookups; refetch every list page.
        if (cache) {
          for (const key of Object.keys(cache.responses)) {
            if (/^\?branch=main&event=push&per_page=100&page=[1-9]\d*$/u.test(key)) delete cache.responses[key];
          }
        }
        if (stats) stats.paginationRestarts = (stats.paginationRestarts || 0) + 1;
        await sleep(500);
      }
    }
  }
  // A filtered list can omit a wrong-branch/event ID, or age past the page limit.
  // Fetch every missing ID directly: incomplete list coverage can never pass.
  const missing = ids.filter(id => !runs.has(id));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
    while (next < missing.length) {
      const id = missing[next++];
      runs.set(id, parseRun(await requestGithubJson(`/${id}`, `Run ${id}`, requestOptions), id, rewrites));
    }
  }));
  if (runs.size !== ids.length || !runs.size) throw new Error("Incomplete or zero GitHub run coverage");
  let previousTime = Infinity;
  for (const row of rows) {
    let primaryTime;
    for (const pair of row.pairs) {
      const pairRuns = pair.ids.map(id => id && runs.get(id));
      pairRuns.forEach((run, i) => {
        if (!run) return;
        if (run.name !== WORKFLOWS[i]) rowError(row.line, `run ${pair.ids[i]} must be ${WORKFLOWS[i]}`);
        if (run.event !== "push" || run.head_branch !== "main") rowError(row.line, `run ${pair.ids[i]} must be a push on main`);
        if (!SHA.test(pair.commit) || !run.head_sha.startsWith(pair.commit)) rowError(row.line, `run ${pair.ids[i]} commit mismatch`);
      });
      if (pairRuns[1] && pairRuns[0].head_sha !== pairRuns[1].head_sha) rowError(row.line, "Verify / Publish runs have different commits");
      const time = Math.min(...pairRuns.filter(Boolean).map(run => run.createdMs));
      if (pair.primary) primaryTime = time;
      else if (time > primaryTime) rowError(row.line, "historical runs are newer than the primary push");
    }
    if (row.date !== pacificDate(primaryTime)) rowError(row.line, `date must be ${pacificDate(primaryTime)} in America/Los_Angeles`);
    if (primaryTime > previousTime) rowError(row.line, "pushes must be ordered newest to oldest by created_at");
    previousTime = primaryTime;
  }
  const result = { rows: rows.length, runs: runs.size };
  if (scope) {
    if (!completeScope) throw new Error("Incomplete changelog push coverage: both original baseline main/push run anchors must be present before the page limit or list end");
    const primaryHeads = new Set(rows.map(row => runs.get(row.pairs[0].ids[0]).head_sha));
    for (const row of rows) {
      if (row.pairs[0].ids[1] === null && publishHeads.has(runs.get(row.pairs[0].ids[0]).head_sha)) {
        rowError(row.line, "a Publish push run exists for this commit; record its run ID instead of —");
      }
    }
    const missingHeads = [...pushHeads].filter(head => head !== scope.through && !primaryHeads.has(head));
    if (missingHeads.length) throw new Error(`Missing deployment table rows for ${missingHeads.length} main/push head(s) within ${scope.since.slice(0, 7)}..${scope.through.slice(0, 7)}: ${missingHeads.map(head => head.slice(0, 7)).join(", ")}`);
    if (scope.since !== scope.through && !primaryHeads.has(scope.since)) {
      throw new Error(`Missing deployment table baseline row for ${scope.since.slice(0, 7)}; only checkout HEAD may be one row behind`);
    }
    result.coverage = { since: scope.since, through: scope.through, pushes: pushHeads.size,
      recorded: [...pushHeads].filter(head => primaryHeads.has(head)).length,
      currentHeadExempt: pushHeads.has(scope.through) && !primaryHeads.has(scope.through) };
  }
  return result;
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
  if (args.some(arg => !["--no-cache", "--structure-only"].includes(arg)) || args.length > 1) {
    throw new Error("Usage: npm run check:changelog -- [--no-cache | --structure-only]");
  }
  const markdown = await readFile(new URL("../docs/CHANGELOG.md", import.meta.url), "utf8");
  // Structural checks work in PR/branch checkouts without credentials, Git or cache.
  const rows = parseChangelogTable(markdown);
  if (args[0] === "--structure-only") {
    const references = rows.reduce((count, row) => count + row.pairs.reduce((sum, pair) => sum + pair.ids.filter(Boolean).length, 0), 0);
    console.log(`Deployment table structure verified offline: ${rows.length} rows, ${references} run ID references; GitHub metadata and push coverage were not checked.`);
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  const cache = args.includes("--no-cache") ? undefined : await loadCache(repo, token);
  const stats = { networkRequests: 0, revalidatedResponses: 0, retries: 0, paginationRestarts: 0 };
  const configuration = JSON.parse(await readFile(new URL("./changelog-coverage.json", import.meta.url), "utf8"));
  if (!configuration || Object.keys(configuration).length !== 2 ||
      Object.keys(configuration).some(key => !["since", "baselineRunIds"].includes(key)) ||
      typeof configuration.since !== "string" || !FULL_SHA.test(configuration.since)) {
    throw new Error("Invalid tracked changelog coverage baseline");
  }
  let rewriteSource;
  try { rewriteSource = await readFile(new URL("./changelog-history-rewrites.json", import.meta.url), "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const rewrites = parseHistoryRewrites(rewriteSource === undefined ? undefined : JSON.parse(rewriteSource));
  const coverage = localChangelogCoverage({ directory: fileURLToPath(new URL("../", import.meta.url)),
    since: configuration.since, baselineRunIds: configuration.baselineRunIds, githubSha: process.env.GITHUB_SHA || "" });
  let result, failure;
  try { result = await verifyChangelogTable(markdown, { repo, token, lookup: "paginated", cache, stats, coverage, rewrites }); }
  catch (error) { failure = error; }
  try { if (cache) await saveCache(cache); }
  catch (error) {
    if (!failure) throw error;
    console.error("Could not save changelog cache; the original verification failure is preserved.");
  }
  if (failure) {
    console.error(`GitHub verification: ${stats.networkRequests} requests, ${stats.revalidatedResponses} HTTP 304 revalidations, ${stats.retries} request retries, ${stats.paginationRestarts} pagination restarts; not completed.`);
    throw failure;
  }
  console.log(`Deployment table verified online: ${result.rows} rows, ${result.runs} GitHub runs; ${stats.networkRequests} requests, ${stats.revalidatedResponses} HTTP 304 revalidations, ${stats.retries} request retries, ${stats.paginationRestarts} pagination restarts; dates in America/Los_Angeles (earlier primary run).`);
  console.log(`Push coverage since ${result.coverage.since} through ${result.coverage.through}: ${result.coverage.pushes} observed main/push head(s), ${result.coverage.recorded} recorded; only checkout HEAD may be one row behind${result.coverage.currentHeadExempt ? " (current push exempt)" : ""}${result.coverage.pushes ? "." : "; baseline-only: no newer target push observed."}`);
}

if (process.argv[1] && process.argv[1] !== "-" && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try { await main(); }
  catch (error) { console.error(`Deployment table check failed: ${error.message}`); process.exitCode = 1; }
}
