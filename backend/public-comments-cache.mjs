// Cache only public data, after the request's CORS/auth/rate-limit middleware.
// Instances do not share memory. When `version` is supplied, every cache hit
// first reads a database counter that triggers bump on any comment write, so a
// post or deletion on another instance is seen on the next request. A failed
// version probe keeps serving the snapshot until its 30-second deadline.
export function createPublicCommentsCache({ load, version, now = Date.now }) {
  let cached;
  let pending;
  let generation = 0;

  function invalidate() {
    generation++;
    cached = pending = undefined;
  }

  async function currentVersion() {
    if (!version) return null;
    const value = await version();
    return value === undefined || value === null ? null : String(value);
  }

  async function read() {
    const startedAt = now();
    if (cached && startedAt < cached.until) {
      const entry = cached;
      if (!version) return entry.comments;
      let latest;
      try { latest = await currentVersion(); } catch { return entry.comments; }
      if (latest === entry.version) return entry.comments;
      if (cached === entry) cached = undefined;
    }
    if (pending) return pending;
    const generationAtStart = generation;
    const loadRows = snapshotVersion => {
      const loadStartedAt = now();
      return Promise.resolve(load(loadStartedAt)).then(rows => ({ snapshotVersion, loadStartedAt, rows }));
    };
    // Read the counter before the rows: a write between the two queries
    // leaves this snapshot one version behind, so the next hit refetches.
    const task = (version ? Promise.resolve().then(currentVersion).then(loadRows) : Promise.resolve().then(() => loadRows(null))).then(({ snapshotVersion, loadStartedAt, rows }) => {
      // A committed write supersedes this query, even if its old snapshot finishes later.
      if (generationAtStart !== generation) return read();
      const completedAt = now();
      const comments = rows.filter(row => row.expires_at === null || Number(row.expires_at) > completedAt)
        .map(row => Object.freeze({ id: Number(row.id), nickname: row.nickname, content: row.content,
          isGuest: Boolean(row.is_guest), createdAt: new Date(row.created_at).toISOString(),
          expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString() }));
      // Count slow queries toward the TTL; refill when a guest expires, too.
      const until = Math.min(loadStartedAt + 30_000, ...rows.filter(row => row.expires_at !== null).map(row => Number(row.expires_at)));
      Object.freeze(comments);
      if (completedAt < until) cached = { comments, until, version: snapshotVersion };
      return comments;
    }).finally(() => {
      if (pending === task) pending = undefined;
    });
    pending = task;
    return task;
  }

  return { read, invalidate };
}

export const PUBLIC_COMMENTS_CACHE_TAG = "public-comments";
export const PUBLIC_COMMENTS_CDN_CACHE_CONTROL = "public, max-age=0, s-maxage=30, stale-while-revalidate=30";
const CREDENTIAL_HEADERS = ["authorization", "cookie", "st-auth-mode", "rid", "fdi-version", "anti-csrf"];

// Only a request carrying no credential of any kind may be stored by the CDN.
// The list body never depends on the caller, but a signed-in request stays
// no-store so session-bearing traffic is never mixed into a shared entry.
export function isAnonymousPublicRequest(req) {
  return CREDENTIAL_HEADERS.every(name => {
    const value = req.headers?.[name];
    return value === undefined || value === "";
  });
}

export function applyPublicCommentsCacheHeaders(req, res) {
  // CORS headers differ per Origin, so the CDN key must include it. Vercel will
  // not store a response that varies on Cookie; credentialed requests are
  // excluded above instead. Authorization is listed for any other cache.
  res.vary("Origin");
  res.vary("Authorization");
  if (!isAnonymousPublicRequest(req) || res.statusCode !== 200) {
    res.setHeader("Cache-Control", "no-store");
    return false;
  }
  res.setHeader("Cache-Control", PUBLIC_COMMENTS_CDN_CACHE_CONTROL);
  res.setHeader("Vercel-Cache-Tag", PUBLIC_COMMENTS_CACHE_TAG);
  // Per-client limiter counters must not be replayed to other visitors.
  for (const name of ["RateLimit", "RateLimit-Policy", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"]) res.removeHeader(name);
  return true;
}
