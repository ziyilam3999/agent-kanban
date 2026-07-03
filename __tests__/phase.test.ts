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

  it("in_review with an execution-review PASS → ✓ PASS — SHIPPING (passed review ships from REVIEW — #1410)", () => {
    const p = phaseLine(
      ticket("in_review", [
        { role: "executor", ts: at(1) },
        { role: "execution-review", ts: at(2), verdict: "PASS" },
      ])
    );
    expect(p.text).toBe("✓ PASS — SHIPPING");
    expect(p.hueVar).toBe("var(--done)"); // shipping state hue — green
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

describe("#1449 SHIPPING→STALE pill cross-checks owning-session liveness (stop crying wolf)", () => {
  // A passed-review ticket in the ship tail: in_review column, in_progress status,
  // newest exec-review carries a non-fail verdict → shippingAfterPass() true. Its
  // updatedAt is 2 h old, so the AGE gate is ALWAYS tripped — only the liveness
  // cross-check decides SHIPPING vs STALE across the three cases below.
  const NOW = Date.parse("2026-07-03T12:00:00.000Z");
  const MIN = 60 * 1000;

  const oldShippingTicket = (): Ticket => ({
    id: "100",
    subject: "Ship the thing",
    description: "",
    column: "in_review",
    status: "in_progress",
    blockedBy: [],
    comments: [
      { role: "executor", ts: "2026-07-03T04:00:00.000Z" },
      { role: "execution-review", ts: "2026-07-03T05:00:00.000Z", verdict: "PASS" },
    ],
    updatedAt: NOW - 120 * MIN, // 2 h quiet on the board → age gate always tripped
  });

  it("case 1 (RED-first): old shipping card whose owning session is LIVE → SHIPPING, not STALE", () => {
    // Session last active 1 min ago → inside the 5-min live window → live. Against
    // today's age-only pill this returns STALE (the false-positive #1449 kills);
    // the liveness conjunction greens it to SHIPPING. (RED→GREEN proof, AC-4.)
    const p = phaseLine(oldShippingTicket(), false, NOW, undefined, NOW - 1 * MIN);
    expect(p.text).toBe("✓ PASS — SHIPPING");
    expect(p.hueVar).toBe("var(--done)");
  });

  it("case 2 (still dims): old shipping card whose owning session is DEAD/not-live → STALE", () => {
    // Session last active 2 h ago → far outside the live window → definitively
    // dead. Proves the fix did NOT simply disable the pill — a real zombie ship
    // still dims to STALE.
    const p = phaseLine(oldShippingTicket(), false, NOW, undefined, NOW - 120 * MIN);
    expect(p.text).toBe("✓ PASS — STALE");
    expect(p.hueVar).toBe("var(--fg-dim)");
  });

  it("case 3 (fail-closed): old shipping card with UNKNOWN liveness (no session signal) → SHIPPING", () => {
    // No sessionLastActive arg → liveness unresolvable → fail closed to SHIPPING.
    // Never cry wolf on ambiguity; the #1435 external watchdog covers genuine death.
    const p = phaseLine(oldShippingTicket(), false, NOW);
    expect(p.text).toBe("✓ PASS — SHIPPING");
    expect(p.hueVar).toBe("var(--done)");
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
