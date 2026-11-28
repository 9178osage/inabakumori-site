const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(file, "utf8");

test("YouTube statistics requests refuse redirects and cap the success body (audit P2-12)", () => {
  const source = read("tools/refresh-youtube-views.mjs");
  assert.match(source, /redirect: "error"/u);
  assert.match(source, /MAX_SUCCESS_BYTES/u);
  assert.match(source, /readBoundedJson\(res, signal, MAX_SUCCESS_BYTES\)/u);
});

test("creator publish verifies SNAPSHOT_HASH as a fixed hex digest (audit P2-13)", () => {
  const workflow = read(".github/workflows/refresh-creator-updates.yml");
  assert.match(workflow, /grep -Eq '\^\[0-9a-f\]\{64\}\$'/u);
  assert.match(workflow, /grep -Fq "name=\\"creator-updates-version\\" content=\\"\$SNAPSHOT_HASH\\""/u);
  assert.doesNotMatch(workflow, /grep -q "name=\\"creator-updates-version\\"/u);
});

test("the changelog check paginates Verify and Publish workflows separately (audit P1-7)", () => {
  const source = read("tools/check-changelog-table.mjs");
  assert.ok(source.includes("check.yml"));
  assert.ok(source.includes("pages.yml"));
  assert.ok(source.includes("PAGINATION_WARN_PAGE"));
});

test("auth-loader skips loadAuth for credential-less public reads (audit P1-4)", () => {
  assert.match(read("js/auth-loader.js"), /credentials === "omit"/u);
});

test("closeAuthModal is blocked while a submission is in flight (audit P2-4)", () => {
  assert.match(read("tools/auth-src.js"), /function closeAuthModal\(\) \{\s*if \(authSubmitting\) return;/u);
});

test("local preview lists x-posts-pages.json and serves a hashed 404 style CSP (audit P2-11)", () => {
  const source = read("tools/static-server.mjs");
  assert.match(source, /"x-posts-pages\.json"/u);
  const html = read("404.html");
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const hash = require("node:crypto").createHash("sha256").update(style).digest("base64");
  assert.match(html, new RegExp(`sha256-${hash.replace(/[+/=]/g, "\\$&")}`));
  assert.match(source, new RegExp(`sha256-${hash.replace(/[+/=]/g, "\\$&")}`));
});

test("section-nav can scroll on narrow desktop and card tokens have defaults (audit P2-8)", () => {
  const css = read("style.css");
  assert.match(css, /\.section-nav \{[^}]*overflow-x: auto;/u);
  assert.match(css, /@media \(max-width: 1000px\) \{\s*\.section-nav \{[^}]*padding-right: 440px;/u);
  const updates = read("updates.css");
  assert.match(updates, /:root\{[^}]*--card:#f3f3f0;--card-line:#fbfbf9/u);
});

test("focus, error, 404 and X-logo contrast rules meet the audit P2-9 adjustments", () => {
  const css = read("style.css");
  assert.match(css, /#lang-btn:focus-visible,[^}]*outline: 3px solid var\(--ui-text\)/u);
  assert.match(css, /#message-name,[^}]*outline: 2px solid transparent/u);
  assert.match(css, /#message-submit-status\[data-error="true"\] \{ color: #8f1f1f; \}/u);
  assert.match(css, /rgba\(240, 240, 240, 0\.58\)/u);
  assert.match(css, /filter: invert\(1\)/u);
  assert.match(read("404.html"), /p\{color:#454b4e\}/u);
});

test("backend package check covers every module and root allowScripts is gone (audit P3-5)", () => {
  const backend = JSON.parse(read("backend/package.json"));
  assert.match(backend.scripts.check, /for f in \*\.mjs/u);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.allowScripts, undefined);
  const eslint = read("eslint.config.mjs");
  for (const rule of ["no-const-assign", "no-dupe-keys", "no-dupe-args", "no-unreachable", "valid-typeof", "use-isnan", "no-unsafe-negation"]) {
    assert.match(eslint, new RegExp(`"${rule}": "error"`, "u"));
  }
});

test("admin comment lists tolerate out-of-range timestamps (audit P3-2)", () => {
  const services = read("backend/services.mjs");
  assert.match(services, /function commentCreatedAt\(row\)/u);
  assert.match(services, /from "\.\/comment-time\.mjs"/u);
  const server = read("backend/server.mjs");
  assert.match(server, /failStartup\(error\.message\)/u);
  assert.match(server, /process\.env\.TRUST_PROXY\.trim\(\)/u);
  assert.match(server, /healthzProbe/u);
});

test("the backup wrapper creates logs as owner-only and quotes config paths (audit P2-15)", () => {
  const wrapper = read("tools/run-backup.sh");
  assert.match(wrapper, /^umask 077$/mu);
  assert.match(wrapper, /^set -u$/mu);
  const python = read("tools/remote-backup.py");
  assert.match(python, /import shlex/u);
  assert.match(python, /shlex\.quote\(config_path\)/u);
  assert.match(python, /result\["directory"\]/u);
});

test("LINK_PATTERN no longer has an overlapping hyphen/dot branch (audit P1-1)", () => {
  assert.match(read("backend/services.mjs"), /\\s\+dot\\s\+/u);
});
