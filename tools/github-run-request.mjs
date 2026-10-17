import { setTimeout as sleep } from "node:timers/promises";

const MAX_EPOCH = 8_640_000_000_000_000;
const COUNTERS = ["networkRequests", "revalidatedResponses", "retries"];
const ETAG = /^(?:W\/)?"[\x21\x23-\x7e]+"$/u;
const plain = value => value !== null && typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

function jsonValue(value, parents = new Set(), depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth > 100 || !value || typeof value !== "object" || parents.has(value)) return false;
  if (!Array.isArray(value) && !plain(value)) return false;
  parents.add(value);
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length && value.every(item => jsonValue(item, parents, depth + 1))
    : Object.values(value).every(item => jsonValue(item, parents, depth + 1));
  parents.delete(value);
  return valid;
}

export function validateGithubCache(cache, repo, token = "") {
  if (cache === undefined) return;
  if (!plain(cache) || cache.version !== 1 || cache.repo !== repo || !plain(cache.responses) ||
      Object.keys(cache).some(key => !["version", "repo", "responses", "cooldownUntil"].includes(key)) ||
      cache.cooldownUntil !== undefined && (!Number.isSafeInteger(cache.cooldownUntil) || cache.cooldownUntil < 0 || cache.cooldownUntil > MAX_EPOCH)) {
    throw new Error("Invalid GitHub response cache configuration");
  }
  for (const [endpoint, entry] of Object.entries(cache.responses)) {
    if (!validEndpoint(endpoint) || !plain(entry) || Object.keys(entry).some(key => !["etag", "data"].includes(key)) ||
        !Object.hasOwn(entry, "data") || typeof entry.etag !== "string" || entry.etag.length > 1024 ||
        !ETAG.test(entry.etag) || !jsonValue(entry.data)) throw new Error("Invalid GitHub cached response");
  }
  if (token && JSON.stringify(cache).includes(token)) throw new Error("Invalid GitHub cached response");
}

function validEndpoint(endpoint) {
  return typeof endpoint === "string" && endpoint.length <= 2048 &&
    (/^\/[1-9]\d*$/u.test(endpoint) || /^\?[^\s#\\]*$/u.test(endpoint));
}

function header(response, name) {
  const source = response.headers;
  if (source === undefined || source === null) return null;
  let value;
  try {
    if (typeof source.get === "function") value = source.get(name);
    else if (plain(source)) value = Object.entries(source).find(([key]) => key.toLowerCase() === name)?.[1];
    else throw new Error();
  } catch { throw new Error("Invalid GitHub response headers"); }
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 2048 || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new Error("Invalid GitHub response headers");
  }
  return value.trim();
}

function rateDetails(response, time) {
  const remaining = header(response, "x-ratelimit-remaining");
  const reset = header(response, "x-ratelimit-reset");
  const retryAfter = header(response, "retry-after");
  let resetAt = null;
  let retryAt = null;
  if (remaining !== null && (!/^\d+$/u.test(remaining) || !Number.isSafeInteger(Number(remaining))) ||
      reset !== null && !/^\d+$/u.test(reset)) {
    throw new Error("Invalid GitHub rate-limit headers");
  }
  if (reset !== null) {
    resetAt = Number(reset) * 1000;
    if (!Number.isSafeInteger(resetAt) || resetAt > MAX_EPOCH) throw new Error("Invalid GitHub rate-limit headers");
  }
  if (retryAfter !== null) {
    if (/^\d+$/u.test(retryAfter)) retryAt = time + Number(retryAfter) * 1000;
    else if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(retryAfter)) retryAt = Date.parse(retryAfter);
    if (!Number.isSafeInteger(retryAt) || retryAt < 0 || retryAt > MAX_EPOCH) throw new Error("Invalid GitHub Retry-After header");
  }
  return { exhausted: remaining !== null && Number(remaining) === 0, resetAt, retryAt };
}

function rateMessage(rate) {
  const details = [];
  if (rate.resetAt !== null) details.push(`rate limit resets at ${new Date(rate.resetAt).toISOString()}`);
  if (rate.retryAt !== null) details.push(`Retry-After until ${new Date(rate.retryAt).toISOString()}`);
  return details.length ? `; ${details.join("; ")}` : "";
}

class RequestError extends Error {
  constructor(message, kind, status = null, rate = null) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.rate = rate;
  }
}

function authAdvice(token) {
  return token ? "; check the configured GH_TOKEN/GITHUB_TOKEN permissions" :
    "; use a configured GH_TOKEN or GITHUB_TOKEN for authenticated GitHub requests";
}

async function attempt(endpoint, label, options) {
  const { fetchImpl, repo, token, deadlineMs, cache, stats, now } = options;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RequestError(`${label}: GitHub request timed out`, "timeout"));
    }, deadlineMs);
  });
  const request = (async () => {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const cached = cache?.responses[endpoint];
    if (cached) headers["If-None-Match"] = cached.etag;
    let response;
    stats.networkRequests++;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${repo}/actions/runs${endpoint}`, {
        headers, signal: controller.signal, redirect: "error"
      });
    } catch { throw new RequestError(`${label}: GitHub request failed (network)`, "network"); }
    if (controller.signal.aborted) throw new RequestError(`${label}: GitHub request timed out`, "timeout");
    if (!response || !Number.isInteger(response.status)) throw new RequestError(`${label}: invalid GitHub response`, "invalid");
    const rate = rateDetails(response, now());
    if (!token && cache) {
      const until = Math.max(rate.exhausted ? rate.resetAt ?? 0 : 0, rate.retryAt ?? 0);
      if (until > now()) cache.cooldownUntil = Math.max(cache.cooldownUntil ?? 0, until);
    }
    if (response.status === 304) {
      const etag = header(response, "etag");
      if (!cached || etag !== null && (!ETAG.test(etag) || etag.replace(/^W\//u, "") !== cached.etag.replace(/^W\//u, ""))) {
        throw new RequestError(`${label}: invalid GitHub 304 cache revalidation`, "invalid");
      }
      stats.revalidatedResponses++;
      return structuredClone(cached.data);
    }
    if (response.status !== 200 || response.ok !== true) {
      // No error body is read or retained, including rate-limit responses.
      try { response.body?.cancel?.()?.catch?.(() => {}); } catch { /* best-effort socket cleanup */ }
      throw new RequestError(`${label}: GitHub HTTP ${response.status}${rateMessage(rate)}${authAdvice(token)}`, "http", response.status, rate);
    }
    const type = header(response, "content-type");
    if (type !== null && !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/iu.test(type)) {
      throw new RequestError(`${label}: invalid GitHub JSON content type`, "invalid");
    }
    let data;
    try { data = await response.json(); } catch { throw new RequestError(`${label}: invalid GitHub JSON`, "invalid"); }
    if (controller.signal.aborted) throw new RequestError(`${label}: GitHub request timed out`, "timeout");
    if (!jsonValue(data)) throw new RequestError(`${label}: invalid GitHub JSON`, "invalid");
    if (cache) {
      const etag = header(response, "etag");
      if (etag !== null && etag.length <= 1024 && ETAG.test(etag) &&
          !(token && (etag.includes(token) || JSON.stringify(data).includes(token)))) cache.responses[endpoint] = { etag, data: structuredClone(data) };
      else delete cache.responses[endpoint];
    }
    return data;
  })();
  try { return await Promise.race([request, timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}

// Cache entries only return after this request gets HTTP 304. Errors never fall
// back to disk data, and retries remain bounded by both count and wait duration.
export async function requestGithubJson(endpoint, label, {
  fetchImpl = globalThis.fetch, repo, token = "", deadlineMs = 12_000, cache, stats = {},
  maxRetries = 2, retryBaseMs = 250, maxRetryWaitMs = 2000, now = Date.now, sleepImpl = sleep
} = {}) {
  if (!validEndpoint(endpoint) || typeof label !== "string" || !label || label.length > 120 || /[\r\n]/u.test(label) ||
      typeof repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo) ||
      typeof token !== "string" || /[\x00-\x1f\x7f]/u.test(token) || typeof fetchImpl !== "function" ||
      !Number.isFinite(deadlineMs) || deadlineMs <= 0 || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5 ||
      !Number.isFinite(retryBaseMs) || retryBaseMs < 0 || !Number.isFinite(maxRetryWaitMs) || maxRetryWaitMs < 0 ||
      typeof now !== "function" || typeof sleepImpl !== "function" || !plain(stats)) throw new Error("Invalid GitHub request configuration");
  token = token.trim();
  if (token) label = label.replaceAll(token, "[redacted]");
  const time = now();
  if (!Number.isSafeInteger(time) || time < 0 || time > MAX_EPOCH) throw new Error("Invalid GitHub clock configuration");
  validateGithubCache(cache, repo, token);
  for (const key of COUNTERS) {
    if (stats[key] === undefined) stats[key] = 0;
    else if (!Number.isSafeInteger(stats[key]) || stats[key] < 0) throw new Error("Invalid GitHub request statistics");
  }
  if (!token && cache?.cooldownUntil > time) {
    throw new Error(`${label}: GitHub anonymous rate-limit cooldown until ${new Date(cache.cooldownUntil).toISOString()}${authAdvice(token)}`);
  }
  const options = { fetchImpl, repo, token, deadlineMs, cache, stats, now };
  for (let retries = 0; ; retries++) {
    try { return await attempt(endpoint, label, options); }
    catch (error) {
      const transient = ["network", "timeout"].includes(error.kind) || error.kind === "http" && error.status >= 500 && error.status <= 599;
      const rateLimited = error.kind === "http" && [403, 429].includes(error.status) && error.rate.retryAt !== null;
      // A bare 403 is a permission failure. A secondary limit without Retry-After
      // needs at least a minute, beyond this helper's short retry budget.
      if (retries >= maxRetries || !transient && !rateLimited || error.rate?.exhausted) throw error;
      const wait = Math.max(retryBaseMs * 2 ** retries, error.rate?.retryAt !== null && error.rate?.retryAt !== undefined ? Math.max(0, error.rate.retryAt - now()) : 0);
      if (!Number.isFinite(wait) || wait > maxRetryWaitMs) throw error;
      try { await sleepImpl(wait); } catch { throw new Error(`${label}: GitHub retry wait failed`); }
      stats.retries++;
    }
  }
}
