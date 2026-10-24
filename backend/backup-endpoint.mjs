// Server-to-server SQLite snapshot download for off-site backups.
// Disabled (404) unless BACKUP_TOKEN is set to at least 32 characters.
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backupDatabase } from "./backup.mjs";
import { normalizeRequestPath } from "./services.mjs";

const BACKUP_PATH = "/api/admin/backup";
const MIN_BACKUP_TOKEN_LENGTH = 32;

export function backupTokenFrom(env) {
  const token = String(env.BACKUP_TOKEN ?? "").trim();
  return token.length >= MIN_BACKUP_TOKEN_LENGTH ? token : null;
}

export function isBackupPath(url) {
  // Shares the path normaliser used by the rate limiters: "//api/admin/backup" and
  // "/api//admin/backup/" must be recognised as the backup path, not treated as ordinary API traffic.
  return normalizeRequestPath(url) === BACKUP_PATH;
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

export function registerBackupEndpoint(app, { databasePath, snapshot = destination => backupDatabase(databasePath, destination), token, limiter, log = console, clientIp = req => req.ip, onBackgroundTask = () => {} }) {
  const disabled = (req, res, next) => token ? next() : res.status(404).json({ error: "请求的地址不存在，请刷新页面后重试", code: "NOT_FOUND" });
  app.get(BACKUP_PATH, disabled, limiter, async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    // Express routes HEAD to GET handlers too. Reject it before creating a snapshot.
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "只支持 GET", code: "METHOD_NOT_ALLOWED" });
    }
    if (!bearerMatches(req.get("authorization"), token)) {
      log.warn("Backup request denied", { requestId: req.requestId, ip: clientIp(req) });
      return res.status(401).json({ error: "未授权", code: "UNAUTHORIZED" });
    }
    let directory;
    // Keep a Vercel invocation alive through streaming and removal of its private temp copy.
    let finished;
    const completion = new Promise(resolve => { finished = resolve; });
    onBackgroundTask(completion);
    const cleanup = () => directory && rm(directory, { recursive: true, force: true }).catch(() => {});
    try {
      directory = await mkdtemp(path.join(os.tmpdir(), "inabakumori-backup-"));
      const file = path.join(directory, "snapshot.db");
      await snapshot(file);
      const { size } = await stat(file);
      res.status(200);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(size));
      res.setHeader("Content-Disposition", `attachment; filename="${backupFilename()}"`);
      // pipeline settles even if the client already disconnected, so the temp copy is always removed.
      // Log "served" only once the whole snapshot was written out; a client abort is logged as such.
      const meta = { requestId: req.requestId, ip: clientIp(req), size };
      try {
        await pipeline(createReadStream(file), res);
        if (res.writableFinished) log.log("Backup served", meta);
        else log.warn("Backup aborted", meta);
      } catch (error) {
        log.warn("Backup aborted", { ...meta, reason: error?.code || error?.name || "error" });
        res.destroy();
      }
      await cleanup();
    } catch (error) {
      await cleanup();
      next(error);
    } finally {
      finished();
    }
  });
}
