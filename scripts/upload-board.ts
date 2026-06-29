#!/usr/bin/env tsx
// upload-board.ts — the courier UPLOAD step.
//
// Reads data/board.json (produced by export:board) and uploads it to Vercel Blob
// at the stable pathname "board.json" (overwrite-in-place, near-zero CDN cache so
// 1.5s polling sees fresh cards). Prints ONLY the resulting blob URL + a one-line
// env hint — NEVER the token.
//
// Token resolution (in order):
//   1. BLOB_READ_WRITE_TOKEN env var  (CI / non-Mac override)
//   2. macOS Keychain: security find-generic-password -s BLOB_READ_WRITE_TOKEN -w
// The token is never printed, never written to a file, never put in an error trace.
//
// The courier OWNS its outcome record: it writes a data/sync.log line (uploaded /
// skipped-no-token / failed) BEFORE every exit, success AND non-zero (#1158) — so a
// background sync is never silent even when the hook swallows the courier's exit.

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { put as realPut } from "@vercel/blob";
import {
  appendSyncRecord,
  defaultSyncLogPath,
  readSyncLog,
} from "../lib/sync-log";

/** Minimal structural type for the blob `put` so a test can inject a mock. */
export type PutFn = (
  pathname: string,
  body: Buffer,
  opts: {
    access: "public";
    token: string;
    addRandomSuffix: boolean;
    cacheControlMaxAge: number;
    allowOverwrite: boolean;
    contentType: string;
  }
) => Promise<{ url: string }>;

/** Token-resolution outcome: the token ("" if absent) + a precise machine reason. */
export interface TokenResolution {
  token: string;
  reason: string; // env-token | keychain-token | keychain-absent | keychain-unreachable-or-absent
}

/** Injectable dependencies for the pure courier unit (hermetic in tests). */
export interface UploadDeps {
  put: PutFn;
  resolveToken: () => TokenResolution;
  boardPath: string;
  logPath: string;
}

const TOKEN_HELP = [
  "upload-board: no Blob token found.",
  "  Store it in the macOS Keychain (recommended — never touches a file):",
  '    security add-generic-password -a "$USER" -s BLOB_READ_WRITE_TOKEN -w',
  "  …then paste the token at the prompt. Or, for CI / non-Mac, export it:",
  "    export BLOB_READ_WRITE_TOKEN=...",
  "  See .env.example for the full note.",
].join("\n");

/**
 * Resolve the Blob read-write token from env, else macOS Keychain — and classify
 * the outcome into a precise, value-free `reason` token. env present → env-token;
 * keychain hit → keychain-token; clean errSecItemNotFound (exit 44) or empty output
 * → keychain-absent; any other non-zero / unrunnable `security` → unreachable. We do
 * NOT over-claim locked-vs-missing from a background shell (not reliably knowable).
 */
export function defaultResolveToken(): TokenResolution {
  const fromEnv = process.env.BLOB_READ_WRITE_TOKEN;
  if (fromEnv && fromEnv.trim() !== "") {
    return { token: fromEnv.trim(), reason: "env-token" };
  }
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", "BLOB_READ_WRITE_TOKEN", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const token = out.trim();
    if (token !== "") return { token, reason: "keychain-token" };
    return { token: "", reason: "keychain-absent" };
  } catch (err) {
    // errSecItemNotFound → `security` exits 44: a clean "not in the keychain".
    const status = (err as { status?: number } | null)?.status;
    if (status === 44) return { token: "", reason: "keychain-absent" };
    // Any other failure (not on macOS, background false-negative, locked) — we can't
    // honestly distinguish, so record the most precise non-over-claiming token.
    return { token: "", reason: "keychain-unreachable-or-absent" };
  }
}

/**
 * The hash the remote currently holds: newest uploaded|skipped-unchanged record with
 * a non-null hash, else null. Both results confirm the remote holds that exact hash.
 * Fail safe toward uploading: first-ever / legacy-hashless / unreadable log → null →
 * the caller uploads (a wrong skip = a stale remote board; a wrong upload = one wasted
 * Advanced Op — the asymmetry favors uploading).
 */
function lastRemoteHash(logPath: string): string | null {
  const recs = readSyncLog(logPath); // newest-last
  for (let i = recs.length - 1; i >= 0; i--) {
    const r = recs[i];
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
 * No real network / Keychain / blob is touched unless the injected deps do so.
 */
export async function uploadBoard(deps: UploadDeps): Promise<number> {
  const { put, resolveToken, boardPath, logPath } = deps;
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
    return 1;
  }

  const stat = fs.statSync(boardPath);
  const boardBytes = stat.size;
  const boardMtime = stat.mtime.toISOString();

  const { token, reason } = resolveToken();
  if (!token) {
    console.error(TOKEN_HELP);
    appendSyncRecord(
      {
        ts: now(),
        result: "skipped-no-token",
        reason,
        url: null,
        boardBytes,
        boardMtime,
      },
      logPath
    );
    return 1;
  }

  const body = fs.readFileSync(boardPath);

  // Content-hash dedup (#1358): a sha256 hex of the EXACT upload bytes. Safe to log
  // (one-way digest of public board data — not the content, not the token). Skip the
  // metered `put` when the remote already holds these exact bytes.
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  const remoteHash = lastRemoteHash(logPath);
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
    const { url } = await put("board.json", body, {
      access: "public",
      token,
      addRandomSuffix: false,
      cacheControlMaxAge: 0,
      allowOverwrite: true,
      contentType: "application/json",
    });

    // ONLY the URL + the one-line env hint. No token, ever.
    console.log(url);
    console.log(`set BOARD_BLOB_URL=${url} in the Vercel project env`);
    appendSyncRecord(
      {
        ts: now(),
        result: "uploaded",
        reason,
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
    return 1;
  }
}

async function main(): Promise<void> {
  const code = await uploadBoard({
    put: realPut as unknown as PutFn,
    resolveToken: defaultResolveToken,
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
