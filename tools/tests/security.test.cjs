const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const backendFiles = ["backend/server.mjs", "backend/services.mjs", "backend/backup.mjs", "backend/backup-endpoint.mjs"];
const read = file => fs.readFileSync(file, "utf8");

test("backend has no shell, eval, dynamic code or SQLite extension loading primitives", () => {
  for (const file of backendFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /child_process|\bexecSync?\(|\bspawn(Sync)?\(|\bfork\(/, `${file}: process execution`);
    assert.doesNotMatch(source, /\beval\(|new Function\(|\bimport\(/, `${file}: dynamic code`);
    assert.doesNotMatch(source, /allowExtension|loadExtension|load_extension/i, `${file}: SQLite extensions`);
    assert.doesNotMatch(source, /writeFile|appendFile|createWriteStream|unlink\(|rmSync|readFile/, `${file}: request-reachable file IO`);
    assert.doesNotMatch(source, /express\.static|sendFile|res\.download/, `${file}: file serving`);
    assert.doesNotMatch(source, /\bfetch\(|https?\.request\(|https?\.get\(/, `${file}: outbound requests (SSRF)`);
  }
  const server = read("backend/server.mjs");
  assert.match(server, /new DatabaseSync\(databasePath\)/, "database opened with default options (extensions disabled)");
  assert.match(server, /app\.set\("query parser", "simple"\)/, "no nested query objects");
  assert.match(server, /express\.json\(\{ limit: "20kb", strict: true \}\)/);
  assert.match(server, /app\.disable\("x-powered-by"\)/);
});

test("every state-changing route requires a session; admin routes check rights server-side", () => {
  const sources = backendFiles.slice(0, 2).map(read).join("\n");
  const routes = [...sources.matchAll(/app\.(post|delete|put|patch)\("([^"]+)",([^\n]*)/g)];
  assert.ok(routes.length >= 3, "expected comment routes");
  for (const [, method, route, rest] of routes) {
    if (method === "post" && route === "/api/comments") {
      // Guests may post (validated, rate limited); a valid session marks the post as a member post.
      assert.match(rest, /verifySession\(\{ sessionRequired: false \}\)/);
      assert.match(rest, /guestCommentLimiter/);
      continue;
    }
    assert.match(rest, /verifySession\(\)/, `${method.toUpperCase()} ${route} must require a session`);
    if (route.startsWith("/api/admin/")) assert.match(rest, /requireAdmin/, `${route} must check admin rights`);
  }
  const services = read("backend/services.mjs");
  assert.match(services, /DELETE FROM comments WHERE id = \? AND user_id = \? AND is_guest = 0/, "members delete only their own comments");
  assert.match(services, /if \(!req\.session \|\| !\(await isAdmin\(req\.session\.getUserId\(\)\)\)\)/);
  // Session tokens travel in Authorization headers, so a forged cross-site form cannot ride cookies (CSRF).
  assert.match(read("backend/server.mjs"), /getTokenTransferMethod: \(\) => "header"/);
  assert.match(read("tools/auth-src.js"), /tokenTransferMethod: "header"/);
});

test("ADDITIONAL_WEBSITE_ORIGINS accepts only bare origins and HTTPS in production", async () => {
  const { parseAdditionalOrigins } = await import("../../backend/services.mjs");
  assert.deepEqual(parseAdditionalOrigins(""), []);
  assert.deepEqual(parseAdditionalOrigins(undefined), []);
  assert.deepEqual(parseAdditionalOrigins(" https://9178osage.github.io , https://osagechan.top/ ", { production: true }),
    ["https://9178osage.github.io", "https://osagechan.top"]);
  for (const bad of ["*", "https://*.github.io", "https://9178osage.github.io/inabakumori-site/", "https://u:p@x.example", "ftp://x.example", "not a url", "https://x.example/?a=1"]) {
    assert.throws(() => parseAdditionalOrigins(bad), /ADDITIONAL_WEBSITE_ORIGINS/, bad);
  }
  assert.throws(() => parseAdditionalOrigins("http://x.example", { production: true }), /HTTPS/);
  assert.deepEqual(parseAdditionalOrigins("http://127.0.0.1:5500"), ["http://127.0.0.1:5500"]);
  const server = read("backend/server.mjs");
  assert.match(server, /new Set\(\[WEBSITE_DOMAIN, \.\.\.ADDITIONAL_WEBSITE_ORIGINS,/);
});

test("frontend talks only to the hardcoded HTTPS API and never renders server data as HTML", () => {
  const context = { window: { location: { hostname: "osagechan.top", protocol: "https:", search: "?api=https://evil.example" } } };
  vm.createContext(context);
  vm.runInContext(read("js/config.js"), context);
  assert.equal(context.window.APP_CONFIG.apiDomain, "https://inabakumori-site-production.up.railway.app");
  for (const file of ["script.js", "js/comments.js", "js/experience.js", "js/i18n.js", "js/network.js", "js/preferences.js", "js/nknk-gallery-ui.js", "tools/auth-src.js"]) {
    assert.doesNotMatch(read(file), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, file);
  }
  const csp = read("index.html").match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/inabakumori-site-production\.up\.railway\.app/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  // Trusted Types: any accidental HTML/script sink (innerHTML etc.) throws instead of injecting.
  assert.match(csp, /require-trusted-types-for 'script'/);
  assert.match(csp, /trusted-types 'none'/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /worker-src 'none'/);
  const page404 = read("404.html");
  const csp404 = page404.match(/Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp404, "404 page has its own CSP");
  assert.match(csp404, /default-src 'none'/);
  const style = page404.match(/<style>([\s\S]*?)<\/style>/)[1];
  const hash = require("node:crypto").createHash("sha256").update(style).digest("base64");
  assert.ok(csp404.includes(`'sha256-${hash}'`), "404 style hash must match its inline style");
});

test("the site refuses to render inside another site's frame", () => {
  const replaced = [];
  const top = { location: { replace: url => replaced.push(url) } };
  const html = { hidden: false, dataset: {} };
  const context = { document: { documentElement: html }, localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: false }) };
  context.window = { top, self: {}, location: { href: "https://osagechan.top/" }, matchMedia: () => ({ matches: false }) };
  vm.createContext(context);
  try { vm.runInContext(read("js/preferences.js"), context); } catch { /* rest of the file needs a fuller DOM */ }
  assert.equal(html.hidden, true);
  assert.deepEqual(replaced, ["https://osagechan.top/"]);
  assert.match(read("index.html"), /<script src="js\/preferences\.js[^"]*"><\/script>/, "frame guard runs from the first, blocking script");
});

test("rate-limit keys use the edge-set client IP on Railway and ignore spoofable or invalid values", async () => {
  const { clientIpResolver } = await import("../../backend/services.mjs");
  const req = headers => ({ ip: "100.64.0.7", get: name => headers[name.toLowerCase()] });
  const railway = clientIpResolver({ RAILWAY_SERVICE_ID: "svc" });
  assert.equal(railway(req({ "x-real-ip": "203.0.113.5" })), "203.0.113.5");
  assert.equal(railway(req({ "x-real-ip": "2001:db8::1" })), "2001:db8::1");
  assert.equal(railway(req({ "x-real-ip": "203.0.113.5, 1.2.3.4" })), "100.64.0.7");
  assert.equal(railway(req({})), "100.64.0.7");
  assert.equal(clientIpResolver({})(req({ "x-real-ip": "203.0.113.5" })), "100.64.0.7", "header ignored off Railway unless configured");
  assert.equal(clientIpResolver({ RAILWAY_SERVICE_ID: "svc", CLIENT_IP_HEADER: "none" })(req({ "x-real-ip": "203.0.113.5" })), "100.64.0.7");
  assert.throws(() => clientIpResolver({ CLIENT_IP_HEADER: "x real ip" }), /CLIENT_IP_HEADER/);
  const server = read("backend/server.mjs");
  const limiters = [...server.matchAll(/const (\w+Limiter) = rateLimit\(\{([^\n]*)/g)];
  assert.ok(limiters.length >= 8);
  for (const [, name, rest] of limiters) {
    if (name === "memberCommentLimiter") continue;
    assert.match(rest, /keyGenerator: clientIpKey/, `${name} must key on the client IP`);
  }
});

test("comment validation stays fast on adversarial 500-character inputs (no ReDoS)", async () => {
  const { validateCommentInput } = await import("../../backend/services.mjs");
  const inputs = ["1".repeat(500), "a-".repeat(250), "a.".repeat(250), "1.".repeat(250), "１".repeat(500),
    "+1 ".repeat(166), "(0".repeat(250), "a".repeat(250) + "@" + "b".repeat(249), "加 我的 ".repeat(100), "www.".repeat(125)];
  // Warm the lazy regex compilation once: the other test files spawn esbuild and git workers, and the
  // first run otherwise pays for compiling four large Unicode patterns while the CPU is contended.
  validateCommentInput({ nickname: "warmup", content: "warmup@example.com 138 0013 8000" });
  const runBatch = content => {
    const cpuStart = process.cpuUsage();
    const wallStart = performance.now();
    for (let i = 0; i < 5; i++) validateCommentInput({ nickname: "n".repeat(30), content });
    const wallMs = performance.now() - wallStart;
    const usage = process.cpuUsage(cpuStart);
    return { wallMs, cpuMs: (usage.user + usage.system) / 1000 };
  };
  for (const content of inputs) {
    let { wallMs, cpuMs } = runBatch(content);
    // Wall time can include time this process spent descheduled; CPU time cannot. Re-measure once
    // when the wall clock looks bad but the CPU work was cheap, and keep both assertions.
    if (wallMs >= 250 && cpuMs < 150) ({ wallMs, cpuMs } = runBatch(content));
    assert.ok(cpuMs < 150, `high CPU time (${cpuMs.toFixed(1)}ms) for ${content.slice(0, 12)}…`);
    assert.ok(wallMs < 250, `slow validation (${wallMs.toFixed(1)}ms) for ${content.slice(0, 12)}…`);
  }
  // Oversized bodies are rejected by length before any pattern runs.
  const oversized = runBatch("a-".repeat(9000));
  assert.equal(validateCommentInput({ nickname: "n", content: "a-".repeat(9000) }).ok, false);
  assert.ok(oversized.cpuMs < 50 && oversized.wallMs < 100);
});

test("every GitHub Action is pinned to a commit SHA, workflows avoid pull_request_target, Dependabot watches all ecosystems", () => {
  for (const file of fs.readdirSync(".github/workflows")) {
    const source = read(`.github/workflows/${file}`);
    for (const [, ref] of source.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(ref, /@[0-9a-f]{40}$/, `${file}: ${ref} must be SHA-pinned`);
    assert.doesNotMatch(source, /pull_request_target/, file);
    assert.doesNotMatch(source, /\$\{\{\s*github\.(event\.(issue|pull_request|comment|head_commit)|head_ref)/, `${file}: untrusted context in expressions`);
    assert.match(source, /^permissions:/m, `${file}: top-level permissions`);
  }
  const dependabot = read(".github/dependabot.yml");
  for (const part of [/package-ecosystem: npm\n\s+directory: \/\n/, /package-ecosystem: npm\n\s+directory: \/backend/, /package-ecosystem: github-actions/]) assert.match(dependabot, part);
});

// Public, text-only files where the contact address could be written back as a login
// identifier. Untracked local files (backend/.env, SECURITY_AUDIT_*.md, dist/) are
// deliberately out of scope: they are not published, and the real .env legitimately
// holds the local ADMIN_EMAILS line.
function publishedTextFiles() {
  const skip = new Set(["node_modules", ".git", "dist", "artifacts", ".backups", ".vscode"]);
  const files = ["index.html", "404.html", "updates.html", "updates.css", "script.js", "style.css", "AGENTS.md", "README.md", "SECURITY.md", "site.webmanifest", "robots.txt", "sitemap.xml", "backend/.env.example"];
  const walk = (directory, filter) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(file, filter);
      else if (filter.test(entry.name)) files.push(file);
    }
  };
  for (const [directory, filter] of Object.entries({ docs: /\.md$/i, js: /\.js$/i, tools: /\.(?:mjs|cjs|js|py)$/i, backend: /\.mjs$/i, data: /\.json$/i, ".github": /\.ya?ml$/i })) walk(directory, filter);
  return files.filter(file => fs.existsSync(file));
}

test("the published contact address never becomes an admin login identifier", () => {
  const page = read("index.html");
  const publicAddresses = [...new Set((page.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(address => address.toLowerCase()))];
  // Tripwire: if the page stops publishing a contact route, the guard below would
  // silently become a no-op, so change it deliberately instead of deleting it.
  assert.ok(publicAddresses.length > 0, "index.html must keep publishing a contact address");
  const files = publishedTextFiles();
  assert.ok(files.length > 25, `expected the public file scan to cover the repository, got ${files.length}`);
  assert.ok(files.includes("docs/SECURITY.md") && files.includes("backend/.env.example"));
  for (const file of ["updates.html", "updates.css", "AGENTS.md", "data/creator-updates.json", "data/x-posts/manifest.json", "tools/sync-copy.py"]) {
    assert.ok(files.includes(file), `${file}: the contact/admin guard must cover newer repository text`);
  }
  const manifest = JSON.parse(read("data/x-posts/manifest.json"));
  for (const shard of manifest.shards) assert.ok(files.includes(`data/x-posts/${shard.file}`), "the contact/admin guard must cover every X post shard");
  for (const file of files) {
    const source = read(file);
    // The address may only appear where it is published as a contact route.
    if (file !== "index.html") {
      for (const address of publicAddresses) {
        assert.ok(!source.toLowerCase().includes(address), `${file}: the public contact address must never be reused (login identifier, admin list or docs)`);
      }
    }
    // Email must never grant admin: a real value here would be the removed-by-design pattern.
    assert.doesNotMatch(source, /^\s*ADMIN_EMAILS\s*=\s*\S/m, `${file}: admin is granted by ADMIN_USER_IDS only`);
  }
  const securityDoc = read("docs/SECURITY.md");
  assert.match(securityDoc, /\*\*唯一\*\*管理员来源/, "the admin source must stay documented as user IDs only");
  // Pin the prose rule as well as the table phrase: rewriting this sentence to allow
  // email-based grants must fail even while the table still carries the required words.
  assert.match(securityDoc, /只通过 `ADMIN_USER_IDS` 授权/, "the prose rule must keep forbidding email-based admin grants");
  assert.match(securityDoc, /管理员登录邮箱应与公开联系邮箱不同/, "the login-email goal must stay documented");
  assert.match(securityDoc, /当前已接受偏差/, "the accepted deviation must stay documented");
});
