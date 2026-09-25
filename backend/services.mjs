import path from "node:path";

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

const LINK_PATTERN = /(?:https?:\/\/|www\.)/iu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{5,}\d)/u;
const PROMOTION_PATTERN = /(刷单|网赚|返利|代购|贷款|彩票|优惠折扣|扫码.{0,8}(进群|加群|领取)|加\s*(微信|微|好友|群)|(?:微信号|vx号|qq号)\s*[:：]?\s*[a-z0-9_-]+|(?:微信|wechat|qq|telegram|whatsapp|discord|line)\s*[:：]\s*[@a-z0-9_-]+|联系方式\s*[:：]|\bcontact\s*me\b|\bbuy\s*now\b|\bdiscount\b|\bpromo\b|\baffiliate\b)/iu;

export function hasVerifiedAdminEmail(user, allowedEmails) {
  return Boolean(user?.loginMethods?.some(method => method.verified === true &&
    typeof method.email === "string" && allowedEmails.has(method.email.trim().toLowerCase())));
}

export function normalizeCommentForComparison(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("und");
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

export function registerCommentManagement(app, db, verifySession) {
  const list = db.prepare(`SELECT id, nickname, content, created_at FROM comments
    WHERE user_id = ? AND is_guest = 0 AND id < ? ORDER BY id DESC LIMIT 21`);
  const owner = db.prepare("SELECT user_id, is_guest FROM comments WHERE id = ?");
  const remove = db.prepare("DELETE FROM comments WHERE id = ? AND user_id = ? AND is_guest = 0");
  app.get("/api/comments/mine", verifySession(), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : Number(req.query.before);
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
    const id = Number(req.params.id);
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
    const before = req.query?.before === undefined ? Number.MAX_SAFE_INTEGER : Number(req.query.before);
    if (!Number.isSafeInteger(before) || before <= 0) return res.status(400).json({ code: "INVALID_CURSOR" });
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
    const id = Number(req.params.id);
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
        link.searchParams.set("token", source.searchParams.get("token") || "");
        link.searchParams.set("tenantId", input.tenantId);
        return original.sendEmail({ ...input, passwordResetLink: link.href });
      }
    })
  };
}
