import path from "node:path";
import { isIP } from "node:net";
import { createHash } from "node:crypto";

// SuperTokens can parse an unparsed request itself, without Express's body limit.
// Require JSON before either parser sees a body, including chunked requests and
// requests without Content-Type. Bodyless session refresh/sign-out remains valid.
export function requireJsonRequestBody(req, res, next) {
  const hasBody = req.headers["transfer-encoding"] !== undefined ||
    (req.headers["content-length"] !== undefined && req.headers["content-length"] !== "0");
  if (!hasBody || req.is("application/json")) return next();
  return res.status(415).json({ error: "请求必须使用 application/json", code: "UNSUPPORTED_MEDIA_TYPE" });
}

// Vercel's canonical copy takes priority over X-Forwarded-For, which an upstream
// proxy can overwrite. Only platform IP headers are trusted on Vercel:
// https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
// Railway's public HTTP ingress sets X-Real-IP. Custom headers elsewhere require
// an ingress that overwrites them; "none" disables header-based resolution.
export function clientIpResolver(env) {
  const configured = String(env.CLIENT_IP_HEADER ?? "").trim().toLowerCase();
  const onVercel = env.VERCEL === "1";
  const vercelHeaders = ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"];
  if (configured && configured !== "none" && !/^[a-z0-9-]{1,64}$/u.test(configured)) throw new Error("CLIENT_IP_HEADER must be a header name");
  if (onVercel && configured && configured !== "none" && !vercelHeaders.includes(configured)) {
    throw new Error("Vercel CLIENT_IP_HEADER must name a platform IP header or none");
  }
  const headers = configured === "none" ? [] : onVercel
    ? [...new Set([vercelHeaders[0], ...(configured ? [configured] : []), ...vercelHeaders])]
    : [configured || (env.RAILWAY_SERVICE_ID ? "x-real-ip" : "")].filter(Boolean);
  return req => {
    for (const header of headers) {
      const raw = req.get?.(header);
      if (raw === undefined || raw === null || raw === "") continue;
      if (typeof raw !== "string") break;
      const value = raw.trim();
      if (!value) continue;
      if (isIP(value)) return value;
      // A present but malformed canonical header must not cause a downgrade to
      // another header. In particular, never choose a hop from a comma list.
      break;
    }
    // Runtime sockets on Vercel identify proxies, not a trusted visitor. Return
    // a missing-identity sentinel for the caller's identity middleware instead.
    if (onVercel) return "0.0.0.0";
    for (const value of [req.ip, req.socket?.remoteAddress]) {
      if (typeof value === "string" && isIP(value.trim())) return value.trim();
    }
    return "0.0.0.0";
  };
}

export function positiveInteger(value, fallback = null) {
  if (value === undefined) return fallback;
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^[1-9]\d{0,15}$/u.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

// With the u flag a valid surrogate pair is one code point, so only unpaired halves match.
export const LONE_SURROGATE = /[\uD800-\uDFFF]/u;
// A comment may be multi-paragraph, but not a wall-stretching column of blank lines.
const MAX_COMMENT_LINE_BREAKS = 15;
export function validateCommentInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.nickname !== "string" || typeof body.content !== "string") {
    return { ok: false, error: "昵称和留言必须为文本", code: "INVALID_COMMENT" };
  }
  // Lone (unpaired) UTF-16 surrogates are not text: they cannot be stored or displayed reliably.
  if (LONE_SURROGATE.test(body.nickname) || LONE_SURROGATE.test(body.content)) {
    return { ok: false, error: "请输入有效的昵称和留言", code: "INVALID_COMMENT" };
  }
  const nickname = body.nickname.normalize("NFC").trim();
  // Normalise both platform and Unicode forced line breaks before collapsing/capping them:
  // the wall renders pre-wrap, so uncounted separators could stretch one comment into a column.
  const content = body.content.normalize("NFC").replace(/\r\n?|[\u2028\u2029]/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
  if ((content.match(/\n/gu) || []).length > MAX_COMMENT_LINE_BREAKS) {
    return { ok: false, error: `留言换行太多，最多 ${MAX_COMMENT_LINE_BREAKS} 个换行`, code: "TOO_MANY_LINE_BREAKS" };
  }
  // Invisible "filler" characters (Hangul fillers, word joiner, soft hyphen, ...) do not count as visible text.
  // U+2800 (Braille blank) and U+1D159 (musical null notehead) are graphic-visible to the engine but
  // paint nothing, so they are stripped here as well instead of relying on Default_Ignorable alone.
  const visible = value => value.replace(/[\s\p{Default_Ignorable_Code_Point}\u115F\u1160\u3164\uFFA0\u2800\u{1D159}]/gu, "").length > 0;
  // Preserve emoji joiners and normal line breaks; reject terminal and bidi controls (incl. LRM/RLM/ALM).
  const unsafeControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
  if (!visible(nickname) || !visible(content) || /[\r\n\t\u2028\u2029]/u.test(nickname) ||
      unsafeControls.test(nickname) || unsafeControls.test(content)) {
    return { ok: false, error: "请输入有效的昵称和留言", code: "INVALID_COMMENT" };
  }
  if (Array.from(nickname).length > 30 || Array.from(content).length > 500) {
    return { ok: false, error: "昵称最多 30 字，留言最多 500 字", code: "INVALID_COMMENT" };
  }
  const issue = detectCommentSafetyIssue(nickname) || detectCommentSafetyIssue(content);
  if (issue) return { ok: false, ...issue };
  return { ok: true, nickname, content };
}

export function websiteLocation(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Website URL must be an HTTP(S) URL without credentials");
  }
  url.search = "";
  url.hash = "";
  return { origin: url.origin, url: url.href };
}

// Extra browser origins allowed by CORS, e.g. the old GitHub Pages origin during a domain move.
// Only bare origins are accepted (no paths, wildcards or credentials); production requires HTTPS.
export function parseAdditionalOrigins(value, { production = false } = {}) {
  const origins = [];
  for (const entry of String(value ?? "").split(",").map(item => item.trim()).filter(Boolean)) {
    let url;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`ADDITIONAL_WEBSITE_ORIGINS entry is not a URL: ${entry}`);
    }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash || entry.includes("*")) {
      throw new Error(`ADDITIONAL_WEBSITE_ORIGINS entries must be bare origins: ${entry}`);
    }
    if (production && url.protocol !== "https:") {
      throw new Error(`ADDITIONAL_WEBSITE_ORIGINS must use HTTPS in production: ${entry}`);
    }
    origins.push(url.origin);
  }
  return origins;
}

export function resolveDatabasePath(env, directory) {
  if (env.VERCEL === "1") {
    throw new Error("Vercel requires a persistent remote database; local SQLite is not supported");
  }
  const configured = env.COMMENTS_DB_PATH?.trim();
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (env.NODE_ENV === "production" && env.RAILWAY_SERVICE_ID && !mount) {
    throw new Error("Attach a Railway volume before storing production comments");
  }
  if (mount && !path.isAbsolute(mount)) {
    throw new Error("RAILWAY_VOLUME_MOUNT_PATH must be absolute");
  }
  if (env.NODE_ENV === "production" && !configured && !mount) {
    throw new Error("Production requires COMMENTS_DB_PATH or a Railway volume");
  }
  if (env.NODE_ENV === "production" && configured && !path.isAbsolute(configured)) {
    throw new Error("Production COMMENTS_DB_PATH must be absolute");
  }
  const databasePath = configured ? path.resolve(configured) : path.join(mount || directory, "comments.db");
  if (mount) {
    const relative = path.relative(path.resolve(mount), databasePath);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("COMMENTS_DB_PATH must be inside the Railway volume");
    }
  }
  return databasePath;
}

const LINK_TLDS = "com|net|org|io|be|cn|jp|me|tv|cc|co|app|xyz|info|link|ly|gl|gg|ru|uk|de|fr|kr|tw|hk|sg|ai|dev|page|site|shop|top|vip|pw|ws|to|im|fm|so|vc|is|it|us|eu|edu|gov";
// TLDs that are also everyday English words ("life.is good", "this.so much", "wait.me too"):
// a bare name ending in one of these only counts as a link when a path follows it.
const WORD_TLDS = "be|me|to|im|so|is|it|us";
const BARE_TLDS = LINK_TLDS.split("|").filter(tld => !WORD_TLDS.split("|").includes(tld)).join("|");
const LINK_PATTERN = new RegExp(String.raw`(?:https?:\/\/|hxxps?:\/\/|www\.)|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:${BARE_TLDS})\b|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:${WORD_TLDS})\/[^\s]|(?:[a-z0-9-]{2,}\s*(?:\[\.\]|\(\.\)|\bdot\b)\s*)+(?:${LINK_TLDS})\b`, "iu");
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
// Chinese mobiles, 0-prefixed landlines, and explicit +country numbers.
// Dates (2026-09-14), plain counters, and dotted IPs are not phones.
// A bare 11-digit number ("listened 13812345678 times") is only a phone with a +country code,
// mobile-style grouping (138 1234 5678 / 138-1234-5678) or a contact word right before it.
const PHONE_PATTERN = /(?<![\d])(?:\+\d{1,3}[\s.-]*(?:1[3-9](?:[\s.-]*\d){9}|(?:\d[\s.-]*){6,12}\d)|1[3-9]\d[\s.-]+\d{4}[\s.-]+\d{4}|(?:电话|手机|号码|致电|打给?我|联系|加(?=\s*(?:我|个|一下|好友|微信|v|wx|vx|qq|q|扣|企鹅))|好友|微信|wx|vx|qq|tel|phone|call|mobile|whatsapp)[^\d\n]{0,6}1[3-9](?:[\s.-]*\d){9}|\(?0\d{2,3}\)?[\s.-]+(?:\d[\s.-]*){6,8}\d)(?![\d])/iu;
// Advertising phrases, not single words: "用彩票的心情等新歌" or "promo of the new album" are fan talk.
const PROMOTION_PATTERN = /(刷单|网赚|返利|(?:无抵押|低息|秒批|快速|网上|小额)贷款|贷款.{0,6}(?:平台|办理|秒批|秒到|下款|额度|找我)|(?:彩票|博彩|时时彩).{0,6}(?:平台|代理|充值|计划|导师|带单)|(?:买|跟)彩票.{0,4}(?:找我|加我|进群)|优惠折扣|扫码.{0,8}(进群|加群|领取)|加\s*(?:一下|一个|下|个|只)?\s*(?:我的\s*)?(微信|微信号?|微|群|qq|vx|v信|威信|wx)|(?:微信号|vx号|qq号)\s*[:：]?\s*[a-z0-9_-]+|(?:微信|wechat|qq|telegram|whatsapp|discord|line|vx|wx|v信)\s*[:：]\s*[@a-z0-9_-]+|联系方式\s*[:：]|\bcontact\s*me\s*(?:on|at|via|through|@|[:：])|\bbuy\s*now\b|\b(?:discount|promo|coupon)\s*codes?\b|\buse\s+(?:my\s+)?code\b|\b\d{1,3}\s*%\s*off\b|\baffiliate\s*link|\bdm\s*me\s*(?:for|to)\b|代购\s*(?:加|联系|咨询|下单|私|微|vx|wx|qq|群|找我|加我))/iu;

// Administrators are granted only by stable SuperTokens user IDs (ADMIN_USER_IDS).
// Emails are not used: signing up with an address does not prove ownership of it.
export function parseAdminUserIds(value) {
  return new Set(String(value ?? "").split(",").map(item => item.trim()).filter(Boolean));
}

export function createAdminCheck(adminUserIds) {
  return async userId => typeof userId === "string" && userId.length > 0 && adminUserIds.has(userId);
}

// Short deploy identifier for /healthz; only a public git commit prefix, never env details.
export function buildVersion(env) {
  for (const value of [env.VERCEL_GIT_COMMIT_SHA, env.RAILWAY_GIT_COMMIT_SHA]) {
    const sha = String(value ?? "").trim();
    if (/^[0-9a-f]{7,40}$/iu.test(sha)) return sha.slice(0, 7).toLowerCase();
  }
  return "dev";
}

export function normalizeCommentForComparison(value) {
  // Strip everything that renders as nothing (word joiner, soft hyphen, braille blank, fillers):
  // otherwise "138<U+2800>1234<U+2800>5678" or "微信<U+2060>：abc" would read like a phone/contact to a
  // human while slipping past the link/contact patterns and the duplicate check.
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\p{Default_Ignorable_Code_Point}\u115F\u1160\u3164\uFFA0\u{1D159}]/gu, "")
    .replace(/[\s\u2800]+/gu, " ")
    .trim()
    .toLocaleLowerCase("und");
}

// Requests can arrive with doubled or backslash separators ("//auth/signin", "\\api\\comments"). The
// WHATWG URL parser reads "//auth" as a *host* and would report "/signin", so the rate limiters and
// the backup-path check would look at the wrong path. Collapse separators and resolve . / .. first.
export function normalizeRequestPath(value) {
  let raw = String(value ?? "");
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      return "";
    }
  }
  let pathname = raw.split(/[?#]/u)[0].replace(/\\/gu, "/");
  // Percent-encoded separators and dots must collapse too ("/outside/%2e%2e/auth/signin"), exactly
  // like the WHATWG URL parser used to do for us. Malformed escapes keep the raw path.
  try {
    pathname = decodeURIComponent(pathname);
  } catch { /* keep raw */ }
  const parts = [];
  for (const part of pathname.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { parts.pop(); continue; }
    parts.push(part);
  }
  return `/${parts.join("/")}`.toLocaleLowerCase("und");
}

// Members: same text within 10 minutes is scoped to the account.
// Guests: mild global same-text window (5 minutes) for longer posts only.
// Short phrases such as "喜欢" are not globally unique.
const GUEST_GLOBAL_DEDUP_MIN_LENGTH = 8;
export function createRecentDuplicateChecker(db, {
  memberWindowMs = 10 * 60 * 1000,
  guestWindowMs = 5 * 60 * 1000
} = {}) {
  const recentMember = db.prepare(`SELECT content FROM comments
    WHERE user_id = ? AND is_guest = 0 AND created_at > ?
      AND (expires_at IS NULL OR expires_at > ?)`);
  const recentGuest = db.prepare(`SELECT content FROM comments
    WHERE is_guest = 1 AND created_at > ?
      AND (expires_at IS NULL OR expires_at > ?)`);
  return (content, userId, now = Date.now()) => {
    const normalized = normalizeCommentForComparison(content);
    if (userId) {
      return recentMember.all(userId, now - memberWindowMs, now)
        .some(row => normalizeCommentForComparison(row.content) === normalized);
    }
    if (Array.from(normalized).length < GUEST_GLOBAL_DEDUP_MIN_LENGTH) return false;
    return recentGuest.all(now - guestWindowMs, now)
      .some(row => normalizeCommentForComparison(row.content) === normalized);
  };
}

// Invisible characters are often used as separators ("138<U+2800>1234<U+2800>5678" reads like a phone
// number). For the filter they become spaces, so the patterns see the separators a human sees; the
// duplicate check keeps deleting them instead, so "text<U+2060>" still matches "text".
function withVisibleSeparators(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\p{Default_Ignorable_Code_Point}\u115F\u1160\u3164\uFFA0\u{1D159}\u2800]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("und");
}

export function detectCommentSafetyIssue(content) {
  const value = normalizeCommentForComparison(content);
  const spaced = withVisibleSeparators(content);
  if ([value, spaced].some(candidate =>
    LINK_PATTERN.test(candidate) || EMAIL_PATTERN.test(candidate) ||
    PHONE_PATTERN.test(candidate) || PROMOTION_PATTERN.test(candidate))) {
    return {
      code: "PROMOTIONAL_CONTENT",
      error: "留言内容不能包含链接、邮箱、电话号码或广告联系方式"
    };
  }
  return null;
}

// Check and insert in one write transaction so two identical posts cannot both pass.
export function insertFreshComment(db, { duplicate, insert, countMember, memberCap = 100, row }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (duplicate(row.content, row.userId, row.createdAt)) {
      db.exec("ROLLBACK");
      return { ok: false, code: "DUPLICATE_COMMENT" };
    }
    if (row.userId && memberCap > 0) {
      const count = Number(countMember.get(row.userId)?.n || 0);
      if (count >= memberCap) {
        db.exec("ROLLBACK");
        return { ok: false, code: "MEMBER_COMMENT_CAP" };
      }
    }
    const result = insert.run(row.nickname, row.content, row.userId, row.isGuest ? 1 : 0, row.createdAt, row.expiresAt);
    db.exec("COMMIT");
    return { ok: true, id: Number(result.lastInsertRowid) };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
    throw error;
  }
}

// Remote database calls are asynchronous. Keep every read and the insert in
// the same write transaction so concurrent requests cannot bypass dedup or cap.
export async function insertFreshCommentAsync(db, { memberCap = 100, row }) {
  return db.transaction(async tx => {
    const normalized = normalizeCommentForComparison(row.content);
    const needsDedup = Boolean(row.userId) || Array.from(normalized).length >= GUEST_GLOBAL_DEDUP_MIN_LENGTH;
    if (db.kind === "postgres" && needsDedup) {
      // Members share a lock across all their text to protect the account cap.
      // Guests only conflict with equivalent long text. Separate prefixes keep
      // those scopes independent; negative keys cannot hit the positive schema gate.
      const identity = row.userId ? `member\0${row.userId}` : `guest\0${normalized}`;
      const digest = createHash("sha256").update(identity).digest();
      const lock = (digest.readBigInt64BE(0) | -(1n << 63n)).toString();
      await tx.prepare("SELECT pg_advisory_xact_lock(?)").get(lock);
    }
    if (needsDedup) {
      const recent = row.userId
        ? await tx.prepare(`SELECT content FROM comments
          WHERE user_id = ? AND is_guest = 0 AND created_at > ?
            AND (expires_at IS NULL OR expires_at > ?)`)
          .all(row.userId, row.createdAt - 10 * 60 * 1000, row.createdAt)
        : await tx.prepare(`SELECT content FROM comments
          WHERE is_guest = 1 AND created_at > ?
            AND (expires_at IS NULL OR expires_at > ?)`)
          .all(row.createdAt - 5 * 60 * 1000, row.createdAt);
      if (recent.some(comment => normalizeCommentForComparison(comment.content) === normalized)) {
        return { ok: false, code: "DUPLICATE_COMMENT" };
      }
    }
    if (row.userId && memberCap > 0) {
      const count = await tx.prepare("SELECT count(*) AS n FROM comments WHERE user_id = ? AND is_guest = 0").get(row.userId);
      if (Number(count?.n || 0) >= memberCap) return { ok: false, code: "MEMBER_COMMENT_CAP" };
    }
    const result = await tx.prepare(`INSERT INTO comments (nickname, content, user_id, is_guest, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(row.nickname, row.content, row.userId, row.isGuest ? 1 : 0, row.createdAt, row.expiresAt);
    return { ok: true, id: Number(result.lastInsertRowid) };
  });
}

export function registerCommentManagement(app, db, verifySession, onDeleted = () => {}) {
  const list = db.prepare(`SELECT id, nickname, content, created_at FROM comments
    WHERE user_id = ? AND is_guest = 0 AND id <= ? ORDER BY id DESC LIMIT 21`);
  const owner = db.prepare("SELECT user_id, is_guest FROM comments WHERE id = ?");
  const remove = db.prepare("DELETE FROM comments WHERE id = ? AND user_id = ? AND is_guest = 0");
  app.get("/api/comments/mine", verifySession(), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const before = positiveInteger(req.query.before, Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before <= 0) {
      return res.status(400).json({ error: "留言分页参数无效", code: "INVALID_CURSOR" });
    }
    const upperBound = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : before - 1;
    const rows = await list.all(req.session.getUserId(), upperBound);
    const comments = rows.slice(0, 20).map(row => ({
      id: Number(row.id), nickname: row.nickname, content: row.content,
      createdAt: new Date(row.created_at).toISOString()
    }));
    res.json({ comments, nextCursor: rows.length > 20 ? comments.at(-1).id : null });
  });
  app.delete("/api/comments/:id", verifySession(), async (req, res) => {
    const id = positiveInteger(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: "留言 ID 无效", code: "INVALID_COMMENT_ID" });
    }
    const userId = req.session.getUserId();
    const comment = await owner.get(id);
    if (!comment) return res.status(404).json({ error: "找不到该留言", code: "COMMENT_NOT_FOUND" });
    if (Boolean(comment.is_guest) || comment.user_id !== userId) {
      return res.status(403).json({ error: "你没有权限删除这条留言", code: "FORBIDDEN" });
    }
    if (Number((await remove.run(id, userId)).changes) !== 1) {
      return res.status(404).json({ error: "找不到该留言", code: "COMMENT_NOT_FOUND" });
    }
    onDeleted();
    res.json({ success: true, deletedCommentId: id });
  });
}

export function registerAdminCommentManagement(app, db, verifySession, isAdmin, onDeleted = () => {}) {
  const list = db.prepare(`SELECT id, nickname, content, is_guest, created_at
    FROM comments
    WHERE (expires_at IS NULL OR expires_at > ?) AND id <= ?
    ORDER BY id DESC LIMIT 51`);
  const remove = db.prepare("DELETE FROM comments WHERE id = ?");
  const requireAdmin = async (req, res, next) => {
    try {
      if (!req.session || !(await isAdmin(req.session.getUserId()))) {
        return res.status(403).json({ error: "管理员权限不足", code: "ADMIN_REQUIRED" });
      }
      return next();
    } catch {
      return res.status(403).json({ error: "管理员权限不足", code: "ADMIN_REQUIRED" });
    }
  };
  app.get("/api/admin/comments", verifySession(), requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const before = positiveInteger(req.query?.before, Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before <= 0) return res.status(400).json({ error: "留言分页参数无效", code: "INVALID_CURSOR" });
    const upperBound = req.query?.before === undefined ? Number.MAX_SAFE_INTEGER : before - 1;
    const rows = await list.all(Date.now(), upperBound);
    const comments = rows.slice(0, 50).map(row => ({
      id: Number(row.id),
      nickname: row.nickname,
      content: row.content,
      isGuest: Boolean(row.is_guest),
      createdAt: new Date(row.created_at).toISOString()
    }));
    res.json({ comments, nextCursor: rows.length > 50 ? comments.at(-1).id : null });
  });
  app.delete("/api/admin/comments/:id", verifySession(), requireAdmin, async (req, res) => {
    const id = positiveInteger(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: "留言 ID 无效", code: "INVALID_COMMENT_ID" });
    }
    if (Number((await remove.run(id)).changes) !== 1) {
      return res.status(404).json({ error: "找不到该留言", code: "COMMENT_NOT_FOUND" });
    }
    onDeleted();
    return res.json({ success: true, deletedCommentId: id });
  });
}

export function passwordResetDelivery(websiteDomain) {
  return {
    override: original => ({
      ...original,
      async sendEmail(input) {
        const source = new URL(input.passwordResetLink);
        const link = new URL(websiteDomain);
        link.search = "";
        link.hash = "";
        link.searchParams.set("resetPassword", "1");
        const token = source.searchParams.get("token") || "";
        const tenantId = input.tenantId || "public";
        // Token stays in the fragment so GitHub Pages request logs do not store it.
        const hash = new URLSearchParams({ token, tenantId }).toString();
        return original.sendEmail({
          ...input,
          passwordResetLink: `${link.origin}${link.pathname}${link.search}#${hash}`
        });
      }
    })
  };
}

// SuperTokens keeps existing sessions after a password reset. Revoke all of the user's
// sessions (across tenants and linked accounts) once the reset succeeded. A revocation
// failure is logged without tokens or emails and never turns a completed reset into a 500.
export function revokeSessionsAfterPasswordReset(passwordResetPOST, revokeAllSessionsForUser, log = console) {
  return async input => {
    const response = await passwordResetPOST(input);
    if (response?.status !== "OK") return response;
    const userId = response.user?.id;
    if (typeof userId !== "string" || !userId) {
      log.warn("Password reset succeeded without a user id; no sessions revoked");
      return response;
    }
    // The reset token is already consumed and the new password already stored, so a revocation
    // failure must never surface as a 500. One immediate retry covers a transient hiccup between
    // this process and the Core; if it still fails the error is logged with name/code only (no user
    // id, token or address) and the reset still reports success.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await revokeAllSessionsForUser(userId);
        return response;
      } catch (error) {
        if (attempt === 2) log.error("Session revocation after password reset failed", { name: error?.name, code: error?.code });
      }
    }
    return response;
  };
}

// Client errors raised by middleware (body-parser: corrupt gzip/deflate/br, bad Content-Length, ...)
// keep their 4xx status. The body is always generic so the error's own message never leaks.
export function clientErrorResponse(err) {
  const status = Number(err?.status ?? err?.statusCode);
  if (!Number.isInteger(status) || status < 400 || status > 499) return null;
  return { status, body: { error: "请求无法处理，请刷新页面后重试", code: "BAD_REQUEST" } };
}

// Final Express error handler; kept here so tests can mount it on an isolated app.
export function createFinalErrorHandler({ isProduction }) {
  return (err, req, res, next) => {
  // A response that already started cannot be replaced by any of the JSON errors below.
  if (res.headersSent) {
    return next(err);
  }
  if (err?.message === "Origin not allowed by CORS") {
    return res.status(403).json({ error: "当前网页无法访问此服务，请从本站网址打开", code: "CORS_ORIGIN_DENIED" });
  }
  if (err?.code === "DATABASE_UNAVAILABLE") {
    res.setHeader("Retry-After", "5");
    return res.status(503).json({ error: "数据库暂时不可用，请稍后重试", code: "DATABASE_UNAVAILABLE" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "请求内容过大", code: "PAYLOAD_TOO_LARGE" });
  }
  if (err?.type === "charset.unsupported" || err?.type === "encoding.unsupported") {
    return res.status(415).json({ error: "请求的字符集或压缩格式不受支持", code: "UNSUPPORTED_MEDIA_TYPE" });
  }
  if (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, "body")) {
    return res.status(400).json({ error: "请求格式不正确，请刷新页面后重试", code: "INVALID_JSON" });
  }
  // Any other client error (e.g. body-parser's 400 for a corrupt gzip/deflate/br body) keeps its 4xx
  // status; only a generic message is sent, never the error's own text.
  const clientError = clientErrorResponse(err);
  if (clientError) return res.status(clientError.status).json(clientError.body);
  if (isProduction) {
    console.error("Internal server error", { requestId: req.requestId, name: err?.name, code: err?.code });
  } else {
    console.error(err);
  }
  if (err?.code === "ERR_SQLITE_ERROR" && /(?:busy|locked)/iu.test(err.message || "")) {
    res.setHeader("Retry-After", "2");
    return res.status(503).json({ error: "服务器忙，请稍后重试", code: "DATABASE_BUSY", requestId: req.requestId });
  }
  return res.status(500).json({ error: "服务器发生错误", code: "INTERNAL_SERVER_ERROR", requestId: req.requestId });
};
}
