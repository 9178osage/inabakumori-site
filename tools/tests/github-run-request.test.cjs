const test = require("node:test");
const assert = require("node:assert/strict");

const repo = "9178osage/inabakumori-site";
const endpoint = "/101";
const load = () => import("../github-run-request.mjs");
const cacheFor = () => ({ version: 1, repo, responses: {} });
const response = (status, data = {}, headers = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: new Headers(headers), json: async () => data });
const fast = { repo, maxRetries: 2, retryBaseMs: 0, sleepImpl: async () => {} };

test("200 stores only JSON and ETag; 304 requires online revalidation of that endpoint", async () => {
  const { requestGithubJson } = await load();
  const cache = cacheFor();
  const stats = {};
  const seen = [];
  const options = { ...fast, cache, stats, token: "synthetic-token", fetchImpl: async (_url, options) => {
    seen.push(options);
    return seen.length === 1 ? response(200, { id: 101 }, { ETag: '"v1"', "Content-Type": "application/json" }) : response(304, null, { ETag: 'W/"v1"' });
  } };
  const first = await requestGithubJson(endpoint, "Run 101", options);
  first.id = 999;
  assert.deepEqual(await requestGithubJson(endpoint, "Run 101", options), { id: 101 });
  assert.equal(seen[0].headers.Authorization, "Bearer synthetic-token");
  assert.equal(seen[1].headers["If-None-Match"], '"v1"');
  assert.equal(JSON.stringify(cache).includes("synthetic-token"), false);
  assert.deepEqual(stats, { networkRequests: 2, revalidatedResponses: 1, retries: 0 });
});

test("304 without a valid matching cache fails, and a different endpoint never reuses data", async () => {
  const { requestGithubJson } = await load();
  for (const cache of [undefined, cacheFor(), { version: 1, repo, responses: { "/102": { etag: '"v1"', data: { id: 102 } } } }]) {
    await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, cache, fetchImpl: async () => response(304) }), /invalid GitHub 304/u);
  }
  const cache = cacheFor();
  cache.responses[endpoint] = { etag: '"v1"', data: { id: 101 } };
  for (const etag of ['"v2"', "broken"]) {
    await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, cache, fetchImpl: async () => response(304, null, { ETag: etag }) }), /invalid GitHub 304/u);
  }
});

test("network, timeout and 5xx retries are bounded and never fall back to cached data", async () => {
  const { requestGithubJson } = await load();
  for (const failure of [async () => { throw new Error("private body/token"); }, async () => response(503)]) {
    const cache = cacheFor();
    cache.responses[endpoint] = { etag: '"old"', data: { stale: true } };
    const stats = {};
    await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, cache, stats, fetchImpl: failure }), /network|HTTP 503/u);
    assert.deepEqual(stats, { networkRequests: 3, revalidatedResponses: 0, retries: 2 });
    assert.deepEqual(cache.responses[endpoint].data, { stale: true });
  }
  const stats = {};
  await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, stats, deadlineMs: 10, fetchImpl: async () => new Promise(() => {}) }), /timed out/u);
  assert.equal(stats.networkRequests, 3);
  assert.equal(stats.retries, 2);
});

test("the deadline covers JSON parsing, while malformed JSON and non-200 responses never read or return cached JSON", async () => {
  const { requestGithubJson } = await load();
  await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, maxRetries: 0, deadlineMs: 10,
    fetchImpl: async () => ({ ...response(200), json: async () => new Promise(() => {}) }) }), /timed out/u);
  for (const status of [204, 403, 404, 429]) {
    let reads = 0;
    const stats = {};
    await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, stats,
      fetchImpl: async () => ({ ...response(status), json: async () => { reads++; return {}; } }) }), new RegExp(`HTTP ${status}`));
    assert.equal(reads, 0);
    assert.equal(stats.networkRequests, 1);
  }
  for (const fetchImpl of [
    async () => ({ ...response(200), json: async () => { throw new SyntaxError("private response"); } }),
    async () => response(200, { id: NaN }), async () => response(200, {}, { "Content-Type": "text/html" })
  ]) await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, fetchImpl }), /invalid GitHub JSON/u);
});

test("anonymous exhausted quota saves reset cooldown and stops future calls without network; tokens bypass it", async () => {
  const { requestGithubJson } = await load();
  const time = Date.parse("2026-10-17T10:00:00Z");
  const cache = cacheFor();
  let calls = 0;
  const options = { ...fast, cache, now: () => time, fetchImpl: async () => { calls++; return response(403, null, {
    "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String((time + 60_000) / 1000)
  }); } };
  await assert.rejects(requestGithubJson(endpoint, "Run 101", options), /HTTP 403.*2026-10-17T10:01:00.000Z.*GH_TOKEN/u);
  assert.equal(cache.cooldownUntil, time + 60_000);
  await assert.rejects(requestGithubJson(endpoint, "Run 101", options), /anonymous rate-limit cooldown until 2026-10-17T10:01:00.000Z/u);
  assert.equal(calls, 1);
  assert.deepEqual(await requestGithubJson(endpoint, "Run 101", { ...options, token: "synthetic-token", fetchImpl: async () => response(200, { live: true }) }), { live: true });
});

test("short Retry-After limits retry with required waits; long waits and ordinary permission failures do not retry", async () => {
  const { requestGithubJson } = await load();
  for (const status of [403, 429]) {
    let time = Date.parse("2026-10-17T10:00:00Z");
    let calls = 0;
    const waits = [];
    const stats = {};
    const cache = cacheFor();
    assert.deepEqual(await requestGithubJson(endpoint, "Run 101", { ...fast, cache, stats, now: () => time,
      retryBaseMs: 250, sleepImpl: async ms => { waits.push(ms); time += ms; },
      fetchImpl: async () => ++calls === 1 ? response(status, null, { "Retry-After": "1", "X-RateLimit-Remaining": "12" }) : response(200, { live: true })
    }), { live: true });
    assert.deepEqual(waits, [1000]);
    assert.deepEqual(stats, { networkRequests: 2, revalidatedResponses: 0, retries: 1 });
  }
  for (const headers of [{ "Retry-After": "60" }, { "X-RateLimit-Remaining": "12" }, {}]) {
    let calls = 0;
    await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, fetchImpl: async () => { calls++; return response(403, null, headers); } }), /HTTP 403/u);
    assert.equal(calls, 1);
  }
});

test("Retry-After HTTP dates are honored, authenticated calls do not persist anonymous cooldown", async () => {
  const { requestGithubJson } = await load();
  const time = Date.parse("2026-10-17T10:00:00Z");
  const cache = cacheFor();
  await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, cache, maxRetries: 0, now: () => time,
    fetchImpl: async () => response(429, null, { "Retry-After": new Date(time + 60_000).toUTCString() }) }), /HTTP 429.*Retry-After until 2026-10-17T10:01:00.000Z/u);
  assert.equal(cache.cooldownUntil, time + 60_000);
  const authenticated = cacheFor();
  await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, cache: authenticated, token: "synthetic-token", now: () => time,
    fetchImpl: async () => response(429, null, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String((time + 60_000) / 1000) }) }), /HTTP 429/u);
  assert.equal(authenticated.cooldownUntil, undefined);
});

test("cache shapes, header values and request statistics are validated without exposing their contents", async () => {
  const { requestGithubJson } = await load();
  const circular = {}; circular.self = circular;
  for (const cache of [{}, { version: 1, repo: "other/repo", responses: {} }, { ...cacheFor(), token: "must-not-print" },
    { ...cacheFor(), cooldownUntil: NaN }, { ...cacheFor(), responses: { [endpoint]: { etag: "invalid", data: {} } } },
    { ...cacheFor(), responses: { [endpoint]: { etag: '""', data: {} } } },
    { ...cacheFor(), responses: { [endpoint]: { etag: '"v1"', data: circular } } }]) {
    const error = await requestGithubJson(endpoint, "Run 101", { ...fast, cache, fetchImpl: async () => { throw new Error("should not fetch"); } }).catch(error => error);
    assert.match(error.message, /Invalid GitHub.*cache|Invalid GitHub cached response/u);
    assert.doesNotMatch(error.message, /must-not-print|should not fetch/u);
  }
  for (const headers of [{ "retry-after": "private-invalid-value" }, { "x-ratelimit-reset": "NaN" }, { "x-ratelimit-remaining": "-1" }, { "retry-after": "bad\r\nvalue" }]) {
    await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast,
      fetchImpl: async () => ({ ...response(429), headers }) }), /Invalid GitHub/u);
  }
  await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, stats: { retries: -1 } }), /statistics/u);
});

test("a timed-out response cannot mutate cache later, and tokens echoed by a response are never cached", async () => {
  const { requestGithubJson } = await load();
  const cache = cacheFor();
  let finish;
  await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, cache, maxRetries: 0, deadlineMs: 10,
    fetchImpl: async () => ({ ...response(200, {}, { ETag: '"v1"' }), json: async () => new Promise(resolve => { finish = resolve; }) }) }), /timed out/u);
  finish({ late: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(cache.responses, {});
  await requestGithubJson(endpoint, "Run 101", { ...fast, cache, token: "synthetic-token",
    fetchImpl: async () => response(200, { unexpected: "synthetic-token" }, { ETag: '"v1"' }) });
  assert.deepEqual(cache.responses, {});
});

test("transient recovery waits with bounded exponential backoff and cancels each completed attempt", async () => {
  const { requestGithubJson } = await load();
  const waits = [];
  const signals = [];
  const stats = {};
  let calls = 0;
  assert.deepEqual(await requestGithubJson(endpoint, "Run 101", { ...fast, stats, retryBaseMs: 250,
    sleepImpl: async ms => waits.push(ms), fetchImpl: async (_url, options) => {
      signals.push(options.signal);
      if (++calls === 1) throw new Error("private network failure");
      return calls === 2 ? response(502) : response(200, { current: true });
    } }), { current: true });
  assert.deepEqual(waits, [250, 500]);
  assert.ok(signals.every(signal => signal.aborted));
  assert.deepEqual(stats, { networkRequests: 3, revalidatedResponses: 0, retries: 2 });
});

test("successful online responses clear only expired cooldowns; future limits and failed requests retain them", async () => {
  const { requestGithubJson } = await load();
  const time = Date.parse("2026-10-17T10:00:00Z");
  for (const [status, until] of [[200, time - 1], [304, time]]) {
    const cache = { ...cacheFor(), cooldownUntil: until };
    if (status === 304) cache.responses[endpoint] = { etag: '"v1"', data: { current: true } };
    assert.deepEqual(await requestGithubJson(endpoint, "Run 101", { ...fast, cache, now: () => time,
      fetchImpl: async () => response(status, { current: true }) }), { current: true });
    assert.equal(Object.hasOwn(cache, "cooldownUntil"), false, `HTTP ${status} clears expired marker`);
  }
  for (const status of [200, 304]) {
    const cache = { ...cacheFor(), cooldownUntil: time + 60_000 };
    if (status === 304) cache.responses[endpoint] = { etag: '"v1"', data: { current: true } };
    await requestGithubJson(endpoint, "Run 101", { ...fast, cache, token: "synthetic-token", now: () => time,
      fetchImpl: async () => response(status, { current: true }) });
    assert.equal(cache.cooldownUntil, time + 60_000, "authenticated success cannot clear a future anonymous limit");
  }
  const newlyLimited = { ...cacheFor(), cooldownUntil: time - 1 };
  await requestGithubJson(endpoint, "Run 101", { ...fast, cache: newlyLimited, now: () => time,
    fetchImpl: async () => response(200, { current: true }, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String((time + 60_000) / 1000) }) });
  assert.equal(newlyLimited.cooldownUntil, time + 60_000, "the successful response's new future limit survives");
  for (const fetchImpl of [async () => response(503), async () => { throw new Error("synthetic network failure"); }, async () => new Promise(() => {})]) {
    const cache = { ...cacheFor(), cooldownUntil: time };
    await assert.rejects(requestGithubJson(endpoint, "Run 101", { ...fast, cache, maxRetries: 0, deadlineMs: 10, now: () => time, fetchImpl }));
    assert.equal(cache.cooldownUntil, time, "failed and timed-out requests preserve the existing marker");
  }
});
