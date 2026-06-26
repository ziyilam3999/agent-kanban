// sync-log.ts — the persistent sync logbook (#1158).
//
// One JSONL record per line at data/sync.log (override with SYNC_LOG). The courier
// writes its outcome here before EVERY exit (uploaded / skipped-no-token / failed),
// and the hook writes an `export-failed` record when the re-export step fails — so a
// background sync is NEVER silent. The log stores only url / bytes / mtime / a closed
// reason-enum — NEVER board content, NEVER the token, NEVER a home path.

import * as fs from "node:fs";
import * as path from "node:path";

/** Closed outcome enum — exactly these three values, no overlap. */
export type SyncResult = "uploaded" | "skipped-no-token" | "failed";

/** One line of the sync logbook. */
export interface SyncRecord {
  ts: string; // ISO-8601
  result: SyncResult;
  reason: string; // short stable token — never a value, never a path, never a stack
  url: string | null;
  boardBytes: number | null;
  boardMtime: string | null; // ISO-8601 | null
}

/** The configured sync-log path: `SYNC_LOG` env override, else `data/sync.log`. */
export function defaultSyncLogPath(): string {
  return process.env.SYNC_LOG || path.join("data", "sync.log");
}

/**
 * Append one record as a single atomic JSONL write (LOW-1): the whole record is
 * one `fs.appendFileSync` call (< PIPE_BUF / 4 KB → no interleave under O_APPEND on
 * POSIX, so overlapping PostToolUse fires can't corrupt a half-line). Creates the
 * dir if missing. NEVER throws to the caller — a logging failure must not break the
 * hook/courier contract.
 */
export function appendSyncRecord(
  record: SyncRecord,
  logPath: string = defaultSyncLogPath()
): void {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + "\n");
  } catch {
    // Logging is best-effort — swallow so the caller's contract is preserved.
  }
}

/** Read + parse the sync log (newest-last). Malformed lines are skipped; absent → []. */
export function readSyncLog(
  logPath: string = defaultSyncLogPath()
): SyncRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  const out: SyncRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as SyncRecord);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}
