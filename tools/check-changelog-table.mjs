import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

async function fetchJson(endpoint, label, { fetchImpl, repo, token, deadlineMs }) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label}: GitHub request timed out`));
    }, deadlineMs);
  });
  const request = (async () => {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${repo}/actions/runs${endpoint}`, {
        headers, signal: controller.signal, redirect: "error"
      });
    } catch { throw new Error(`${label}: GitHub request failed (network)`); }
    if (!response?.ok || response.status !== 200) {
      throw new Error(`${label}: GitHub HTTP ${Number.isInteger(response?.status) ? response.status : "invalid response"}`);
    }
    let data;
    try { data = await response.json(); } catch { throw new Error(`${label}: invalid GitHub JSON`); }
    return data;
  })();
  try { return await Promise.race([request, deadline]); }
  finally { clearTimeout(timer); }
}

function pacificDate(time) {
  const parts = PACIFIC_DATE.formatToParts(new Date(time));
  return `${parts.find(part => part.type === "month").value}-${parts.find(part => part.type === "day").value}`;
}

// A push's date/order is the earlier created_at of its primary Verify and Publish
// runs. Thus a pair straddling Pacific midnight belongs to the earlier day.
export async function verifyChangelogTable(markdown, {
  fetchImpl = globalThis.fetch, repo = DEFAULT_REPO, token = "", deadlineMs = 12_000, concurrency = 4,
  lookup = "direct", maxPages = 10
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
  const requestOptions = { fetchImpl, repo, token, deadlineMs };
  if (lookup === "paginated") {
    const wanted = new Set(ids);
    for (let page = 1; page <= maxPages && runs.size < ids.length; page++) {
      const data = await fetchJson(`?branch=main&event=push&per_page=100&page=${page}`, `Runs page ${page}`, requestOptions);
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
      runs.set(id, parseRun(await fetchJson(`/${id}`, `Run ${id}`, requestOptions), id));
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

async function main() {
  const markdown = await readFile(new URL("../docs/CHANGELOG.md", import.meta.url), "utf8");
  const result = await verifyChangelogTable(markdown, {
    repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO,
    token: (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim(),
    lookup: "paginated"
  });
  console.log(`Deployment table verified: ${result.rows} rows, ${result.runs} GitHub runs; dates in America/Los_Angeles (earlier primary run).`);
}

if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try { await main(); }
  catch (error) { console.error(`Deployment table check failed: ${error.message}`); process.exitCode = 1; }
}
