const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("production Core links must be HTTPS except loopback or explicitly trusted hosts (audit #06)", async () => {
  const { coreTransportProblem } = await import("../../backend/transport-security.mjs");
  assert.equal(coreTransportProblem("https://st-dev-synthetic.aws.supertokens.io"), null);
  assert.equal(coreTransportProblem("http://127.0.0.1:3567"), null);
  assert.equal(coreTransportProblem("http://localhost:3567"), null);
  assert.equal(coreTransportProblem("http://[::1]:3567"), null);
  assert.match(coreTransportProblem("http://core.example.test:3567"), /must use HTTPS/u);
  assert.match(coreTransportProblem("https://a.example.test;http://b.example.test"), /must use HTTPS/u, "every listed Core is checked");
  assert.equal(coreTransportProblem("http://core.internal:3567", { TRUSTED_PLAINTEXT_HOSTS: "core.internal" }), null);
  assert.match(coreTransportProblem("ftp://core.example.test"), /must use HTTPS/u);
  const secret = "http://private-secret-host.example.test/?apiKey=private-secret-value";
  assert.doesNotMatch(coreTransportProblem(secret), /private-secret/u, "messages never echo the configured value");
});

test("production PostgreSQL links must use verified TLS unless local or trusted (audit #06)", async () => {
  const { postgresTransportProblem } = await import("../../backend/transport-security.mjs");
  const remote = "postgresql://synthetic:private-password@ep-synthetic.neon.example.test/db";
  for (const ok of ["?sslmode=require", "?sslmode=require&channel_binding=require", "?sslmode=verify-full", "?sslmode=verify-ca", "?ssl=true",
    "?uselibpqcompat=true&sslmode=verify-full"]) {
    assert.equal(postgresTransportProblem(remote + ok), null, ok);
  }
  assert.equal(postgresTransportProblem(remote, { PGSSLMODE: "require" }), null, "PGSSLMODE applies when the URL is silent");
  for (const bad of ["", "?sslmode=disable", "?sslmode=allow", "?sslmode=no-verify", "?ssl=false", "?uselibpqcompat=true&sslmode=require"]) {
    const problem = postgresTransportProblem(remote + bad);
    assert.match(problem, /TLS with certificate verification/u, bad || "no TLS setting");
    assert.doesNotMatch(problem, /private-password|neon\.example/u);
  }
  assert.match(postgresTransportProblem(remote, { PGSSLMODE: "disable" }), /TLS/u);
  assert.equal(postgresTransportProblem("postgresql://u:p@127.0.0.1:5432/db"), null);
  assert.equal(postgresTransportProblem("postgresql://u:p@localhost/db"), null);
  assert.equal(postgresTransportProblem("postgresql://u:p@db.internal/db", { TRUSTED_PLAINTEXT_HOSTS: "db.internal" }), null);
});

test("openDatabase refuses an unverified remote PostgreSQL link in production before connecting", async () => {
  const { openDatabase } = await import("../../backend/database.mjs");
  const url = "postgresql://synthetic:private-password@ep-synthetic.neon.example.test/db?sslmode=no-verify";
  await assert.rejects(openDatabase({ DATABASE_URL: url, VERCEL: "1" }, "/tmp"), error =>
    error.code === "DATABASE_CONFIG" && /TLS/u.test(error.message) && !/private-password/u.test(error.message));
  await assert.rejects(openDatabase({ DATABASE_URL: url, NODE_ENV: "production" }, "/tmp"), error => error.code === "DATABASE_CONFIG");
});

test("the server checks the Core link at production startup", () => {
  const server = fs.readFileSync("backend/server.mjs", "utf8");
  assert.match(server, /if \(IS_PRODUCTION \|\| IS_VERCEL\) \{\n[^\n]*\n  const coreProblem = coreTransportProblem\(SUPERTOKENS_CONNECTION_URI, process\.env\);\n  if \(coreProblem\) failStartup\(coreProblem\);/u);
});

test("postgres TLS checks follow pg 8's last-parameter and case-sensitive PGSSLMODE rules (audit P2-1)", async () => {
  const { postgresTransportProblem } = await import("../../backend/transport-security.mjs");
  const base = "postgresql://synthetic:private-password@ep-synthetic.neon.example.test/db";
  assert.match(postgresTransportProblem(`${base}?sslmode=verify-full&sslmode=disable`), /TLS/u);
  assert.match(postgresTransportProblem(`${base}?sslmode=verify-full&sslmode=no-verify`), /TLS/u);
  assert.match(postgresTransportProblem(`${base}?ssl=true&ssl=0`), /TLS/u);
  assert.equal(postgresTransportProblem("postgresql://synthetic:private-password@localhost/db?host=localhost&host=db.example.com"),
    postgresTransportProblem(`${base}?sslmode=disable`));
  assert.match(postgresTransportProblem(base, { PGSSLMODE: "REQUIRE" }), /TLS/u, "pg ignores uppercase PGSSLMODE");
  assert.equal(postgresTransportProblem(base, { PGSSLMODE: "require" }), null);
  assert.match(postgresTransportProblem("postgresql://synthetic:private-password@foo%25bar.example.test/db"), /DATABASE_URL|PostgreSQL connection URL/u);
});
