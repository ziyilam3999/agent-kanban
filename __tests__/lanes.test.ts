import { computeActiveIds } from "@/lib/active";
import { deriveLanes } from "@/lib/lanes";
import type { Column, LedgerComment, Ticket } from "@/lib/board-schema";

const ticket = (
  id: string,
  column: Column,
  comments: LedgerComment[] = [],
  updatedAt = 1,
): Ticket => ({
  id,
  subject: `subject ${id}`,
  description: "",
  column,
  status:
    column === "done" ? "completed" : column === "todo" ? "pending" : "in_progress",
  blockedBy: [],
  comments,
  updatedAt,
});

const c = (role: string, verdict?: string): LedgerComment => ({
  role,
  ts: "2026-06-27T00:00:00.000Z",
  verdict,
});

describe("deriveLanes — pure selector", () => {
  it("AC#1a: 0 active ids → fewer than 2 lanes (BoardView gate stays false)", () => {
    const tickets = [ticket("1", "in_progress"), ticket("2", "in_progress")];
    expect(deriveLanes(tickets, new Set()).length).toBeLessThan(2);
  });

  it("AC#1a: 1 active id → fewer than 2 lanes", () => {
    const tickets = [ticket("1", "in_progress"), ticket("2", "in_progress")];
    expect(deriveLanes(tickets, new Set(["1"])).length).toBeLessThan(2);
  });

  it("AC#2: N active in-progress ids → exactly N lanes (2 and 3)", () => {
    const t = [
      ticket("1", "in_progress"),
      ticket("2", "in_progress"),
      ticket("3", "in_progress"),
    ];
    expect(deriveLanes(t, new Set(["1", "2"])).length).toBe(2);
    expect(deriveLanes(t, new Set(["1", "2", "3"])).length).toBe(3);
  });

  it("AC#3: currentStageIndex = highest PIPELINE_ROLES index present", () => {
    const planning = ticket("1", "in_progress", [c("planner")]);
    const reviewing = ticket("2", "in_progress", [c("planner"), c("plan-review")]);
    const executing = ticket("3", "in_progress", [
      c("planner"),
      c("plan-review"),
      c("executor"),
    ]);
    const execReview = ticket("4", "in_progress", [
      c("planner"),
      c("plan-review"),
      c("executor"),
      c("execution-review"),
    ]);
    const lanes = deriveLanes(
      [planning, reviewing, executing, execReview],
      new Set(["1", "2", "3", "4"]),
    );
    const byId = Object.fromEntries(lanes.map((l) => [l.id, l.currentStageIndex]));
    expect(byId["1"]).toBe(0);
    expect(byId["2"]).toBe(1);
    expect(byId["3"]).toBe(2);
    expect(byId["4"]).toBe(3);
  });

  it("AC#3: no pipeline role seen → planner-pending (index 0)", () => {
    const t = ticket("1", "in_progress", [c("orchestrator")]);
    const [lane] = deriveLanes([t], new Set(["1"]));
    expect(lane.currentStageIndex).toBe(0);
    // Highest index wins even when out-of-order / interleaved with free-form roles.
    const t2 = ticket("2", "in_progress", [
      c("executor"),
      c("orchestrator"),
      c("planner"),
    ]);
    const [lane2] = deriveLanes([t2], new Set(["2"]));
    expect(lane2.currentStageIndex).toBe(2);
  });

  it("excludes non-active and non-in_progress tickets", () => {
    const tickets = [
      ticket("1", "in_progress"), // active → lane
      ticket("2", "in_progress"), // NOT active → excluded
      ticket("3", "in_review"), // active but wrong column → excluded
      ticket("4", "done"), // active but wrong column → excluded
    ];
    const lanes = deriveLanes(tickets, new Set(["1", "3", "4"]));
    expect(lanes.map((l) => l.id)).toEqual(["1"]);
  });

  it("sorts lanes focus-first (newest updatedAt on top)", () => {
    const tickets = [
      ticket("old", "in_progress", [], 100),
      ticket("new", "in_progress", [], 300),
      ticket("mid", "in_progress", [], 200),
    ];
    const lanes = deriveLanes(tickets, new Set(["old", "new", "mid"]));
    expect(lanes.map((l) => l.id)).toEqual(["new", "mid", "old"]);
  });

  it("integration: computeActiveIds + deriveLanes on a 2-live fixture → 2 lanes", () => {
    // Two in_progress tickets both freshly touched in a live session.
    const now = 1_000_000;
    const tickets = [
      ticket("a", "in_progress", [c("planner")], now - 1000),
      ticket("b", "in_progress", [c("planner"), c("executor")], now - 2000),
    ];
    const activeIds = computeActiveIds(tickets, true, now);
    const lanes = deriveLanes(tickets, activeIds);
    expect(lanes.length).toBe(2);
  });

  describe("#1468 AC5: swimlane parity — verdict-aware currentStageIndex, agrees with the drawer bar", () => {
    it("plan-review FAIL: the lit stage RETURNS to planner (index 0), plan-review marked as the failed stage (index 1)", () => {
      const t = ticket("1", "in_progress", [
        c("planner"),
        c("plan-review", "BLOCK"),
        c("executor"), // stray comment — must not move the lane forward either
      ]);
      const [lane] = deriveLanes([t], new Set(["1"]));
      expect(lane.currentStageIndex).toBe(0);
      expect(lane.reworking).toBe(true);
      expect(lane.failedStage).toBe(1);
    });

    it("exec-review FAIL: the lit stage returns to executor (index 2), exec-review marked as the failed stage (index 3)", () => {
      const t = ticket("1", "in_progress", [
        c("planner"),
        c("plan-review", "APPROVE"),
        c("executor"),
        c("execution-review", "FAIL"),
      ]);
      const [lane] = deriveLanes([t], new Set(["1"]));
      expect(lane.currentStageIndex).toBe(2);
      expect(lane.reworking).toBe(true);
      expect(lane.failedStage).toBe(3);
    });

    it("non-regression: a no-fail fixture's currentStageIndex is UNCHANGED from today (AC#3 above stays green) and carries no reworking/failedStage", () => {
      const executing = ticket("3", "in_progress", [
        c("planner"),
        c("plan-review"),
        c("executor"),
      ]);
      const [lane] = deriveLanes([executing], new Set(["3"]));
      expect(lane.currentStageIndex).toBe(2);
      expect(lane.reworking).toBeUndefined();
      expect(lane.failedStage).toBeUndefined();
    });
  });
});
