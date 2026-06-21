import {
  phaseLine,
  latestReviewVerdict,
  verdictHue,
} from "@/lib/ui-meta";
import type { Column, LedgerComment, Ticket } from "@/lib/board-schema";

const ticket = (
  column: Column,
  comments: LedgerComment[] = []
): Ticket => ({
  id: "100",
  subject: "Do the thing",
  description: "",
  column,
  status: column === "done" ? "completed" : column === "todo" ? "pending" : "in_progress",
  blockedBy: [],
  comments,
  updatedAt: 1,
});

const at = (n: number) => `2026-06-21T0${n}:00:00.000Z`;

describe("phaseLine", () => {
  it("todo ticket with no comments → QUEUED", () => {
    const p = phaseLine(ticket("todo"));
    expect(p.text).toBe("QUEUED");
    expect(p.hueVar).toBe("var(--todo)");
    expect(p.ariaLabel).toContain("queued");
  });

  it("in_progress whose latest work-role comment is executor → ▶ EXECUTOR", () => {
    const p = phaseLine(
      ticket("in_progress", [
        { role: "planner", ts: at(1) },
        { role: "executor", ts: at(2) },
      ])
    );
    expect(p.text.startsWith("▶")).toBe(true);
    expect(p.text).toContain("EXECUTOR");
    expect(p.hueVar).toBe("var(--live)"); // roleColor("executor")
  });

  it("in_progress with only a planner comment → ▶ PLANNER", () => {
    const p = phaseLine(ticket("in_progress", [{ role: "planner", ts: at(1) }]));
    expect(p.text).toContain("PLANNER");
    expect(p.text).not.toContain("EXECUTOR");
  });

  it("in_progress, no work-role, 1-arg (active defaults false) → ▶ STARTED (cyan)", () => {
    const p = phaseLine(
      ticket("in_progress", [{ role: "orchestrator", ts: at(1) }])
    );
    expect(p.text).toBe("▶ STARTED");
    expect(p.hueVar).toBe("var(--prog)");
    expect(p.ariaLabel).toContain("started");
  });

  it("in_progress, no work-role, active=true → ▶ WORKING (mint --live)", () => {
    const p = phaseLine(
      ticket("in_progress", [{ role: "orchestrator", ts: at(1) }]),
      true
    );
    expect(p.text).toBe("▶ WORKING");
    expect(p.hueVar).toBe("var(--live)");
    expect(p.ariaLabel).toContain("working now");
  });

  it("in_review with an execution-review PASS → ◆ REVIEW · PASS", () => {
    const p = phaseLine(
      ticket("in_review", [
        { role: "executor", ts: at(1) },
        { role: "execution-review", ts: at(2), verdict: "PASS" },
      ])
    );
    expect(p.text).toContain("REVIEW");
    expect(p.text).toContain("PASS");
    expect(p.hueVar).toBe("var(--done)"); // PASS → green
  });

  it("in_review with no verdict → ◆ REVIEW", () => {
    const p = phaseLine(ticket("in_review", [{ role: "executor", ts: at(1) }]));
    expect(p.text).toBe("◆ REVIEW");
    expect(p.hueVar).toBe("var(--review)");
  });

  it("done with a verdict → ✓ DONE · <verdict>", () => {
    const p = phaseLine(
      ticket("done", [
        { role: "execution-review", ts: at(2), verdict: "APPROVE" },
      ])
    );
    expect(p.text).toContain("DONE");
    expect(p.text).toContain("APPROVE");
  });

  it("done with no verdict → ✓ DONE (no separator)", () => {
    const p = phaseLine(ticket("done", []));
    expect(p.text).toBe("✓ DONE");
  });

  it("every branch returns non-empty text", () => {
    for (const col of ["todo", "in_progress", "in_review", "done"] as Column[]) {
      expect(phaseLine(ticket(col)).text.length).toBeGreaterThan(0);
    }
  });
});

describe("latestReviewVerdict", () => {
  it("prefers the most recent execution-review verdict over plan-review", () => {
    const v = latestReviewVerdict(
      ticket("done", [
        { role: "plan-review", ts: at(1), verdict: "APPROVE" },
        { role: "execution-review", ts: at(2), verdict: "PASS" },
      ])
    );
    expect(v).toBe("PASS");
  });

  it("falls back to plan-review when no execution-review verdict exists", () => {
    const v = latestReviewVerdict(
      ticket("in_review", [{ role: "plan-review", ts: at(1), verdict: "APPROVE-WITH-NOTES" }])
    );
    expect(v).toBe("APPROVE-WITH-NOTES");
  });

  it("returns the LAST execution-review verdict (oldest-first → last wins)", () => {
    const v = latestReviewVerdict(
      ticket("done", [
        { role: "execution-review", ts: at(1), verdict: "REVISE" },
        { role: "execution-review", ts: at(2), verdict: "PASS" },
      ])
    );
    expect(v).toBe("PASS");
  });

  it("undefined when no review verdict present", () => {
    expect(latestReviewVerdict(ticket("in_progress", [{ role: "executor", ts: at(1) }]))).toBeUndefined();
  });
});

describe("verdictHue precedence (shared, byte-identical to the drawer)", () => {
  it("BLOCK/FAIL/REJECT → red", () => {
    expect(verdictHue("BLOCK")).toBe("var(--err)");
    expect(verdictHue("FAIL")).toBe("var(--err)");
  });
  it("amber (NOTES/WITH-FIX) precedes green", () => {
    expect(verdictHue("APPROVE-WITH-NOTES")).toBe("var(--review)");
    expect(verdictHue("SHIP-WITH-FIXES")).toBe("var(--review)");
  });
  it("APPROVE/PASS → green", () => {
    expect(verdictHue("PASS")).toBe("var(--done)");
    expect(verdictHue("APPROVE")).toBe("var(--done)");
  });
  it("bare SHIP → green, unknown → dim", () => {
    expect(verdictHue("SHIP")).toBe("var(--done)");
    expect(verdictHue("???")).toBe("var(--fg-dim)");
  });
});
