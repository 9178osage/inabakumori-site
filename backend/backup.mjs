import "dotenv/config";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, open, chmod, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDatabasePath } from "./services.mjs";

export async function backupDatabase(source, destination) {
  if (path.resolve(source) === path.resolve(destination)) throw new Error("Backup must not overwrite the source database");
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  // Reserve the destination exclusively. Existing backups must never be overwritten.
  const reservation = await open(destination, "wx", 0o600);
  await reservation.close();
  let db;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    await backup(db, destination);
    const check = new DatabaseSync(destination, { readOnly: true });
    try {
      if (check.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("Backup integrity check failed");
    } finally { check.close(); }
    await chmod(destination, 0o600);
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  } finally { db?.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const source = resolveDatabasePath(process.env, directory);
  const filename = `comments-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(source), ".backups", filename);
  await backupDatabase(source, destination);
  console.log(`Backup created and verified: ${destination}`);
}
