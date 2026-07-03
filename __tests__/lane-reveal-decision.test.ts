// lane-reveal-decision.test.ts — #1456 AC#2: the pure guard-decision matrix
// (node-env, no jsdom needed — decideLaneReveal takes every input as a plain
// value/boolean). This BACKSTOPS guard-LOGIC vacuity: flipping any single guard
// in the source must fail at least one case here. It does NOT substitute for
// AC#1's WIRING proof (that the real BoardView effect actually calls
// scrollIntoView) — a correct decideLaneReveal() mis-wired into BoardView would
// keep this file green while the real behavior is broken; keep both oracles.
//
// NOTE (plan risk r5): `alreadyVisible` is a boolean INPUT here — this file
// proves the DECISION given that boolean, not that BoardView's runtime
// getBoundingClientRect-based check correctly COMPUTES it (jsdom returns an
// all-zero rect for every element, so that computation has no automated jsdom
// proof; see lib/lane-reveal.ts's doc comment + AC#1's test file).

import { decideLaneReveal, type LaneRevealInput } from "@/lib/lane-reveal";

const base: LaneRevealInput = {
  prevCount: 1,
  currentCount: 2,
  alreadyVisible: false,
  drawerOpen: false,
  reducedMotion: false,
};

describe("decideLaneReveal — pure guard-decision matrix (AC#2)", () => {
  it("transition + not-visible + drawer-closed => reveal", () => {
    expect(decideLaneReveal(base).reveal).toBe(true);
  });

  it("already-visible => no reveal (don't-yank guard 2)", () => {
    expect(decideLaneReveal({ ...base, alreadyVisible: true }).reveal).toBe(
      false
    );
  });

  it("drawer-open => no reveal (modal guard 3)", () => {
    expect(decideLaneReveal({ ...base, drawerOpen: true }).reveal).toBe(false);
  });

  it("no-transition (>=2 -> >=2, e.g. 2 -> 3) => no reveal", () => {
    expect(
      decideLaneReveal({ ...base, prevCount: 2, currentCount: 3 }).reveal
    ).toBe(false);
  });

  it("no-transition (no-op re-render, count unchanged) => no reveal", () => {
    expect(
      decideLaneReveal({ ...base, prevCount: 2, currentCount: 2 }).reveal
    ).toBe(false);
  });

  it("panel DISAPPEARING (>=2 -> <2) => no reveal (not an appearance)", () => {
    expect(
      decideLaneReveal({ ...base, prevCount: 2, currentCount: 1 }).reveal
    ).toBe(false);
  });

  it("first-load already at >=2 (prevCount seeded to currentCount) => no reveal", () => {
    expect(
      decideLaneReveal({ ...base, prevCount: 2, currentCount: 2 }).reveal
    ).toBe(false);
  });

  it("reduced-motion => behavior:'auto' on a firing transition", () => {
    expect(
      decideLaneReveal({ ...base, reducedMotion: true }).behavior
    ).toBe("auto");
  });

  it("motion allowed => behavior:'smooth' on a firing transition", () => {
    expect(decideLaneReveal(base).behavior).toBe("smooth");
  });

  it("a genuine transition combined with BOTH suppressing guards still => no reveal", () => {
    expect(
      decideLaneReveal({ ...base, alreadyVisible: true, drawerOpen: true })
        .reveal
    ).toBe(false);
  });
});
