// Durable follow-up for password resets whose immediate session revocation failed.
// One row per account, holding only the account ID and timestamps (no tokens, emails or passwords).
// A retry revokes only sessions created before the reset, so a device the owner signed in with
// the new password is never kicked out again by a delayed retry.
export const SESSION_REVOCATION_BATCH = 20;
export const SESSION_REVOCATION_ALERT_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;

export function sessionRevocationBackoff(attempts) {
  const exponent = Math.max(0, Math.min(Number(attempts) || 0, 20) - 1);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
}

function cleanReport(log, level, message, details) {
  try { log[level](message, details); } catch { /* logging must not break auth or requests */ }
}

export function createPendingSessionRevocations(db, {
  listSessionHandles,
  sessionCreatedAt,
  revokeSessions,
  now = Date.now,
  log = console,
  batch = SESSION_REVOCATION_BATCH
} = {}) {
  if (!db || ![listSessionHandles, sessionCreatedAt, revokeSessions, now].every(fn => typeof fn === "function")) {
    throw new TypeError("Pending session revocations need a database and session functions");
  }
  const select = db.prepare("SELECT user_id, reset_at, attempts FROM pending_session_revocations WHERE user_id = ?");
  return {
    // Keeps the latest reset time when a second reset happens before the first retry succeeds.
    async enqueue(userId, resetAt) {
      if (typeof userId !== "string" || !userId || !Number.isSafeInteger(resetAt) || resetAt < 0) throw new TypeError("Invalid pending revocation");
      await db.transaction(async tx => {
        const existing = await tx.prepare("SELECT reset_at FROM pending_session_revocations WHERE user_id = ?").get(userId);
        if (existing) {
          await tx.prepare("UPDATE pending_session_revocations SET reset_at = ?, next_attempt_at = ? WHERE user_id = ?")
            .run(Math.max(Number(existing.reset_at), resetAt), now(), userId);
        } else {
          await tx.prepare("INSERT INTO pending_session_revocations (user_id, reset_at, attempts, next_attempt_at) VALUES (?, ?, 0, ?)")
            .run(userId, resetAt, now());
        }
      });
    },
    async get(userId) { return select.get(userId); },
    async backlog() {
      return Number((await db.prepare("SELECT count(*) AS n FROM pending_session_revocations").get())?.n || 0);
    },
    // Called from request maintenance; returns how many accounts were fully handled.
    async process() {
      const due = await db.prepare("SELECT user_id, reset_at, attempts FROM pending_session_revocations WHERE next_attempt_at <= ? ORDER BY next_attempt_at, user_id LIMIT ?")
        .all(now(), batch);
      let done = 0;
      for (const row of due) {
        const userId = row.user_id;
        const resetAt = Number(row.reset_at);
        try {
          const stale = [];
          for (const handle of await listSessionHandles(userId)) {
            const created = await sessionCreatedAt(handle);
            // A session that no longer exists needs nothing; one created after the reset is kept.
            if (Number.isFinite(created) && created <= resetAt) stale.push(handle);
          }
          if (stale.length) await revokeSessions(stale);
          // Only the reset that was handled is cleared; a newer reset queued meanwhile stays.
          await db.prepare("DELETE FROM pending_session_revocations WHERE user_id = ? AND reset_at = ?").run(userId, resetAt);
          done++;
        } catch (error) {
          const attempts = Number(row.attempts) + 1;
          await db.prepare("UPDATE pending_session_revocations SET attempts = ?, next_attempt_at = ? WHERE user_id = ? AND reset_at = ?")
            .run(attempts, now() + sessionRevocationBackoff(attempts), userId, resetAt);
          if (attempts >= SESSION_REVOCATION_ALERT_ATTEMPTS) {
            cleanReport(log, "error", "Pending session revocation still failing after password reset; check the SuperTokens Core", { attempts, name: error?.name, code: error?.code });
          } else {
            cleanReport(log, "warn", "Pending session revocation retry failed", { attempts, name: error?.name, code: error?.code });
          }
        }
      }
      return done;
    }
  };
}
