// board-freshness.ts — the PURE, injectable decision for the external board-freshness
// watchdog (#1435). Sibling to active.ts / sync-log.ts.
//
// WHY THIS EXISTS (the exact gap): the in-process courier alarm in
// scripts/upload-board.ts (consecutiveTrailingFailures + shouldNotify, #1405) only
// advances when the courier RAN and FAILED (3 trailing non-success data/sync.log
// records). It is structurally BLIND to the courier NEVER RUNNING — hook unwired,
// kill-switch present, or a long silent executor leg that writes no TaskCreate|
// TaskUpdate — because all three write ZERO sync.log records, so the counter never
// moves and the board freezes silently while real work happens.
//
// This module is the INDEPENDENT out-of-band age-watchdog memory
// `feedback_live_board_freshness_guard_must_be_external_watchdog_not_inprocess_failure_counter`
// demands: it compares the board artifact's AGE against the wall clock FROM THE
// OUTSIDE, gated by a courier-independent "is anyone working now?" signal so it does
// not cry wolf during a genuine idle. It is FAIL-CLOSED — "I can't tell" alerts, it
// never silently passes.
//
// PURITY: this file reads no clock, no filesystem, no launchd, and fires no real
// notification. All of that is INJECTED by the caller (scripts/board-freshness-
// watchdog.ts wires the real reads; the test injects synthetic values). That is what
// makes the both-ends test hermetic. It imports NOTHING (D7: zero Blob SDK, zero
// credential, zero network — grep-provable).

/** The verdict tokens — the D5 truth-table outcomes. Stable, machine-parseable. */
export type Verdict =
  | "FRESH" // board age <= staleMs → healthy, quiet
  | "STALE-ACTIVE" // board stale AND work active → THE bug → alert
  | "IDLE" // board stale AND nobody working → quiet (no cry-wolf)
  | "UNKNOWN" // can't determine freshness/activity → alert (fail-closed)
  | "DISABLED"; // kill-switch on → quiet

/**
 * Inputs to the pure decision. Everything is pre-resolved by the caller so this stays
 * hermetic.
 *
 * `boardMtimeMs`:  the board artifact's mtime (ms epoch), or `null` when the board
 *                  file is MISSING or UNREADABLE → fail-closed UNKNOWN.
 * `activityMtimeMs`: the newest "work is happening now" marker mtime (ms epoch) across
 *                  the courier-INDEPENDENT signals (3-role-ledger + lane-heartbeat).
 *                  Two sentinels carry the fail-closed distinction the memory needs:
 *                    - a real number  → the newest activity marker's mtime;
 *                    - `Number.NEGATIVE_INFINITY` → the signals were readable but NO
 *                      marker exists → genuinely idle (contributes to IDLE, never
 *                      alerts);
 *                    - `null` → the activity signal was UNREADABLE (a real read error,
 *                      not a missing dir) → fail-closed, treat as active.
 */
export interface DecisionInput {
  now: number;
  killSwitch: boolean;
  boardMtimeMs: number | null;
  activityMtimeMs: number | null;
  staleMs: number;
  activeWindowMs: number;
}

/** TRUE for the verdicts that must fire the operator alert. */
export function isAlertingVerdict(v: Verdict): boolean {
  return v === "STALE-ACTIVE" || v === "UNKNOWN";
}

/**
 * The D5 decision truth table, as pure logic. No thresholds are hardcoded here — N
 * (`staleMs`) and W (`activeWindowMs`) arrive as inputs (Rule 16). Only two states
 * stay quiet: genuinely FRESH, or genuinely IDLE. Every "can't tell" path alerts.
 *
 *   | board age            | activity age   | verdict       | notify |
 *   |----------------------|----------------|---------------|--------|
 *   | kill-switch on       | any            | DISABLED      | no     |
 *   | missing / unreadable | any            | UNKNOWN       | YES    |
 *   | <= N (fresh)         | any            | FRESH         | no     |
 *   | > N (stale)          | unreadable     | UNKNOWN       | YES    |
 *   | > N (stale)          | <= W (active)  | STALE-ACTIVE  | YES    |
 *   | > N (stale)          | > W (idle)     | IDLE          | no     |
 */
export function decideFreshness(input: DecisionInput): Verdict {
  // Kill-switch wins over everything (an operator explicitly silenced the alarm).
  if (input.killSwitch) return "DISABLED";

  // Board file missing / unreadable → can't determine freshness at all → fail-closed.
  // A fresh activity signal must NOT rescue a missing board: a gone board.json is a
  // strong "something is very wrong" signal, so we alert regardless of activity.
  if (input.boardMtimeMs === null) return "UNKNOWN";

  // Board is FRESH → the whole downstream chain is at worst this fresh → quiet, even
  // if the activity signal is unreadable (nothing is stale, so there is nothing to
  // alert about).
  const boardAgeMs = input.now - input.boardMtimeMs;
  if (boardAgeMs <= input.staleMs) return "FRESH";

  // Board is STALE from here down.

  // Activity signal unreadable while the board is stale → can't tell whether work is
  // happening → fail-closed (a stale board during possibly-live work must alert).
  if (input.activityMtimeMs === null) return "UNKNOWN";

  // Stale board + genuinely active work = the freeze-while-active bug this watchdog
  // exists to catch. (NEGATIVE_INFINITY activity — no markers — makes activityAge
  // Infinity > W, so it correctly falls through to IDLE.)
  const activityAgeMs = input.now - input.activityMtimeMs;
  if (activityAgeMs <= input.activeWindowMs) return "STALE-ACTIVE";

  // Stale board + nobody working → don't cry wolf during a real idle stretch.
  return "IDLE";
}

/** Injectable side-effect surface (the real macOS notify, or a test spy). */
export interface CheckDeps {
  notify: (title: string, message: string) => void;
}

const ALERT_TITLE = "agent-kanban board freshness";

/**
 * Compute the verdict AND fire the injected notify on the alerting verdicts. Returns
 * the verdict token. The message carries ONLY coarse result/reason tokens and a
 * rounded age in seconds — never board content, a path, or a secret.
 */
export function runFreshnessCheck(
  input: DecisionInput,
  deps: CheckDeps
): Verdict {
  const verdict = decideFreshness(input);
  if (!isAlertingVerdict(verdict)) return verdict;

  let message: string;
  if (verdict === "STALE-ACTIVE" && input.boardMtimeMs !== null) {
    const ageS = Math.round((input.now - input.boardMtimeMs) / 1000);
    message = `The live board is stale (${ageS}s old) while work is active — the courier has not re-exported. Check the sync hook / kill-switch.`;
  } else {
    // UNKNOWN — board or activity signal could not be determined (fail-closed).
    message =
      "Board freshness could not be determined (board file or activity signal unreadable) — the live board may be silently stale. Check the courier + watchdog inputs.";
  }
  deps.notify(ALERT_TITLE, message);
  return verdict;
}
