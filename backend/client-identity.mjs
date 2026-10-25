import { ipKeyGenerator } from "express-rate-limit";
import { normalizeRequestPath } from "./services.mjs";

// A missing platform IP is not a visitor identity. Only verified sessions can
// supply an independent fallback; anonymous reads retain their route permissions.
export function createClientIdentity({ clientIp, verifySession, isBackupPath, onUnavailable }) {
  const verifyOptionalSession = verifySession({ sessionRequired: false });
  const unavailable = (req, res, next) => Promise.resolve()
    .then(() => onUnavailable?.(req, res))
    .then(() => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "5");
      return res.status(503).json({ error: "暂时无法识别访客来源，请稍后重试。", code: "CLIENT_IDENTITY_UNAVAILABLE" });
    }).catch(next);

  return (req, res, next) => {
    try {
      delete req.clientRateLimitKey;
      req.skipIpRateLimits = false;
      const ip = clientIp(req);
      if (ip && ip !== "0.0.0.0") {
        req.clientRateLimitKey = ipKeyGenerator(ip);
        return next();
      }
      const url = req.originalUrl || req.url;
      if (isBackupPath(url)) {
        req.clientRateLimitKey = "unidentified:backup";
        return next();
      }
      // Preflights carry no session credentials; the existing CORS whitelist
      // decides whether the browser may send its subsequent authenticated call.
      if (req.method === "OPTIONS") {
        req.skipIpRateLimits = true;
        return next();
      }
      const pathname = normalizeRequestPath(url);
      if (pathname === "/auth" || pathname.startsWith("/auth/")) return unavailable(req, res, next);

      // Discard any pre-existing object: only this verification's SDK result is
      // eligible for the member bucket, never a decoded token or caller claim.
      delete req.session;
      return Promise.resolve(verifyOptionalSession(req, res, error => {
        if (error) return next(error);
        try {
          if (req.session) {
            req.clientRateLimitKey = `member:${req.session.getUserId()}`;
            return next();
          }
          if (req.method === "GET" || req.method === "HEAD") {
            req.skipIpRateLimits = true;
            return next();
          }
          return unavailable(req, res, next);
        } catch (failure) { return next(failure); }
      })).catch(next);
    } catch (error) { return next(error); }
  };
}
