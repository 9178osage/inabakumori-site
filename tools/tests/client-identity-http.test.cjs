const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { writeFile } = require("node:fs/promises");
const express = require("../../backend/node_modules/express");
const cors = require("../../backend/node_modules/cors");

const ORIGIN = "https://trusted.example.test";
const BACKUP_TOKEN = "synthetic-private-backup-token-0123456789";

function counter(prefix) {
  const counts = new Map();
  return { prefix, localKeys: false, counts,
    async increment(key) {
      const totalHits = (counts.get(key) || 0) + 1;
      counts.set(key, totalHits);
      return { totalHits, resetTime: new Date(Date.now() + 60_000) };
    },
    async decrement(key) { counts.set(key, Math.max(0, (counts.get(key) || 0) - 1)); },
    async resetKey(key) { counts.delete(key); }
  };
}

async function serve(t) {
  const { createClientIdentity } = await import("../../backend/client-identity.mjs");
  const { createRequestRateLimit } = await import("../../backend/request-rate-limit.mjs");
  const { isBackupPath, registerBackupEndpoint } = await import("../../backend/backup-endpoint.mjs");
  const sessions = new Map([["alice-1", "alice"], ["alice-2", "alice"], ["bob-1", "bob"]]);
  const requests = counter("identity-http-requests"), backups = counter("identity-http-backups");
  const pending = [];
  const app = express();
  const expose = (req, res) => {
    if (!isBackupPath(req.originalUrl) && req.get("origin") === ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", ORIGIN);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.vary("Origin");
    }
  };
  const identity = createClientIdentity({ clientIp: () => "0.0.0.0", isBackupPath, onUnavailable: expose,
    verifySession: () => (req, _res, next) => {
      const token = req.get("authorization")?.replace(/^Bearer /u, "");
      if (!token) return next();
      if (!sessions.has(token)) return next(Object.assign(new Error("Invalid synthetic credential"), { status: 401 }));
      req.session = { getUserId: () => sessions.get(token) };
      return next();
    }
  });
  app.use((req, res, next) => identity(req, res, error => {
    if (error) expose(req, res);
    next(error);
  }));
  app.use(createRequestRateLimit({ store: requests, windowMs: 60_000,
    limit: req => isBackupPath(req.originalUrl) ? 100 : 2,
    keyGenerator: req => req.clientRateLimitKey, validate: false,
    handler(req, res) { expose(req, res); res.status(429).json({ code: "RATE_LIMITED" }); }
  }));
  const corsMiddleware = cors({ credentials: true, methods: ["GET", "HEAD", "POST", "OPTIONS"],
    origin(origin, done) {
      if (!origin || origin === ORIGIN) return done(null, true);
      return done(Object.assign(new Error("Origin denied"), { status: 403 }));
    }
  });
  app.use((req, res, next) => isBackupPath(req.originalUrl) ? next() : corsMiddleware(req, res, next));
  registerBackupEndpoint(app, { token: BACKUP_TOKEN,
    limiter: createRequestRateLimit({ store: backups, windowMs: 60_000, limit: 2,
      keyGenerator: req => req.clientRateLimitKey, validate: false }),
    snapshot: destination => writeFile(destination, "synthetic snapshot"),
    onBackgroundTask: task => pending.push(task), log: { warn() {}, info() {}, error() {} }
  });
  app.use((_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.status === 401 ? "UNAUTHORIZED" : "ORIGIN_DENIED" }));
  const server = await new Promise((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(instance)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await Promise.all(pending); });
  return { requests: requests.counts, backups: backups.counts,
    call({ method = "GET", url = "/api/comments", token, origin = ORIGIN, headers = {} } = {}) {
      return new Promise((resolve, reject) => {
        const request = http.request({ hostname: "127.0.0.1", port: server.address().port, path: url, method, agent: false,
          headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } }, response => {
          let body = "";
          response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; });
          response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
        });
        request.on("error", reject); request.end();
      });
    }
  };
}

test("missing-IP HTTP requests share Alice's quota across verified tokens while Bob remains independent", async t => {
  const app = await serve(t);
  for (const token of ["alice-1", "alice-2"]) assert.equal((await app.call({ method: "POST", token })).status, 200);
  const limited = await app.call({ method: "POST", token: "alice-1" });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["access-control-allow-origin"], ORIGIN);
  assert.equal(limited.headers["access-control-allow-credentials"], "true");
  assert.equal((await app.call({ method: "POST", token: "bob-1" })).status, 200);
  assert.deepEqual([...app.requests], [["member:alice", 3], ["member:bob", 1]]);
});

test("anonymous HTTP reads and preflights remain usable; anonymous writes fail before any counter", async t => {
  const app = await serve(t);
  for (const method of ["GET", "GET", "GET", "HEAD"]) assert.equal((await app.call({ method })).status, 200);
  for (const url of ["/api/comments", "/auth/signin", "/auth/session/refresh"]) {
    const denied = await app.call({ method: "POST", url });
    assert.equal(denied.status, 503);
    assert.deepEqual(JSON.parse(denied.body), { error: "暂时无法识别访客来源，请稍后重试。", code: "CLIENT_IDENTITY_UNAVAILABLE" });
    assert.equal(denied.headers["access-control-allow-origin"], ORIGIN);
    assert.equal(denied.headers["access-control-allow-credentials"], "true");
    assert.equal(denied.headers["retry-after"], "5");
    const preflight = await app.call({ method: "OPTIONS", url, headers: { "Access-Control-Request-Method": "POST" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], ORIGIN);
  }
  const foreign = await app.call({ method: "OPTIONS", origin: "https://foreign.example.test", headers: { "Access-Control-Request-Method": "POST" } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers["access-control-allow-origin"], undefined);
  assert.equal(app.requests.size, 0);
});

test("fake and expired HTTP credentials never get a user bucket and their 401 remains readable", async t => {
  const app = await serve(t);
  for (const token of ["fake", "expired-alice-1"]) {
    const result = await app.call({ method: "POST", token, headers: { "X-User-Id": "alice" } });
    assert.equal(result.status, 401);
    assert.equal(result.headers["access-control-allow-origin"], ORIGIN);
    assert.equal(result.headers["access-control-allow-credentials"], "true");
  }
  assert.equal(app.requests.size, 0);
});

test("missing-IP backup HTTP requests still require the token and consume an independent strict quota", async t => {
  const app = await serve(t);
  const denied = await app.call({ url: "/api/admin/backup" });
  assert.equal(denied.status, 401);
  const saved = await app.call({ url: "/api/admin/backup", token: BACKUP_TOKEN });
  assert.equal(saved.status, 200);
  const limited = await app.call({ url: "/api/admin/backup", token: BACKUP_TOKEN });
  assert.equal(limited.status, 429);
  for (const result of [denied, saved, limited]) assert.equal(result.headers["access-control-allow-origin"], undefined);
  assert.deepEqual([...app.backups], [["unidentified:backup", 3]]);
  assert.equal((await app.call({ method: "POST", token: "alice-1" })).status, 200);
  assert.equal(app.requests.get("member:alice"), 1);
});
