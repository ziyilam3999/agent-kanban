// stage-bar.test.ts — #1468 AC3: pure-selector unit tests for resolveStageBar(),
// one assertion per brief §3/§4 state. This is the logic-level companion to
// __tests__/stage-bar-render.test.ts (the render-level regression guard).

import { resolveStageBar } from "@/lib/stage-bar";
import { verdictHue } from "@/lib/ui-meta";
import type { Column, LedgerComment, Ticket } from "@/lib/board-schema";

const ticket = (comments: LedgerComment[], column: Column = "in_progress"): Ticket => ({
  id: "1468",
  subject: "Stage bar fixture",
  description: "",
  column,
  status: column === "done" ? "completed" : column === "todo" ? "pending" : "in_progress",
  blockedBy: [],
  comments,
  updatedAt: 1,
});

const at = (n: number) => `2026-07-04T0${n}:00:00.000Z`;

const pillFor = (state: ReturnType<typeof resolveStageBar>, role: string) =>
  state.pills.find((p) => p.role === role)!;

describe("resolveStageBar — AC3 selector states", () => {
  it("AC3a: clean-PASS forward — plan-review APPROVE, planner done, executor current, exec-review pending", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "APPROVE" },
    ]);
    const s = resolveStageBar(t);

    expect(pillFor(s, "plan-review").look).toBe("pass");
    expect(verdictHue(pillFor(s, "plan-review").verdict!)).toBe("var(--done)");
    expect(pillFor(s, "planner").look).toBe("done");
    expect(pillFor(s, "executor").look).toBe("current");
    expect(pillFor(s, "execution-review").look).toBe("pending");
    expect(s.pointer).toBe("executor");
    expect(s.terminal).toBe(false);
  });

  it("AC3b: caveated-PASS — plan-review APPROVE-WITH-NOTES tints amber, still no bounce", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "APPROVE-WITH-NOTES" },
    ]);
    const s = resolveStageBar(t);

    expect(pillFor(s, "plan-review").look).toBe("pass");
    expect(verdictHue(pillFor(s, "plan-review").verdict!)).toBe("var(--review)");
    expect(s.pointer).toBe("executor");
  });

  it("AC3c (KEY): plan-review BLOCK loops back to planner; executor+exec-review forced pending EVEN with a stray executor comment", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "BLOCK" },
      { role: "executor", ts: at(3) }, // stray comment — must NOT count as reached-and-done
    ]);
    const s = resolveStageBar(t);

    expect(pillFor(s, "plan-review").look).toBe("failed");
    expect(s.pointer).toBe("planner");
    expect(pillFor(s, "planner").look).toBe("reworking");
    expect(pillFor(s, "executor").look).toBe("pending");
    expect(pillFor(s, "execution-review").look).toBe("pending");
    expect(s.loopbackGap).toEqual(["planner", "plan-review"]);
    expect(s.terminal).toBe(false);
  });

  it("AC3d: exec-review FAIL loops back to executor; planner done, plan-review pass", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "APPROVE" },
      { role: "executor", ts: at(3) },
      { role: "execution-review", ts: at(4), verdict: "FAIL" },
    ]);
    const s = resolveStageBar(t);

    expect(pillFor(s, "execution-review").look).toBe("failed");
    expect(s.pointer).toBe("executor");
    expect(pillFor(s, "executor").look).toBe("reworking");
    expect(pillFor(s, "planner").look).toBe("done");
    expect(pillFor(s, "plan-review").look).toBe("pass");
    expect(s.loopbackGap).toEqual(["executor", "execution-review"]);
  });

  it("AC3e: rework-then-pass self-correct — LATEST plan-review verdict wins, not a sticky scar", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "BLOCK" },
      { role: "planner", ts: at(3) },
      { role: "plan-review", ts: at(4), verdict: "APPROVE" },
    ]);
    const s = resolveStageBar(t);

    expect(s.pointer).toBe("executor");
    expect(pillFor(s, "plan-review").look).toBe("pass");
  });

  it("AC3f: terminal all-PASS — no pointer, no current/reworking anywhere, every role done/pass", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "APPROVE" },
      { role: "executor", ts: at(3) },
      { role: "execution-review", ts: at(4), verdict: "PASS" },
    ]);
    const s = resolveStageBar(t);

    expect(s.terminal).toBe(true);
    expect(s.pointer).toBeNull();
    for (const p of s.pills) {
      expect(["done", "pass"]).toContain(p.look);
    }
  });

  it("forward state 3 corner: all 4 roles reached but exec-review has no verdict yet -> pointer=execution-review, current", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "APPROVE" },
      { role: "executor", ts: at(3) },
      { role: "execution-review", ts: at(4) }, // reviewing now, no verdict yet
    ]);
    const s = resolveStageBar(t);

    expect(s.pointer).toBe("execution-review");
    expect(pillFor(s, "execution-review").look).toBe("current");
    expect(s.terminal).toBe(false);
  });

  it("reuse: selector references isFailClassVerdict/verdictHue indirectly via consistent classification", () => {
    // BLOCK / FAIL / REJECT are all fail-class (same regex the board already uses).
    for (const bad of ["BLOCK", "FAIL", "REJECT", "reject-with-fixes"]) {
      const t = ticket([
        { role: "planner", ts: at(1) },
        { role: "plan-review", ts: at(2), verdict: bad },
      ]);
      expect(resolveStageBar(t).pointer).toBe("planner");
    }
  });
});
