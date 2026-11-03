#!/bin/bash
# launchd wrapper for tools/remote-backup.py, installed next to it in the
# private backup directory. Exit 2 means the snapshot was SAVED but cleanup was
# skipped (sharp comment drop, or an unreadable drop-guard.json); nothing was
# deleted. remote-backup.py prints one "NEEDS REVIEW:" summary line saying which
# case it is; that line is copied to backup.log and NEEDS-REVIEW.txt and the job
# ends as a success. Other non-zero codes are failures for backup-error.log.
D="${INABAKUMORI_BACKUP_DIR:-$HOME/Library/Application Support/inabakumori-site-backup}"
PY="${INABAKUMORI_BACKUP_PYTHON:-/usr/bin/python3}"
out=$("$PY" -B "$D/remote-backup.py" "$D/backup-config.json")
rc=$?
printf '%s\n' "$out" | grep -v '^NEEDS REVIEW: ' || true
stamp=$(date "+%Y-%m-%d %H:%M:%S %Z")
if [ "$rc" -eq 2 ]; then
  line=$(printf '%s\n' "$out" | grep -m1 '^NEEDS REVIEW: ')
  [ -n "$line" ] || line="NEEDS REVIEW: snapshot saved, cleanup skipped; nothing deleted. Details in backup-error.log."
  echo "$stamp $line" >> "$D/backup.log"
  echo "$stamp $line" >> "$D/NEEDS-REVIEW.txt"
  chmod 600 "$D/NEEDS-REVIEW.txt"
  exit 0
fi
[ "$rc" -ne 0 ] && echo "$stamp FAILED: exit $rc" >> "$D/backup-error.log"
exit "$rc"
