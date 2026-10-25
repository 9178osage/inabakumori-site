const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("../../backend/node_modules/express");

const PRIVATE = "postgresql://private-user:synthetic-private-password@private-host/db";

function counterStore({ offline = false } = {}) {
  const counts = new Map();
  const store = {
    prefix: "requests",
    localKeys: false,
    init(options) { assert.equal(this, store); this.windowMs = options.windowMs; },
    async increment(key) {
      assert.equal(this, store);
      if (offline) throw Object.assign(new Error(PRIVATE), { code: "ECONNREFUSED", cause: PRIVATE });
      const totalHits = (counts.get(key) || 0) + 1;
      counts.set(key, totalHits);
      return { totalHits, resetTime: new Date(Date.now() + this.windowMs) };
    },
    async decrement(key) { assert.equal(this, store); counts.set(key, Math.max(0, (counts.get(key) || 0) - 1)); },
    async resetKey(key) { assert.equal(this, store); counts.delete(key); },
    async get(key) { assert.equal(this, store); return { totalHits: counts.get(key) || 0 }; }
  };
  return { store, counts };
}

async function serve(t, { store, options = {}, policy = {}, requireSession = false, unidentified = false } = {}) {
  const { createRequestRateLimit } = await import("../../backend/request-rate-limit.mjs");
  const app = express();
  const logs = [];
  const errors = [];
  let handlers = 0;
  if (unidentified) app.use((req, _res, next) => { req.skipIpRateLimits = true; next(); });
  const limiter = createRequestRateLimit({ store, windowMs: 60_000, limit: 2, keyGenerator: () => "visitor", validate: false, ...options },
    { log: { error: (...args) => logs.push(args) }, ...policy });
  app.use(limiter);
  if (requireSession) app.use((_req, res) => res.status(401).json({ code: "UNAUTHORIZED" }));
  app.use((_req, res) => { handlers++; res.json({ ok: true }); });
  app.use((error, _req, res, _next) => { errors.push(error); res.status(500).json({ code: "INTERNAL_ERROR" }); });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(listening));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    logs, errors, limiter,
    get handlers() { return handlers; },
    request(method = "GET", origin) {
      return new Promise((resolve, reject) => {
        const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: "/api/comments", method, headers: origin ? { Origin: origin } : {} }, res => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", chunk => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on("error", reject);
        req.end();
      });
    }
  };
}

test("only failed store reads pass through GET/HEAD; writes and preflights return private 503 without reaching handlers", async t => {
  const { store } = counterStore({ offline: true });
  const originalIncrement = store.increment;
  const app = await serve(t, { store, options: { passOnStoreError: true }, policy: { allowReadOnStoreError: true } });
  for (const method of ["GET", "HEAD"]) {
    const response = await app.request(method);
    assert.equal(response.status, 200);
    assert.equal(response.headers["retry-after"], undefined);
  }
  assert.equal(app.handlers, 2);
  for (const method of ["POST", "DELETE", "OPTIONS"]) {
    const response = await app.request(method);
    assert.equal(response.status, 503);
    assert.equal(response.headers["retry-after"], "5");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(response.body), { error: "数据库暂时不可用，请稍后重试", code: "DATABASE_UNAVAILABLE" });
  }
  assert.equal(app.handlers, 2, "no mutating route runs while the counter store is unavailable");
  assert.equal(app.errors.length, 0);
  assert.equal(store.increment, originalIncrement, "the original store remains unchanged");
  await assert.rejects(store.increment("visitor"), error => error.message === PRIVATE);
  assert.equal(app.logs.length, 5);
  assert.deepEqual(app.logs[0], ["Rate limit store unavailable", { prefix: "requests", method: "GET", name: "Error", code: "ECONNREFUSED" }]);
  assert.doesNotMatch(JSON.stringify(app.logs), /private-user|synthetic-private-password|private-host|postgresql|cause|stack/u);
});

test("read-through cannot bypass a downstream session check and strict backup limiters never open", async t => {
  const protectedApp = await serve(t, { store: counterStore({ offline: true }).store, policy: { allowReadOnStoreError: true }, requireSession: true });
  for (const method of ["GET", "HEAD"]) assert.equal((await protectedApp.request(method)).status, 401);
  assert.equal(protectedApp.handlers, 0);
  const backup = await serve(t, { store: counterStore({ offline: true }).store });
  for (const method of ["GET", "HEAD", "POST"]) {
    const response = await backup.request(method);
    assert.equal(response.status, 503);
    assert.equal(response.headers["retry-after"], "5");
  }
  assert.equal(backup.handlers, 0);
});

test("working stores keep one shared method-independent quota, enforce 429 and preserve original method receivers", async t => {
  const { store, counts } = counterStore();
  const app = await serve(t, { store, policy: { allowReadOnStoreError: true } });
  assert.equal((await app.request("GET")).status, 200);
  assert.equal((await app.request("POST")).status, 200);
  assert.equal((await app.request("HEAD")).status, 429);
  assert.equal(counts.get("visitor"), 3);
  assert.equal(app.handlers, 2);
  assert.equal(app.logs.length, 0);
  assert.deepEqual(await app.limiter.getKey("visitor"), { totalHits: 3 });
  await app.limiter.resetKey("visitor");
  assert.equal(counts.has("visitor"), false);
});

test("the default in-memory store preserves the same GET/POST quota used with local SQLite", async t => {
  const app = await serve(t, { policy: { allowReadOnStoreError: true } });
  assert.equal((await app.request("GET")).status, 200);
  assert.equal((await app.request("POST")).status, 200);
  assert.equal((await app.request("GET")).status, 429);
  assert.equal(app.handlers, 2);
  assert.deepEqual(app.logs, []);
});

test("class stores retain private-field receivers through initialization and every forwarded method", async t => {
  class PrivateStore {
    prefix = "private_store";
    localKeys = true;
    #count = 0;
    #window;
    init(options) { this.#window = options.windowMs; }
    async increment() { return { totalHits: ++this.#count, resetTime: new Date(Date.now() + this.#window) }; }
    async decrement() { this.#count--; }
    async resetKey() { this.#count = 0; }
    async get() { return { totalHits: this.#count }; }
  }
  const app = await serve(t, { store: new PrivateStore() });
  assert.equal((await app.request()).status, 200);
  assert.deepEqual(await app.limiter.getKey("visitor"), { totalHits: 1 });
  await app.limiter.resetKey("visitor");
  assert.deepEqual(await app.limiter.getKey("visitor"), { totalHits: 0 });
  assert.deepEqual(app.errors, []);
});

test("unidentified reads and preflights avoid shared quotas while a skip flag never exempts writes", async t => {
  const { store, counts } = counterStore();
  const app = await serve(t, { store, unidentified: true });
  for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal((await app.request(method)).status, 200);
  assert.equal(counts.size, 0);
  assert.equal((await app.request("POST")).status, 200);
  assert.equal((await app.request("POST")).status, 200);
  assert.equal((await app.request("POST")).status, 429);
});

test("key, limit and normal 429 handler errors are forwarded and never mistaken for store failures", async t => {
  for (const option of ["keyGenerator", "limit", "handler"]) {
    const failure = new Error(`synthetic ${option} failure`);
    const options = { [option]: () => { throw failure; } };
    if (option === "handler") options.limit = 0;
    const app = await serve(t, { store: counterStore().store, options, policy: { allowReadOnStoreError: true } });
    assert.equal((await app.request("GET")).status, 500, option);
    assert.equal(app.handlers, 0);
    assert.deepEqual(app.errors, [failure]);
    assert.deepEqual(app.logs, []);
  }
});

test("unavailable hooks expose trusted-origin CORS only and hook failures remain closed", async t => {
  const app = await serve(t, {
    store: counterStore({ offline: true }).store,
    policy: { allowReadOnStoreError: true, onUnavailable(req, res) {
      if (req.get("origin") === "https://trusted.example") {
        res.setHeader("Access-Control-Allow-Origin", req.get("origin"));
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.vary("Origin");
      }
    } }
  });
  const trusted = await app.request("POST", "https://trusted.example");
  assert.equal(trusted.status, 503);
  assert.equal(trusted.headers["access-control-allow-origin"], "https://trusted.example");
  assert.equal(trusted.headers["access-control-allow-credentials"], "true");
  assert.equal(trusted.headers.vary, "Origin");
  const untrusted = await app.request("POST", "https://untrusted.example");
  assert.equal(untrusted.status, 503);
  assert.equal(untrusted.headers["access-control-allow-origin"], undefined);
  const failure = new Error("synthetic hook failure");
  const broken = await serve(t, { store: counterStore({ offline: true }).store, policy: { onUnavailable() { throw failure; } } });
  assert.equal((await broken.request("POST")).status, 500);
  assert.equal(broken.handlers, 0);
  assert.deepEqual(broken.errors, [failure]);
});

test("unsafe driver name/code metadata cannot leak into store outage logs", async t => {
  const { store } = counterStore();
  store.increment = async () => { throw { name: PRIVATE, code: PRIVATE, message: PRIVATE, cause: PRIVATE, stack: PRIVATE }; };
  const app = await serve(t, { store });
  assert.equal((await app.request()).status, 503);
  assert.deepEqual(app.logs, [["Rate limit store unavailable", { prefix: "requests", method: "GET", name: "Error" }]]);
  assert.doesNotMatch(JSON.stringify(app.logs), /private|postgresql|cause|stack/u);
});
