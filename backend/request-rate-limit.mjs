import { rateLimit } from "express-rate-limit";

const storeFailures = new WeakMap();
const SAFE_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AggregateError", "AbortError", "TimeoutError", "DatabaseError"]);
const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EPIPE", "EHOSTUNREACH", "ENETUNREACH"]);
const METHODS = new Set(["GET", "HEAD", "POST", "DELETE", "PUT", "PATCH", "OPTIONS", "CONNECT", "TRACE"]);

function safeErrorMetadata(error) {
  const name = SAFE_NAMES.has(error?.name) ? error.name : "Error";
  const code = typeof error?.code === "string" && (NETWORK_CODES.has(error.code) || /^(?:[0-9]{2}|XX)[0-9A-Z]{3}$/u.test(error.code)) ? error.code : undefined;
  return code ? { name, code } : { name };
}

function guardedStore(original) {
  if (!original || typeof original.increment !== "function") return original;
  // Forward the Store interface without mutating it. Methods must retain the
  // original receiver, including class stores that use private instance fields.
  const guarded = Object.create(Object.getPrototypeOf(original));
  Object.defineProperties(guarded, {
    prefix: { get: () => original.prefix },
    localKeys: { get: () => original.localKeys }
  });
  for (const method of ["init", "decrement", "resetKey", "resetAll", "get", "shutdown"]) {
    if (typeof original[method] === "function") guarded[method] = (...args) => original[method].apply(original, args);
  }
  guarded.increment = async (...args) => {
    try { return await original.increment.apply(original, args); }
    catch (error) {
      const failure = new Error("Rate limit store unavailable");
      storeFailures.set(failure, safeErrorMetadata(error));
      throw failure;
    }
  };
  return guarded;
}

export function createRequestRateLimit(options, { allowReadOnStoreError = false, onUnavailable, log = console } = {}) {
  const store = guardedStore(options.store);
  const limiter = rateLimit({ ...options, ...(store ? { store } : {}), passOnStoreError: false });
  const configuredPrefix = options.store?.prefix;
  const prefix = typeof configuredPrefix === "string" && /^[a-z][a-z0-9:_-]{0,79}$/u.test(configuredPrefix) ? configuredPrefix : "requests";
  const middleware = (req, res, next) => limiter(req, res, error => {
    if (!error) return next();
    const details = storeFailures.get(error);
    if (!details) return next(error);
    try {
      log.error("Rate limit store unavailable", { prefix, method: METHODS.has(req.method) ? req.method : "OTHER", ...details });
      if (allowReadOnStoreError === true && ["GET", "HEAD"].includes(req.method)) return next();
    } catch (failure) { return next(failure); }
    // A trusted-origin hook can add CORS before the global CORS middleware.
    return Promise.resolve().then(() => onUnavailable?.(req, res)).then(() => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "数据库暂时不可用，请稍后重试", code: "DATABASE_UNAVAILABLE" });
    }).catch(next);
  });
  middleware.resetKey = limiter.resetKey;
  middleware.getKey = limiter.getKey;
  return middleware;
}
