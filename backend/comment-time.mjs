// One accepted range for stored comment times, shared by the migration preflight,
// the PostgreSQL constraint, the public list and tools/remote-backup.py (MAX_DATE_MS):
// non-negative integer milliseconds that JavaScript Date can represent.
export const MAX_COMMENT_TIME_MS = 8_640_000_000_000_000;

export function isCommentTime(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_COMMENT_TIME_MS;
}
