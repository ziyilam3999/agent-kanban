// ui-meta.ts — shared display tokens for the telemetry UI (column hues + role
// metadata). One source so the card pips, pipeline meter, and drawer timeline all
// agree on colors and the canonical 4-role pipeline order.

import type { Column, Ticket } from "./board-schema";
import { LIVE_WINDOW_MS } from "./board-schema";

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
 * Fail-class review verdict tokens. ONE shared definition (#1410) — the column
 * mapping (build-board newestExecutionReviewState), the chain predicate
 * (active.ts chainInFlight), and the hue precedence (verdictHue below) all
 * classify through this single regex, so the fail-class boundary can never
 * drift between layers. A FAIL/BLOCK/REJECT execution-review sends the card
 * back to IN PROGRESS (rework is an honest backward move) and keeps the chain
 * in flight; every other resolved verdict counts as non-fail.
 */
export const FAIL_CLASS_RE = /BLOCK|FAIL|REJECT/i;

/** TRUE iff the verdict carries a fail-class token (case-insensitive). */
export function isFailClassVerdict(v: string): boolean {
  return FAIL_CLASS_RE.test(v);
}

/**
 * How long after its last observable event a passed-and-shipping ticket keeps
 * the "SHIPPING" pill before it dims to "STALE" (#1410). 60 min — deliberately
 * NOT the 6 h INFLIGHT_LANE_CAP_MS: that cap is tuned for silent multi-hour
 * EXECUTOR legs mid-chain, whereas the post-PASS ship tail (merge → CI wait →
 * install → close) is minutes-scale; a pill claiming activity for 6 h would
 * lie. Configurable: change here, or inject per call via phaseLine's
 * `shippingStaleCapMs` parameter (same exported-const + injectable-param shape
 * as ACTIVE_WINDOW_MS / INFLIGHT_LANE_CAP_MS — no env var by the #1403 Q2
 * precedent).
 */
export const SHIPPING_STALE_MS = 60 * 60 * 1000;

/**
 * CSS hue for a review verdict, by precedence (most severe first):
 *   BLOCK / FAIL / REJECT                 → red   (--err)
 *   NOTES / WITH-FIX(ES) / WARN           → amber (--review)
 *   APPROVE / PASS / SHIP (without FIX)   → green (--done)
 *   otherwise                              → dim
 * Case-insensitive. A qualified verdict (e.g. APPROVE-WITH-NOTES, SHIP-WITH-FIXES)
 * resolves AMBER because the amber check precedes the green one. Shared by the
 * drawer verdict pills and the card phase line — one source of the precedence.
 * The severe branch delegates to isFailClassVerdict (the shared fail-class
 * predicate; its /i flag subsumes the former manual toUpperCase check).
 */
export function verdictHue(v: string): string {
  const u = v.toUpperCase();
  if (isFailClassVerdict(u)) return "var(--err)";
  if (/NOTES|WITH-FIX|FIXES|WARN/.test(u)) return "var(--review)";
  if (/APPROVE|PASS/.test(u)) return "var(--done)";
  if (/SHIP/.test(u) && !/FIX/.test(u)) return "var(--done)";
  return "var(--fg-dim)";
}

/** Pipeline roles that DO the work (not review) — used to name the in_progress
 * actor. Exported (#1468) so the stage-bar selector can name the correct work
 * role to bounce the pointer onto — reusing the exact set phaseLine/cardModel
 * already use, so the bar never disagrees with them about "who is a work role." */
export const WORK_PIPELINE_ROLES = new Set<string>(["planner", "executor"]);

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

/**
 * The latest verdict for ONE named review role (#1468) — generalizes
 * latestReviewVerdict (which blends plan-review/execution-review into a single
 * "the" verdict) to a per-role lookup, so the stage-bar selector can classify
 * plan-review and execution-review INDEPENDENTLY. Same last-match-wins scan
 * (comments are oldest-first); latestReviewVerdict is left untouched (its own
 * tests depend on the blended behavior) rather than reimplemented on top of
 * this, to avoid unrelated churn.
 */
export function latestVerdictForRole(ticket: Ticket, role: string): string | undefined {
  let verdict: string | undefined;
  for (const c of ticket.comments) {
    if (c.role === role && c.verdict !== undefined) verdict = c.verdict;
  }
  return verdict;
}

/** The model+effort a card badge (or drawer node) shows — the observed tier·version
 * plus an optional subordinate effort suffix (#1465, design brief §2/§4). */
export interface CardModel {
  /** Raw captured model version, e.g. "claude-sonnet-5" — abbreviate for display via abbreviateModel(). */
  version: string;
  /** Session-inherited effort word, e.g. "xhigh". Only ever attached alongside a version (see cardModel). */
  effort?: string;
}

/**
 * Strip the "claude-" vendor prefix from a captured model version string, e.g.
 * "claude-sonnet-5" -> "sonnet-5". The leading word IS the tier; the whole token
 * IS the version — one compact string carries both facts (design brief §2), so
 * no separate tier chip is rendered.
 */
export function abbreviateModel(modelVersion: string): string {
  return modelVersion.replace(/^claude-/, "");
}

/**
 * Compact badge text for a CardModel, e.g. "sonnet-5·xhigh" or, with no effort,
 * "sonnet-5" (the effort segment AND its separator are dropped TOGETHER — never
 * a dangling middot, design brief §4 Partial state). Pure text-contract helper;
 * Card.tsx / Drawer.tsx render the two segments as separate two-tone spans
 * (model brighter, effort dimmer) but both read off this same abbreviate+join
 * logic so the textual contract can never drift between the two call sites.
 */
export function formatCardModel(m: CardModel): string {
  const version = abbreviateModel(m.version);
  return m.effort ? `${version}·${m.effort}` : version;
}

/**
 * Select the model+effort a CARD badge shows (design brief §4 — one summary per
 * card; the drawer shows every role's model individually). Comments are
 * oldest-first (build-board convention), so scanning from the end finds the
 * newest match first:
 *   in_progress -> the newest WORK-role (planner/executor) comment carrying a
 *                  modelVersion (the phase line's own actor-selection rule,
 *                  WORK_PIPELINE_ROLES, reused so the badge never disagrees with
 *                  "who is the phase line naming"); no match -> undefined (NOT a
 *                  fallback to another role's model — an in_progress card would
 *                  otherwise show a stale reviewer's model as if it were live).
 *   otherwise   -> the newest model-bearing comment, any role (a finished/queued
 *                  card cares about "who last touched it", not liveness).
 * effort rides ONLY on the same comment as its modelVersion (effort-alone is
 * meaningless — design brief §4 Partial state) — enforced structurally here
 * because both fields are read off the SAME matched comment.
 * Returns undefined when no comment in the selected scope carries a modelVersion
 * — the card/drawer then renders NOTHING (no empty pill, no dangling separator).
 */
export function cardModel(ticket: Ticket): CardModel | undefined {
  if (ticket.column === "in_progress") {
    for (let i = ticket.comments.length - 1; i >= 0; i--) {
      const c = ticket.comments[i];
      if (WORK_PIPELINE_ROLES.has(c.role) && c.modelVersion) {
        return { version: c.modelVersion, effort: c.effort };
      }
    }
    return undefined;
  }
  for (let i = ticket.comments.length - 1; i >= 0; i--) {
    const c = ticket.comments[i];
    if (c.modelVersion) {
      return { version: c.modelVersion, effort: c.effort };
    }
  }
  return undefined;
}

/**
 * TRUE iff the ticket passed execution review but its ship tail hasn't
 * completed (#1410): status still `in_progress` AND the NEWEST execution-review
 * comment carries a present, non-empty, NON-fail-class verdict. Comments arrive
 * ts-sorted from build-board, so "newest" = last in array (same convention as
 * chainInFlight). A `completed` or `pending` ticket is never "shipping".
 *
 * NOTE: this comment-POSITION selector can disagree with the server's raw
 * newest-by-ts selector on a mixed valid-ts+NaN-ts exec-review ledger (the raw
 * selector sorts NaN as -Infinity/oldest; the comment sort leaves a NaN-ts
 * line in place) — see the mixed-ts pin in monotonic-flow.test.ts.
 */
export function shippingAfterPass(t: Ticket): boolean {
  if (t.status !== "in_progress") return false;
  let newestExecVerdict: string | undefined;
  for (const c of t.comments) {
    if (c.role === "execution-review") newestExecVerdict = c.verdict;
  }
  if (newestExecVerdict === undefined) return false;
  const v = newestExecVerdict.trim();
  if (v === "") return false;
  return !isFailClassVerdict(v);
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
 *   in_review   → shipping (passed review, ship tail running — #1410):
 *                 "✓ <VERDICT> — SHIPPING" (green), dimming to
 *                 "✓ <VERDICT> — STALE" ONLY when board-write age exceeds
 *                 `shippingStaleCapMs` AND the owning session is definitively
 *                 not live (#1449 — see below); otherwise the pending/fail path:
 *                 "◆ REVIEW · <VERDICT>" (hue by verdict severity), else "◆ REVIEW"
 *   done        → "✓ DONE" plus " · <VERDICT>" when a review verdict exists
 *
 * `active` (default false) marks the single in_progress ticket the live session is
 * working RIGHT NOW (or a parallel-touched card) — it distinguishes the live focus
 * (▶ WORKING, mint, pulsing) from a begun-but-parked card (▶ STARTED, cyan, static).
 *
 * `nowMs` (optional) is the client clock driving the shipping-stale flip; when
 * omitted the shipping pill never goes stale (back-compat). The staleness is
 * client-derived so it advances each poll even on a frozen (edge-driven)
 * snapshot — a server-side decay would freeze exactly when an orchestrator dies.
 *
 * `sessionLastActive` (optional, #1449) is the owning session's `lastActive` epoch
 * — the board's INDEPENDENT liveness signal (folds the <session>.beat heartbeat
 * that every ship-tail Bash step touches, so it keeps advancing during a quiet
 * ship tail while a single card's `updatedAt` does not). STALE is now a
 * CONJUNCTION: age > cap AND the session is definitively not live
 * (`nowMs - sessionLastActive > LIVE_WINDOW_MS`, the board's single definition of
 * "live", reused). Bias rules — a live session's card is NEVER stale, and UNKNOWN
 * liveness (this arg omitted, or nowMs omitted) FAILS CLOSED to SHIPPING: the pill
 * never cries wolf; the #1435 external watchdog is the real net for ships that die.
 * Deriving from the epoch (not a server `live` boolean) keeps this freeze-safe — a
 * genuinely-dead session on a frozen snapshot still reaches STALE as `nowMs` runs.
 */
export function phaseLine(
  ticket: Ticket,
  active = false,
  nowMs?: number,
  shippingStaleCapMs = SHIPPING_STALE_MS,
  sessionLastActive?: number
): PhaseLine {
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
      // Shipping sub-branch FIRST (#1410): passed execution review, ship tail
      // running. `v` is the newest exec-review comment's verdict — the same one
      // shippingAfterPass matched (verdicts are 24-char-capped upstream).
      if (shippingAfterPass(ticket)) {
        let v = "";
        for (const c of ticket.comments) {
          if (c.role === "execution-review" && c.verdict) v = c.verdict;
        }
        // STALE is a CONJUNCTION (#1449): the card's board-write age exceeds the
        // cap AND its owning session is DEFINITIVELY not live. A live session (or
        // UNKNOWN liveness — no session signal, or no clock) fails CLOSED to
        // SHIPPING so the pill never cries wolf on an actively-shipped card whose
        // quiet ship tail hasn't touched THIS card's updatedAt.
        const ageExceedsCap =
          nowMs !== undefined && nowMs - ticket.updatedAt > shippingStaleCapMs;
        const sessionDefinitelyDead =
          nowMs !== undefined &&
          sessionLastActive !== undefined &&
          nowMs - sessionLastActive > LIVE_WINDOW_MS;
        const stale = ageExceedsCap && sessionDefinitelyDead;
        return stale
          ? {
              text: `✓ ${v} — STALE`,
              hueVar: "var(--fg-dim)",
              ariaLabel: `passed review (${v}), shipping stalled`,
            }
          : {
              text: `✓ ${v} — SHIPPING`,
              hueVar: "var(--done)",
              ariaLabel: `passed review (${v}), shipping`,
            };
      }
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
