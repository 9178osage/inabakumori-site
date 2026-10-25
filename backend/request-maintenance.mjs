// Requests only schedule work. Keep one task per warm instance, and let Vercel
// retain that task explicitly instead of delaying an unrelated API response.
export function createRequestMaintenance({
  work,
  env = process.env,
  now = Date.now,
  intervalMs = 60 * 60 * 1000,
  retryMs = 60 * 1000,
  onBackgroundTask,
  log = console
} = {}) {
  if (typeof work !== "function" || typeof now !== "function") throw new TypeError("Maintenance requires work and clock functions");
  if (onBackgroundTask !== undefined && typeof onBackgroundTask !== "function") throw new TypeError("Maintenance background task hook must be a function");
  if (![intervalMs, retryMs].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError("Maintenance intervals must be positive safe integers");
  }
  let nextRunAt = 0;
  let pending;
  const report = (message, error) => {
    // Neither driver messages nor request details belong in background logs.
    // A broken logger must not turn a handled job failure into a rejection.
    try { log.error(message, { name: error?.name, code: error?.code }); } catch { /* keep requests independent */ }
  };
  return (_req, _res, next) => {
    if (env.COMMENTS_READ_ONLY !== "1" && !pending && now() >= nextRunAt) {
      pending = Promise.resolve().then(work).then(
        () => { nextRunAt = now() + intervalMs; },
        error => {
          nextRunAt = now() + retryMs;
          report("Request maintenance failed", error);
        }
      ).finally(() => { pending = undefined; });
      try { onBackgroundTask?.(pending); }
      catch (error) { report("Maintenance background task registration failed", error); }
    }
    return next();
  };
}
