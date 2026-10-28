// Cache only public data, after the request's CORS/auth/rate-limit middleware.
// Instances do not share memory: another instance may serve its snapshot for 30 s.
export function createPublicCommentsCache({ load, now = Date.now }) {
  let cached;
  let pending;
  let generation = 0;

  function invalidate() {
    generation++;
    cached = pending = undefined;
  }

  async function read() {
    const startedAt = now();
    if (cached && startedAt < cached.until) return cached.comments;
    if (pending) return pending;
    const version = generation;
    const task = Promise.resolve().then(() => load(startedAt)).then(rows => {
      // A committed write supersedes this query, even if its old snapshot finishes later.
      if (version !== generation) return read();
      const completedAt = now();
      const comments = rows.filter(row => row.expires_at === null || Number(row.expires_at) > completedAt)
        .map(row => Object.freeze({ id: Number(row.id), nickname: row.nickname, content: row.content,
          isGuest: Boolean(row.is_guest), createdAt: new Date(row.created_at).toISOString(),
          expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString() }));
      // Count slow queries toward the TTL; refill when a guest expires, too.
      const until = Math.min(startedAt + 30_000, ...rows.filter(row => row.expires_at !== null).map(row => Number(row.expires_at)));
      Object.freeze(comments);
      if (completedAt < until) cached = { comments, until };
      return comments;
    }).finally(() => {
      if (pending === task) pending = undefined;
    });
    pending = task;
    return task;
  }

  return { read, invalidate };
}
