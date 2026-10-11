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
