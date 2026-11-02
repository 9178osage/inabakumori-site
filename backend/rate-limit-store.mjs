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

// Audit C3: the global limiter and the public-read limiter both charge a plain
// GET /api/comments. One statement charges both rows. The follower row is only
// charged when the leader's new total is within its limit, exactly as the
// follower limiter is never reached after the leader rejects.
const UPSERT_SET = table => `total_hits = CASE WHEN ${table}.reset_at <= (SELECT now_ms FROM request_clock)
      THEN 1 ELSE ${table}.total_hits + 1 END,
    reset_at = CASE WHEN ${table}.reset_at <= (SELECT now_ms FROM request_clock)
      THEN (SELECT now_ms FROM request_clock) + ? ELSE ${table}.reset_at END`;
const PAIRED_INCREMENT = `WITH request_clock AS MATERIALIZED (SELECT ${NOW_MS} AS now_ms),
  leader AS (
    INSERT INTO rate_limit_counters (prefix, key_hash, total_hits, reset_at)
    SELECT ?, ?, 1, now_ms + ? FROM request_clock WHERE true
    ON CONFLICT (prefix, key_hash) DO UPDATE SET ${UPSERT_SET("rate_limit_counters")}
    RETURNING total_hits, reset_at),
  follower AS (
    INSERT INTO rate_limit_counters (prefix, key_hash, total_hits, reset_at)
    SELECT ?, ?, 1, request_clock.now_ms + ? FROM request_clock, leader WHERE leader.total_hits <= ?
    ON CONFLICT (prefix, key_hash) DO UPDATE SET ${UPSERT_SET("rate_limit_counters")}
    RETURNING total_hits, reset_at)
  SELECT leader.total_hits, leader.reset_at, follower.total_hits AS follower_hits, follower.reset_at AS follower_reset
  FROM leader LEFT JOIN follower ON true`;
const PAIR = Symbol("paired rate limit increment");
const FOLLOWER_INFO = Symbol("paired rate limit follower");
const prefetchedKey = (prefix, keyHash) => `prefetched:${prefix}:${keyHash}`;

// Ask the leader store's next increment in this request to also charge the
// follower store for the same key. Call only where the request is certain to
// reach the follower limiter whenever the leader allows it.
export function pairNextIncrement(leader, follower, { leaderLimit }) {
  const context = requestContext.getStore();
  const info = follower?.[FOLLOWER_INFO]?.();
  if (!context || !info || typeof leader?.prefix !== "string" || !Number.isSafeInteger(leaderLimit) || leaderLimit < 1) return false;
  context.set(PAIR, { leaderPrefix: leader.prefix, leaderLimit, follower: info });
  return true;
}

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
    [FOLLOWER_INFO]() { return { prefix, interval: validateWindow(interval) }; },
    async increment(key) {
      validateWindow(interval);
      const keyHash = hash(key);
      const context = requestContext.getStore();
      const prefetched = context?.get(prefetchedKey(prefix, keyHash));
      if (prefetched) {
        context.delete(prefetchedKey(prefix, keyHash));
        context.set(`${prefix}:${keyHash}`, prefetched.resetTime.getTime());
        return prefetched;
      }
      const pair = context?.get(PAIR);
      if (pair && pair.leaderPrefix === prefix) {
        context.delete(PAIR);
        const { follower, leaderLimit } = pair;
        const row = await db.prepare(PAIRED_INCREMENT).get(prefix, keyHash, interval, interval,
          follower.prefix, keyHash, follower.interval, leaderLimit, follower.interval);
        const result = information(row);
        if (!result || result.totalHits < 1) throw new Error("Shared rate limit increment did not return a counter");
        context.set(`${prefix}:${keyHash}`, result.resetTime.getTime());
        if (row.follower_hits !== null && row.follower_hits !== undefined) {
          const followerResult = information({ total_hits: row.follower_hits, reset_at: row.follower_reset });
          if (!followerResult || followerResult.totalHits < 1) throw new Error("Shared rate limit increment did not return a counter");
          context.set(prefetchedKey(follower.prefix, keyHash), followerResult);
        }
        // No follower row means it was not charged: its limiter then increments as before.
        return result;
      }
      const result = information(await db.prepare(INCREMENT).get(prefix, keyHash, interval, interval));
      if (!result || result.totalHits < 1) throw new Error("Shared rate limit increment did not return a counter");
      context?.set(`${prefix}:${keyHash}`, result.resetTime.getTime());
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
