const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("the real server survives a PostgreSQL cold-start outage and reports safe HTTP errors", async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "station-database-outage-")));
  const port = await unusedPort();
  const databasePort = await unusedPort();
  const password = "synthetic-private-password-do-not-log";
  const script = path.resolve(__dirname, "../../backend/server.mjs");
  const origin = "https://site.example.test";
  const child = spawn(process.execPath, [script], {
    cwd: directory,
    env: { PATH: process.env.PATH, NODE_ENV: "development", NODE_NO_WARNINGS: "1", HOST: "127.0.0.1", PORT: String(port),
      DATABASE_URL: `postgres://test:${password}@127.0.0.1:${databasePort}/unavailable`, WEBSITE_URL: origin,
      API_DOMAIN: `http://127.0.0.1:${port}`, SUPERTOKENS_CONNECTION_URI: "http://127.0.0.1:39999",
      SUPERTOKENS_API_KEY: "synthetic-core-key", BACKUP_TOKEN: "synthetic-backup-token-0123456789abcdef" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    await new Promise((resolve, reject) => {
      let timeout, onData, onExit;
      const finish = error => {
        clearTimeout(timeout); child.stdout.off("data", onData); child.off("exit", onExit);
        if (error) reject(error); else resolve();
      };
      timeout = setTimeout(() => finish(new Error("Outage fixture did not start")), 15_000);
      onData = () => { if (stdout.includes("Backend running")) finish(); };
      onExit = () => finish(new Error("Outage fixture exited before starting"));
      child.stdout.on("data", onData); child.once("exit", onExit); onData();
    });
    const call = (route, options = {}) => fetch(`http://127.0.0.1:${port}${route}`, {
      ...options, headers: { Origin: origin, ...options.headers }, signal: AbortSignal.timeout(5000)
    });
    const health = await call("/healthz");
    assert.equal(health.status, 503);
    assert.equal(health.headers.get("retry-after"), "5");
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.equal(health.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual(await health.json(), { ok: false, code: "DATABASE_UNAVAILABLE" });
    assert.doesNotMatch(stderr, /Rate limit store unavailable/u, "health bypasses all shared counters");
    const head = await call("/healthz", { method: "HEAD" });
    assert.equal(head.status, 503); await head.arrayBuffer();
    const root = await call("/");
    assert.equal(root.status, 200); assert.deepEqual(await root.json(), { ok: true });
    const read = await call("/api/comments");
    assert.equal(read.status, 503);
    assert.equal((await read.json()).code, "DATABASE_UNAVAILABLE");
    const mine = await call("/api/comments/mine");
    assert.equal(mine.status, 401, "read fail-open does not bypass session checks"); await mine.arrayBuffer();
    for (const [method, route] of [["POST", "/api/comments"], ["DELETE", "/api/comments/1"], ["OPTIONS", "/api/comments"], ["POST", "/auth/signin"]]) {
      const response = await call(route, { method });
      assert.equal(response.status, 503, method + " " + route);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.equal((await response.json()).code, "DATABASE_UNAVAILABLE");
    }
    const backup = await call("/api/admin/backup");
    assert.equal(backup.status, 503, "backup retains its strict limiter");
    assert.equal(backup.headers.get("access-control-allow-origin"), null); await backup.arrayBuffer();
    assert.ok(stderr.includes("Rate limit store unavailable"));
    for (const secret of [password, "synthetic-core-key", "synthetic-backup-token", "postgres://"]) {
      assert.ok(!(stdout + stderr).includes(secret), "diagnostics do not disclose credentials");
    }
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise(resolve => child.once("exit", resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Vercel configuration failures identify all missing variable names without process.exit", () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "station-vercel-configuration-")));
  try {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, "../../backend/server.mjs")], {
      cwd: directory, env: { PATH: process.env.PATH, VERCEL: "1", NODE_ENV: "production", NODE_NO_WARNINGS: "1" },
      encoding: "utf8", timeout: 10_000
    });
    assert.equal(result.status, 1);
    for (const name of ["SUPERTOKENS_CONNECTION_URI", "SUPERTOKENS_API_KEY", "DATABASE_URL", "API_DOMAIN", "WEBSITE_URL"]) assert.ok(result.stderr.includes(name));
    assert.match(result.stderr, /BACKEND_CONFIGURATION_ERROR/u);
    assert.match(result.stderr, /configure this deployment's environment and redeploy/u);
    assert.doesNotMatch(result.stderr, /exited with code 1|process\.exit\(/u);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
