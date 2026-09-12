import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import supertokens from "supertokens-node";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import Session from "supertokens-node/recipe/session";
import {
  middleware,
  errorHandler
} from "supertokens-node/framework/express";
import {
  verifySession
} from "supertokens-node/recipe/session/framework/express";
const NODE_ENV = process.env.NODE_ENV === "production" ? "production" : "development";
const IS_PRODUCTION = NODE_ENV === "production";
function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}
const SUPERTOKENS_CONNECTION_URI = requiredEnv("SUPERTOKENS_CONNECTION_URI");
const SUPERTOKENS_API_KEY = requiredEnv("SUPERTOKENS_API_KEY");
const PORT = Number(process.env.PORT || 3001);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error("❌ PORT must be an integer between 1 and 65535");
  process.exit(1);
}
const API_DOMAIN = (process.env.API_DOMAIN || "http://127.0.0.1:3001").trim();
const WEBSITE_DOMAIN = (process.env.WEBSITE_DOMAIN || "http://127.0.0.1:5500").trim();
if (IS_PRODUCTION) {
  if (!API_DOMAIN.startsWith("https://")) {
    console.error("❌ Production API_DOMAIN must use HTTPS");
    process.exit(1);
  }
  if (!WEBSITE_DOMAIN.startsWith("https://")) {
    console.error("❌ Production WEBSITE_DOMAIN must use HTTPS");
    process.exit(1);
  }
}
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) {
  const trustProxy = Number(process.env.TRUST_PROXY);
  if (!Number.isInteger(trustProxy) || trustProxy < 1) {
    console.error("❌ TRUST_PROXY must be a positive integer");
    process.exit(1);
  }
  app.set("trust proxy", trustProxy);
}
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    strictTransportSecurity: IS_PRODUCTION ? {
      maxAge: 31536e3,
      includeSubDomains: true,
      preload: false
    } : false
  })
);
supertokens.init({
  framework: "express",
  supertokens: {
    connectionURI: SUPERTOKENS_CONNECTION_URI,
    apiKey: SUPERTOKENS_API_KEY
  },
  appInfo: {
    appName: "Inabakumori Fanswall",
    apiDomain: API_DOMAIN,
    websiteDomain: WEBSITE_DOMAIN,
    apiBasePath: "/auth",
    websiteBasePath: "/auth"
  },
  recipeList: [
    EmailPassword.init(),
    Session.init({
      // 认证 Token 使用 Cookie，不放 localStorage。
      getTokenTransferMethod: () => "cookie"
    })
  ]
});
const ALLOWED_ORIGINS = new Set([
  WEBSITE_DOMAIN,
  ...IS_PRODUCTION ? [] : [
    "http://127.0.0.1:5500",
    "http://localhost:5500"
  ]
]);
const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    if (ALLOWED_ORIGINS.has(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed by CORS"));
  },
  allowedHeaders: [
    "content-type",
    ...supertokens.getAllCORSHeaders()
  ],
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  credentials: true,
  maxAge: 600
};
app.use(cors(corsOptions));
const authSensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "请求过于频繁，请稍后再试",
    code: "RATE_LIMITED"
  }
});
app.use(
  [
    "/auth/signin",
    "/auth/signup",
    "/auth/user/password/reset",
    "/auth/user/password/reset/token"
  ],
  authSensitiveLimiter
);
app.use(middleware());
app.use(
  express.json({
    limit: "20kb",
    strict: true
  })
);
const commentLimiter = rateLimit({
  windowMs: 60 * 1e3,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "留言发送过于频繁，请稍后再试",
    code: "RATE_LIMITED"
  }
});
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databasePath = path.join(__dirname, "comments.db");
const db = new DatabaseSync(databasePath);
db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT NOT NULL,
        content TEXT NOT NULL,
        user_id TEXT,
        is_guest INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        expires_at INTEGER
    )
`);
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_comments_created_at
    ON comments(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_comments_expiry
    ON comments(is_guest, expires_at);

    CREATE INDEX IF NOT EXISTS idx_comments_user
    ON comments(user_id);
`);
console.log("✅ Comments database ready");
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
    ORDER BY created_at DESC
    LIMIT ?
`);
const insertCommentStatement = db.prepare(`
    INSERT INTO comments (
        nickname,
        content,
        user_id,
        is_guest,
        created_at,
        expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
`);
const deleteExpiredGuestsStatement = db.prepare(`
    DELETE FROM comments
    WHERE
        is_guest = 1
        AND expires_at IS NOT NULL
        AND expires_at <= ?
`);
const findCommentOwnerStatement = db.prepare(`
    SELECT id, user_id, is_guest
    FROM comments
    WHERE id = ?
    LIMIT 1
`);
const deleteOwnedCommentStatement = db.prepare(`
    DELETE FROM comments
    WHERE
        id = ?
        AND user_id = ?
        AND is_guest = 0
`);
const MAX_NICKNAME_LENGTH = 30;
const MAX_COMMENT_LENGTH = 500;
const MAX_PUBLIC_COMMENTS = 100;
function unicodeLength(value) {
  return Array.from(value).length;
}
function normalizeUserText(value) {
  return value.normalize("NFC").trim();
}
function validateCommentInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "请求格式不正确" };
  }
  if (typeof body.nickname !== "string") {
    return { ok: false, error: "昵称格式不正确" };
  }
  if (typeof body.content !== "string") {
    return { ok: false, error: "留言格式不正确" };
  }
  const nickname = normalizeUserText(body.nickname);
  const content = normalizeUserText(body.content);
  if (!nickname) {
    return { ok: false, error: "请输入昵称" };
  }
  if (unicodeLength(nickname) > MAX_NICKNAME_LENGTH) {
    return {
      ok: false,
      error: `昵称不能超过 ${MAX_NICKNAME_LENGTH} 个字符`
    };
  }
  if (/\r|\n|\t/u.test(nickname)) {
    return { ok: false, error: "昵称不能包含换行符" };
  }
  if (!content) {
    return { ok: false, error: "请输入留言内容" };
  }
  if (unicodeLength(content) > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      error: `留言不能超过 ${MAX_COMMENT_LENGTH} 个字符`
    };
  }
  return {
    ok: true,
    nickname,
    content
  };
}
function requireJsonContentType(req, res, next) {
  if (!req.is("application/json")) {
    return res.status(415).json({
      error: "请求必须使用 application/json",
      code: "UNSUPPORTED_MEDIA_TYPE"
    });
  }
  next();
}
function deleteExpiredGuestComments() {
  const result = deleteExpiredGuestsStatement.run(Date.now());
  const deleted = Number(result.changes);
  if (deleted > 0) {
    console.log(`🧹 Deleted ${deleted} expired guest comment(s)`);
  }
}
deleteExpiredGuestComments();
const guestCleanupTimer = setInterval(
  deleteExpiredGuestComments,
  60 * 60 * 1e3
);
guestCleanupTimer.unref();
app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    service: "Inabakumori Fanswall Backend"
  });
});
app.get("/api/comments", (req, res) => {
  const rows = selectRecentCommentsStatement.all(
    Date.now(),
    MAX_PUBLIC_COMMENTS
  );
  const comments = rows.map((comment) => ({
    id: Number(comment.id),
    nickname: comment.nickname,
    content: comment.content,
    isGuest: Boolean(comment.is_guest),
    createdAt: new Date(comment.created_at).toISOString(),
    expiresAt: comment.expires_at === null ? null : new Date(comment.expires_at).toISOString()
  }));
  res.json({ comments });
});
app.post(
  "/api/comments",
  commentLimiter,
  requireJsonContentType,
  verifySession({ sessionRequired: false }),
  (req, res) => {
    const validation = validateCommentInput(req.body);
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.error,
        code: "INVALID_COMMENT"
      });
    }
    const { nickname, content } = validation;
    const isLoggedIn = req.session !== void 0;
    const userId = isLoggedIn ? req.session.getUserId() : null;
    const isGuest = !isLoggedIn;
    const createdAt = Date.now();
    const expiresAt = isGuest ? createdAt + 30 * 24 * 60 * 60 * 1e3 : null;
    const result = insertCommentStatement.run(
      nickname,
      content,
      userId,
      isGuest ? 1 : 0,
      createdAt,
      expiresAt
    );
    return res.status(201).json({
      success: true,
      comment: {
        id: Number(result.lastInsertRowid),
        nickname,
        content,
        isGuest,
        createdAt: new Date(createdAt).toISOString(),
        expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString()
      }
    });
  }
);
app.delete(
  "/api/comments/:id",
  verifySession(),
  (req, res) => {
    const commentId = Number(req.params.id);
    if (!Number.isSafeInteger(commentId) || commentId <= 0) {
      return res.status(400).json({
        error: "留言 ID 无效",
        code: "INVALID_COMMENT_ID"
      });
    }
    const currentUserId = req.session.getUserId();
    const comment = findCommentOwnerStatement.get(commentId);
    if (!comment) {
      return res.status(404).json({
        error: "找不到该留言",
        code: "COMMENT_NOT_FOUND"
      });
    }
    if (Boolean(comment.is_guest) || comment.user_id !== currentUserId) {
      return res.status(403).json({
        error: "你没有权限删除这条留言",
        code: "FORBIDDEN"
      });
    }
    const result = deleteOwnedCommentStatement.run(
      commentId,
      currentUserId
    );
    if (Number(result.changes) !== 1) {
      return res.status(404).json({
        error: "找不到该留言",
        code: "COMMENT_NOT_FOUND"
      });
    }
    return res.json({
      success: true,
      deletedCommentId: commentId
    });
  }
);
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API 路径不存在",
    code: "NOT_FOUND"
  });
});
app.use(errorHandler());
app.use((err, req, res, next) => {
  if (err?.message === "Origin not allowed by CORS") {
    return res.status(403).json({
      error: "Origin 不被允许",
      code: "CORS_ORIGIN_DENIED"
    });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: "请求内容过大",
      code: "PAYLOAD_TOO_LARGE"
    });
  }
  if (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, "body")) {
    return res.status(400).json({
      error: "JSON 格式不正确",
      code: "INVALID_JSON"
    });
  }
  if (res.headersSent) {
    return next(err);
  }
  if (IS_PRODUCTION) {
    console.error("Internal server error", {
      name: err?.name,
      message: err?.message
    });
  } else {
    console.error(err);
  }
  return res.status(500).json({
    error: "服务器发生错误",
    code: "INTERNAL_SERVER_ERROR"
  });
});
const server = app.listen(
  PORT,
  "127.0.0.1",
  () => {
    console.log(
      `✅ Backend running at http://127.0.0.1:${PORT}`
    );
    console.log(`🔐 Environment: ${NODE_ENV}`);
    console.log("💬 Guest comments expire after 30 days");
    console.log("👤 Logged-in comments do not automatically expire");
    console.log("🛡️ Core security enabled (lightweight mode)");
  }
);
function shutdown(signal) {
  console.log(`🛑 Received ${signal}. Shutting down...`);
  clearInterval(guestCleanupTimer);
  server.close(() => {
    try {
      db.close();
      console.log("✅ Database closed safely");
    } catch (error) {
      console.error("❌ Failed to close database", error);
    }
    console.log("✅ Server shut down safely");
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
