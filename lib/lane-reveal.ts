// lane-reveal.ts — PURE guard-decision function for #1456 (auto-reveal the Live
// Swimlanes panel when it first appears). Decides WHETHER a `<2 -> >=2` lane-count
// transition should trigger a scroll-into-view + arrival cue, and WHICH scroll
// `behavior` to use. No DOM access — the caller (BoardView) supplies every input
// as a plain value/boolean, which is what makes this unit-testable as a pure
// matrix (AC#2) independent of jsdom's DOM quirks.
//
// NOTE (plan risk r5): `alreadyVisible` is received here as a boolean INPUT. This
// function proves the DECISION given that boolean — it does not (and cannot) prove
// that the caller's runtime viewport check correctly COMPUTES the boolean. jsdom's
// `getBoundingClientRect()` returns an all-zero rect for every element (no real
// layout engine), so that computation has no automated jsdom proof; its real-world
// correctness rests on the ui-evolve real-browser screenshots (leg 2).

export interface LaneRevealInput {
  /** `lanes.length` (the exact BoardView mount predicate) on the PREVIOUS render. */
  prevCount: number;
  /** `lanes.length` on the CURRENT render. */
  currentCount: number;
  /** True when the panel's bounding box is already fully within the viewport. */
  alreadyVisible: boolean;
  /** True when the ticket Drawer modal is open (`selectedId != null`). */
  drawerOpen: boolean;
  /** `useReducedMotion()` — true when the operator prefers reduced motion. */
  reducedMotion: boolean;
}

export interface LaneRevealDecision {
  /** Fire the scroll-into-view + one-shot arrival cue. */
  reveal: boolean;
  /** The `scrollIntoView({ behavior })` value to use when `reveal` is true. */
  behavior: "auto" | "smooth";
}

/**
 * Decide whether the Live Swimlanes panel should be auto-revealed.
 *
 * Fires ONLY on the genuine `<2 -> >=2` crossing (`prevCount < 2 && currentCount
 * >= 2`) — never on an already-present panel (`2 -> 3`), never on a no-op
 * re-render (`prevCount === currentCount`), and never on a panel that DISAPPEARS
 * (`>=2 -> <2`). Even a genuine crossing is suppressed when the panel is already
 * on-screen (don't-yank) or the Drawer modal is open (don't yank the background
 * out from under a modal). `behavior` is always computed (harmless when `reveal`
 * is false) so the caller can destructure without a null-check.
 */
export function decideLaneReveal(input: LaneRevealInput): LaneRevealDecision {
  const { prevCount, currentCount, alreadyVisible, drawerOpen, reducedMotion } =
    input;
  const crossedIntoView = prevCount < 2 && currentCount >= 2;
  const reveal = crossedIntoView && !alreadyVisible && !drawerOpen;
  return { reveal, behavior: reducedMotion ? "auto" : "smooth" };
}
