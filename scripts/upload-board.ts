#!/usr/bin/env tsx
// upload-board.ts — the courier UPLOAD step.
//
// Reads data/board.json (produced by export:board) and uploads it to Vercel Blob
// at the stable pathname "board.json" (overwrite-in-place, near-zero CDN cache so
// 1.5s polling sees fresh cards). Prints ONLY the resulting blob URL + a one-line
// env hint — NEVER a credential.
//
// Auth (#1050, #1405): ALL credential resolution lives in scripts/blob-auth.ts —
// OIDC only (short-lived, self-refreshing via `vercel env pull`). The long-lived
// RW token was revoked server-side 2026-07-02 and its arms (and the rw-fallback
// alert that watched them) were removed (#1405). The auth-agnostic
// failure-STREAK alert below survives — it fires on ANY 3 consecutive
// non-success records regardless of auth path.
//
// The courier OWNS its outcome record: it writes a data/sync.log line (uploaded /
// skipped-no-token / failed) BEFORE every exit, success AND non-zero (#1158) — so a
// background sync is never silent even when the hook swallows the courier's exit.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { put as realPut } from "@vercel/blob";
import { defaultResolveBlobAuth, type BlobAuth } from "./blob-auth";
import {
  appendSyncRecord,
  defaultSyncLogPath,
  readSyncLog,
  type SyncRecord,
} from "../lib/sync-log";
// The osascript alert channel now lives in the dependency-free lib/notify.ts so the
// #1435 board-freshness watchdog can reuse the SAME notifier without importing this
// module (which pulls in @vercel/blob + runs main() on import). Re-exported here so
// the courier's public surface (and any existing importer) is unchanged.
import { defaultNotify } from "../lib/notify";
export { defaultNotify } from "../lib/notify";

/** Minimal structural type for the blob `put` so a test can inject a mock.
 * The courier passes oidcToken+storeId and NO `token` key — the SDK's
 * implementation prefers an explicit `token` over OIDC, so passing both would
 * silently defeat OIDC (verified against @vercel/blob 2.4.1). */
export type PutFn = (
  pathname: string,
  body: Buffer,
  opts: {
    access: "public";
    oidcToken?: string;
    storeId?: string;
    addRandomSuffix: boolean;
    cacheControlMaxAge: number;
    allowOverwrite: boolean;
    contentType: string;
  }
) => Promise<{ url: string }>;

/** Injectable dependencies for the pure courier unit (hermetic in tests).
 *
 * DELIBERATE EXCLUSION (#1578): there is NO `allowPublish` / `skipGuard` /
 * `force` field here, and there never should be. The publish opt-in guard
 * below is read from the PROCESS ENVIRONMENT inside `uploadBoard()`, never
 * from a caller-supplied dep — a caller-supplied authorization flag is a
 * bypass by another name (it relocates the gate from "the process
 * environment declared publish intent" to "whatever the caller passed",
 * which is the exact trust model that let a test fixture reach production).
 * `put` / `resolveAuth` / `boardPath` / `logPath` / `notify` stay injectable
 * for hermetic testing; the gate does not. */
export interface UploadDeps {
  put: PutFn;
  resolveAuth: () => BlobAuth;
  boardPath: string;
  logPath: string;
  /** Out-of-band alert (default: macOS notification). Injectable for tests. */
  notify?: (title: string, message: string) => void;
}

/** Positive-opt-in marker (#1578). The ONLY code path that sets this is the
 * installed hook (scripts/on-task-change.sh) for its own courier invocation.
 * Every ad-hoc / manual / test / verification invocation is inert BY DEFAULT. */
const PUBLISH_MARKER_VALUE = "1";

/** Fixture-shape floor thresholds (#1578) — see contract arms below. */
const FLOOR_MIN_BYTES = 20_000;
const FLOOR_MIN_TICKETS = 10;
const RESERVED_TEST_TICKET_ID = "9999";
const SYNTHETIC_ID_PREFIX = /^(demo|test|smoke)/;

/**
 * Fixture-shape floor (#1578, defense in depth): even with publish authorized,
 * refuse a board that smells synthetic. This is a SEPARATE axis from the
 * opt-in guard — the opt-in proves WHO invoked the courier, this proves WHAT
 * is being published. Any one arm tripping is enough to refuse:
 *   - the file is smaller than FLOOR_MIN_BYTES, OR
 *   - it parses to fewer than FLOOR_MIN_TICKETS total tickets, OR
 *   - any ticket carries the reserved test id "9999", OR
 *   - the board sessionId or any session-summary id looks synthetic
 *     (demo|test|smoke prefix — real ids are hex, so this has zero
 *     false-positive risk against genuine session ids).
 * Unparsable JSON is treated as synthetic (fail closed — content that cannot
 * be proven real is refused, not uploaded).
 */
function looksSynthetic(boardBytes: number, body: Buffer): boolean {
  if (boardBytes < FLOOR_MIN_BYTES) return true;

  let parsed: {
    sessionId?: unknown;
    tickets?: unknown;
    sessions?: unknown;
  };
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return true;
  }

  const tickets = Array.isArray(parsed.tickets) ? parsed.tickets : [];
  if (tickets.length < FLOOR_MIN_TICKETS) return true;
  for (const t of tickets) {
    if (
      t &&
      typeof t === "object" &&
      "id" in t &&
      String((t as { id: unknown }).id) === RESERVED_TEST_TICKET_ID
    ) {
      return true;
    }
  }

  const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : "";
  if (SYNTHETIC_ID_PREFIX.test(sessionId)) return true;

  const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  for (const s of sessions) {
    const id =
      s && typeof s === "object" && "id" in s
        ? String((s as { id: unknown }).id)
        : "";
    if (SYNTHETIC_ID_PREFIX.test(id)) return true;
  }

  return false;
}

/**
 * Consecutive NOT-SYNCED records at the tail of the log (fail-closed: anything that
 * is not a success outcome — `uploaded` / `skipped-unchanged` — counts, so `failed`,
 * `skipped-no-token`, and any future/hook-written result like `export-failed` all
 * register). This is what "the board is silently going stale" looks like in data.
 */
export function consecutiveTrailingFailures(
  records: Pick<SyncRecord, "result">[]
): number {
  let n = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i].result;
    if (r === "uploaded" || r === "skipped-unchanged") break;
    n++;
  }
  return n;
}

/**
 * Alert at 3 consecutive failures, then every 3rd after (6, 9, …) — loud enough to
 * reach the operator, debounced enough not to spam a long outage on every task edit.
 */
export function shouldNotify(consecutive: number): boolean {
  return consecutive >= 3 && consecutive % 3 === 0;
}

/** After a failure record lands: alert out-of-band if the trailing streak warrants. */
function maybeAlertOnFailureStreak(
  logPath: string,
  notify: (title: string, message: string) => void,
  lastReason: string
): void {
  try {
    const n = consecutiveTrailingFailures(readSyncLog(logPath));
    if (shouldNotify(n)) {
      notify(
        "agent-kanban board sync",
        `Board sync has failed ${n} times in a row (latest: ${lastReason}). The live board is going stale — check data/sync.log.`
      );
    }
  } catch {
    /* best-effort */
  }
}

const TOKEN_HELP = [
  "upload-board: no Blob credential found.",
  "  OIDC (the only credential path — short-lived, self-refreshing): from the",
  "  linked repo root run",
  "    vercel env pull .env.vercel-oidc.local --yes",
  "  …the courier then refreshes it automatically near expiry (overrides:",
  "  OIDC_TOKEN_FILE, OIDC_REFRESH_SKEW_S).",
  "  See .env.example for the full note.",
].join("\n");

/**
 * The hash the remote currently holds: newest uploaded|skipped-unchanged record with
 * a non-null hash, else null. Both results confirm the remote holds that exact hash.
 * Fail safe toward uploading: first-ever / legacy-hashless / unreadable log → null →
 * the caller uploads (a wrong skip = a stale remote board; a wrong upload = one wasted
 * Advanced Op — the asymmetry favors uploading).
 */
function lastRemoteHash(records: SyncRecord[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (
      (r.result === "uploaded" || r.result === "skipped-unchanged") &&
      r.hash != null &&
      r.hash !== ""
    ) {
      return r.hash;
    }
  }
  return null; // first-ever upload OR only legacy/hashless records → upload (fail safe)
}

/**
 * Pure, injectable courier. Returns the intended process exit code (0 = uploaded,
 * non-zero = skipped/failed) and writes EXACTLY ONE sync-log record before returning.
 * No real network / Keychain / CLI / blob is touched unless the injected deps do so.
 *
 * DELIBERATE AMBIENT-ENV EXCEPTION (#1578): every dependency this function
 * touches is injected via `deps` EXCEPT the publish opt-in marker, which is
 * read straight from `process.env.BOARD_PUBLISH` below. This is intentional:
 * a gate you can inject is not a gate. The marker is set ONLY by the installed
 * hook (scripts/on-task-change.sh) for its own invocation; every other caller
 * — ad-hoc script run, in-process test call, direct `tsx` invocation — is
 * inert by default. See UploadDeps for why the marker is not, and must never
 * become, a `deps` field.
 */
export async function uploadBoard(deps: UploadDeps): Promise<number> {
  const { put, resolveAuth, boardPath, logPath } = deps;
  const notify = deps.notify ?? defaultNotify;
  const now = (): string => new Date().toISOString();

  if (!fs.existsSync(boardPath)) {
    console.error(
      `upload-board: ${boardPath} not found — run \`npm run export:board\` first.`
    );
    appendSyncRecord(
      {
        ts: now(),
        result: "failed",
        reason: "board-not-found",
        url: null,
        boardBytes: null,
        boardMtime: null,
      },
      logPath
    );
    maybeAlertOnFailureStreak(logPath, notify, "board-not-found");
    return 1;
  }

  const stat = fs.statSync(boardPath);
  const boardBytes = stat.size;
  const boardMtime = stat.mtime.toISOString();

  // ---- Publish opt-in guard (#1578, THE root fix) ----
  // Fail-closed default: nothing past this point is credentialed or network-
  // reachable unless the process environment explicitly declares publish
  // intent. Runs BEFORE resolveAuth() (and therefore before ANY credential
  // resolution) and is NOT conditioned on NODE_ENV — a jest-only disable would
  // reopen exactly the in-process door this guard exists to close.
  if (process.env.BOARD_PUBLISH !== PUBLISH_MARKER_VALUE) {
    appendSyncRecord(
      {
        ts: now(),
        result: "refused",
        reason: "publish-optin-missing",
        url: null,
        boardBytes,
        boardMtime,
      },
      logPath
    );
    maybeAlertOnFailureStreak(logPath, notify, "publish-optin-missing");
    return 1;
  }

  const body = fs.readFileSync(boardPath);

  // ---- Fixture-shape floor (#1578, defense in depth) ----
  // Even with publish authorized, refuse a board that smells synthetic — a
  // SEPARATE axis from the opt-in above (who invoked vs what is published).
  // Also runs before resolveAuth(): a refused run must never touch credentials.
  if (looksSynthetic(boardBytes, body)) {
    appendSyncRecord(
      {
        ts: now(),
        result: "refused",
        reason: "synthetic-board",
        url: null,
        boardBytes,
        boardMtime,
      },
      logPath
    );
    maybeAlertOnFailureStreak(logPath, notify, "synthetic-board");
    return 1;
  }

  const auth = resolveAuth();
  if (auth.mode === "none") {
    console.error(TOKEN_HELP);
    appendSyncRecord(
      {
        ts: now(),
        result: "skipped-no-token",
        reason: auth.reason,
        url: null,
        boardBytes,
        boardMtime,
      },
      logPath
    );
    maybeAlertOnFailureStreak(logPath, notify, auth.reason);
    return 1;
  }

  // Content-hash dedup (#1358): a sha256 hex of the EXACT upload bytes. Safe to log
  // (one-way digest of public board data — not the content, not a credential). Skip
  // the metered `put` when the remote already holds these exact bytes.
  const priorRecords = readSyncLog(logPath);
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  const remoteHash = lastRemoteHash(priorRecords);
  if (remoteHash !== null && remoteHash === hash) {
    // Deliberate success no-op — the remote already holds these exact bytes. The hook
    // `|| true`-wraps + `exit 0`s regardless; 0 is the honest "nothing to do, all good".
    appendSyncRecord(
      {
        ts: now(),
        result: "skipped-unchanged",
        reason: "unchanged",
        url: null,
        boardBytes,
        boardMtime,
        hash,
      },
      logPath
    );
    return 0;
  }

  try {
    const baseOpts = {
      access: "public" as const,
      addRandomSuffix: false,
      cacheControlMaxAge: 0,
      allowOverwrite: true,
      contentType: "application/json",
    };
    // oidc passes NO `token` key: the SDK prefers an explicit `token` over
    // OIDC (verified in 2.4.1's resolveBlobAuth), so including one would
    // silently defeat OIDC. Post-#1405 oidc is the only credentialed mode.
    const { url } = await put("board.json", body, {
      ...baseOpts,
      oidcToken: auth.oidcToken,
      storeId: auth.storeId,
    });

    // ONLY the URL + the one-line env hint. No credential, ever.
    console.log(url);
    console.log(`set BOARD_BLOB_URL=${url} in the Vercel project env`);
    appendSyncRecord(
      {
        ts: now(),
        result: "uploaded",
        reason: auth.reason,
        url,
        boardBytes,
        boardMtime,
        hash,
      },
      logPath
    );
    return 0;
  } catch (err: unknown) {
    // Print only the message — never the stack (could echo request internals). Log
    // only the error CLASS (not the message/stack) so no request internals leak.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`upload-board: upload failed — ${msg}`);
    const errClass =
      err instanceof Error ? err.constructor.name || "Error" : "unknown-error";
    appendSyncRecord(
      {
        ts: now(),
        result: "failed",
        reason: errClass,
        url: null,
        boardBytes,
        boardMtime,
      },
      logPath
    );
    maybeAlertOnFailureStreak(logPath, notify, errClass);
    return 1;
  }
}

async function main(): Promise<void> {
  const code = await uploadBoard({
    put: realPut as unknown as PutFn,
    resolveAuth: () => defaultResolveBlobAuth(),
    boardPath: process.env.OUT || path.join("data", "board.json"),
    logPath: defaultSyncLogPath(),
  });
  process.exit(code);
}

// Run the courier only when invoked as a script — NOT when imported by a unit test
// (jest sets NODE_ENV=test). Importing the module to exercise uploadBoard() must not
// fire the real `put` or the real `security` Keychain read (#1158 AC-IMPORTABLE).
if (process.env.NODE_ENV !== "test") {
  void main();
}
