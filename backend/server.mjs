import "dotenv/config";
import { normalizeRequestPath, validateCommentInput, websiteLocation, parseAdditionalOrigins, clientIpResolver, parseAdminUserIds, createAdminCheck, buildVersion, insertFreshCommentAsync, registerAdminCommentManagement, registerCommentManagement, passwordResetDelivery, requireJsonRequestBody, revokeSessionsAfterPasswordReset, createFinalErrorHandler } from "./services.mjs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, SELECT_COMMENT_LIST_VERSION } from "./database.mjs";
import { createDatabaseAccess } from "./database-access.mjs";
import { createRequestRateLimit } from "./request-rate-limit.mjs";
import { createClientIdentity } from "./client-identity.mjs";
import { createRequestMaintenance } from "./request-maintenance.mjs";
import { createPublicCommentsCache, applyPublicCommentsCacheHeaders, PUBLIC_COMMENTS_CACHE_TAG } from "./public-comments-cache.mjs";
import { createPostgresRateLimitStore, cleanupExpiredRateLimits, withRateLimitRequestContext } from "./rate-limit-store.mjs";
import { commentWriteMaintenance } from "./maintenance.mjs";
import { waitUntil, dangerouslyDeleteByTag } from "@vercel/functions";
import { registerBackupEndpoint, backupTokenFrom, isBackupPath } from "./backup-endpoint.mjs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import supertokens from "supertokens-node";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import Session from "supertokens-node/recipe/session";
import { middleware, errorHandler } from "supertokens-node/framework/express";
import { verifySession } from "supertokens-node/recipe/session/framework/express";
const NODE_ENV = process.env.NODE_ENV === "production" ? "production" : "development";
const IS_PRODUCTION = NODE_ENV === "production";
const IS_VERCEL = process.env.VERCEL === "1";
function failStartup(message) {
  console.error(`❌ ${message}`);
  if (IS_VERCEL) throw Object.assign(new Error(message), { code: "BACKEND_CONFIGURATION_ERROR" });
  process.exit(1);
}
if (IS_VERCEL) {
  const missing = ["SUPERTOKENS_CONNECTION_URI", "SUPERTOKENS_API_KEY", "DATABASE_URL", "API_DOMAIN", "WEBSITE_URL"]
    .filter(name => !process.env[name]?.trim());
  if (missing.length) failStartup(`Missing required Vercel environment variables: ${missing.join(", ")}; configure this deployment's environment and redeploy`);
}
function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    failStartup(`Missing required environment variable: ${name}`);
  }
  return value;
}
function normalizeOrigin(value, name) {
  try {
    return websiteLocation(value).origin;
  } catch {
    failStartup(`${name} must be a full URL`);
  }
}
const SUPERTOKENS_CONNECTION_URI = requiredEnv("SUPERTOKENS_CONNECTION_URI");
const SUPERTOKENS_API_KEY = requiredEnv("SUPERTOKENS_API_KEY");
const ADMIN_USER_IDS = parseAdminUserIds(process.env.ADMIN_USER_IDS);
if (!ADMIN_USER_IDS.size) {
  console.warn("⚠️ ADMIN_USER_IDS is empty: nobody can use the admin panel");
}
if (process.env.ADMIN_EMAILS?.trim()) {
  console.warn("⚠️ ADMIN_EMAILS is no longer used; configure ADMIN_USER_IDS instead");
}
const BUILD_VERSION = buildVersion(process.env);
const PORT = Number(process.env.PORT || 3001);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  failStartup("PORT must be an integer between 1 and 65535");
}
const API_DOMAIN = normalizeOrigin((process.env.API_DOMAIN || "http://127.0.0.1:3001").trim(), "API_DOMAIN");
const website = websiteLocation((process.env.WEBSITE_URL || process.env.WEBSITE_DOMAIN || "http://127.0.0.1:5500").trim());
const WEBSITE_DOMAIN = website.origin;
let ADDITIONAL_WEBSITE_ORIGINS;
try {
  ADDITIONAL_WEBSITE_ORIGINS = parseAdditionalOrigins(process.env.ADDITIONAL_WEBSITE_ORIGINS, { production: IS_PRODUCTION });
} catch (error) {
  failStartup(error.message);
}
const HOST = (process.env.HOST || (IS_PRODUCTION ? "0.0.0.0" : "127.0.0.1")).trim();
if (!HOST) {
  failStartup("HOST cannot be empty");
}
if (IS_PRODUCTION) {
  if (!IS_VERCEL && !process.env.TRUST_PROXY?.trim()) {
    failStartup("Non-Vercel production requires TRUST_PROXY set to the trusted proxy hop count");
  }
  if (!API_DOMAIN.startsWith("https://")) {
    failStartup("Production API_DOMAIN must use HTTPS");
  }
  if (!WEBSITE_DOMAIN.startsWith("https://")) {
    failStartup("Production WEBSITE_DOMAIN must use HTTPS");
  }
}
let clientIp;
try {
  clientIp = clientIpResolver(process.env);
} catch (error) {
  failStartup(error.message);
}
const clientIpKey = req => req.clientRateLimitKey;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseKind = process.env.DATABASE_URL?.trim() ? "postgres" : "sqlite";
let db = databaseKind === "postgres" ? createDatabaseAccess({ kind: databaseKind, open: () => openDatabase(process.env, __dirname) }) : undefined;
let databaseReady = false;
try {
  if (db) await db.ready();
  else db = await openDatabase(process.env, __dirname);
  databaseReady = true;
} catch (error) {
  if (databaseKind === "postgres" && error.code !== "DATABASE_CONFIG") {
    console.error("❌ PostgreSQL unavailable; check DATABASE_URL, connectivity and provider status. Health checks return 503 until recovery");
  } else {
    failStartup(error.code === "DATABASE_CONFIG" ? error.message : "Unable to initialize SQLite comments database; check COMMENTS_DB_PATH, directory write permissions and database integrity");
  }
}
if (databaseReady) console.log("✅ Comments database ready");
console.log("✅ Backend initialized", { version: BUILD_VERSION, node: process.version, storage: db.kind, databaseReady });
const sharedStore = prefix => db.kind === "postgres" ? { store: createPostgresRateLimitStore(db, {
  prefix: prefix.toLowerCase(), onBackgroundTask: IS_VERCEL ? waitUntil : undefined
}) } : {};
const app = express();
app.disable("x-powered-by");
app.set("query parser", "simple");
app.use(withRateLimitRequestContext);
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  res.setHeader("Cache-Control", "no-store");
  next();
});
if (process.env.TRUST_PROXY) {
  const trustProxy = Number(process.env.TRUST_PROXY);
  if (!Number.isInteger(trustProxy) || trustProxy < 1) {
    failStartup("TRUST_PROXY must be a positive integer");
  }
  app.set("trust proxy", trustProxy);
}
// API-only backend: CSP hardens JSON/auth responses.
// The GitHub Pages static site is not served here, so frontend YouTube/fonts/scripts are unaffected.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  strictTransportSecurity: IS_PRODUCTION ? { maxAge: 31536e3, includeSubDomains: true, preload: false } : false
}));
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  next();
});
supertokens.init({
  framework: "express",
  supertokens: { connectionURI: SUPERTOKENS_CONNECTION_URI, apiKey: SUPERTOKENS_API_KEY },
  appInfo: { appName: "Inabakumori Fanswall", apiDomain: API_DOMAIN, websiteDomain: WEBSITE_DOMAIN, apiBasePath: "/auth", websiteBasePath: "/auth" },
  recipeList: [
    EmailPassword.init({
      emailDelivery: passwordResetDelivery(website.url),
      override: {
        apis: original => {
          const next = { ...original };
          // Unused by this site. Leaving it open allows bulk email enumeration.
          delete next.emailExistsGET;
          // A reset must also sign out every existing session (a stolen session would otherwise survive it).
          if (original.passwordResetPOST) {
            next.passwordResetPOST = revokeSessionsAfterPasswordReset(original.passwordResetPOST, userId => Session.revokeAllSessionsForUser(userId));
          }
          return next;
        }
      }
    }),
    Session.init({ getTokenTransferMethod: () => "header" })
  ]
});
const ALLOWED_ORIGINS = new Set([WEBSITE_DOMAIN, ...ADDITIONAL_WEBSITE_ORIGINS, ...IS_PRODUCTION ? [] : ["http://127.0.0.1:5500", "http://localhost:5500"]]);
const corsOptions = { origin(origin, callback) {
  if (!origin) return callback(null, true);
  if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
  return callback(new Error("Origin not allowed by CORS"));
}, exposedHeaders: ["X-Request-Id", "Retry-After"], allowedHeaders: ["content-type", ...supertokens.getAllCORSHeaders()], methods: ["GET", "POST", "DELETE", "OPTIONS"], credentials: true, maxAge: 600 };
const corsMiddleware = cors(corsOptions);
// Diagnostics must not depend on shared counters, authentication or maintenance.
// A temporarily unavailable pool can recover on a later probe, including cold starts.
app.get("/healthz", corsMiddleware, async (req, res) => {
  try {
    await db.prepare("SELECT 1").get();
    return res.json({ ok: true, version: BUILD_VERSION });
  } catch {
    res.setHeader("Retry-After", "5");
    return res.status(503).json({ ok: false, code: "DATABASE_UNAVAILABLE" });
  }
});
app.options("/healthz", corsMiddleware);
function exposeLimiterResponse(req, res) {
  const origin = req.get("origin");
  if (!isBackupPath(req.originalUrl || req.url) && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, Retry-After");
    res.vary("Origin");
  }
}
const identifyClient = createClientIdentity({ clientIp, verifySession, isBackupPath, onUnavailable: exposeLimiterResponse });
app.use((req, res, next) => identifyClient(req, res, error => {
  if (error) exposeLimiterResponse(req, res);
  next(error);
}));
// Bound non-diagnostic traffic before parsing. Only reads may continue when
// counter storage fails; POST/DELETE/OPTIONS still fail closed with a safe 503.
const requestLimiter = createRequestRateLimit({ ...sharedStore("requestLimiter"), keyGenerator: clientIpKey, windowMs: 60_000, limit: 180,
  standardHeaders: "draft-7", legacyHeaders: false,
  handler(req, res, _next, options) {
    // The limiter runs before CORS, but trusted pages must still be able to read 429.
    exposeLimiterResponse(req, res);
    res.status(options.statusCode).json(options.message);
  },
  message: { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" } }, { allowReadOnStoreError: true, onUnavailable: exposeLimiterResponse });
app.use(requestLimiter);
// CORS only limits which browser pages may read responses; every protected route still
// verifies the SuperTokens session (and admin rights) on the server.
// The backup download is server-to-server only: no CORS headers, so browsers cannot read it.
app.use((req, res, next) => isBackupPath(req.originalUrl || req.url) ? next() : corsMiddleware(req, res, next));
app.use(requireJsonRequestBody);
// Browser clients send plain JSON. Do not decode untrusted compressed bodies,
// including Brotli, while managed runtimes control their own security patches.
app.use(express.json({ limit: "20kb", strict: true, inflate: false }));
const authSensitiveLimiter = createRequestRateLimit({ ...sharedStore("authSensitiveLimiter"), keyGenerator: clientIpKey, windowMs: 15 * 60 * 1e3, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" } });
// emailExistsGET is removed from the SuperTokens APIs, so only POST auth routes need throttling.
app.use((req, res, next) => {
  if (req.method !== "POST") return next();
  const pathname = normalizeRequestPath(req.originalUrl || req.url);
  if (pathname !== "/auth" && !pathname.startsWith("/auth/")) return next();
  return authSensitiveLimiter(req, res, next);
});
app.use(middleware());
app.use(commentWriteMaintenance(process.env));
const commentLimiter = createRequestRateLimit({ ...sharedStore("commentLimiter"), keyGenerator: clientIpKey, windowMs: 60 * 1e3, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "留言发送过于频繁，请稍后再试", code: "RATE_LIMITED" } });
// A 409 duplicate still counts: otherwise a guest could probe (or squat) recent texts for free.
const guestCommentLimiter = createRequestRateLimit({ ...sharedStore("guestCommentLimiter"), keyGenerator: clientIpKey, windowMs: 60 * 60 * 1e3, limit: 3, skipFailedRequests: true, requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.statusCode === 409, standardHeaders: "draft-7", legacyHeaders: false, skip: req => req.session !== undefined, message: { error: "游客每小时最多留言 3 条，请稍后再试", code: "GUEST_RATE_LIMITED" } });
const memberCommentLimiter = createRequestRateLimit({ ...sharedStore("memberCommentLimiter"),
  windowMs: 60 * 60 * 1e3,
  limit: 20,
  skipFailedRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: req => req.session === undefined,
  keyGenerator: req => `member:${req.session.getUserId()}`,
  validate: false,
  message: { error: "登录用户每小时最多留言 20 条，请稍后再试", code: "MEMBER_RATE_LIMITED" }
});
const selectRecentCommentsStatement = db.prepare(`
    SELECT
        id,
        nickname,
        content,
        is_guest,
        created_at,
        expires_at
    FROM comments
    WHERE expires_at IS NULL OR expires_at > ?
    ORDER BY id DESC
    LIMIT ?
`);
const deleteExpiredGuestsStatement = db.prepare(`
    DELETE FROM comments
    WHERE
        is_guest = 1
        AND expires_at IS NOT NULL
        AND expires_at <= ?
`);
const MAX_PUBLIC_COMMENTS = 100;
const selectCommentListVersionStatement = db.prepare(SELECT_COMMENT_LIST_VERSION);
const publicComments = createPublicCommentsCache({ load: now => selectRecentCommentsStatement.all(now, MAX_PUBLIC_COMMENTS),
  version: async () => (await selectCommentListVersionStatement.get())?.version });
// Same-instance memory is cleared at once; the shared CDN copy is deleted by tag
// (Hobby plans include tag purges). A failed purge is bounded by s-maxage.
function invalidatePublicComments() {
  publicComments.invalidate();
  if (!IS_VERCEL) return;
  const purge = Promise.resolve().then(() => dangerouslyDeleteByTag(PUBLIC_COMMENTS_CACHE_TAG))
    .catch(error => console.error("Public comments CDN purge failed", { name: error?.name, code: error?.code }));
  waitUntil(purge);
}
const MEMBER_COMMENT_CAP = 100;
const GUEST_COMMENT_RETENTION_DAYS = 182;
const GUEST_COMMENT_RETENTION_MS = GUEST_COMMENT_RETENTION_DAYS * 24 * 60 * 60 * 1e3;
function requireJsonContentType(req, res, next) {
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "请求必须使用 application/json", code: "UNSUPPORTED_MEDIA_TYPE" });
  }
  next();
}
async function deleteExpiredGuestComments() {
  if (process.env.COMMENTS_READ_ONLY === "1") return;
  const result = await deleteExpiredGuestsStatement.run(Date.now());
  const deleted = Number(result.changes);
  if (deleted > 0) {
    invalidatePublicComments();
    console.log(`🧹 Deleted ${deleted} expired guest comment(s)`);
  }
  await cleanupExpiredRateLimits(db);
}
app.use(createRequestMaintenance({ work: deleteExpiredGuestComments, env: process.env,
  onBackgroundTask: IS_VERCEL ? waitUntil : undefined }));
app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true });
});
const commentReadLimiter = createRequestRateLimit({ ...sharedStore("commentReadLimiter"), keyGenerator: clientIpKey, windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" } }, { allowReadOnStoreError: true });
const commentDeleteLimiter = createRequestRateLimit({ ...sharedStore("commentDeleteLimiter"), keyGenerator: clientIpKey, windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" } });
app.use("/api", commentReadLimiter);
app.use((req, res, next) => {
  if (req.method !== "DELETE") return next();
  const pathname = normalizeRequestPath(req.originalUrl || req.url);
  return /^\/api\/(?:admin\/)?comments(?:\/|$)/u.test(pathname) ? commentDeleteLimiter(req, res, next) : next();
});
app.get("/api/comments", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const comments = await publicComments.read();
  applyPublicCommentsCacheHeaders(req, res);
  res.json({ comments });
});
app.post("/api/comments", commentLimiter, requireJsonContentType, verifySession({ sessionRequired: false }), guestCommentLimiter, memberCommentLimiter, async (req, res) => {
  const validation = validateCommentInput(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error, code: validation.code || "INVALID_COMMENT" });
  }
  const { nickname, content } = validation;
  const isLoggedIn = req.session !== void 0;
  const userId = isLoggedIn ? req.session.getUserId() : null;
  const isGuest = !isLoggedIn;
  const createdAt = Date.now();
  const expiresAt = isGuest ? createdAt + GUEST_COMMENT_RETENTION_MS : null;
  const inserted = await insertFreshCommentAsync(db, {
    memberCap: MEMBER_COMMENT_CAP,
    row: { nickname, content, userId, isGuest, createdAt, expiresAt }
  });
  if (!inserted.ok && inserted.code === "DUPLICATE_COMMENT") {
    return res.status(409).json({ error: "相同内容请稍后再留言", code: "DUPLICATE_COMMENT" });
  }
  if (!inserted.ok) {
    return res.status(409).json({ error: "每个账号最多保留 100 条留言，请先删除旧留言", code: "MEMBER_COMMENT_CAP" });
  }
  invalidatePublicComments();
  return res.status(201).json({ success: true, comment: { id: inserted.id, nickname, content, isGuest, createdAt: new Date(createdAt).toISOString(), expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString() } });
});
registerCommentManagement(app, db, verifySession, invalidatePublicComments);
registerAdminCommentManagement(app, db, verifySession, createAdminCheck(ADMIN_USER_IDS), invalidatePublicComments);
const BACKUP_TOKEN = backupTokenFrom(process.env);
if (process.env.BACKUP_TOKEN?.trim() && !BACKUP_TOKEN) console.warn("⚠️ BACKUP_TOKEN is shorter than 32 characters; backup endpoint disabled");
const backupLimiter = createRequestRateLimit({ ...sharedStore("backupLimiter"), keyGenerator: clientIpKey, windowMs: 60 * 60 * 1e3, limit: 5, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" } });
registerBackupEndpoint(app, { snapshot: destination => db.snapshot(destination), token: BACKUP_TOKEN, limiter: backupLimiter, clientIp,
  onBackgroundTask: IS_VERCEL ? waitUntil : undefined });
app.use("/api", (req, res) => {
  res.status(404).json({ error: "请求的地址不存在，请刷新页面后重试", code: "NOT_FOUND" });
});
app.use((req, res) => {
  res.status(404).json({ error: "请求的地址不存在，请刷新页面后重试", code: "NOT_FOUND" });
});
app.use(errorHandler());
app.use(createFinalErrorHandler({ isProduction: IS_PRODUCTION }));
export default app;

// Vercel owns the listener and function lifecycle; standalone runs drain on shutdown.
if (!IS_VERCEL) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`✅ Backend running at http://${HOST}:${PORT} (version ${BUILD_VERSION})`);
    console.log(`🔐 Environment: ${NODE_ENV}`);
    console.log(`💬 Guest comments expire after 6 months (${GUEST_COMMENT_RETENTION_DAYS} days)`);
    console.log("👤 Logged-in comments do not automatically expire");
    console.log("🛡️ Core security enabled (lightweight mode)");
    console.log(db.kind === "sqlite" ? "🗄️ SQLite comment storage is single-instance; do not run multiple replicas" : "🗄️ PostgreSQL comment storage and shared rate limits ready");
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    // Deployment hosts send SIGTERM on replacement; a clean drain exits 0.
    // After 8s, drop in-flight connections so server.close() still completes and exits 0;
    // only a close that hangs past 15s exits 1.
    const drain = setTimeout(() => {
      console.error("Shutdown drain timeout; closing remaining connections");
      server.closeAllConnections();
    }, 8_000);
    drain.unref();
    const deadline = setTimeout(() => {
      console.error("Shutdown deadline exceeded");
      process.exit(1);
    }, 15_000);
    deadline.unref();
    console.log(`🛑 Received ${signal}. Shutting down...`);
    server.close(async () => {
      try {
        if (db.kind === "sqlite") await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        await db.close();
        console.log("✅ Database closed safely");
      } catch (error) {
        console.error("❌ Failed to close database", { name: error.name, code: error.code });
      }
      clearTimeout(drain);
      clearTimeout(deadline);
      console.log("✅ Server shut down safely");
      process.exit(0);
    });
    // Keep-alive sockets from the Railway edge would otherwise hold server.close() open.
    server.closeIdleConnections();
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
