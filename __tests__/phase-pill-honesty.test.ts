// phase-pill-honesty.test.ts — REVIEW-column and SHIPPING pills overstate a
// ticket's progress. Two defects, one root cause: a pill kept borrowing a
// signal that no longer describes what is currently gating the card.
//
//   1. in_review pill borrowed a BLENDED verdict (latestReviewVerdict =
//      execVerdict ?? planVerdict) instead of the verdict of the row that is
//      CURRENTLY gating the column — the newest execution-review comment.
//      Mid-review (open row, no verdict yet) it showed an earlier
//      plan-review PASS or a stale prior exec-review round's verdict.
//   2. SHIPPING did not honor an operator's deliberate on_hold parking once
//      the gating review had passed (isHeld() was column-gated to
//      in_progress only), and never dimmed to STALE under a live session no
//      matter how old the passed verdict was.
//
// Plan: .ai-workspace/plans/2026-09-11-agent-kanban-inreview-and-shipping-pills-overstate-progress.md
// (agent-kanban-inreview-and-shipping-pills-overstate-progress). Fixture ids
// (F-A..F-K, F3) match the plan's Binary AC table exactly — this file is the
// test oracle for AC-1..AC-8.
//
// Scope discipline (AC-7, the plan's highest-risk item): this is the ONE new
// test file the plan permits. No existing test file is touched.
//
// PURE, number-fed (buildTicket + synthetic RawLedgerLine[], one hand-built
// Ticket for F3 matching the established monotonic-flow.test.ts pattern) —
// no fs, no network, fixed NOW constant.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTicket, type RawLedgerLine, type RawTask } from "@/lib/build-board";
import { computeActiveIds } from "@/lib/active";
import {
  phaseLine,
  isHeld,
  SHIPPING_STALE_MS,
  SHIPPING_STALE_VERDICT_AGE_MS,
} from "@/lib/ui-meta";
import { Card } from "@/components/Card";
import { Drawer } from "@/components/Drawer";
import type { Ticket } from "@/lib/board-schema";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const LIVE = NOW - 1 * MIN; // inside LIVE_WINDOW_MS (5 min) — definitively live
const DEAD = NOW - 2 * HOUR; // far outside — definitively not live

/** ISO timestamp `msAgo` before NOW. */
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function task(id: string, over: Partial<RawTask> = {}): RawTask {
  return {
    id,
    subject: `Ticket ${id}`,
    description: "",
    status: "in_progress",
    blocks: [],
    blockedBy: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Fixtures — ids match the plan's Binary AC table verbatim.
// ---------------------------------------------------------------------------

/** F-A: planner; plan-review PASS; executor; exec-review OPEN | updatedAt NOW−5 min */
function fixtureA(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "planner", ts: iso(60 * MIN), agentId: "ag-pl" },
    { role: "plan-review", ts: iso(50 * MIN), verdict: "PASS", agentId: "ag-pr" },
    { role: "executor", ts: iso(30 * MIN), agentId: "ag-ex" },
    { role: "execution-review", ts: iso(10 * MIN), agentId: "ag-er" }, // OPEN
  ];
  return buildTicket(task("fa"), lines, NOW - 5 * MIN);
}

/** F-B: plan-review PASS; exec-review FAIL (NOW−3h); executor (NOW−2h); exec-review OPEN (NOW−10min) | updatedAt NOW−5min */
function fixtureB(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "plan-review", ts: iso(4 * HOUR), verdict: "PASS", agentId: "ag-pr" },
    { role: "execution-review", ts: iso(3 * HOUR), verdict: "FAIL", agentId: "ag-er1" },
    { role: "executor", ts: iso(2 * HOUR), agentId: "ag-ex2" },
    { role: "execution-review", ts: iso(10 * MIN), agentId: "ag-er2" }, // OPEN round 2
  ];
  return buildTicket(task("fb"), lines, NOW - 5 * MIN);
}

/** F-C: metadata.on_hold set; exec-review PASS closedAt NOW−5d | updatedAt NOW−5d */
function fixtureC(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "execution-review", ts: iso(5 * DAY), verdict: "PASS", closedAt: iso(5 * DAY), agentId: "ag-er" },
  ];
  return buildTicket(
    task("fc", { metadata: { on_hold: "parked for the demo" } }),
    lines,
    NOW - 5 * DAY
  );
}

/** F-C2: as F-C but exec PASS closedAt NOW−1d | updatedAt NOW−2min */
function fixtureC2(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "execution-review", ts: iso(1 * DAY), verdict: "PASS", closedAt: iso(1 * DAY), agentId: "ag-er" },
  ];
  return buildTicket(
    task("fc2", { metadata: { on_hold: "parked for the demo" } }),
    lines,
    NOW - 2 * MIN
  );
}

/** F-D: exec-review PASS closedAt NOW−5d, no hold | updatedAt NOW−5d */
function fixtureD(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "execution-review", ts: iso(5 * DAY), verdict: "PASS", closedAt: iso(5 * DAY), agentId: "ag-er" },
  ];
  return buildTicket(task("fd"), lines, NOW - 5 * DAY);
}

/** F-D variant for AC-5(e): the verdict row's closedAt absent, ts NOW−5d. */
function fixtureDNoClosedAt(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "execution-review", ts: iso(5 * DAY), verdict: "PASS", agentId: "ag-er" },
  ];
  return buildTicket(task("fd-noclosed"), lines, NOW - 5 * DAY);
}

/** F-E: exec-review PASS closedAt NOW−10min | updatedAt NOW−2min */
function fixtureE(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "execution-review", ts: iso(10 * MIN), verdict: "PASS", closedAt: iso(10 * MIN), agentId: "ag-er" },
  ];
  return buildTicket(task("fe"), lines, NOW - 2 * MIN);
}

/** F-F: exec-review PASS ts NOW−7h, no closedAt (the #1449 case-1 shape) | updatedAt NOW−2h */
function fixtureF(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "execution-review", ts: iso(7 * HOUR), verdict: "PASS", agentId: "ag-er" },
  ];
  return buildTicket(task("ff"), lines, NOW - 2 * HOUR);
}

/** F-I: exec-review PASS closedAt NOW−5d; ship-tail row ts NOW−2min | updatedAt NOW−2min */
function fixtureI(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "execution-review", ts: iso(5 * DAY), verdict: "PASS", closedAt: iso(5 * DAY), agentId: "ag-er" },
    { role: "ship-tail", ts: iso(2 * MIN), agentId: "ag-st" },
  ];
  return buildTicket(task("fi"), lines, NOW - 2 * MIN);
}

/** F-J: exec-review PASS closedAt NOW−23h | updatedAt NOW−2h */
function fixtureJ(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "execution-review", ts: iso(23 * HOUR), verdict: "PASS", closedAt: iso(23 * HOUR), agentId: "ag-er" },
  ];
  return buildTicket(task("fj"), lines, NOW - 2 * HOUR);
}

/** F-J': as F-J with closedAt NOW−25h | updatedAt NOW−2h */
function fixtureJPrime(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "execution-review", ts: iso(25 * HOUR), verdict: "PASS", closedAt: iso(25 * HOUR), agentId: "ag-er" },
  ];
  return buildTicket(task("fjp"), lines, NOW - 2 * HOUR);
}

/** F-K: on_hold set; planner/plan-review PASS/executor all closed; exec-review
 * OPEN (the #1867 AC-4 shape; ledger mtime NOW−12min) | updatedAt NOW−12min */
function fixtureK(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "planner", ts: iso(60 * MIN), agentId: "ag-pl", closedAt: iso(60 * MIN) },
    { role: "plan-review", ts: iso(50 * MIN), verdict: "PASS", agentId: "ag-pr", closedAt: iso(50 * MIN) },
    { role: "executor", ts: iso(30 * MIN), agentId: "ag-ex", closedAt: iso(30 * MIN) },
    { role: "execution-review", ts: iso(12 * MIN), agentId: "ag-er" }, // OPEN — punched in
  ];
  return buildTicket(
    task("fk", { metadata: { on_hold: "parked on purpose for the demo" } }),
    lines,
    NOW - 30 * MIN,
    undefined,
    NOW - 12 * MIN // ledger mtime → updatedAt
  );
}

/** F-G: on_hold set; executor only (PROG column) | updatedAt NOW−1h */
function fixtureG(): Ticket {
  const lines: RawLedgerLine[] = [{ role: "executor", ts: iso(70 * MIN), agentId: "ag-ex" }];
  return buildTicket(
    task("fg", { metadata: { on_hold: "waiting on data" } }),
    lines,
    NOW - 1 * HOUR
  );
}

/** F-H: status completed, on_hold set, exec-review PASS | updatedAt NOW−1d */
function fixtureH(): Ticket {
  const lines: RawLedgerLine[] = [
    { role: "execution-review", ts: iso(2 * DAY), verdict: "PASS", closedAt: iso(2 * DAY), agentId: "ag-er" },
  ];
  return buildTicket(
    task("fh", { status: "completed", metadata: { on_hold: "stale reason" } }),
    lines,
    NOW - 1 * DAY
  );
}

/** F3: hand-built — column in_review, status in_progress, exec-review FAIL
 * (the existing monotonic-flow negative shape, reused here as a control). */
function fixture3(): Ticket {
  return {
    id: "f3",
    subject: "Ship the thing",
    description: "",
    column: "in_review",
    status: "in_progress",
    blockedBy: [],
    comments: [
      { role: "executor", ts: iso(3 * HOUR) },
      { role: "execution-review", ts: iso(2 * HOUR), verdict: "FAIL" },
    ],
    updatedAt: NOW - 2 * MIN,
  };
}

/** Fresh chain-less focus ticket for the lane-count assertions. */
function focusTicket(): Ticket {
  return buildTicket(task("focus"), [], NOW - 1 * MIN);
}

// ---------------------------------------------------------------------------
// AC-1 — Gating-role verdict only.
// ---------------------------------------------------------------------------
describe("AC-1 — in_review pill keys on the gating role's own verdict, not a blend", () => {
  it("F-A (plan-review PASS, exec-review OPEN) → neutral ◆ REVIEW", () => {
    const p = phaseLine(fixtureA(), false, NOW, undefined, LIVE);
    expect(p.text).toBe("◆ REVIEW");
    expect(p.hueVar).toBe("var(--review)");
    expect(p.ariaLabel).toBe("in review");
  });
});

// ---------------------------------------------------------------------------
// AC-2 — Newest exec-review row, not newest verdict.
// ---------------------------------------------------------------------------
describe("AC-2 — the newest execution-review COMMENT gates, not the newest VERDICT", () => {
  it("F-B (round-1 FAIL closed, round-2 OPEN) → neutral ◆ REVIEW, not the stale round-1 FAIL", () => {
    const p = phaseLine(fixtureB(), false, NOW, undefined, LIVE);
    expect(p.text).toBe("◆ REVIEW");
    expect(p.hueVar).toBe("var(--review)");
  });
});

// ---------------------------------------------------------------------------
// AC-3 — Hold beats ship, everywhere the hold treatment lives.
// ---------------------------------------------------------------------------
describe("AC-3 — a held ticket whose gating review already passed reads ON HOLD, not SHIPPING", () => {
  it.each([
    ["F-C", fixtureC],
    ["F-C2", fixtureC2],
  ])("%s: phaseLine → ⏸ ON HOLD, var(--hold), no SHIPPING substring", (_label, build) => {
    const t = build();
    const p = phaseLine(t, false, NOW, undefined, LIVE);
    expect(p.text).toBe("⏸ ON HOLD");
    expect(p.hueVar).toBe("var(--hold)");
    expect(p.text).not.toContain("SHIPPING");
  });

  it.each([
    ["F-C", fixtureC],
    ["F-C2", fixtureC2],
  ])("%s: Card markup carries ⏸ ON HOLD + ak-card--hold, no SHIPPING", (_label, build) => {
    const t = build();
    const markup = renderToStaticMarkup(
      createElement(Card, { ticket: t, nowMs: NOW, sessionLastActive: LIVE })
    );
    expect(markup).toContain("⏸ ON HOLD");
    expect(markup).toContain("ak-card--hold");
    expect(markup).not.toContain("SHIPPING");
  });

  it.each([
    ["F-C", fixtureC],
    ["F-C2", fixtureC2],
  ])("%s: Drawer markup carries the ⏸ ON HOLD chip", (_label, build) => {
    const t = build();
    const markup = renderToStaticMarkup(
      createElement(Drawer, { ticket: t, nowMs: NOW, onClose: () => {} })
    );
    expect(markup).toContain("⏸ ON HOLD");
  });

  it("F-C2 is excluded from computeActiveIds — a held card never breathes/counts as a lane", () => {
    const active = computeActiveIds([fixtureC2()], true, NOW);
    expect(active.has("fc2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — Old PASS + quiet card dims even with a live session.
// ---------------------------------------------------------------------------
describe("AC-4 — a stale-enough gating PASS dims to STALE even under a LIVE owning session", () => {
  it("F-D (5-day-old PASS, quiet card, LIVE session) → ✓ PASS — STALE", () => {
    const p = phaseLine(fixtureD(), false, NOW, SHIPPING_STALE_MS, LIVE);
    expect(p.text).toBe("✓ PASS — STALE");
    expect(p.hueVar).toBe("var(--fg-dim)");
    expect(p.ariaLabel).toContain("stalled");
  });
});

// ---------------------------------------------------------------------------
// AC-5 — The bound is real, honored, and fails closed.
// ---------------------------------------------------------------------------
describe("AC-5 — the verdict-age STALE bound is honored and fails closed", () => {
  it("(a) F-J (23h old PASS, LIVE session) → SHIPPING (green control, under the 24h bound)", () => {
    const p = phaseLine(fixtureJ(), false, NOW, SHIPPING_STALE_MS, LIVE);
    expect(p.text).toBe("✓ PASS — SHIPPING");
    expect(p.hueVar).toBe("var(--done)");
  });

  it("(b) F-J' (25h old PASS, LIVE session) → STALE (over the 24h bound)", () => {
    const p = phaseLine(fixtureJPrime(), false, NOW, SHIPPING_STALE_MS, LIVE);
    expect(p.text).toBe("✓ PASS — STALE");
    expect(p.hueVar).toBe("var(--fg-dim)");
  });

  it("(c) F-I (5-day-old PASS, fresh ship-tail write 2m ago) → SHIPPING (fresh board write always wins)", () => {
    const p = phaseLine(fixtureI(), false, NOW, SHIPPING_STALE_MS, LIVE);
    expect(p.text).toBe("✓ PASS — SHIPPING");
    expect(p.hueVar).toBe("var(--done)");
  });

  it("(d) F-D with nowMs omitted → SHIPPING (existing back-compat pin: no clock, never stale)", () => {
    const p = phaseLine(fixtureD());
    expect(p.text).toBe("✓ PASS — SHIPPING");
    expect(p.hueVar).toBe("var(--done)");
  });

  it("(e) F-D variant: verdict row's closedAt absent, ts NOW−5d → STALE (ts fallback honored)", () => {
    const p = phaseLine(fixtureDNoClosedAt(), false, NOW, SHIPPING_STALE_MS, LIVE);
    expect(p.text).toBe("✓ PASS — STALE");
    expect(p.hueVar).toBe("var(--fg-dim)");
  });

  it("(f) F-D with a DEAD session → STALE (green control — #1449's liveness arm still works)", () => {
    const p = phaseLine(fixtureD(), false, NOW, SHIPPING_STALE_MS, DEAD);
    expect(p.text).toBe("✓ PASS — STALE");
    expect(p.hueVar).toBe("var(--fg-dim)");
  });

  it("SHIPPING_STALE_VERDICT_AGE_MS is exported and equals 24h (the injectable default)", () => {
    expect(SHIPPING_STALE_VERDICT_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// AC-6 — The running-reviewer pin survives + non-regression controls.
// ---------------------------------------------------------------------------
describe("AC-6 — the #1867 running-reviewer pin survives the pill fix, plus non-regression controls", () => {
  it("F-K (held + running reviewer, no verdict) → neutral ◆ REVIEW, not a borrowed PASS", () => {
    const p = phaseLine(fixtureK(), false, NOW, undefined, LIVE);
    expect(p.text).toBe("◆ REVIEW");
  });

  it("F-K still counts as a live lane (#1867 AC-4: a running agent outranks a parked-for-later note)", () => {
    const focus = focusTicket();
    const fk = fixtureK();
    expect(isHeld(fk)).toBe(false); // the reviewer is still punched in — never "held"
    const active = computeActiveIds([focus, fk], true, NOW);
    expect(active.has("fk")).toBe(true);
  });

  it("F-G (held, PROG column, no review yet) → ⏸ ON HOLD (existing #1816 path, untouched)", () => {
    const p = phaseLine(fixtureG(), false, NOW, undefined, LIVE);
    expect(p.text).toBe("⏸ ON HOLD");
    expect(p.hueVar).toBe("var(--hold)");
  });

  it("F-H (completed + stale onHold) → ✓ DONE · PASS, no ON HOLD / --hold anywhere in Card markup (AC10 completed-guard)", () => {
    const fh = fixtureH();
    const p = phaseLine(fh, false, NOW, undefined, LIVE);
    expect(p.text).toBe("✓ DONE · PASS");
    expect(isHeld(fh)).toBe(false);
    const markup = renderToStaticMarkup(createElement(Card, { ticket: fh, nowMs: NOW }));
    expect(markup).not.toContain("ON HOLD");
    expect(markup).not.toContain("var(--hold)");
  });

  it("F3 (hand-built in_review + FAIL) → ◆ REVIEW · FAIL / var(--err) (defensive fail-verdict shape preserved)", () => {
    const p = phaseLine(fixture3(), false, NOW, undefined, LIVE);
    expect(p.text).toBe("◆ REVIEW · FAIL");
    expect(p.hueVar).toBe("var(--err)");
  });

  it("F-E (fresh PASS, 10m old) → ✓ PASS — SHIPPING", () => {
    const p = phaseLine(fixtureE(), false, NOW, undefined, LIVE);
    expect(p.text).toBe("✓ PASS — SHIPPING");
    expect(p.hueVar).toBe("var(--done)");
  });

  it("F-F (#1449 case-1 shape: 7h-old verdict ts, LIVE session) → ✓ PASS — SHIPPING (verdict age under the 24h bound)", () => {
    const p = phaseLine(fixtureF(), false, NOW, undefined, LIVE);
    expect(p.text).toBe("✓ PASS — SHIPPING");
    expect(p.hueVar).toBe("var(--done)");
  });
});
