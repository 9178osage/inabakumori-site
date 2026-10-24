import { normalizeRequestPath } from "./services.mjs";

// Deployment-scoped switch: set it on every old writer before the final snapshot.
export function commentWriteMaintenance(env) {
  const readOnly = env.COMMENTS_READ_ONLY === "1";
  return (req, res, next) => {
    if (!readOnly || !["POST", "DELETE"].includes(req.method)) return next();
    const pathname = normalizeRequestPath(req.originalUrl || req.url);
    if (!/^\/api\/(?:admin\/)?comments(?:\/|$)/u.test(pathname)) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "300");
    return res.status(503).json({ error: "留言维护中，请稍后再试", code: "COMMENTS_READ_ONLY" });
  };
}
