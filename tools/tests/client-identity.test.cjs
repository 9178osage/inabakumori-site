const test = require("node:test");
const assert = require("node:assert/strict");

async function harness({ ip = "0.0.0.0", verify, onUnavailable } = {}) {
  const { createClientIdentity } = await import("../../backend/client-identity.mjs");
  const { isBackupPath } = await import("../../backend/backup-endpoint.mjs");
  let checks = 0;
  const middleware = createClientIdentity({
    clientIp: () => ip,
    isBackupPath,
    onUnavailable,
    verifySession(options) {
      assert.deepEqual(options, { sessionRequired: false });
      return (req, res, next) => {
        checks++;
        if (verify) return verify(req, res, next);
        req.session = undefined;
        return next();
      };
    }
  });
  return {
    get checks() { return checks; },
    request(extra = {}) {
      const req = { method: "GET", url: "/api/comments", ...extra };
      const headers = {};
      return new Promise((resolve, reject) => {
        const res = {
          setHeader(name, value) { headers[name.toLowerCase()] = value; },
          status(status) { this.statusCode = status; return this; },
          json(body) { resolve({ req, headers, status: this.statusCode, body }); return this; }
        };
        try {
          Promise.resolve(middleware(req, res, error => resolve({ req, headers, error, next: true }))).catch(reject);
        } catch (error) { reject(error); }
      });
    }
  };
}

test("missing-IP members use verified user identities across distinct sessions", async () => {
  const app = await harness({ verify(req, _res, next) {
    req.session = { getUserId: () => req.verifiedUser };
    next();
  } });
  const first = await app.request({ method: "POST", verifiedUser: "alice", sessionHandle: "session-1" });
  const same = await app.request({ method: "POST", verifiedUser: "alice", sessionHandle: "session-2" });
  const other = await app.request({ method: "DELETE", verifiedUser: "bob" });
  assert.equal(first.req.clientRateLimitKey, "member:alice");
  assert.equal(same.req.clientRateLimitKey, first.req.clientRateLimitKey);
  assert.equal(other.req.clientRateLimitKey, "member:bob");
  assert.ok([first, same, other].every(result => result.next && !result.req.skipIpRateLimits));
  assert.equal(app.checks, 3);
});

test("unverified session claims and verification errors never create a member bucket", async () => {
  const failure = new Error("invalid signature");
  const app = await harness({ verify(req, _res, next) {
    assert.equal(req.session, undefined, "pre-existing session objects are discarded");
    next(failure);
  } });
  const result = await app.request({ session: { getUserId: () => "forged" }, headers: { authorization: "Bearer forged" } });
  assert.equal(result.error, failure);
  assert.equal(result.req.clientRateLimitKey, undefined);
  assert.equal(result.req.skipIpRateLimits, false);
});

test("anonymous reads skip only IP limits while writes fail with a retryable 503", async () => {
  const app = await harness();
  for (const method of ["GET", "HEAD"]) {
    const result = await app.request({ method });
    assert.equal(result.next, true, "downstream permission checks still run");
    assert.equal(result.req.skipIpRateLimits, true);
    assert.equal(result.req.clientRateLimitKey, undefined);
  }
  for (const method of ["POST", "DELETE"]) {
    const result = await app.request({ method });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "CLIENT_IDENTITY_UNAVAILABLE");
    assert.equal(result.headers["retry-after"], "5");
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(result.next, undefined);
  }
});

test("missing-IP preflights reach the existing CORS policy except for the private backup path", async () => {
  const app = await harness();
  for (const url of ["/api/comments", "/auth/signin", "/auth/session/refresh"]) {
    const result = await app.request({ method: "OPTIONS", url });
    assert.equal(result.next, true);
    assert.equal(result.req.skipIpRateLimits, true);
    assert.equal(result.req.clientRateLimitKey, undefined);
  }
  const backup = await app.request({ method: "OPTIONS", url: "/api/admin/backup" });
  assert.equal(backup.req.skipIpRateLimits, false);
  assert.equal(backup.req.clientRateLimitKey, "unidentified:backup");
  assert.equal(app.checks, 0);
});

test("missing-IP auth paths fail before session handling and backup retains its own quota identity", async () => {
  const app = await harness();
  for (const url of ["/auth", "/auth/signin", "//AUTH/session/refresh", "/outside/%2e%2e/auth/signin"]) {
    assert.equal((await app.request({ url, method: "POST" })).status, 503);
  }
  const backup = await app.request({ url: "/api/admin/backup" });
  assert.equal(backup.req.clientRateLimitKey, "unidentified:backup");
  assert.equal(backup.req.skipIpRateLimits, false);
  assert.equal(backup.next, true, "downstream token and backup quota checks still run");
  assert.equal(app.checks, 0);
});

test("real IPs ignore account claims and preserve the existing IPv6 subnet grouping", async () => {
  const ipv4 = await harness({ ip: "198.51.100.7" });
  const result = await ipv4.request({ session: { getUserId: () => "forged" } });
  assert.equal(result.req.clientRateLimitKey, "198.51.100.7");
  assert.equal(ipv4.checks, 0);
  const first = await harness({ ip: "2001:db8:1234:5600::1" });
  const second = await harness({ ip: "2001:db8:1234:5678::2" });
  const firstResult = await first.request();
  assert.equal(firstResult.req.clientRateLimitKey, (await second.request()).req.clientRateLimitKey);
  assert.equal(firstResult.req.clientRateLimitKey, "2001:db8:1234:5600::/56");
});

test("synchronous failures, rejected verification and unavailable hooks reach the error handler", async () => {
  const failure = new Error("verification failed");
  for (const verify of [() => { throw failure; }, () => Promise.reject(failure)]) {
    const app = await harness({ verify });
    assert.equal((await app.request()).error, failure);
  }
  const calls = [];
  const app = await harness({ onUnavailable(req, res) {
    calls.push(req.method);
    res.setHeader("Access-Control-Allow-Origin", "https://trusted.example");
  } });
  const result = await app.request({ method: "POST" });
  assert.equal(result.headers["access-control-allow-origin"], "https://trusted.example");
  assert.deepEqual(calls, ["POST"]);
  const broken = await harness({ onUnavailable: () => Promise.reject(failure) });
  assert.equal((await broken.request({ method: "POST" })).error, failure);
});
