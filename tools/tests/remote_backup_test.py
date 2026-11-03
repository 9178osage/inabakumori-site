import contextlib
import datetime
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("remote_backup", Path(__file__).resolve().parents[1] / "remote-backup.py")
REMOTE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REMOTE)
TOKEN = "synthetic-private-backup-token-123456789"


class Response(io.BytesIO):
    status = 200

    def __init__(self, data, length=True):
        super().__init__(data)
        self.headers = {"Content-Length": str(len(data))} if length else {}


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="station-private-backup-")
        self.root = Path(os.path.realpath(self.temp.name))
        self.directory = self.root / "snapshots"
        self.directory.mkdir(mode=0o700)
        self.config = self.root / "config.json"
        self.write_config()

    def tearDown(self):
        self.temp.cleanup()

    def write_config(self, **changes):
        values = {"url": REMOTE.BACKUP_URL, "token": TOKEN, "directory": str(self.directory)}
        values.update(changes)
        self.config.write_text(json.dumps(values))
        self.config.chmod(0o600)

    def snapshot(self, corrupt_sequence=False):
        source = self.root / "synthetic.db"
        with sqlite3.connect(str(source)) as db:
            db.execute("""CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT NOT NULL, content TEXT NOT NULL, user_id TEXT,
                is_guest INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER)""")
            db.execute("INSERT INTO comments VALUES (7, '雨', 'private synthetic text', 'synthetic-user', 0, 1700000000000, NULL)")
            db.execute("INSERT INTO comments VALUES (13, '雲', 'private synthetic guest', NULL, 1, 1600000000000, 1600000600000)")
            db.execute("INSERT INTO comments VALUES (101, 'deleted', 'deleted private text', NULL, 1, 1600000000000, NULL)")
            db.execute("DELETE FROM comments WHERE id = 101")
            if corrupt_sequence:
                db.execute("UPDATE sqlite_sequence SET seq = 1 WHERE name = 'comments'")
        return source.read_bytes()

    def network(self, body, length=True):
        opener = mock.Mock()
        opener.open.return_value = Response(body, length)
        return mock.patch.object(REMOTE.urllib.request, "build_opener", return_value=opener), opener

    def files(self):
        return sorted(p.name for p in self.directory.iterdir())

    def test_valid_snapshot_is_private_and_retains_data_and_high_water(self):
        network, opener = self.network(self.snapshot())
        with network:
            result = REMOTE.backup(str(self.config))
        self.assertEqual((result["comments"], result["members"], result["guests"]), (2, 1, 1))
        names = self.files()
        self.assertEqual(len(names), 1)
        self.assertRegex(names[0], REMOTE.BACKUP_NAME)
        saved = self.directory / names[0]
        self.assertEqual(stat.S_IMODE(saved.stat().st_mode), 0o600)
        with sqlite3.connect(str(saved)) as db:
            self.assertEqual(db.execute("SELECT seq FROM sqlite_sequence WHERE name = 'comments'").fetchone(), (101,))
            self.assertEqual(db.execute("SELECT content FROM comments WHERE id = 7").fetchone(), ("private synthetic text",))
        request = opener.open.call_args[0][0]
        self.assertEqual(request.full_url, REMOTE.BACKUP_URL)
        self.assertEqual(request.get_header("Authorization"), "Bearer " + TOKEN)
        self.assertEqual(opener.open.call_args[1]["timeout"], 30)

    def test_legacy_node_sqlite_real_integer_sequence_remains_usable(self):
        self.snapshot()
        source = self.root / "synthetic.db"
        with sqlite3.connect(str(source)) as db:
            db.execute("UPDATE sqlite_sequence SET seq = CAST(? AS REAL) WHERE name = 'comments'", (101,))
            self.assertEqual(db.execute("SELECT seq, typeof(seq) FROM sqlite_sequence WHERE name = 'comments'").fetchone(), (101.0, "real"))
        network, _ = self.network(source.read_bytes())
        with network:
            result = REMOTE.backup(str(self.config))
        self.assertEqual(result["comments"], 2)
        self.assertEqual(len(self.files()), 1)
        with sqlite3.connect(str(self.directory / self.files()[0])) as db:
            db.execute("INSERT INTO comments (nickname, content, user_id, is_guest, created_at) VALUES ('test', 'next id', NULL, 1, 1700000000000)")
            self.assertEqual(db.execute("SELECT MAX(id) FROM comments").fetchone(), (102,))

    def test_failed_download_or_corrupt_sqlite_never_publishes_a_backup(self):
        bad_sequence = self.snapshot(corrupt_sequence=True)
        valid_header_corrupt = b"SQLite format 3\x00" + b"broken database" * 100
        for body in [b"unauthorized private response", valid_header_corrupt, bad_sequence]:
            network, _ = self.network(body)
            with network, self.assertRaises(Exception):
                REMOTE.backup(str(self.config))
            self.assertEqual(self.files(), [])

    def test_redirects_are_refused_without_following_and_leave_no_snapshot(self):
        def redirect(request, timeout):
            REMOTE.NoRedirect().redirect_request(request, None, 302, "redirect", {}, "https://untrusted.example/collect")
        opener = mock.Mock()
        opener.open.side_effect = redirect
        with mock.patch.object(REMOTE.urllib.request, "build_opener", return_value=opener), self.assertRaises(REMOTE.BackupError):
            REMOTE.backup(str(self.config))
        self.assertEqual(opener.open.call_count, 1)
        self.assertEqual(self.files(), [])

    def test_system_and_environment_proxies_are_not_used(self):
        body = self.snapshot()
        with mock.patch.dict(os.environ, {"https_proxy": "http://proxy.invalid:8080", "HTTPS_PROXY": "http://proxy.invalid:8080"}), \
                mock.patch.object(REMOTE.urllib.request, "getproxies", side_effect=AssertionError("proxy discovery must be disabled")), \
                mock.patch.object(REMOTE.urllib.request.OpenerDirector, "open", return_value=Response(body)) as network:
            result = REMOTE.backup(str(self.config))
        self.assertEqual(result["comments"], 2)
        request = network.call_args[0][0]
        self.assertEqual(request.full_url, REMOTE.BACKUP_URL)
        self.assertEqual(request.get_header("Authorization"), "Bearer " + TOKEN)

    def test_private_permissions_owner_and_symlinks_are_enforced(self):
        with mock.patch.object(REMOTE.urllib.request, "build_opener") as network:
            self.config.chmod(0o640)
            with self.assertRaises(REMOTE.BackupError):
                REMOTE.backup(str(self.config))
            self.config.chmod(0o600)
            self.directory.chmod(0o750)
            with self.assertRaises(REMOTE.BackupError):
                REMOTE.backup(str(self.config))
            self.directory.chmod(0o700)
            with mock.patch.object(REMOTE.os, "geteuid", return_value=os.geteuid() + 1), self.assertRaises(REMOTE.BackupError):
                REMOTE.backup(str(self.config))
            link = self.root / "config-link.json"
            link.symlink_to(self.config)
            with self.assertRaises(REMOTE.BackupError):
                REMOTE.backup(str(link))
            directory_link = self.root / "snapshots-link"
            directory_link.symlink_to(self.directory, target_is_directory=True)
            self.write_config(directory=str(directory_link))
            with self.assertRaises(REMOTE.BackupError):
                REMOTE.backup(str(self.config))
            self.write_config()
            parent_link = self.root / "parent-link"
            parent_link.symlink_to(self.root, target_is_directory=True)
            with self.assertRaises(REMOTE.BackupError):
                REMOTE.backup(str(parent_link / "config.json"))
            network.assert_not_called()
        self.assertEqual(self.files(), [])

    def test_endpoint_and_credentials_are_validated_before_network(self):
        for changes in [{"url": "https://inabakumori-site-production.up.railway.app/api/admin/backup"},
                        {"url": REMOTE.BACKUP_URL + "?redirect=1"}, {"token": "short"},
                        {"token": TOKEN + "\r\nInjected: bad"}, {"retention_days": 0}, {"retention_days": True}]:
            self.write_config(**changes)
            with mock.patch.object(REMOTE.urllib.request, "build_opener") as network, self.assertRaises(REMOTE.BackupError):
                REMOTE.backup(str(self.config))
            network.assert_not_called()

    def named(self, when, suffix="0123456789abcdef", body=b"old backup"):
        path = self.directory / ("inabakumori-comments-" + when.strftime("%Y%m%dT%H%M%SZ") + "-" + suffix + ".db")
        path.write_bytes(body)
        return path

    def many(self, count):
        source = self.root / ("many-%d.db" % count)
        with sqlite3.connect(str(source)) as db:
            db.execute("""CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT NOT NULL, content TEXT NOT NULL, user_id TEXT,
                is_guest INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER)""")
            for i in range(1, count + 1):
                db.execute("INSERT INTO comments VALUES (?, 'n', 'synthetic', NULL, 1, 1700000000000, NULL)", (i,))
        return source.read_bytes()

    def test_tiered_retention_keeps_daily_then_weekly_then_monthly(self):
        now = datetime.datetime(2026, 11, 2, 12, tzinfo=datetime.timezone.utc)
        snapshots = []
        for day in range(0, 500):
            when = now - datetime.timedelta(days=day)
            snapshots.append((when.timestamp(), "d%03d" % day))
        keep = REMOTE.keep_set(snapshots, now, 14, 8, 12)
        for day in range(14):
            self.assertIn("d%03d" % day, keep)
        weekly = [n for n in keep if 14 <= int(n[1:]) < 56]
        self.assertTrue(5 <= len(weekly) <= 7, weekly)
        monthly = [n for n in keep if 56 <= int(n[1:])]
        self.assertTrue(9 <= len(monthly) <= 11, monthly)
        self.assertFalse(any(int(n[1:]) > 12 * 31 for n in keep))

    def test_old_weekly_and_monthly_snapshots_survive_real_prune(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        week_old = self.named(now - datetime.timedelta(days=45), "1111111111111111")
        month_old = self.named(now - datetime.timedelta(days=200), "2222222222222222")
        ancient = self.named(now - datetime.timedelta(days=900), "3333333333333333")
        network, _ = self.network(self.snapshot())
        with network:
            result = REMOTE.backup(str(self.config))
        self.assertEqual(result["pruned"], 1)
        self.assertTrue(week_old.exists() and month_old.exists())
        self.assertFalse(ancient.exists())

    def test_sharp_comment_drop_keeps_every_snapshot_and_exits_nonzero(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        previous = self.named(now - datetime.timedelta(days=1), "4444444444444444", self.many(40))
        ancient = self.named(now - datetime.timedelta(days=900), "5555555555555555")
        network, _ = self.network(self.many(5))
        stderr = io.StringIO()
        with network, contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(REMOTE.main([str(self.config)]), 2)
        self.assertIn("cleanup skipped", stderr.getvalue())
        self.assertTrue(previous.exists() and ancient.exists())
        self.assertEqual(len([n for n in self.files() if n != "drop-guard.json"]), 3)

    def test_small_or_moderate_changes_still_prune(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        self.named(now - datetime.timedelta(days=1), "6666666666666666", self.many(40))
        ancient = self.named(now - datetime.timedelta(days=900), "7777777777777777")
        network, _ = self.network(self.many(30))
        with network:
            result = REMOTE.backup(str(self.config))
        self.assertNotIn("cleanup_skipped", result)
        self.assertFalse(ancient.exists())

    def test_guard_keeps_firing_on_later_days_until_comments_return(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        nine, empty = self.many(9), self.many(0)
        self.named(now - datetime.timedelta(days=1), "8888888888888888", nine)
        ancient = self.named(now - datetime.timedelta(days=900), "9999999999999999", nine)
        for day in range(3):
            before = set(self.files())
            network, _ = self.network(empty)
            with network:
                result = REMOTE.backup(str(self.config))
            self.assertEqual(result.get("cleanup_skipped"), "comment_drop", "day %d" % day)
            self.assertEqual(result["previous_comments"], 9)
            self.assertEqual(result["pruned"], 0)
            self.assertTrue(before <= set(self.files()), "nothing may be deleted while comments are missing")
        self.assertTrue(ancient.exists())
        network, _ = self.network(nine)
        with network:
            result = REMOTE.backup(str(self.config))
        self.assertNotIn("cleanup_skipped", result)
        self.assertFalse(ancient.exists())

    def run_day(self, body):
        network, _ = self.network(body)
        with network, contextlib.redirect_stderr(io.StringIO()):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = REMOTE.main([str(self.config)])
        return code, out.getvalue()

    def drop_setup(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        nine = self.many(9)
        self.named(now - datetime.timedelta(days=1), "aaaaaaaaaaaaaaaa", nine)
        ancient = self.named(now - datetime.timedelta(days=900), "bbbbbbbbbbbbbbbb", nine)
        return nine, self.many(4), ancient, self.directory / "drop-guard.json"

    def test_partial_drop_keeps_firing_until_half_the_baseline_returns(self):
        nine, four, ancient, state = self.drop_setup()
        for day in range(3):
            before = set(self.files())
            code, _ = self.run_day(four)
            self.assertEqual(code, 2, "day %d" % day)
            self.assertTrue(before <= set(self.files()), "nothing may be deleted while comments are missing")
        self.assertTrue(ancient.exists())
        self.assertEqual(json.loads(state.read_text())["comments"], 9)
        code, out = self.run_day(self.many(5))
        self.assertEqual(code, 0)
        self.assertIn("drop guard cleared", out)
        self.assertFalse(state.exists())
        self.assertFalse(ancient.exists())

    def test_manually_deleted_guard_resumes_cleanup(self):
        nine, four, ancient, state = self.drop_setup()
        self.assertEqual(self.run_day(four)[0], 2)
        state.unlink()
        self.assertEqual(self.run_day(four)[0], 0)
        self.assertFalse(ancient.exists())

    def test_damaged_guard_state_deletes_nothing(self):
        nine, four, ancient, state = self.drop_setup()
        state.write_text("{not json")
        before = set(self.files())
        self.assertEqual(self.run_day(nine)[0], 2)
        self.assertTrue(before <= set(self.files()))
        self.assertTrue(ancient.exists() and state.exists())

    def review_output(self, body):
        network, _ = self.network(body)
        out, err = io.StringIO(), io.StringIO()
        with network, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = REMOTE.main([str(self.config)])
        return code, [l for l in out.getvalue().splitlines() if l.startswith("NEEDS REVIEW: ")], err.getvalue()

    def test_review_line_names_the_drop_with_counts_and_release_path(self):
        nine, four, ancient, state = self.drop_setup()
        code, lines, err = self.review_output(four)
        self.assertEqual(code, 2)
        self.assertEqual(len(lines), 1)
        self.assertIn("comment count dropped sharply (reference 9, new 4)", lines[0])
        self.assertIn("delete " + str(state) + " to release the guard", lines[0])
        self.assertIn("backup-error.log", lines[0])
        self.assertIn(lines[0], err)
        self.assertTrue(ancient.exists())

    def test_review_line_names_an_unreadable_guard_state(self):
        nine, four, ancient, state = self.drop_setup()
        state.write_text("{not json")
        code, lines, _ = self.review_output(nine)
        self.assertEqual(code, 2)
        self.assertIn("drop guard state is damaged or unreadable", lines[0])
        self.assertNotIn("dropped sharply", lines[0])
        self.assertIn("delete " + str(state) + " to release the guard", lines[0])
        self.assertTrue(ancient.exists() and state.exists())

    def wrapper(self, line, code):
        home = self.root / "wrapper"
        home.mkdir()
        (home / "remote-backup.py").write_text(
            "import sys\nprint('Backup verified: comments=4')\nprint(%r)\nsys.exit(%d)\n" % (line, code))
        env = dict(os.environ, INABAKUMORI_BACKUP_DIR=str(home), INABAKUMORI_BACKUP_PYTHON=sys.executable)
        wrapper = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "run-backup.sh")
        done = subprocess.run(["/bin/bash", wrapper], env=env, capture_output=True, text=True)
        return done, home

    def test_wrapper_copies_each_review_line_to_log_and_needs_review(self):
        for line in ["NEEDS REVIEW: comment count dropped sharply (reference 9, new 4); delete /x/drop-guard.json to release the guard. Details in backup-error.log.",
                     "NEEDS REVIEW: drop guard state is damaged or unreadable (new snapshot has 9 comments); delete /x/drop-guard.json to release the guard. Details in backup-error.log."]:
            with self.subTest(line=line[:40]):
                done, home = self.wrapper(line, 2)
                self.assertEqual(done.returncode, 0)
                self.assertIn("Backup verified", done.stdout)
                self.assertNotIn("NEEDS REVIEW", done.stdout)
                for name in ["backup.log", "NEEDS-REVIEW.txt"]:
                    text = (home / name).read_text()
                    self.assertEqual(text.count("NEEDS REVIEW"), 1)
                    self.assertIn(line, text)
                self.assertEqual(stat.S_IMODE((home / "NEEDS-REVIEW.txt").stat().st_mode), 0o600)
                self.assertFalse((home / "backup-error.log").exists())
                import shutil; shutil.rmtree(str(home))

    def test_wrapper_records_other_failures_only_in_error_log(self):
        done, home = self.wrapper("", 1)
        self.assertEqual(done.returncode, 1)
        self.assertIn("FAILED: exit 1", (home / "backup-error.log").read_text())
        self.assertFalse((home / "NEEDS-REVIEW.txt").exists())

    def test_small_comment_counts_are_still_guarded(self):
        self.assertTrue(REMOTE.sharp_drop({"comments": 9}, {"comments": 0}, 50))
        self.assertTrue(REMOTE.sharp_drop({"comments": 9}, {"comments": 4}, 50))
        self.assertFalse(REMOTE.sharp_drop({"comments": 9}, {"comments": 5}, 50))
        self.assertTrue(REMOTE.sharp_drop({"comments": 1}, {"comments": 0}, 50))
        self.assertFalse(REMOTE.sharp_drop({"comments": 0}, {"comments": 0}, 50))
        self.assertFalse(REMOTE.sharp_drop(None, {"comments": 0}, 50))

    def test_tier_configuration_is_validated(self):
        for change in [{"weekly_weeks": -1}, {"monthly_months": True}, {"max_drop_percent": 0}, {"max_drop_percent": 101}]:
            self.write_config(**change)
            with self.assertRaises(REMOTE.BackupError):
                REMOTE.load_config(str(self.config))

    def test_only_success_prunes_expired_tool_files_and_preserves_other_files_and_symlinks(self):
        expired = self.directory / "inabakumori-comments-20000101T000000Z-0123456789abcdef.db"
        expired.write_bytes(b"old backup")
        os.utime(str(expired), (1, 1))
        other = self.directory / "migration-final.db"
        other.write_bytes(b"never delete migration source")
        os.utime(str(other), (1, 1))
        link = self.directory / "inabakumori-comments-20000101T000000Z-fedcba9876543210.db"
        link.symlink_to(other)
        network, _ = self.network(b"failure")
        with network, self.assertRaises(REMOTE.BackupError):
            REMOTE.backup(str(self.config))
        self.assertTrue(expired.exists(), "failure must not prune any previous snapshot")
        network, _ = self.network(self.snapshot())
        with network:
            result = REMOTE.backup(str(self.config))
        self.assertEqual(result["pruned"], 1)
        self.assertFalse(expired.exists())
        self.assertEqual(other.read_bytes(), b"never delete migration source")
        self.assertTrue(link.is_symlink())

    def test_size_and_total_time_limits_remove_partial_downloads(self):
        network, _ = self.network(b"x" * 1025)
        with network, mock.patch.object(REMOTE, "MAX_BYTES", 1024), self.assertRaises(REMOTE.BackupError):
            REMOTE.backup(str(self.config))
        self.assertEqual(self.files(), [])
        network, _ = self.network(b"x" * 1025, length=False)
        with network, mock.patch.object(REMOTE, "MAX_BYTES", 1024), self.assertRaises(REMOTE.BackupError):
            REMOTE.backup(str(self.config))
        self.assertEqual(self.files(), [])
        network, _ = self.network(self.snapshot())
        with network, mock.patch.object(REMOTE.time, "monotonic", side_effect=[0, 121]), self.assertRaises(REMOTE.BackupError):
            REMOTE.backup(str(self.config))
        self.assertEqual(self.files(), [])

    def test_total_deadline_is_checked_between_partial_socket_reads(self):
        clock = [0]

        class SlowResponse(Response):
            reads = 0

            def read(self, size=-1):
                raise AssertionError("download must not wait for a complete read(size)")

            def read1(self, size=-1):
                self.reads += 1
                clock[0] += 61
                return super().read1(1)

        response = SlowResponse(b"x" * 1024)
        network, opener = self.network(b"")
        opener.open.return_value = response
        with network, mock.patch.object(REMOTE.time, "monotonic", side_effect=lambda: clock[0]), self.assertRaises(REMOTE.BackupError):
            REMOTE.backup(str(self.config))
        self.assertEqual(response.reads, 2, "the deadline interrupts a peer that sends one byte per read")
        self.assertEqual(self.files(), [])

    def test_invalid_postgres_timestamps_and_ambiguous_sequences_preserve_previous_snapshots(self):
        valid = self.snapshot()
        source = self.root / "synthetic.db"
        previous = self.directory / "inabakumori-comments-20000101T000000Z-0123456789abcdef.db"
        previous.write_bytes(b"keep previous snapshot")
        os.utime(str(previous), (1, 1))
        for statement in ["UPDATE comments SET created_at = -1 WHERE id = 7",
                          "UPDATE comments SET expires_at = -1 WHERE id = 13",
                          "UPDATE sqlite_sequence SET seq = -1 WHERE name = 'comments'",
                          "UPDATE sqlite_sequence SET seq = 9007199254740992 WHERE name = 'comments'",
                          "UPDATE sqlite_sequence SET seq = 17.5 WHERE name = 'comments'",
                          "UPDATE sqlite_sequence SET seq = 1e999 WHERE name = 'comments'",
                          "UPDATE sqlite_sequence SET seq = -1.0 WHERE name = 'comments'",
                          "UPDATE sqlite_sequence SET seq = 9007199254740992.0 WHERE name = 'comments'",
                          "UPDATE sqlite_sequence SET seq = 'invalid' WHERE name = 'comments'",
                          "INSERT INTO sqlite_sequence (name, seq) VALUES ('comments', 200)"]:
            source.write_bytes(valid)
            with sqlite3.connect(str(source)) as db:
                db.execute(statement)
            network, _ = self.network(source.read_bytes())
            with network, self.assertRaises(REMOTE.BackupError):
                REMOTE.backup(str(self.config))
            self.assertEqual(self.files(), [previous.name])
            self.assertEqual(previous.read_bytes(), b"keep previous snapshot")

    def test_cli_failure_does_not_echo_url_token_path_or_private_text(self):
        opener = mock.Mock()
        opener.open.side_effect = RuntimeError(REMOTE.BACKUP_URL + TOKEN + str(self.config) + "private synthetic text")
        output = io.StringIO()
        with mock.patch.object(REMOTE.urllib.request, "build_opener", return_value=opener), contextlib.redirect_stderr(output):
            self.assertEqual(REMOTE.main([str(self.config)]), 1)
        message = output.getvalue()
        for secret in [TOKEN, REMOTE.BACKUP_URL, str(self.config), "private synthetic text"]:
            self.assertNotIn(secret, message)
        self.assertEqual(self.files(), [])

    def test_runtime_evidence_accepts_only_a_plain_node_version_and_is_optional(self):
        body = self.snapshot()
        for header, expected in [(None, "unknown"), ("v24.22.1", "v24.22.1"),
                                 ("private synthetic header " + TOKEN, "unknown"), ("v24.22.1\nprivate text", "unknown")]:
            network, opener = self.network(body)
            if header is not None:
                opener.open.return_value.headers["X-Backend-Node-Version"] = header
            with network:
                result = REMOTE.backup(str(self.config))
            self.assertEqual(result["runtime"], expected)


if __name__ == "__main__":
    unittest.main()
