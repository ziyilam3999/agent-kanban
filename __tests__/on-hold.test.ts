// on-hold.test.ts — #1816 "⏸ ON HOLD" signal, Binary AC1-AC12 (data-layer +
// visual-treatment + WCAG contrast). AC13 (ui-evolve ACCEPT) is a separate
// artifact (.ai-workspace/reviews/1816-ui-evolve-verdict.md); AC14/AC15
// (privacy scan / no live publish) are process checks, not unit tests here.

import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTicket, type RawTask } from "@/lib/build-board";
import { computeActiveIds } from "@/lib/active";
import { heldFor, isHeld } from "@/lib/ui-meta";
import { Card } from "@/components/Card";
import { Drawer } from "@/components/Drawer";
import type { Ticket } from "@/lib/board-schema";

const baseTask = (over: Partial<RawTask> = {}): RawTask => ({
  id: "100",
  subject: "Do the thing",
  description: "a description",
  activeForm: "Doing the thing",
  status: "in_progress",
  blocks: [],
  blockedBy: [],
  ...over,
});

const baseTicket = (over: Partial<Ticket> = {}): Ticket => ({
  id: "100",
  subject: "Do the thing",
  description: "",
  column: "in_progress",
  status: "in_progress",
  blockedBy: [],
  comments: [],
  updatedAt: 1,
  ...over,
});

// ---------------------------------------------------------------------------
// AC1 — round-trip, additive.
// ---------------------------------------------------------------------------
describe("AC1 — buildTicket round-trips metadata.on_hold into Ticket.onHold", () => {
  it("a RawTask with metadata.on_hold set yields Ticket.onHold with the same string", () => {
    const t = buildTicket(
      baseTask({ metadata: { on_hold: "waiting on #1434 data" } }),
      [],
      1
    );
    expect(t.onHold).toBe("waiting on #1434 data");
  });
});

// ---------------------------------------------------------------------------
// AC2 — graceful-absent is byte-identical.
// ---------------------------------------------------------------------------

// Captured BEFORE any #1816 code changes by rendering this exact fixture
// (in_progress, one executor comment, nowMs=2, updatedAt=1) against the
// pre-feature Card component — NOT recomputed from the component under test,
// so a regression that changes the no-hold render path WILL be caught here
// (same anti-regression shape as card.test.ts's EXPECTED_MODELLESS_FOOT).
const EXPECTED_NO_HOLD =
  '<div class="ak-card" style="--hue:var(--prog)"><span class="ak-card__rail" aria-hidden="true"></span><div class="ak-card__top"><span class="ak-card__id">#100</span><span class="ak-card__top-right"><span class="ak-pips ak-pips--dim" role="img" aria-label="pipeline progress: 1 of 4 roles"><span class="ak-pip" title="PLANNER (pending)"></span><span class="ak-pip" title="PLAN-REVIEW (pending)"></span><span class="ak-pip ak-pip--on" style="--pip:var(--live)" title="EXECUTOR"></span><span class="ak-pip" title="EXEC-REVIEW (pending)"></span></span></span></div><p class="ak-phase" style="--phase:var(--live)" aria-label="in progress, executor">▶ EXECUTOR</p><p class="ak-card__subject">Do the thing</p><div class="ak-card__foot"><span class="ak-card__time">just now</span></div></div>';

describe("AC2 — graceful-absent is byte-identical to the pre-feature baseline", () => {
  const cases: Array<[string, RawTask]> = [
    ["no metadata at all", baseTask()],
    ["metadata present but no on_hold key", baseTask({ metadata: {} })],
    ["on_hold explicitly empty string", baseTask({ metadata: { on_hold: "" } })],
  ];

  it.each(cases)("%s → Ticket.onHold is undefined AND markup is byte-identical", (_label, task) => {
    const t = buildTicket(
      task,
      [{ role: "executor", ts: "2026-06-21T01:00:00.000Z" }],
      1
    );
    expect(t.onHold).toBeUndefined();
    const markup = renderToStaticMarkup(createElement(Card, { ticket: t, nowMs: 2 }));
    expect(markup).not.toContain("ON HOLD");
    expect(markup).toBe(EXPECTED_NO_HOLD);
  });
});

// ---------------------------------------------------------------------------
// AC3 — privacy redaction at the seam.
// ---------------------------------------------------------------------------
describe("AC3 — metadata.on_hold home paths are redacted at buildTicket", () => {
  it("a home path in the reason is collapsed to ~ before it reaches Ticket.onHold", () => {
    const t = buildTicket(
      baseTask({
        metadata: { on_hold: "blocked on /Users/exampleuser/secret/data" },
      }),
      [],
      1
    );
    expect(t.onHold).toBeDefined();
    expect(t.onHold).not.toContain("/Users/");
    expect(t.onHold).toContain("~");
  });
});

// ---------------------------------------------------------------------------
// AC4 — type optionality compiles. This test file itself is the exercise: it
// constructs all three RawTask.metadata shapes (absent / present-without-
// on_hold / present-with-on_hold) at the type level, and the whole suite only
// runs after `tsc --noEmit` / ts-jest compiles it — so a real type error here
// fails the test run before any assertion executes.
// ---------------------------------------------------------------------------
describe("AC4 — metadata optionality compiles across all three shapes", () => {
  it("RawTask compiles with metadata absent", () => {
    const t: RawTask = baseTask();
    expect(t.metadata).toBeUndefined();
  });
  it("RawTask compiles with metadata present, on_hold absent", () => {
    const t: RawTask = baseTask({ metadata: {} });
    expect(t.metadata?.on_hold).toBeUndefined();
  });
  it("RawTask compiles with metadata present, on_hold set", () => {
    const t: RawTask = baseTask({ metadata: { on_hold: "reason" } });
    expect(t.metadata?.on_hold).toBe("reason");
  });
});

// ---------------------------------------------------------------------------
// AC5 — phase-line override.
// ---------------------------------------------------------------------------
describe("AC5 — phase-line override for on-hold in_progress cards", () => {
  it("an on-hold in_progress ticket renders ⏸ ON HOLD with the --hold hue", () => {
    const t = baseTicket({ onHold: "waiting on #1434 data" });
    const markup = renderToStaticMarkup(createElement(Card, { ticket: t, nowMs: 2 }));
    expect(markup).toContain("⏸ ON HOLD");
    expect(markup).toContain("--phase:var(--hold)");
  });

  it("a NON-held in_progress ticket still renders its role phase line unchanged", () => {
    const t = baseTicket({
      comments: [{ role: "executor", ts: "2026-06-21T01:00:00.000Z" }],
    });
    const markup = renderToStaticMarkup(createElement(Card, { ticket: t, nowMs: 2 }));
    expect(markup).toContain("▶ EXECUTOR");
    expect(markup).not.toContain("ON HOLD");
  });
});

// ---------------------------------------------------------------------------
// AC6 — breathing removed (non-vacuous exclusion).
// ---------------------------------------------------------------------------
describe("AC6 — an on-hold ticket is excluded from the active set (non-vacuous)", () => {
  const NOW = 1_000_000_000_000;

  it("the SAME fixture is active under the normal rule, then excluded once onHold is set", () => {
    const notHeld: Ticket = baseTicket({ id: "focus", updatedAt: NOW });
    const activeBefore = computeActiveIds([notHeld], true, NOW);
    expect(activeBefore.has("focus")).toBe(true); // power check: the exclusion has something to exclude

    const held: Ticket = { ...notHeld, onHold: "parked on purpose" };
    const activeAfter = computeActiveIds([held], true, NOW);
    expect(activeAfter.has("focus")).toBe(false);

    // The Card markup a real caller would produce (active = computeActiveIds().has(id))
    // carries neither the breathing rail class nor the pulsing phase class.
    const markup = renderToStaticMarkup(
      createElement(Card, { ticket: held, nowMs: NOW, active: activeAfter.has("focus") })
    );
    expect(markup).not.toContain("ak-card--active");
    expect(markup).not.toContain("ak-phase--live");
  });
});

// ---------------------------------------------------------------------------
// AC7 — rail static + tile receded (state hook present).
// ---------------------------------------------------------------------------
describe("AC7 — on-hold state hook renders in markup", () => {
  it("an on-hold Card carries the ak-card--hold class", () => {
    const t = baseTicket({ onHold: "parked" });
    const markup = renderToStaticMarkup(createElement(Card, { ticket: t, nowMs: 2 }));
    expect(markup).toContain("ak-card--hold");
  });

  it("a non-held Card does NOT carry ak-card--hold", () => {
    const t = baseTicket();
    const markup = renderToStaticMarkup(createElement(Card, { ticket: t, nowMs: 2 }));
    expect(markup).not.toContain("ak-card--hold");
  });
});

// ---------------------------------------------------------------------------
// AC8 — footer "⏸ held Nd".
// ---------------------------------------------------------------------------
describe("AC8 — footer age readout", () => {
  it("an on-hold ticket updated N days ago renders 'held Nd' with the correct N", () => {
    const nowMs = Date.parse("2026-07-21T00:00:00.000Z");
    const updatedAt = nowMs - 4 * 86_400_000; // 4 days earlier
    const t = baseTicket({ onHold: "parked", updatedAt });
    const markup = renderToStaticMarkup(createElement(Card, { ticket: t, nowMs }));
    expect(markup).toContain("held 4d");
  });

  it("heldFor fails safe (undefined, no crash, no bogus number) when nowMs is unavailable", () => {
    const t = baseTicket({ onHold: "parked", updatedAt: 1 });
    expect(() => heldFor(t, undefined)).not.toThrow();
    expect(heldFor(t, undefined)).toBeUndefined();
  });

  it("heldFor returns undefined for a non-held ticket regardless of nowMs", () => {
    const t = baseTicket();
    expect(heldFor(t, 1_000_000)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC9 — on_hold + blockedBy orthogonal (state 3).
// ---------------------------------------------------------------------------
describe("AC9 — on-hold and blocked are orthogonal, both render", () => {
  it("a ticket with BOTH onHold and non-empty blockedBy shows both pills", () => {
    const nowMs = Date.parse("2026-07-21T00:00:00.000Z");
    const updatedAt = nowMs - 2 * 86_400_000;
    const t = baseTicket({
      onHold: "waiting on data",
      blockedBy: ["55"],
      updatedAt,
    });
    const markup = renderToStaticMarkup(createElement(Card, { ticket: t, nowMs }));
    expect(markup).toContain("⛔ blocked by #55");
    expect(markup).toContain("held 2d");
  });
});

// ---------------------------------------------------------------------------
// AC10 — terminal wins (state 4).
// ---------------------------------------------------------------------------
describe("AC10 — terminal status wins over a stale onHold", () => {
  it("a completed ticket with onHold set still renders ✓ DONE, no ON HOLD / --hold", () => {
    const t = baseTicket({
      column: "done",
      status: "completed",
      onHold: "stale reason",
    });
    const markup = renderToStaticMarkup(createElement(Card, { ticket: t, nowMs: 2 }));
    expect(markup).toContain("✓ DONE");
    expect(markup).not.toContain("ON HOLD");
    expect(markup).not.toContain("var(--hold)");
  });

  it("isHeld() is false once the ticket's column has moved off in_progress", () => {
    const t = baseTicket({ column: "done", status: "completed", onHold: "stale" });
    expect(isHeld(t)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC11 — drawer.
// ---------------------------------------------------------------------------

// Captured BEFORE any #1816 code changes (empty-comments in_progress fixture,
// nowMs=2, updatedAt=1) — not recomputed, same anti-regression shape as AC2.
const EXPECTED_NO_HOLD_DRAWER =
  '<div class="ak-scrim" style="opacity:0"></div><aside class="ak-drawer" role="dialog" aria-modal="true" aria-label="Ticket #100 audit log" style="transform:translateY(100%)"><span class="ak-drawer__grip" aria-hidden="true"></span><div class="ak-drawer__head"><span class="ak-drawer__id">#100</span><span class="ak-chip" style="--hue:var(--prog)">In Progress</span><button type="button" class="ak-drawer__close" aria-label="Close">✕</button></div><div class="ak-drawer__body" data-ak-pulldown="true"><h2 class="ak-drawer__title">Do the thing</h2><div class="ak-pipeline-wrap"><div class="ak-pipeline" role="img" aria-label="stage: PLANNER active"><div class="ak-pipeline__step ak-pipeline__step--current ak-pipeline__step--glow" style="--step:var(--prog)"><span class="ak-pipeline__bar" aria-hidden="true"></span><span class="ak-pipeline__label"><span class="ak-pipeline__label-text">PLANNER</span></span></div><div class="ak-pipeline__step ak-pipeline__step--pending" style="--step:var(--review)"><span class="ak-pipeline__bar" aria-hidden="true"></span><span class="ak-pipeline__label"><span class="ak-pipeline__label-text">PLAN-REVIEW</span></span></div><div class="ak-pipeline__step ak-pipeline__step--pending" style="--step:var(--live)"><span class="ak-pipeline__bar" aria-hidden="true"></span><span class="ak-pipeline__label"><span class="ak-pipeline__label-text">EXECUTOR</span></span></div><div class="ak-pipeline__step ak-pipeline__step--pending" style="--step:var(--done)"><span class="ak-pipeline__bar" aria-hidden="true"></span><span class="ak-pipeline__label"><span class="ak-pipeline__label-text">EXEC-REVIEW</span></span></div></div></div><p class="ak-drawer__section">Black-box timeline</p><p class="ak-timeline__empty">No role events recorded yet.</p></div></aside>';

describe("AC11 — Drawer renders the ON HOLD chip + reason block", () => {
  it("an on-hold ticket's drawer contains IN PROGRESS chip, ON HOLD chip, and the reason text", () => {
    const t = baseTicket({ onHold: "waiting on #1434 outcome-digest data" });
    const markup = renderToStaticMarkup(
      createElement(Drawer, { ticket: t, nowMs: 2, onClose: () => {} })
    );
    expect(markup).toContain("In Progress");
    expect(markup).toContain("⏸ ON HOLD");
    expect(markup).toContain("waiting on #1434 outcome-digest data");
  });

  it("a non-held ticket's drawer is byte-identical to the pre-feature baseline", () => {
    const t = baseTicket();
    const markup = renderToStaticMarkup(
      createElement(Drawer, { ticket: t, nowMs: 2, onClose: () => {} })
    );
    expect(markup).toBe(EXPECTED_NO_HOLD_DRAWER);
  });
});

// ---------------------------------------------------------------------------
// AC12 — WCAG contrast (measured, not guessed).
// ---------------------------------------------------------------------------
describe("AC12 — --hold on --panel clears WCAG AA (>= 4.5:1)", () => {
  function hexToRgb(hex: string): [number, number, number] {
    const m = hex.trim().replace("#", "");
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    return [r, g, b];
  }

  function relLuminance([r, g, b]: [number, number, number]): number {
    const chan = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const [rl, gl, bl] = [chan(r), chan(g), chan(b)];
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  }

  function contrastRatio(hexA: string, hexB: string): number {
    const l1 = relLuminance(hexToRgb(hexA));
    const l2 = relLuminance(hexToRgb(hexB));
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  it("reads the ACTUAL --hold and --panel values from app/globals.css and computes their ratio", () => {
    const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
    const holdMatch = css.match(/--hold:\s*(#[0-9a-fA-F]{6})/);
    const panelMatch = css.match(/--panel:\s*(#[0-9a-fA-F]{6})/);
    expect(holdMatch).not.toBeNull();
    expect(panelMatch).not.toBeNull();
    const hold = holdMatch![1];
    const panel = panelMatch![1];
    const ratio = contrastRatio(hold, panel);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
