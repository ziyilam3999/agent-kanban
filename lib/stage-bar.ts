// stage-bar.ts — the ONE pure control-flow selector shared by the drawer's
// PipelineProgress bar (components/Drawer.tsx) AND the swimlane track
// (lib/lanes.ts -> components/LiveSwimlanes.tsx), so the two surfaces can
// never disagree about which role the chain is actually working on (#1468).
//
// The bug this replaces: both surfaces derived their "current" role from role
// PRESENCE only (rolesSeen) — a fail-class review comment still counted as
// "done", so the bar/track happily lit the NEXT role as "up next" even though
// the chain actually bounced BACKWARD to the prior work role to be redone.
//
// This selector resolves the design brief's §3 state machine and returns, per
// pipeline role, both facts the old code conflated: REACHED (any comment) and,
// for review roles, VERDICT (the review's own latest decision) — plus the
// single derived POINTER (the one role the chain is genuinely working on right
// now, or null when terminal). Built entirely on the board's existing
// isFailClassVerdict (bounce test) + verdictHue (tint, applied by callers) +
// the two reuse enablers in ui-meta.ts — no forked fail-class vocabulary.

import type { Ticket } from "./board-schema";
import {
  PIPELINE_ROLES,
  isFailClassVerdict,
  latestVerdictForRole,
  roleLabel,
  type PipelineRole,
} from "./ui-meta";

/**
 * Per-pill visual state. `current` = genuinely next in forward flow (first
 * pass, no rework). `reworking` = the pointer bounced BACK onto this work role
 * after a downstream fail — renders with the identical glow as `current`
 * (callers union both into one shared "active/glow" marker) plus a `↩` prefix
 * distinguishing "redoing" from "starting fresh".
 */
export type StageLook = "done" | "pass" | "failed" | "current" | "reworking" | "pending";

export interface StagePill {
  role: PipelineRole;
  /** Has this role acted (>=1 comment)? Presence-only — unchanged semantics
   * from the pre-#1468 `rolesSeen`. */
  reached: boolean;
  /** The role's own latest verdict (review roles only). Undefined for work
   * roles and for a review role with no verdict-bearing comment yet. */
  verdict?: string;
  look: StageLook;
}

export interface StageBarState {
  /** One pill per PIPELINE_ROLES, same order. */
  pills: StagePill[];
  /** The single role the chain is working on right now, or null when terminal. */
  pointer: PipelineRole | null;
  /** True iff execution-review passed — the chain is complete; no pointer, no glow. */
  terminal: boolean;
  /** True iff a fail-class review bounced the pointer BACK to a prior work role. */
  reworking: boolean;
  /** The adjacent [workRole, reviewRole] pair the ◄ loopback glyph renders
   * between, or null when there is no active bounce. */
  loopbackGap: readonly [PipelineRole, PipelineRole] | null;
  /** Honest, non-fractional description of the control state (brief §5) — the
   * container aria-label. Never announces a downstream role as done/next when
   * a review failed. */
  ariaLabel: string;
}

function roleIndex(role: PipelineRole): number {
  return PIPELINE_ROLES.indexOf(role);
}

/**
 * Resolve the verdict-aware control-flow state for a ticket's 4-role pipeline.
 * Pure function of `ticket.comments` — no clock, no network, unit-testable.
 * Precedence (brief §3, first match wins): execPass -> TERMINAL; execFail ->
 * bounce to EXECUTOR; planFail -> bounce to PLANNER (forcing every downstream
 * role grey, even a stray later comment); otherwise -> forward flow.
 */
export function resolveStageBar(ticket: Ticket): StageBarState {
  const rolesSeen = new Set(ticket.comments.map((c) => c.role));
  const planVerdict = latestVerdictForRole(ticket, "plan-review");
  const execVerdict = latestVerdictForRole(ticket, "execution-review");

  const planReached = rolesSeen.has("plan-review");
  const execReached = rolesSeen.has("execution-review");

  const planFail = planReached && planVerdict !== undefined && isFailClassVerdict(planVerdict);
  const execFail = execReached && execVerdict !== undefined && isFailClassVerdict(execVerdict);
  const execPass = execReached && execVerdict !== undefined && !isFailClassVerdict(execVerdict);

  let pointer: PipelineRole | null;
  let terminal = false;
  let reworking = false;
  let loopbackGap: readonly [PipelineRole, PipelineRole] | null = null;
  /** When set, every role at/after this index is FORCED grey (pending), even
   * with a stray comment (#1468 R1 — the exact operator-caught bug). */
  let forceGreyFromIndex: number | null = null;

  if (execPass) {
    pointer = null;
    terminal = true;
  } else if (execFail) {
    pointer = "executor";
    reworking = true;
    loopbackGap = ["executor", "execution-review"] as const;
  } else if (planFail) {
    pointer = "planner";
    reworking = true;
    loopbackGap = ["planner", "plan-review"] as const;
    forceGreyFromIndex = roleIndex("executor");
  } else {
    const nextPending = PIPELINE_ROLES.find((r) => !rolesSeen.has(r));
    // The only way every role can be "reached" without landing in execFail/
    // execPass above is execution-review having NO verdict yet (reviewing
    // now) — brief §3 state 3's "all reached but exec-review pending" case.
    pointer = nextPending ?? "execution-review";
  }

  const pills: StagePill[] = PIPELINE_ROLES.map((role, idx) => {
    const reached = rolesSeen.has(role);
    const isReview = role === "plan-review" || role === "execution-review";
    const verdict = role === "plan-review" ? planVerdict : role === "execution-review" ? execVerdict : undefined;

    if (forceGreyFromIndex !== null && idx >= forceGreyFromIndex) {
      return { role, reached, verdict, look: "pending" };
    }

    if (role === pointer) {
      return { role, reached, verdict, look: reworking ? "reworking" : "current" };
    }

    if (isReview) {
      if (reached && verdict !== undefined) {
        return { role, reached, verdict, look: isFailClassVerdict(verdict) ? "failed" : "pass" };
      }
      return { role, reached, verdict, look: reached ? "done" : "pending" };
    }

    return { role, reached, verdict: undefined, look: reached ? "done" : "pending" };
  });

  const ariaLabel = buildAriaLabel(pills, pointer, terminal, reworking, loopbackGap);

  return { pills, pointer, terminal, reworking, loopbackGap, ariaLabel };
}

function buildAriaLabel(
  pills: StagePill[],
  pointer: PipelineRole | null,
  terminal: boolean,
  reworking: boolean,
  loopbackGap: readonly [PipelineRole, PipelineRole] | null,
): string {
  if (terminal) return "stage: complete, all roles passed";

  if (reworking && loopbackGap) {
    const [workRole, reviewRole] = loopbackGap;
    const notYetReached = pills.filter((p) => p.look === "pending").map((p) => roleLabel(p.role));
    const tail = notYetReached.length ? `; ${notYetReached.join(" and ")} not yet reached` : "";
    return `stage: ${roleLabel(workRole)} re-working after ${roleLabel(reviewRole)} failed${tail}`;
  }

  const passedOrDone = pills
    .filter((p) => p.look === "done" || p.look === "pass")
    .map((p) => roleLabel(p.role));
  const activeLabel = pointer ? roleLabel(pointer) : null;
  const tail = passedOrDone.length ? `; ${passedOrDone.join(" and ")} passed` : "";
  return activeLabel ? `stage: ${activeLabel} active${tail}` : "stage: queued";
}
