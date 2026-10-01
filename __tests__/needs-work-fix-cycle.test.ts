// needs-work-fix-cycle.test.ts — #2783 AC-1 oracle: one `it` per HELD-OUT row
// of the approved plan. Rows 1-5 are the must-fire arms (RED on the 9f6ad97
// base, GREEN on head); rows 6-10 are must-not-fire non-regression pins
// (GREEN on both). The "executor own variants" block adds independent
// held-out cases in each direction: the NEEDS_WORK underscore spelling, a
// lowercase REVISE, the artifact fallback on the OTHER review role, a
// decorated NEEDS-WORK token, and substring/whole-word guards (REVISIT,
// NEEDS-WORKAROUND, UNREVISED PASS, the out-of-vocabulary "NEEDS WORK").
//
// All fixtures are synthetic: fake task ids, inline ledger rows, and temp-dir
// artifacts written by the test itself (fake names, scratch dir). No real
// ledger, task file or transcript is ever read.

import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  buildTicket,
  newestExecutionReviewState,
  type RawLedgerLine,
  type RawTask,
} from "@/lib/build-board";
import { resolveStageBar } from "@/lib/stage-bar";
import { chainInFlight } from "@/lib/active";
import { verdictHue } from "@/lib/ui-meta";
import type { Ticket } from "@/lib/board-schema";

const baseTask = (over: Partial<RawTask> = {}): RawTask => ({
  id: "2783",
  subject: "NEEDS-WORK fix-cycle fixture",
  description: "synthetic fixture — fake ids only",
  activeForm: "Fixing the thing",
  status: "in_progress",
  blocks: [],
  blockedBy: [],
  ...over,
});

const at = (n: number) => `2026-10-02T0${n}:00:00.000Z`;

const ticketFrom = (lines: RawLedgerLine[], over: Partial<RawTask> = {}): Ticket =>
  buildTicket(baseTask(over), lines, 1);

const pillFor = (s: ReturnType<typeof resolveStageBar>, role: string) =>
  s.pills.find((p) => p.role === role)!;

const artifactDir = mkdtempSync(join(tmpdir(), "akb-2783-"));
const writeArtifact = (name: string, body: string): string => {
  const p = join(artifactDir, name);
  writeFileSync(p, body, "utf8");
  return p;
};

describe("#2783 HELD-OUT must-fire rows (RED on the 9f6ad97 base)", () => {
  it('row 1: newest exec-review verdict "NEEDS-WORK" — column in_progress; pointer executor, reworking; exec-review pill failed; hue --err', () => {
    const t = ticketFrom([
      { role: "planner", ts: at(1) },
      { role: "executor", ts: at(2) },
      { role: "execution-review", ts: at(3), verdict: "NEEDS-WORK" },
    ]);
    expect(t.column).toBe("in_progress");
    const s = resolveStageBar(t);
    expect(s.pointer).toBe("executor");
    expect(s.reworking).toBe(true);
    expect(s.terminal).toBe(false);
    expect(pillFor(s, "executor").look).toBe("reworking");
    expect(pillFor(s, "execution-review").look).toBe("failed");
    expect(verdictHue("NEEDS-WORK")).toBe("var(--err)");
  });

  it('row 2: plan-review "NEEDS-WORK" then a later planner row (fold) with no new plan-review — pointer planner, reworking; executor + exec-review forced pending', () => {
    const t = ticketFrom([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "NEEDS-WORK" },
      { role: "planner", ts: at(3) }, // planner fold — no new plan-review row after it
    ]);
    const s = resolveStageBar(t);
    expect(s.pointer).toBe("planner");
    expect(s.reworking).toBe(true);
    expect(pillFor(s, "executor").look).toBe("pending");
    expect(pillFor(s, "execution-review").look).toBe("pending");
  });

  it('row 3: newest exec-review verdict "REVISE" — same as row 1', () => {
    const t = ticketFrom([
      { role: "planner", ts: at(1) },
      { role: "executor", ts: at(2) },
      { role: "execution-review", ts: at(3), verdict: "REVISE" },
    ]);
    expect(t.column).toBe("in_progress");
    const s = resolveStageBar(t);
    expect(s.pointer).toBe("executor");
    expect(s.reworking).toBe(true);
    expect(s.terminal).toBe(false);
    expect(pillFor(s, "executor").look).toBe("reworking");
    expect(pillFor(s, "execution-review").look).toBe("failed");
    expect(verdictHue("REVISE")).toBe("var(--err)");
  });

  it('row 4: exec-review "NEEDS-WORK" then a LATER plan-review "PASS" (different role) — still fix cycle: column in_progress, pointer executor', () => {
    const t = ticketFrom([
      { role: "planner", ts: at(1) },
      { role: "executor", ts: at(2) },
      { role: "execution-review", ts: at(3), verdict: "NEEDS-WORK" },
      { role: "plan-review", ts: at(4), verdict: "PASS" }, // different role — must NOT clear the fix cycle
    ]);
    expect(t.column).toBe("in_progress");
    const s = resolveStageBar(t);
    expect(s.pointer).toBe("executor");
    expect(s.reworking).toBe(true);
    expect(pillFor(s, "execution-review").look).toBe("failed");
  });

  it('row 5: exec-review artifact "Decision: NEEDS-WORK", no ledger verdict — execReviewState resolved-fail', () => {
    const artifact = writeArtifact(
      "exec-review-r2.md",
      "# Execution review\n\nNot there yet.\n\nDecision: NEEDS-WORK\n"
    );
    const lines: RawLedgerLine[] = [
      { role: "execution-review", ts: at(3), artifact_path: artifact },
    ];
    expect(newestExecutionReviewState(lines)).toBe("resolved-fail");
  });
});

describe("#2783 HELD-OUT must-not-fire rows (non-regression pins)", () => {
  it('row 6: exec-review "NEEDS-WORK" then a LATER exec-review "PASS" (same role) — column in_review, pointer null, terminal; chain not in flight', () => {
    const t = ticketFrom([
      { role: "planner", ts: at(1) },
      { role: "executor", ts: at(2) },
      { role: "execution-review", ts: at(3), verdict: "NEEDS-WORK" },
      { role: "execution-review", ts: at(4), verdict: "PASS" }, // same role supersedes
    ]);
    expect(t.column).toBe("in_review");
    const s = resolveStageBar(t);
    expect(s.pointer).toBeNull();
    expect(s.terminal).toBe(true);
    expect(chainInFlight(t)).toBe(false);
  });

  it('row 7: exec-review "FAIL" then exec-review "PASS" (same role) — renders done exactly as row 6', () => {
    const t = ticketFrom([
      { role: "planner", ts: at(1) },
      { role: "executor", ts: at(2) },
      { role: "execution-review", ts: at(3), verdict: "FAIL" },
      { role: "execution-review", ts: at(4), verdict: "PASS" },
    ]);
    expect(t.column).toBe("in_review");
    const s = resolveStageBar(t);
    expect(s.pointer).toBeNull();
    expect(s.terminal).toBe(true);
    expect(chainInFlight(t)).toBe(false);
  });

  it('row 8: exec-review "SHIP-WITH-FIXES" / "PASS-WITH-FIXES" — resolved-nonfail, in_review, amber hue (unchanged)', () => {
    for (const verdict of ["SHIP-WITH-FIXES", "PASS-WITH-FIXES"]) {
      const lines: RawLedgerLine[] = [
        { role: "execution-review", ts: at(3), verdict },
      ];
      expect(newestExecutionReviewState(lines)).toBe("resolved-nonfail");
      expect(ticketFrom(lines).column).toBe("in_review");
      expect(verdictHue(verdict)).toBe("var(--review)");
    }
  });

  it("row 9: exec-review row with no verdict and no artifact — pending, in_review (unchanged)", () => {
    const lines: RawLedgerLine[] = [{ role: "execution-review", ts: at(3) }];
    expect(newestExecutionReviewState(lines)).toBe("pending");
    expect(ticketFrom(lines).column).toBe("in_review");
  });

  it('row 10: status "completed" + newest exec-review "NEEDS-WORK" — column done (toColumn completed arm is unconditional; the board trusts the task file)', () => {
    const t = ticketFrom(
      [{ role: "execution-review", ts: at(3), verdict: "NEEDS-WORK" }],
      { status: "completed" }
    );
    expect(t.column).toBe("done");
  });
});

describe("#2783 executor own variants (independent of every review round)", () => {
  it("own must-fire: plan-review NEEDS_WORK (underscore spelling) bounces the pointer to planner, reworking", () => {
    const t = ticketFrom([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "NEEDS_WORK" },
    ]);
    const s = resolveStageBar(t);
    expect(s.pointer).toBe("planner");
    expect(s.reworking).toBe(true);
    expect(pillFor(s, "executor").look).toBe("pending");
  });

  it("own must-fire: exec-review revise (lowercase) classifies resolved-fail through the case-insensitive predicate", () => {
    const lines: RawLedgerLine[] = [
      { role: "execution-review", ts: at(3), verdict: "revise" },
    ];
    expect(newestExecutionReviewState(lines)).toBe("resolved-fail");
    expect(ticketFrom(lines).column).toBe("in_progress");
  });

  it("own must-fire: plan-review row with NO verdict + artifact Decision: NEEDS-WORK bounces to planner (artifact fallback on the other review role)", () => {
    const artifact = writeArtifact(
      "plan-review-r1.md",
      "# Plan review\n\nStructure needs work.\n\nDecision: NEEDS-WORK\n"
    );
    const t = ticketFrom([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), artifact_path: artifact },
    ]);
    const s = resolveStageBar(t);
    expect(s.pointer).toBe("planner");
    expect(s.reworking).toBe(true);
  });

  it("own must-fire: exec-review NEEDS-WORK (r2) — a decorated token still fires (word boundary tolerates trailing text)", () => {
    const lines: RawLedgerLine[] = [
      { role: "execution-review", ts: at(3), verdict: "NEEDS-WORK (r2)" },
    ];
    expect(newestExecutionReviewState(lines)).toBe("resolved-fail");
  });

  it("own must-not-fire: REVISIT — REVISE must not substring-match REVISIT", () => {
    const lines: RawLedgerLine[] = [
      { role: "execution-review", ts: at(3), verdict: "REVISIT" },
    ];
    expect(newestExecutionReviewState(lines)).toBe("resolved-nonfail");
    const s = resolveStageBar(ticketFrom(lines));
    expect(s.terminal).toBe(true);
    expect(s.pointer).toBeNull();
  });

  it("own must-not-fire: NEEDS-WORKAROUND — NEEDS-WORK must not match inside a longer word", () => {
    const lines: RawLedgerLine[] = [
      { role: "execution-review", ts: at(3), verdict: "NEEDS-WORKAROUND" },
    ];
    expect(newestExecutionReviewState(lines)).toBe("resolved-nonfail");
  });

  it("own must-not-fire: UNREVISED PASS — a PASS decorated with an unexpanded token stays non-fail", () => {
    const lines: RawLedgerLine[] = [
      { role: "execution-review", ts: at(3), verdict: "UNREVISED PASS" },
    ];
    expect(newestExecutionReviewState(lines)).toBe("resolved-nonfail");
    expect(ticketFrom(lines).column).toBe("in_review");
  });

  it('own must-not-fire: "NEEDS WORK" (space spelling) is out of the plan vocabulary and stays non-fail', () => {
    const lines: RawLedgerLine[] = [
      { role: "execution-review", ts: at(3), verdict: "NEEDS WORK" },
    ];
    expect(newestExecutionReviewState(lines)).toBe("resolved-nonfail");
  });
});
