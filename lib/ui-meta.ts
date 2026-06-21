// ui-meta.ts — shared display tokens for the telemetry UI (column hues + role
// metadata). One source so the card pips, pipeline meter, and drawer timeline all
// agree on colors and the canonical 4-role pipeline order.

import type { Column, Ticket } from "./board-schema";

/** CSS-var hue per column — the thin status rail + count tint, never a fill. */
export const COLUMN_HUE: Record<Column, string> = {
  todo: "var(--todo)",
  in_progress: "var(--prog)",
  in_review: "var(--review)",
  done: "var(--done)",
};

/** Short mono label per column for the pipeline meter readout. */
export const COLUMN_METER_LABEL: Record<Column, string> = {
  todo: "TODO",
  in_progress: "PROG",
  in_review: "REVIEW",
  done: "DONE",
};

/** The 4-role pipeline, in execution order — drives the card progress pips. */
export const PIPELINE_ROLES = [
  "planner",
  "plan-review",
  "executor",
  "execution-review",
] as const;

export type PipelineRole = (typeof PIPELINE_ROLES)[number];

/** Color-code per role (drawer nodes + pips). Free-form roles fall back to dim. */
export const ROLE_COLOR: Record<string, string> = {
  planner: "var(--prog)",
  "plan-review": "var(--review)",
  executor: "var(--live)",
  "execution-review": "var(--done)",
  orchestrator: "var(--fg-dim)",
};

/** Mono-caps label per role for the drawer timeline + pip tooltips. */
export const ROLE_LABEL: Record<string, string> = {
  planner: "PLANNER",
  "plan-review": "PLAN-REVIEW",
  executor: "EXECUTOR",
  "execution-review": "EXEC-REVIEW",
  orchestrator: "ORCHESTRATOR",
};

export function roleColor(role: string): string {
  return ROLE_COLOR[role] ?? "var(--fg-dim)";
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.toUpperCase();
}

/**
 * CSS hue for a review verdict, by precedence (most severe first):
 *   BLOCK / FAIL / REJECT                 → red   (--err)
 *   NOTES / WITH-FIX(ES) / WARN           → amber (--review)
 *   APPROVE / PASS / SHIP (without FIX)   → green (--done)
 *   otherwise                              → dim
 * Case-insensitive. A qualified verdict (e.g. APPROVE-WITH-NOTES, SHIP-WITH-FIXES)
 * resolves AMBER because the amber check precedes the green one. Shared by the
 * drawer verdict pills and the card phase line — one source of the precedence.
 */
export function verdictHue(v: string): string {
  const u = v.toUpperCase();
  if (/BLOCK|FAIL|REJECT/.test(u)) return "var(--err)";
  if (/NOTES|WITH-FIX|FIXES|WARN/.test(u)) return "var(--review)";
  if (/APPROVE|PASS/.test(u)) return "var(--done)";
  if (/SHIP/.test(u) && !/FIX/.test(u)) return "var(--done)";
  return "var(--fg-dim)";
}

/** Pipeline roles that DO the work (not review) — used to name the in_progress actor. */
const WORK_PIPELINE_ROLES = new Set<string>(["planner", "executor"]);

/**
 * The latest review verdict for a ticket, preferring an execution-review over a
 * plan-review. Comments are oldest-first, so the LAST match of each role wins.
 * Returns undefined when neither review role carries a verdict.
 */
export function latestReviewVerdict(ticket: Ticket): string | undefined {
  let planVerdict: string | undefined;
  let execVerdict: string | undefined;
  for (const c of ticket.comments) {
    if (!c.verdict) continue;
    if (c.role === "execution-review") execVerdict = c.verdict;
    else if (c.role === "plan-review") planVerdict = c.verdict;
  }
  return execVerdict ?? planVerdict;
}

/** Display metadata for a card's phase line — the plain-words "why it's in this lane". */
export interface PhaseLine {
  text: string;
  hueVar: string;
  ariaLabel: string;
}

/**
 * Build the per-card phase line that states WHY a ticket sits in its lane, in plain
 * words + a hue token. Branches on `ticket.column`; every branch returns NON-EMPTY text.
 *   todo        → "QUEUED"
 *   in_progress → "▶ <ROLE>" of the latest work role (planner/executor); else
 *                 "▶ WORKING" (mint) when `active`, "▶ STARTED" (cyan) when not
 *   in_review   → "◆ REVIEW · <VERDICT>" (hue by verdict severity), else "◆ REVIEW"
 *   done        → "✓ DONE" plus " · <VERDICT>" when a review verdict exists
 *
 * `active` (default false) marks the single in_progress ticket the live session is
 * working RIGHT NOW (or a parallel-touched card) — it distinguishes the live focus
 * (▶ WORKING, mint, pulsing) from a begun-but-parked card (▶ STARTED, cyan, static).
 */
export function phaseLine(ticket: Ticket, active = false): PhaseLine {
  switch (ticket.column) {
    case "todo":
      return {
        text: "QUEUED",
        hueVar: "var(--todo)",
        ariaLabel: "queued, no role yet",
      };
    case "in_progress": {
      let role: string | undefined;
      for (const c of ticket.comments) {
        if (WORK_PIPELINE_ROLES.has(c.role)) role = c.role;
      }
      if (!role) {
        return active
          ? {
              text: "▶ WORKING",
              hueVar: "var(--live)",
              ariaLabel: "in progress, working now",
            }
          : {
              text: "▶ STARTED",
              hueVar: "var(--prog)",
              ariaLabel: "in progress, started",
            };
      }
      return {
        text: `▶ ${roleLabel(role)}`,
        hueVar: roleColor(role),
        ariaLabel: `in progress, ${role}`,
      };
    }
    case "in_review": {
      const verdict = latestReviewVerdict(ticket);
      if (!verdict) {
        return {
          text: "◆ REVIEW",
          hueVar: "var(--review)",
          ariaLabel: "in review",
        };
      }
      return {
        text: `◆ REVIEW · ${verdict}`,
        hueVar: verdictHue(verdict),
        ariaLabel: `in review, verdict ${verdict}`,
      };
    }
    case "done":
    default: {
      const verdict = latestReviewVerdict(ticket);
      return {
        text: verdict ? `✓ DONE · ${verdict}` : "✓ DONE",
        hueVar: "var(--done)",
        ariaLabel: verdict ? `done, verdict ${verdict}` : "done",
      };
    }
  }
}
