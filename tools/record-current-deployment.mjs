#!/usr/bin/env node
// Scheduled data commits must first record the successful push they build on.
// The independent online changelog gate still runs after this helper.
import { readFile, open, rename, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseChangelogTable } from "./check-changelog-table.mjs";
import { requestGithubJson } from "./github-run-request.mjs";
import { assertRepoPath } from "./safe-fs.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO = "9178osage/inabakumori-site";
const WORKFLOWS = ["Verify website", "Publish public site"];
const FULL_SHA = /^[0-9a-f]{40}$/u;
const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "2-digit", day: "2-digit" });

export function currentCheckoutHead(directory) {
  let head;
  try {
    head = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], { cwd: directory, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch { throw new Error("Cannot read current deployment commit from Git HEAD"); }
  if (!FULL_SHA.test(head)) throw new Error("Invalid current Git HEAD");
  return head;
}
function verifyRun(run, head, event) {
  if (!run || !Number.isSafeInteger(run.id) || run.id <= 0 || typeof run.name !== "string" ||
      run.head_sha !== head || run.head_branch !== "main" || run.event !== event ||
      typeof run.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(run.created_at) ||
      !Number.isFinite(Date.parse(run.created_at)) || new Date(run.created_at).toISOString().replace(".000Z", "Z") !== run.created_at ||
      typeof run.status !== "string" || (run.conclusion !== null && typeof run.conclusion !== "string")) {
    throw new Error("Invalid or mismatched current-HEAD workflow run");
  }
  return run;
}
async function currentRuns(head, event, options) {
  const all = [];
  const seen = new Set();
  let total;
  for (let page = 1; page <= 10; page++) {
    const query = new URLSearchParams({ branch: "main", event, head_sha: head, per_page: "100", page: String(page) });
    const data = await requestGithubJson(`?${query}`, `Current deployment ${event} runs`, { ...options, repo: REPO });
    if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || data.total_count > 1000 ||
        !Array.isArray(data.workflow_runs) || data.workflow_runs.length > 100 || total !== undefined && total !== data.total_count) {
      throw new Error("Invalid, incomplete or changing current-HEAD run list");
    }
    total = data.total_count;
    for (const candidate of data.workflow_runs) {
      const run = verifyRun(candidate, head, event);
      if (seen.has(run.id)) throw new Error("Duplicate current-HEAD run across list pages");
      seen.add(run.id);
      all.push(run);
    }
    if (all.length === total) return all;
    if (all.length > total || data.workflow_runs.length < 100) throw new Error("Incomplete current-HEAD run list");
  }
  throw new Error("Current-HEAD run pagination limit reached");
}
function successfulPair(runs, event) {
  const pair = WORKFLOWS.map(name => runs.filter(run => run.name === name)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0]);
  if (pair.some(run => !run)) throw new Error(`Current HEAD has an incomplete ${event} Verify / Publish pair`);
  for (const run of pair) {
    if (run.status !== "completed" || run.conclusion !== "success") throw new Error(`Current HEAD ${run.name} ${event} run has not completed successfully`);
  }
  return pair;
}

export async function prepareCurrentDeploymentRecord(markdown, head, options = {}) {
  if (typeof markdown !== "string" || !FULL_SHA.test(head)) throw new Error("Invalid current deployment record input");
  const rows = parseChangelogTable(markdown);
  if (rows.some(row => head.startsWith(row.commits.at(-1)))) return { changed: false, markdown, reason: "already-recorded", head };
  if (rows.some(row => row.commits.some(commit => head.startsWith(commit)))) throw new Error("Current HEAD appears only as a historical commit; refusing a duplicate deployment row");
  const pushRuns = await currentRuns(head, "push", options);
  const targetRuns = pushRuns.filter(run => WORKFLOWS.includes(run.name));
  if (!targetRuns.length) {
    // GITHUB_TOKEN bot commits do not trigger push workflows. They must have the
    // explicit successful dispatch pair; a missing or failed pair is not an exception.
    successfulPair(await currentRuns(head, "workflow_dispatch", options), "workflow_dispatch");
    return { changed: false, markdown, reason: "dispatch-only", head };
  }
  const pair = successfulPair(targetRuns, "push");
  const earlier = Math.min(...pair.map(run => Date.parse(run.created_at)));
  const parts = DATE.formatToParts(new Date(earlier));
  const date = `${parts.find(part => part.type === "month").value}-${parts.find(part => part.type === "day").value}`;
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/u);
  const row = `| ${date} | \`${head.slice(0, 7)}\` | 补记前次发布，供定时动态同步前核对 | ${pair[0].id} / ${pair[1].id} |`;
  lines.splice(rows[0].line - 1, 0, row);
  const updated = lines.join(newline);
  parseChangelogTable(updated);
  return { changed: true, markdown: updated, reason: "recorded-push", head, date, runIds: pair.map(run => String(run.id)) };
}

export async function recordCurrentDeployment({ directory = ROOT, readHead = currentCheckoutHead, renameImpl = rename, ...requestOptions } = {}) {
  const destination = assertRepoPath(directory, "docs/CHANGELOG.md", { mustExist: true });
  const head = readHead(directory);
  const original = await readFile(destination, "utf8");
  const result = await prepareCurrentDeploymentRecord(original, head, requestOptions);
  if (!result.changed) return result;
  const temporary = assertRepoPath(directory, `docs/.deployment-record-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o644);
    await handle.writeFile(result.markdown, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    const checked = assertRepoPath(directory, "docs/CHANGELOG.md", { mustExist: true });
    if (readHead(directory) !== head || await readFile(checked, "utf8") !== original) throw new Error("Git HEAD or changelog changed while preparing the deployment row; retry from the new state");
    await renameImpl(temporary, destination);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true });
  }
  return result;
}
async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const result = await recordCurrentDeployment({ token });
  console.log(`Current deployment ${result.head.slice(0, 7)}: ${result.reason}${result.runIds ? ` (${result.runIds.join(" / ")})` : ""}.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
