// Server-to-server SQLite snapshot download for off-site backups.
// Disabled (404) unless BACKUP_TOKEN is set to at least 32 characters.
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backupDatabase } from "./backup.mjs";

export const BACKUP_PATH = "/api/admin/backup";
export const MIN_BACKUP_TOKEN_LENGTH = 32;

export function backupTokenFrom(env) {
  const token = String(env.BACKUP_TOKEN ?? "").trim();
  return token.length >= MIN_BACKUP_TOKEN_LENGTH ? token : null;
}

export function isBackupPath(url) {
  try {
    return new URL(url, "http://localhost").pathname.replace(/\/+$/u, "").toLowerCase() === BACKUP_PATH;
  } catch {
    return false;
  }
}

// Hash both sides first so timingSafeEqual always compares equal-length buffers.
export function bearerMatches(header, token) {
  if (!token || typeof header !== "string") return false;
  const match = /^Bearer ([\x21-\x7E]{1,512})$/u.exec(header.trim());
  if (!match) return false;
  const given = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(token).digest();
  return timingSafeEqual(given, expected);
}

export function backupFilename(now = new Date()) {
  return `comments-${now.toISOString().slice(0, 10).replaceAll("-", "")}.db`;
}

export function registerBackupEndpoint(app, { databasePath, token, limiter, log = console }) {
  const disabled = (req, res, next) => token ? next() : res.status(404).json({ error: "API 路径不存在", code: "NOT_FOUND" });
  app.get(BACKUP_PATH, disabled, limiter, async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") return res.status(405).json({ error: "只支持 GET", code: "METHOD_NOT_ALLOWED" });
    if (!bearerMatches(req.get("authorization"), token)) {
      log.warn("Backup request denied", { requestId: req.requestId, ip: req.ip });
      return res.status(401).json({ error: "未授权", code: "UNAUTHORIZED" });
    }
    let directory;
    const cleanup = () => directory && rm(directory, { recursive: true, force: true }).catch(() => {});
    try {
      directory = await mkdtemp(path.join(os.tmpdir(), "inabakumori-backup-"));
      const file = path.join(directory, "snapshot.db");
      await backupDatabase(databasePath, file);
      const { size } = await stat(file);
      log.log("Backup served", { requestId: req.requestId, ip: req.ip, size });
      res.status(200);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(size));
      res.setHeader("Content-Disposition", `attachment; filename="${backupFilename()}"`);
      res.on("close", cleanup);
      const stream = createReadStream(file);
      stream.on("error", error => { cleanup(); res.destroy(error); });
      stream.pipe(res);
    } catch (error) {
      await cleanup();
      next(error);
    }
  });
}
