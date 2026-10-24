import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const NOW_MS = "(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint";
const requestContext = new AsyncLocalStorage();

// Keep the window that each request incremented until its finish/close handler
// runs. It can then refund only that exact window, even after a long suspension.
export function withRateLimitRequestContext(_req, _res, next) {
  return requestContext.run(new Map(), next);
}

// PostgreSQL is the authority for both the clock and counter. One UPSERT holds
// the row lock through expiry reset and increment, across all Vercel instances.
const INCREMENT = `WITH request_clock AS MATERIALIZED (SELECT ${NOW_MS} AS now_ms)
  INSERT INTO rate_limit_counters (prefix, key_hash, total_hits, reset_at)
  SELECT ?, ?, 1, now_ms + ? FROM request_clock WHERE true
  ON CONFLICT (prefix, key_hash) DO UPDATE SET
    total_hits = CASE WHEN rate_limit_counters.reset_at <= (SELECT now_ms FROM request_clock)
      THEN 1 ELSE rate_limit_counters.total_hits + 1 END,
    reset_at = CASE WHEN rate_limit_counters.reset_at <= (SELECT now_ms FROM request_clock)
      THEN (SELECT now_ms FROM request_clock) + ? ELSE rate_limit_counters.reset_at END
  RETURNING total_hits, reset_at`;

export function createPostgresRateLimitStore(db, { prefix, windowMs, onBackgroundTask } = {}) {
  if (db?.kind !== "postgres") throw new Error("Shared rate limiting requires a PostgreSQL database");
  if (typeof prefix !== "string" || !/^[a-z][a-z0-9:_-]{0,79}$/u.test(prefix)) throw new Error("Rate limit store requires a unique prefix");
  if (onBackgroundTask !== undefined && typeof onBackgroundTask !== "function") throw new Error("onBackgroundTask must be a function");
  let interval = windowMs;
  const validateWindow = value => {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Rate limit windowMs must be a positive safe integer");
    return value;
  };
  if (interval !== undefined) validateWindow(interval);
  const hash = key => createHash("sha256").update(String(key)).digest("hex");
  const information = row => {
    if (!row) return undefined;
    const totalHits = Number(row.total_hits);
    const resetAt = Number(row.reset_at);
    if (!Number.isSafeInteger(totalHits) || totalHits < 0 || !Number.isSafeInteger(resetAt) || Number.isNaN(new Date(resetAt).getTime())) {
      throw new Error("Invalid shared rate limit counter");
    }
    return { totalHits, resetTime: new Date(resetAt) };
  };
  return {
    prefix,
    localKeys: false,
    init(options) { interval = validateWindow(options.windowMs); },
    async increment(key) {
      validateWindow(interval);
      const keyHash = hash(key);
      const result = information(await db.prepare(INCREMENT).get(prefix, keyHash, interval, interval));
      if (!result || result.totalHits < 1) throw new Error("Shared rate limit increment did not return a counter");
      requestContext.getStore()?.set(`${prefix}:${keyHash}`, result.resetTime.getTime());
      return result;
    },
    async get(key) {
      return information(await db.prepare(`SELECT total_hits, reset_at FROM rate_limit_counters WHERE prefix = ? AND key_hash = ? AND reset_at > ${NOW_MS}`)
        .get(prefix, hash(key)));
    },
    decrement(key) {
      const keyHash = hash(key);
      const context = requestContext.getStore();
      const contextKey = `${prefix}:${keyHash}`;
      const expectedReset = context?.get(contextKey);
      // Finish and close can race while the first SQL update is still pending.
      // Consume this request's refund once, before yielding to the database.
      context?.delete(contextKey);
      const pending = (async () => {
        // Missing request context cannot identify a window safely. Keeping the
        // charge is conservative and avoids refunding a different request.
        if (expectedReset === undefined) return;
        await db.prepare(`UPDATE rate_limit_counters SET total_hits = GREATEST(total_hits - 1, 0)
          WHERE prefix = ? AND key_hash = ? AND reset_at = ? AND reset_at > ${NOW_MS}`)
          .run(prefix, keyHash, expectedReset);
      })().catch(error => {
        // Finish listeners are asynchronous and Express cannot catch their
        // rejection. Keep the original charge and expose no connection details.
        console.error("Rate limit decrement failed", { name: error?.name, code: error?.code });
      });
      try { onBackgroundTask?.(pending); }
      catch (error) { console.error("Rate limit background task registration failed", { name: error?.name, code: error?.code }); }
      return pending;
    },
    async resetKey(key) {
      await db.prepare("DELETE FROM rate_limit_counters WHERE prefix = ? AND key_hash = ?").run(prefix, hash(key));
    },
    async resetAll() {
      await db.prepare("DELETE FROM rate_limit_counters WHERE prefix = ?").run(prefix);
    }
  };
}

// Call from the same request-driven maintenance as expired guest comments.
// No persistent process or background timer is needed. Bounded work prevents a
// large dormant table from monopolizing the database when traffic returns.
export async function cleanupExpiredRateLimits(db) {
  if (db.kind !== "postgres") return;
  await db.exec(`DELETE FROM rate_limit_counters WHERE ctid IN (
    SELECT ctid FROM rate_limit_counters WHERE reset_at <= ${NOW_MS} LIMIT 1000
  )`);
}
