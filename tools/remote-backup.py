#!/usr/bin/env python3
"""Private daily snapshot download; accepts one owner-only JSON configuration file."""
import datetime
from contextlib import closing
import json
import math
import os
import re
import secrets
import sqlite3
import stat
import sys
import time
import urllib.parse
import urllib.request

BACKUP_URL = "https://inabakumori-backend.vercel.app/api/admin/backup"
MAX_BYTES = 64 * 1024 * 1024
TIMEOUT = 30
TOTAL_TIMEOUT = 120
MAX_INTEGER = 9_007_199_254_740_991
BACKUP_NAME = re.compile(r"^inabakumori-comments-\d{8}T\d{6}Z-[0-9a-f]{16}\.db$")


class BackupError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise BackupError("Backup redirect refused")


def private_path(path, directory=False):
    if not isinstance(path, str) or not os.path.isabs(path):
        raise BackupError("Configuration and backup paths must be absolute")
    # Check the complete path, including parents, before opening any private file.
    current = os.path.sep
    for part in path.split(os.path.sep)[1:]:
        current = os.path.join(current, part)
        if stat.S_ISLNK(os.lstat(current).st_mode):
            raise BackupError("Symbolic links are not allowed")
    info = os.lstat(path)
    valid_type = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    if not valid_type or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise BackupError("Private configuration and backup directory must be owner-only")
    return info


def load_config(filename):
    info = private_path(filename)
    if info.st_size > 16_384:
        raise BackupError("Invalid backup configuration")
    descriptor = os.open(filename, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "r", encoding="utf-8") as source:
        current = os.fstat(source.fileno())
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            raise BackupError("Configuration changed while opening")
        config = json.load(source)
    if not isinstance(config, dict) or config.get("url") != BACKUP_URL:
        raise BackupError("Invalid backup endpoint configuration")
    token = config.get("token")
    if not isinstance(token, str) or not re.fullmatch(r"[\x21-\x7e]{32,512}", token):
        raise BackupError("Invalid backup credential configuration")
    retention = config.get("retention_days", 30)
    if type(retention) is not int or not 1 <= retention <= 3650:
        raise BackupError("Invalid backup retention configuration")
    private_path(config.get("directory"), directory=True)
    return {"url": BACKUP_URL, "token": token, "directory": config["directory"], "retention_days": retention}


def download(config, destination):
    request = urllib.request.Request(config["url"], headers={"Authorization": "Bearer " + config["token"], "Accept": "application/octet-stream"})
    # Ignore environment and system proxy settings. Send this credential only
    # to the fixed HTTPS origin, with normal certificate verification.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    deadline = time.monotonic() + TOTAL_TIMEOUT
    size = 0
    with opener.open(request, timeout=TIMEOUT) as response:
        if response.status != 200:
            raise BackupError("Backup server did not return a snapshot")
        runtime_header = response.headers.get("X-Backend-Node-Version", "")
        runtime = runtime_header if len(runtime_header) <= 64 and re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", runtime_header) else "unknown"
        expected = response.headers.get("Content-Length")
        if expected is not None:
            if not re.fullmatch(r"[0-9]{1,10}", expected) or not 16 <= int(expected) <= MAX_BYTES:
                raise BackupError("Backup response size is invalid")
            expected = int(expected)
        descriptor = os.open(destination, os.O_WRONLY | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "wb") as output:
            while True:
                if time.monotonic() > deadline:
                    raise BackupError("Backup download timed out")
                # read(size) can wait for the entire size while a peer keeps
                # dripping bytes. read1 returns after one buffered/socket read,
                # allowing the total deadline to be checked between chunks.
                chunk = response.read1(min(65_536, MAX_BYTES + 1 - size))
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BYTES:
                    raise BackupError("Backup response exceeds size limit")
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
    if expected is not None and expected != size:
        raise BackupError("Backup download was incomplete")
    return size, runtime


def verify_snapshot(filename):
    with open(filename, "rb") as source:
        if source.read(16) != b"SQLite format 3\x00":
            raise BackupError("Backup is not a SQLite snapshot")
    uri = "file:" + urllib.parse.quote(filename, safe="/") + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        db.execute("PRAGMA query_only = ON")
        db.execute("PRAGMA trusted_schema = OFF")
        if db.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
            raise BackupError("Backup SQLite integrity check failed")
        columns = {row[1]: row for row in db.execute("PRAGMA table_info(comments)")}
        required = {"id", "nickname", "content", "user_id", "is_guest", "created_at", "expires_at"}
        if not required.issubset(columns) or columns["id"][5] != 1:
            raise BackupError("Backup comments schema is invalid")
        total, max_id, invalid, members, guests = db.execute("""
            SELECT COUNT(*), COALESCE(MAX(id), 0),
              COALESCE(SUM(CASE WHEN
                typeof(id) != 'integer' OR id <= 0 OR id > ? OR
                typeof(nickname) != 'text' OR typeof(content) != 'text' OR
                (user_id IS NOT NULL AND typeof(user_id) != 'text') OR
                typeof(is_guest) != 'integer' OR is_guest NOT IN (0, 1) OR
                typeof(created_at) != 'integer' OR created_at NOT BETWEEN ? AND ? OR
                (expires_at IS NOT NULL AND (typeof(expires_at) != 'integer' OR expires_at NOT BETWEEN ? AND ?))
              THEN 1 ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN is_guest = 0 THEN 1 ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN is_guest = 1 THEN 1 ELSE 0 END), 0)
            FROM comments
        """, (MAX_INTEGER, 0, MAX_INTEGER, 0, MAX_INTEGER)).fetchone()
        sequences = db.execute("SELECT seq FROM sqlite_sequence WHERE name = 'comments'").fetchall()
        high_water = sequences[0][0] if sequences else 0
        # Older node:sqlite exports bound JavaScript Numbers as REAL in this
        # untyped SQLite column. Accept only a finite, exact integer; all row
        # fields above still require PostgreSQL-compatible integer storage.
        if type(high_water) is float and math.isfinite(high_water) and high_water.is_integer():
            high_water = int(high_water)
        if invalid or len(sequences) > 1 or type(high_water) is not int or not max_id <= high_water <= MAX_INTEGER:
            raise BackupError("Backup comments or ID sequence are invalid")
    return {"comments": total, "members": members, "guests": guests}


def prune(directory, retention_days, now):
    cutoff = now.timestamp() - retention_days * 86400
    removed, failed = 0, 0
    for name in os.listdir(directory):
        if not BACKUP_NAME.fullmatch(name):
            continue
        filename = os.path.join(directory, name)
        try:
            info = os.lstat(filename)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mtime >= cutoff:
                continue
            os.unlink(filename)
            removed += 1
        except OSError:
            failed += 1
    return removed, failed


def backup(config_filename):
    config = load_config(config_filename)
    directory = config["directory"]
    temporary = os.path.join(directory, ".inabakumori-download-" + secrets.token_hex(16) + ".part")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    os.close(descriptor)
    try:
        size, runtime = download(config, temporary)
        counts = verify_snapshot(temporary)
        now = datetime.datetime.now(datetime.timezone.utc)
        filename = "inabakumori-comments-" + now.strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(8) + ".db"
        # Linking a completed private file is atomic and refuses to overwrite any existing file.
        os.link(temporary, os.path.join(directory, filename), follow_symlinks=False)
    finally:
        os.unlink(temporary)
    removed, failed = prune(directory, config["retention_days"], now)
    return {**counts, "bytes": size, "runtime": runtime, "pruned": removed, "cleanup_errors": failed}


def main(args):
    if len(args) != 1:
        print("Usage: remote-backup.py /absolute/private/config.json", file=sys.stderr)
        return 1
    try:
        result = backup(args[0])
    except Exception:
        # Never echo URLs, request/driver exceptions, paths, credentials or comment text.
        print("Backup failed; check private configuration, connectivity and snapshot integrity", file=sys.stderr)
        return 1
    print("Backup verified: " + ", ".join(f"{key}={value}" for key, value in result.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
