#!/usr/bin/env tsx
// board-freshness-watchdog.ts — the CLI that wires the pure #1435 decision
// (lib/board-freshness.ts) to REAL local file reads + the REAL osascript notifier,
// on a launchd StartInterval schedule (scripts/install-board-watchdog.sh).
//
// It is INDEPENDENT of the courier (D7): it imports no Blob upload SDK and no Blob
// credential resolver, and makes no network call. It only stats local files and fires
// the shared osascript notifier (lib/notify.ts). That independence is what lets it catch the whole
// "courier never ran" family the in-process #1405 counter is structurally blind to.
//
// Modes:
//   --check / --dry-run  Compute + print the verdict token to stdout, exit 0, fire
//                        NOTHING and mutate NOTHING (the outside-the-diff observability
//                        handle + the hermetic CLI test surface).
//   (no flag)            Live: fire the real notification on an alerting verdict
//                        (debounced once per staleness episode), print the token,
//                        exit 0.
//
// Every knob is env/config with a sane default (Rule 16) — no hardcoded home path, no
// magic threshold literal in the decision path:
//   OUT                            board artifact path        (default data/board.json)
//   BOARD_STALE_THRESHOLD_MS       staleness threshold N      (default 10 min)
//   BOARD_WATCHDOG_ACTIVE_WINDOW_MS active-work window W      (default 8 min, aligned
//                                                             to lib/active.ts)
//   LEDGER_DIR                     3-role-ledger dir          (default ~/.claude/3role-ledger)
//   HEARTBEAT_DIR                  lane-heartbeat dir         (default ~/.claude/lane-heartbeats)
//   SESSION_ID                     restrict activity to one session (default: all)
//   SYNC_LOG                       sync logbook path          (default data/sync.log)
//   BOARD_WATCHDOG_FOLD_SYNCLOG    fold sync.log ts into freshness (default 1/on)
//   BOARD_WATCHDOG_OFF             kill-switch env flag       (1/true/yes)
//   BOARD_WATCHDOG_OFF_FILE        kill-switch dotfile        (default ~/.claude/.kanban-watchdog-off)
//   BOARD_WATCHDOG_STATE_FILE      debounce state file        (default ~/.claude/.kanban-watchdog-state.json)

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  decideFreshness,
  isAlertingVerdict,
  runFreshnessCheck,
  type DecisionInput,
  type Verdict,
} from "../lib/board-freshness";
import { defaultNotify } from "../lib/notify";
import { readSyncLog } from "../lib/sync-log";

// Sane defaults (Rule 16) — configurable via the env vars above, never hardcoded into
// the decision path (lib/board-freshness.ts takes N/W as inputs).
const DEFAULT_STALE_MS = 10 * 60 * 1000; // 10 min — comfortably above the active upload cadence
const DEFAULT_ACTIVE_WINDOW_MS = 8 * 60 * 1000; // aligned to lib/active.ts ACTIVE_WINDOW_MS

function isENOENT(e: unknown): boolean {
  return (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function intFromEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

function boolFromEnv(name: string, def: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "") return def;
  return !(raw === "0" || raw === "false" || raw === "no");
}

/** Board artifact mtime (ms), or null when the file is MISSING/UNREADABLE (fail-closed). */
function readBoardMtimeMs(boardPath: string): number | null {
  try {
    return fs.statSync(boardPath).mtimeMs;
  } catch {
    return null;
  }
}

/** Newest sync.log record ts (ms), or null if none/unreadable. Defensive secondary. */
function lastSyncLogTsMs(logPath: string): number | null {
  const records = readSyncLog(logPath); // guarded: [] on any error
  for (let i = records.length - 1; i >= 0; i--) {
    const t = Date.parse(records[i].ts);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/**
 * Newest courier-INDEPENDENT activity mtime (ms) across the 3-role-ledger (#1305) and
 * lane-heartbeat (#1317) markers — the SAME liveness inputs the board itself renders.
 * Returns:
 *   - a real number  → newest activity marker mtime;
 *   - NEGATIVE_INFINITY → readable but NO marker exists → genuinely idle;
 *   - null           → a genuine read error (NOT a missing dir) → fail-closed.
 * A missing dir (ENOENT) is "no activity yet", not a malfunction.
 */
function readActivityMtimeMs(
  ledgerDir: string,
  heartbeatDir: string,
  sessionId: string | null
): number | null {
  let newest = Number.NEGATIVE_INFINITY;
  let unreadable = false;

  // Lane-heartbeat markers: flat <heartbeatDir>/<session>.beat files (#1317).
  try {
    const names = sessionId
      ? [`${sessionId}.beat`]
      : fs.readdirSync(heartbeatDir);
    for (const f of names) {
      if (!f.endsWith(".beat")) continue;
      try {
        const st = fs.statSync(path.join(heartbeatDir, f));
        if (st.isFile()) newest = Math.max(newest, st.mtimeMs);
      } catch (e) {
        if (!isENOENT(e)) unreadable = true;
      }
    }
  } catch (e) {
    if (!isENOENT(e)) unreadable = true;
  }

  // 3-role-ledger markers: nested <ledgerDir>/<session>/<task>.jsonl files (#1305).
  try {
    const sessions = sessionId ? [sessionId] : fs.readdirSync(ledgerDir);
    for (const s of sessions) {
      const sdir = path.join(ledgerDir, s);
      let files: string[];
      try {
        files = fs.readdirSync(sdir);
      } catch (e) {
        if (!isENOENT(e)) unreadable = true;
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        try {
          const st = fs.statSync(path.join(sdir, f));
          if (st.isFile()) newest = Math.max(newest, st.mtimeMs);
        } catch (e) {
          if (!isENOENT(e)) unreadable = true;
        }
      }
    }
  } catch (e) {
    if (!isENOENT(e)) unreadable = true;
  }

  if (unreadable) return null; // fail-closed: a genuine read error, treat as active
  return newest; // NEGATIVE_INFINITY when no markers → idle
}

/** Kill-switch: an env flag OR a dotfile (independent of the courier's own disable path). */
function killSwitchOn(): boolean {
  if (boolFromEnv("BOARD_WATCHDOG_OFF", false)) return true;
  const file =
    process.env.BOARD_WATCHDOG_OFF_FILE ||
    path.join(os.homedir(), ".claude", ".kanban-watchdog-off");
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

// --- Debounce state (live mode only): alert once per staleness episode, re-arm on FRESH.
interface WatchdogState {
  episode: "active" | "clear";
  lastAlertTs?: string;
}

function stateFilePath(): string {
  return (
    process.env.BOARD_WATCHDOG_STATE_FILE ||
    path.join(os.homedir(), ".claude", ".kanban-watchdog-state.json")
  );
}

function readState(file: string): WatchdogState {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as WatchdogState;
    if (s && (s.episode === "active" || s.episode === "clear")) return s;
  } catch {
    /* absent/malformed → armed (clear) */
  }
  return { episode: "clear" };
}

function writeState(file: string, state: WatchdogState): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state) + "\n");
  } catch {
    /* best-effort — a state-write failure must never break the watchdog */
  }
}

/** Live-mode: compute the verdict, fire the real notify once per episode, re-arm on FRESH. */
function runLive(input: DecisionInput): Verdict {
  const file = stateFilePath();
  const verdict = decideFreshness(input);

  if (verdict === "FRESH") {
    writeState(file, { episode: "clear" }); // board recovered → re-arm
    return verdict;
  }
  if (!isAlertingVerdict(verdict)) return verdict; // IDLE / DISABLED → no alert, no change

  const state = readState(file);
  if (state.episode !== "active") {
    runFreshnessCheck(input, { notify: defaultNotify });
    writeState(file, {
      episode: "active",
      lastAlertTs: new Date(input.now).toISOString(),
    });
  }
  return verdict;
}

function resolveInputs(): DecisionInput {
  const homedir = os.homedir();
  const boardPath = process.env.OUT || path.join("data", "board.json");
  const ledgerDir =
    process.env.LEDGER_DIR || path.join(homedir, ".claude", "3role-ledger");
  const heartbeatDir =
    process.env.HEARTBEAT_DIR ||
    path.join(homedir, ".claude", "lane-heartbeats");
  const sessionId = (process.env.SESSION_ID || "").trim() || null;
  const syncLogPath = process.env.SYNC_LOG || path.join("data", "sync.log");

  let boardMtimeMs = readBoardMtimeMs(boardPath);
  // Defensive secondary (D1): MAX-fold the newest sync.log ts so an actively-running
  // courier (sync.log advancing) reads as fresh here — that keeps this watchdog
  // COMPLEMENTARY with the in-process #1405 streak counter instead of double-alerting.
  // Never rescues a MISSING board (null stays null): a gone board.json is fail-closed.
  if (boardMtimeMs !== null && boolFromEnv("BOARD_WATCHDOG_FOLD_SYNCLOG", true)) {
    const syncTs = lastSyncLogTsMs(syncLogPath);
    if (syncTs !== null) boardMtimeMs = Math.max(boardMtimeMs, syncTs);
  }

  return {
    now: Date.now(),
    killSwitch: killSwitchOn(),
    boardMtimeMs,
    activityMtimeMs: readActivityMtimeMs(ledgerDir, heartbeatDir, sessionId),
    staleMs: intFromEnv("BOARD_STALE_THRESHOLD_MS", DEFAULT_STALE_MS),
    activeWindowMs: intFromEnv(
      "BOARD_WATCHDOG_ACTIVE_WINDOW_MS",
      DEFAULT_ACTIVE_WINDOW_MS
    ),
  };
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--check") || args.has("--dry-run");
  const input = resolveInputs();

  const verdict = dryRun ? decideFreshness(input) : runLive(input);
  process.stdout.write(verdict + "\n");
  process.exit(0);
}

main();
