import contextlib
import datetime
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
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
