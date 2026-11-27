// Run this against a private, verified SQLite backup, never the live database file.
// No dotenv loading: the target connection must be supplied through DATABASE_URL.
import { DatabaseSync } from "node:sqlite";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCommentTime } from "./comment-time.mjs";

const COLUMNS = ["id", "nickname", "content", "user_id", "is_guest", "created_at", "expires_at"];
const SELECT_COMMENTS = `SELECT ${COLUMNS.join(", ")} FROM comments ORDER BY id`;
const INSERT_COMMENT = `INSERT INTO comments (${COLUMNS.join(", ")}) VALUES (?, ?, ?, ?, ?, ?, ?)`;
const directory = path.dirname(fileURLToPath(import.meta.url));
const HELP = "Usage: node backend/migrate-comments.mjs --source /private/backup.db [--dry-run | --apply [--accept-target-history]]\n" +
  "Dry-run is the default and does not connect to PostgreSQL. --apply requires DATABASE_URL.\n" +
  "An empty target that already issued comment IDs is refused when the backup reuses them; pass --accept-target-history\n" +
  "only when the backup comes from that same database, so its IDs are the comments the target issued.";

class MigrationError extends Error {}

export function parseMigrationArgs(args) {
  let source;
  let mode;
  let acceptTargetHistory = false;
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { help: true };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--source" && source === undefined && args[index + 1] && !args[index + 1].startsWith("--")) {
      source = args[++index];
    } else if (["--dry-run", "--apply"].includes(arg) && mode === undefined) {
      mode = arg;
    } else if (arg === "--accept-target-history" && !acceptTargetHistory) {
      acceptTargetHistory = true;
    } else {
      throw new MigrationError("Invalid arguments; use --source with one backup path and optionally --dry-run or --apply");
    }
  }
  if (!source) throw new MigrationError("A SQLite backup is required; pass --source /private/backup.db");
  if (acceptTargetHistory && mode !== "--apply") throw new MigrationError("--accept-target-history is only meaningful with --apply");
  return { source: path.resolve(source), apply: mode === "--apply", acceptTargetHistory };
}

function validRow(row) {
  return Number.isSafeInteger(row.id) && row.id > 0 &&
    typeof row.nickname === "string" && typeof row.content === "string" &&
    (row.user_id === null || typeof row.user_id === "string") &&
    [0, 1].includes(row.is_guest) && isCommentTime(row.created_at) &&
    (row.expires_at === null || isCommentTime(row.expires_at));
}

// Names the offending comments (IDs only, never text) so a bad backup can be fixed before import.
export function describeInvalidRows(rows, limit = 10) {
  const labels = [];
  rows.forEach((row, index) => {
    if (validRow(row)) return;
    labels.push(Number.isSafeInteger(row.id) ? `ID ${row.id}` : `row ${index + 1}`);
  });
  if (!labels.length) return null;
  return labels.length > limit ? `${labels.slice(0, limit).join(", ")} and ${labels.length - limit} more` : labels.join(", ");
}

function readSource(source) {
  let db;
  try {
    db = new DatabaseSync(path.resolve(source), { readOnly: true });
    db.exec("BEGIN");
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("integrity");
    const rows = db.prepare(SELECT_COMMENTS).all();
    const invalid = describeInvalidRows(rows);
    if (invalid) throw new MigrationError(`Source comments contain unsupported field values (${invalid}); times must be non-negative milliseconds JavaScript can represent; no data was imported`);
    const maxId = rows.at(-1)?.id || 0;
    const sequenceTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").get();
    const sequence = sequenceTable && db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'comments'").get();
    const highWater = sequence ? sequence.seq : maxId;
    if (!Number.isSafeInteger(highWater) || highWater < maxId || highWater < 0) {
      throw new MigrationError("Source comments have an invalid ID sequence; no data was imported");
    }
    return { rows, highWater };
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError("Unable to read a valid SQLite comments backup; check its path, integrity and schema");
  } finally {
    db?.close();
  }
}

function requirePostgresUrl(env) {
  try {
    const url = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === "/") throw new Error("invalid");
  } catch {
    throw new MigrationError("--apply requires a PostgreSQL DATABASE_URL environment variable");
  }
}

async function openTarget(env) {
  const { openDatabase } = await import("./database.mjs");
  return openDatabase(env, directory);
}

// openTarget is injectable so rollback and refusal paths can be tested without a live database.
export async function migrateComments({ source, apply = false, acceptTargetHistory = false, env = process.env }, dependencies = {}) {
  if (typeof source !== "string" || !source) throw new MigrationError("A SQLite backup is required; pass --source /private/backup.db");
  const { rows, highWater } = readSource(source);
  const result = {
    applied: false, total: rows.length,
    members: rows.filter(row => row.is_guest === 0).length,
    guests: rows.filter(row => row.is_guest === 1).length
  };
  if (!apply) return result;
  requirePostgresUrl(env);
  const log = dependencies.log || console;
  let target;
  let targetHighWater = 0;
  try {
    target = await (dependencies.openTarget || openTarget)(env);
    if (target.kind !== "postgres") throw new MigrationError("The migration target must be PostgreSQL");
    await target.transaction(async tx => {
      // Serialize against application writes too, not only other migration processes.
      await tx.exec("LOCK TABLE comments IN EXCLUSIVE MODE");
      const count = await tx.prepare("SELECT COUNT(*) AS n FROM comments").get();
      if (Number(count.n) !== 0) throw new MigrationError("Target comments table is not empty; no data was imported");
      // An empty table may still have issued IDs (deleted comments). Never move its sequence back,
      // and refuse to give old IDs to backup rows unless the operator confirms they are the same comments.
      const issued = await tx.prepare("SELECT pg_sequence_last_value(pg_get_serial_sequence('comments', 'id')::regclass) AS issued").get();
      const targetIssued = issued?.issued === null || issued?.issued === undefined ? 0 : Number(issued.issued);
      if (!Number.isSafeInteger(targetIssued) || targetIssued < 0) throw new MigrationError("Target comment ID sequence is invalid; no data was imported");
      if (targetIssued > 0 && rows.length && rows[0].id <= targetIssued && !acceptTargetHistory) {
        throw new MigrationError(`Target already issued comment IDs up to ${targetIssued}, which overlap this backup; no data was imported. ` +
          "Use a fresh database, or pass --accept-target-history only if the backup comes from this same database");
      }
      targetHighWater = targetIssued;
      const insert = tx.prepare(INSERT_COMMENT);
      for (const row of rows) await insert.run(...COLUMNS.map(column => row[column]));
      const imported = await tx.prepare(SELECT_COMMENTS).all();
      if (imported.length !== rows.length || rows.some((row, index) => COLUMNS.some(column => row[column] !== imported[index][column]))) {
        throw new MigrationError("Imported comments failed exact field verification; the transaction was rolled back");
      }
      const nextHighWater = Math.max(highWater, targetHighWater);
      if (nextHighWater > 0) {
        await tx.prepare("SELECT setval(pg_get_serial_sequence('comments', 'id'), ?, true)").get(nextHighWater);
      }
    });
  } catch (error) {
    await closeQuietly(target, log);
    if (error instanceof MigrationError) throw error;
    // Driver errors can contain connection strings, SQL parameters and private text.
    throw new MigrationError("PostgreSQL migration failed; no successful import was confirmed; check private database diagnostics");
  }
  // The import is committed and verified at this point. A failing close() is a
  // cleanup problem only and must not be reported as a failed import.
  await closeQuietly(target, log);
  return { ...result, applied: true };
}

async function closeQuietly(target, log) {
  try { await target?.close(); }
  catch (error) { log.warn("PostgreSQL connection close failed after the migration finished", { name: error?.name, code: error?.code }); }
}

export async function migrationCli(args, env = process.env, output = console) {
  try {
    const options = parseMigrationArgs(args);
    if (options.help) { output.log(HELP); return 0; }
    const result = await migrateComments({ ...options, env });
    output.log(`${result.applied ? "Import committed and verified" : "Dry-run verified (PostgreSQL was not contacted)"}: ${result.total} comments (${result.members} members, ${result.guests} guests)`);
    return 0;
  } catch (error) {
    output.error(error instanceof MigrationError ? error.message : "Migration failed; check the private backup and database configuration");
    return 1;
  }
}

if (process.argv[1] && process.argv[1] !== "-" && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await migrationCli(process.argv.slice(2));
}
