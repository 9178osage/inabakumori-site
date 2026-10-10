import path from "node:path";

export function positiveInteger(value, fallback = null) {
  if (value === undefined) return fallback;
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^[1-9]\d{0,15}$/u.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function validateCommentInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.nickname !== "string" || typeof body.content !== "string") {
    return { ok: false, error: "昵称和留言必须为文本", code: "INVALID_COMMENT" };
  }
  const nickname = body.nickname.normalize("NFC").trim();
  const content = body.content.normalize("NFC").trim();
  const visible = value => value.replace(/[\s\u200B-\u200D\uFEFF]/gu, "").length > 0;
  // Preserve emoji joiners and normal line breaks; reject terminal and bidi controls.
  const unsafeControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;
  if (!visible(nickname) || !visible(content) || /[\r\n\t]/u.test(nickname) ||
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

export function resolveDatabasePath(env, directory) {
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
const LINK_PATTERN = new RegExp(String.raw`(?:https?:\/\/|hxxps?:\/\/|www\.)|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:${LINK_TLDS})\b|(?:[a-z0-9-]{2,}\s*(?:\[\.\]|\(\.\)|\bdot\b)\s*)+(?:${LINK_TLDS})\b`, "iu");
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
// Chinese mobiles, 0-prefixed landlines, and explicit +country numbers.
// Dates (2026-09-14), plain counters, and dotted IPs are not phones.
const PHONE_PATTERN = /(?<![\d])(?:\+\d{1,3}[\s.-]*)?(?:1[3-9](?:[\s.-]*\d){9}|\(?0\d{2,3}\)?[\s.-]+(?:\d[\s.-]*){6,8}\d)(?![\d])/u;
const PROMOTION_PATTERN = /(刷单|网赚|返利|代购|贷款|彩票|优惠折扣|扫码.{0,8}(进群|加群|领取)|加\s*(?:一下|一个|下|个|只)?\s*(?:我的\s*)?(微信|微信号?|微|群|qq|vx|v信|威信|wx)|(?:微信号|vx号|qq号)\s*[:：]?\s*[a-z0-9_-]+|(?:微信|wechat|qq|telegram|whatsapp|discord|line|vx|wx|v信)\s*[:：]\s*[@a-z0-9_-]+|联系方式\s*[:：]|\bcontact\s*me\b|\bbuy\s*now\b|\bdiscount\b|\bpromo\b|\baffiliate\b)/iu;

export function hasVerifiedAdminEmail(user, allowedEmails) {
  // Signup alone does not prove ownership of an allowlisted email address.
  // Without email verification, provision administrators through ADMIN_USER_IDS.
  return Boolean(user?.loginMethods?.some(method =>
    method.verified === true && typeof method.email === "string" && allowedEmails.has(method.email.trim().toLowerCase())));
}

export function normalizeCommentForComparison(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("und");
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
    WHERE user_id = ? AND is_guest = 0 AND created_at > ?`);
  const recentGuest = db.prepare(`SELECT content FROM comments
    WHERE is_guest = 1 AND created_at > ?`);
  return (content, userId, now = Date.now()) => {
    const normalized = normalizeCommentForComparison(content);
    if (userId) {
      return recentMember.all(userId, now - memberWindowMs)
        .some(row => normalizeCommentForComparison(row.content) === normalized);
    }
    if (Array.from(normalized).length < GUEST_GLOBAL_DEDUP_MIN_LENGTH) return false;
    return recentGuest.all(now - guestWindowMs)
      .some(row => normalizeCommentForComparison(row.content) === normalized);
  };
}

export function detectCommentSafetyIssue(content) {
  const value = normalizeCommentForComparison(content);
  if (LINK_PATTERN.test(value) || EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value) || PROMOTION_PATTERN.test(value)) {
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

export function registerCommentManagement(app, db, verifySession) {
  const list = db.prepare(`SELECT id, nickname, content, created_at FROM comments
    WHERE user_id = ? AND is_guest = 0 AND id < ? ORDER BY id DESC LIMIT 21`);
  const owner = db.prepare("SELECT user_id, is_guest FROM comments WHERE id = ?");
  const remove = db.prepare("DELETE FROM comments WHERE id = ? AND user_id = ? AND is_guest = 0");
  app.get("/api/comments/mine", verifySession(), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const before = positiveInteger(req.query.before, Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before <= 0) {
      return res.status(400).json({ error: "留言分页参数无效", code: "INVALID_CURSOR" });
    }
    const rows = list.all(req.session.getUserId(), before);
    const comments = rows.slice(0, 20).map(row => ({
      id: Number(row.id), nickname: row.nickname, content: row.content,
      createdAt: new Date(row.created_at).toISOString()
    }));
    res.json({ comments, nextCursor: rows.length > 20 ? comments.at(-1).id : null });
  });
  app.delete("/api/comments/:id", verifySession(), (req, res) => {
    const id = positiveInteger(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: "留言 ID 无效", code: "INVALID_COMMENT_ID" });
    }
    const userId = req.session.getUserId();
    const comment = owner.get(id);
    if (!comment) return res.status(404).json({ error: "找不到该留言", code: "COMMENT_NOT_FOUND" });
    if (Boolean(comment.is_guest) || comment.user_id !== userId) {
      return res.status(403).json({ error: "你没有权限删除这条留言", code: "FORBIDDEN" });
    }
    if (Number(remove.run(id, userId).changes) !== 1) {
      return res.status(404).json({ error: "找不到该留言", code: "COMMENT_NOT_FOUND" });
    }
    res.json({ success: true, deletedCommentId: id });
  });
}

export function registerAdminCommentManagement(app, db, verifySession, isAdmin) {
  const list = db.prepare(`SELECT id, nickname, content, is_guest, created_at
    FROM comments
    WHERE (expires_at IS NULL OR expires_at > ?) AND id < ?
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
  app.get("/api/admin/comments", verifySession(), requireAdmin, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const before = positiveInteger(req.query?.before, Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before <= 0) return res.status(400).json({ error: "留言分页参数无效", code: "INVALID_CURSOR" });
    const rows = list.all(Date.now(), before);
    const comments = rows.slice(0, 50).map(row => ({
      id: Number(row.id),
      nickname: row.nickname,
      content: row.content,
      isGuest: Boolean(row.is_guest),
      createdAt: new Date(row.created_at).toISOString()
    }));
    res.json({ comments, nextCursor: rows.length > 50 ? comments.at(-1).id : null });
  });
  app.delete("/api/admin/comments/:id", verifySession(), requireAdmin, (req, res) => {
    const id = positiveInteger(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: "留言 ID 无效", code: "INVALID_COMMENT_ID" });
    }
    if (Number(remove.run(id).changes) !== 1) {
      return res.status(404).json({ error: "找不到该留言", code: "COMMENT_NOT_FOUND" });
    }
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
