// monotonic-flow.test.ts — #1410: monotonic column flow. A resolved-PASS
// execution review keeps the card in the REVIEW column for the ship tail;
// only a fail-class verdict returns it to IN PROGRESS.
//
// Stage 1a (staged red): the AC-1 case, using EXISTING master exports — it
// FAILED AS AN ASSERTION on origin/master (expected "in_review", received
// "in_progress"; red output captured in the PR body). Stage 1b (this file's
// final form) adds the AC-2..AC-7 fixtures against the new exports.
//
// PURE number-fed — buildTicket + synthetic RawLedgerLine[] +
// computeActiveIds / deriveLanes / phaseLine; fixed NOW constant; no
// fs/network (the hermeticity fence — same discipline as
// lane-inflight-undercount.test.ts). Synthetic ids only.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTicket, type RawTask, type RawLedgerLine } from "@/lib/build-board";
import { computeActiveIds, chainInFlight } from "@/lib/active";
import { deriveLanes } from "@/lib/lanes";
import { phaseLine, shippingAfterPass } from "@/lib/ui-meta";
import { Card } from "@/components/Card";
import type { Ticket } from "@/lib/board-schema";

const NOW = Date.parse("2026-07-02T12:00:00.000Z");
const MIN = 60 * 1000;

const baseTask = (over: Partial<RawTask> = {}): RawTask => ({
  id: "ut",
  subject: "Ship the thing",
  description: "a synthetic description",
  activeForm: "Shipping the thing",
  status: "in_progress",
  blocks: [],
  blockedBy: [],
  ...over,
});

/** A resolved-verdict execution-review ledger (newest = the verdict line). */
const execReview = (verdict?: string, ts = "2026-07-02T05:00:00.000Z"): RawLedgerLine =>
  verdict === undefined ? { role: "execution-review", ts } : { role: "execution-review", ts, verdict };

/** Shipping ticket: in_progress status + newest exec-review resolved non-fail. */
const shippingTicket = (updatedAt: number, verdict = "PASS", id = "ut"): Ticket =>
  buildTicket(baseTask({ id }), [execReview(verdict)], updatedAt);

/** Fresh chain-less focus ticket (no comments — plain inline work). */
const focusTicket = (updatedAt: number, id = "focus"): Ticket =>
  buildTicket(baseTask({ id }), [], updatedAt);

describe("#1410 AC-1 — resolved-PASS stays in REVIEW (was RED on master)", () => {
  it("AC-1: in_progress + execution-review resolved PASS → in_review (RED on master: master returns in_progress)", () => {
    const t = buildTicket(baseTask(), [execReview("PASS")], 1);
    expect(t.column).toBe("in_review");
  });
});

describe("#1410 AC-2 — fail-class verdicts return the card to IN PROGRESS (one fixture per regex disjunct, #1179)", () => {
  it.each(["FAIL", "BLOCK", "REJECT"])(
    "in_progress + newest exec-review verdict %s → in_progress",
    (verdict) => {
      const t = buildTicket(baseTask(), [execReview(verdict)], 1);
      expect(t.column).toBe("in_progress");
    }
  );
});

describe("#1410 AC-3 — unchanged pins", () => {
  it("in_progress + UNRESOLVED exec-review → in_review (pending, as today)", () => {
    const t = buildTicket(baseTask(), [execReview(undefined)], 1);
    expect(t.column).toBe("in_review");
  });

  it("in_progress + no exec-review → in_progress", () => {
    const t = buildTicket(baseTask(), [], 1);
    expect(t.column).toBe("in_progress");
  });

  it("completed + resolved PASS → done", () => {
    const t = buildTicket(baseTask({ status: "completed" }), [execReview("PASS")], 1);
    expect(t.column).toBe("done");
  });

  it("pending + pipeline-role comment → in_progress; pending without → todo", () => {
    const started = buildTicket(
      baseTask({ status: "pending" }),
      [{ role: "planner", ts: "2026-07-02T04:00:00.000Z" }],
      1
    );
    expect(started.column).toBe("in_progress");
    const queued = buildTicket(baseTask({ status: "pending" }), [], 1);
    expect(queued.column).toBe("todo");
  });
});

describe("#1410 AC-5 — lane semantics pinned (shipping keeps today's ship-tail liveness)", () => {
  it("AC-5(a) STALE shipping: 120-min-old shipping ticket in in_review, NOT active, NO lane (fresh chain-less focus beside it)", () => {
    const shipping = shippingTicket(NOW - 120 * MIN);
    const focus = focusTicket(NOW - 1 * MIN);
    expect(shipping.column).toBe("in_review");
    const active = computeActiveIds([shipping, focus], true, NOW);
    expect(active.has("ut")).toBe(false);
    const lanes = deriveLanes([shipping, focus], active);
    expect(lanes.some((l) => l.id === "ut")).toBe(false);
  });

  it("AC-5(b) FRESH shipping: 2-min-old shipping ticket IS active (window disjunct) AND IS a lane", () => {
    const shipping = shippingTicket(NOW - 2 * MIN);
    const focus = focusTicket(NOW - 1 * MIN);
    const active = computeActiveIds([shipping, focus], true, NOW);
    expect(active.has("ut")).toBe(true);
    const lanes = deriveLanes([shipping, focus], active);
    expect(lanes.some((l) => l.id === "ut")).toBe(true);
  });

  it("AC-5(c) chainInFlight(shippingTicket) === false (#1403 chain-complete semantics untouched)", () => {
    expect(chainInFlight(shippingTicket(NOW - 2 * MIN))).toBe(false);
  });

  it("AC-5(d) mixed-ts divergence pin: [valid-ts no-verdict, NaN-ts PASS] → column in_review (raw selector: pending) BUT shippingAfterPass true (comment-position selector: the NaN PASS) AND lane-admitted via the window", () => {
    // Pins the documented raw-vs-display newest-SELECTION divergence (plan §4 /
    // Risk 1, counterexample B): the SERVER column classifies on the raw
    // newest-by-ts selector over the unsorted ledger (NaN → -Infinity loses →
    // newest = the valid UNRESOLVED line → pending → in_review, same as
    // master), while shippingAfterPass reads the SORTED comments array's LAST
    // exec-review (a NaN-ts comment stays in place → the appended-last NaN
    // PASS wins → shipping). Master never laned this shape; the new lane
    // population admits it. Pathological (malformed ts mixed with valid ts on
    // one ticket, never observed) — asserted so a future refactor changes this
    // consciously, not silently.
    const lines: RawLedgerLine[] = [
      { role: "execution-review", ts: "2026-07-02T05:00:00.000Z" },
      { role: "execution-review", ts: "not-a-date", verdict: "PASS" },
    ];
    const mixed = buildTicket(baseTask(), lines, NOW - 2 * MIN);
    expect(mixed.column).toBe("in_review");
    expect(shippingAfterPass(mixed)).toBe(true);
    const focus = focusTicket(NOW - 1 * MIN);
    const active = computeActiveIds([mixed, focus], true, NOW);
    expect(active.has("ut")).toBe(true);
  });
});

describe("#1410 AC-6 — the verdict-token shipping pill", () => {
  it("fresh shipping + verdict PASS → ✓ PASS — SHIPPING (green)", () => {
    const p = phaseLine(shippingTicket(NOW - 2 * MIN), false, NOW);
    expect(p.text).toBe("✓ PASS — SHIPPING");
    expect(p.hueVar).toBe("var(--done)");
  });

  it("fresh shipping + verdict SHIP-WITH-FIXES → ✓ SHIP-WITH-FIXES — SHIPPING (same predicate, honest token)", () => {
    const p = phaseLine(shippingTicket(NOW - 2 * MIN, "SHIP-WITH-FIXES"), false, NOW);
    expect(p.text).toBe("✓ SHIP-WITH-FIXES — SHIPPING");
    expect(p.hueVar).toBe("var(--done)");
  });

  it("in_review + NO verdict → ◆ REVIEW unchanged", () => {
    const t = buildTicket(baseTask(), [execReview(undefined)], NOW - 2 * MIN);
    const p = phaseLine(t, false, NOW);
    expect(p.text).toBe("◆ REVIEW");
    expect(p.hueVar).toBe("var(--review)");
  });

  it("NEGATIVE (F3): in_review-COLUMN ticket whose newest exec-review verdict is FAIL → NOT the shipping pill — ◆ REVIEW · FAIL (red)", () => {
    // Defensive fail-verdict-yet-in_review shape (hand-built Ticket — the
    // established phase.test.ts pattern): shippingAfterPass must reject the
    // fail-class verdict and fall through to the existing review pill.
    const t: Ticket = {
      id: "ut",
      subject: "Ship the thing",
      description: "",
      column: "in_review",
      status: "in_progress",
      blockedBy: [],
      comments: [
        { role: "executor", ts: "2026-07-02T04:00:00.000Z" },
        { role: "execution-review", ts: "2026-07-02T05:00:00.000Z", verdict: "FAIL" },
      ],
      updatedAt: NOW - 2 * MIN,
    };
    expect(shippingAfterPass(t)).toBe(false);
    const p = phaseLine(t, false, NOW);
    expect(p.text).toBe("◆ REVIEW · FAIL");
    expect(p.hueVar).toBe("var(--err)");
  });

  it("rendered Card markup for a fresh shipping ticket carries PASS and SHIPPING", () => {
    const markup = renderToStaticMarkup(
      createElement(Card, { ticket: shippingTicket(NOW - 2 * MIN), nowMs: NOW })
    );
    expect(markup).toContain("PASS");
    expect(markup).toContain("SHIPPING");
  });
});

describe("#1410 AC-7 — zombie bound (client-computed stale badge)", () => {
  it("shipping ticket 2 h old → ✓ PASS — STALE (dim)", () => {
    const p = phaseLine(shippingTicket(NOW - 120 * MIN), false, NOW);
    expect(p.text).toBe("✓ PASS — STALE");
    expect(p.hueVar).toBe("var(--fg-dim)");
  });

  it("cap is an honored parameter: shippingStaleCapMs = 60_000 flips the fresh (2-min) fixture stale", () => {
    const p = phaseLine(shippingTicket(NOW - 2 * MIN), false, NOW, 60_000);
    expect(p.text).toBe("✓ PASS — STALE");
    expect(p.hueVar).toBe("var(--fg-dim)");
  });

  it("nowMs omitted → never stale (back-compat)", () => {
    const p = phaseLine(shippingTicket(NOW - 120 * MIN));
    expect(p.text).toBe("✓ PASS — SHIPPING");
    expect(p.hueVar).toBe("var(--done)");
  });
});
