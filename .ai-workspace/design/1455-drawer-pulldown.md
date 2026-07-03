# #1455 — Drawer pull-down-from-top drag-to-dismiss: design brief

Expands the plan's `design_pov` (`.ai-workspace/plans/2026-07-03-1455-drawer-pulldown-dismiss.md`) with the as-built interaction design, the implementation trap discovered while building it, and the real screenshots the ui-evolve leg needs.

## The POV: one motion vocabulary, no mode-switch to think about

This is not "a drag handle you must aim for." The grip pill stays as the *visual* signal that the sheet is draggable, but the real gesture people already carry in their thumbs from Apple Maps / Music / Messages is now live: **at the top of the card, pull down to leave.**

- **At the top, down = leave. Once you're reading (scrolled), down = go back up.** The user never consciously picks "scroll mode" vs "dismiss mode" — the scroll position decides for them, invisibly. That's why the gate is `scrollTop === 0`, not a separate drag zone or a mode toggle.
- **Rubber-band elasticity is unchanged** (`dragElastic={{ top: 0, bottom: 0.4 }}`) — the sheet still follows the finger with the same "weight," and you still can't lift it above rest (you scroll instead). This is the tactile "am I sure?" cue as you approach the dismiss point.
- **Same release threshold as the grip** (`offset.y > 90 || velocity.y > 600`) — a small accidental nudge while reading snaps back home; a confident pull or flick lets go. Reusing this threshold means the feature has zero new "does this feel right?" surface — it already felt right for the grip.
- **No new chrome.** Resting state (grip pill + hero title + compact identity bar) is pixel-identical to #1447 — see `m-01-resting-state.png`. This feature adds behaviour, not decoration.

## The gate: `scrollTop === 0`, latched once, never re-evaluated mid-gesture

| Case | Condition (at gesture start) | Behaviour |
|---|---|---|
| A — at-top + down | `scrollTop === 0` AND finger moving down | Dismiss drag (same machinery as the grip) |
| B — scrolled | `scrollTop > 0` | Native scroll only — **never** starts a dismiss drag for this gesture, even if the finger later drags content back to the top |
| C — at-top + up | `scrollTop === 0` AND finger moving up | Scroll into content — never dismisses |
| D — grip press | anywhere on `.ak-drawer__grip` | Dismiss drag, unconditionally — untouched by this change |

The decision is made **once**, from the live `scrollTop`, the first moment the gesture's vertical travel crosses a small intent threshold (6px — enough to reject stray taps/jitter, small enough to feel immediate). It is never re-evaluated mid-gesture: that "hand off after native scroll has already claimed the pointer" path is exactly the #1447 trap (cairn line 141) this design avoids.

## Why the grip drag is untouched

The grip (`.ak-drawer__grip`) keeps its own `onPointerDown → controls.start(e)` handler, unconditionally, exactly as shipped in #1447. It doesn't sit inside the scrollable region, so it was never subject to the native-scroll-takeover problem below — there was no reason to touch it, and every existing grip behaviour (rubber-band, threshold, reduced-motion guard) is byte-identical to before. Case D in the e2e proves this directly.

## The implementation trap this plan didn't fully anticipate (and how it was solved)

The plan's Alternatives-considered section correctly rejected "whole-sheet `drag` + cancel when scrolled" because Framer Motion claims the pointer at drag start and can't cleanly hand it back. Building this surfaced a **second, independent** trap, one level below Framer Motion: **the browser itself.**

Empirically (verified live against this repo's Chromium/CDP oracle, per Rule 18): a `touch-action: auto` scrollable region commits to *native* scroll handling within ~30px of any vertical touch movement — **regardless of `scrollTop`** — and fires `pointercancel` the instant it does. That permanently cuts off the PointerEvent stream our own gate logic needs to detect "at-top + down" and call `controls.start`. Calling `preventDefault()` from React's synthetic `onPointerDown`/`onPointerMove` did **not** suppress this (verified by direct experiment, both at pointerdown and at the resolving pointermove) — only a plain, non-passive `element.addEventListener("touchstart", ..., { passive: false })` with an unconditional `preventDefault()` whenever the gesture starts at `scrollTop === 0` retains ownership long enough for the gate to run.

That fix has its own cost: once native scrolling is pre-empted for a gesture, it does **not** resume mid-gesture even if you stop calling `preventDefault()` later (also verified empirically) — so Case C (at-top, pull up to read more) would otherwise go dead. The fix owns that gesture for its whole lifetime and **manually replays** the finger's vertical delta onto `bodyRef.current.scrollTop` for exactly the one case that needs it: a gesture that started at the top and resolved to "scroll." A gesture that starts already scrolled (Case B) is never touched by any of this — native scroll runs completely untouched, exactly as before #1455.

No CSS `touch-action` was added anywhere on `.ak-drawer__body` — the #1447 invariant holds. The suppression is a JS-level, per-gesture `preventDefault()`, not a standing CSS declaration.

## Discoverability

Unchanged from the plan: no tooltip, no new visual affordance. The grip pill is the documented gesture; the body-pull is the expected-but-undocumented power gesture real bottom-sheet users already know.

## Screenshots (`.ai-workspace/design/screens-1455/`)

- `m-01-resting-state.png` — 390×844 mobile, drawer open, at rest. Grip pill + hero title + compact identity bar — pixel-parity check against #1447's resting state (no visual regression).
- `m-02-mid-pulldown.png` — 390×844 mobile, same drawer, captured mid-gesture: finger held ~55px into an at-top downward pull (well short of the 90px dismiss threshold). Compare against `m-01` — the sheet is visibly translated down with the rubber-band in effect, proving the interaction is live, not just a passed assertion.
- `d-01-side-panel.png` — 1440×900 desktop side panel. The grip is `display:none` and the body-pull is touch-only (gated on `pointerType === "touch"`), so desktop is visually and behaviourally untouched — confirmed here.

## Residual risk (honest, not gated here)

Per cairn line 141 ("chromium scrolls fine, iOS doesn't"), this chromium/CDP oracle is necessary-but-not-sufficient for iOS Safari — real touch-input timing, momentum scrolling, and rubber-banding can differ from the CDP-synthesized touch stream used in the e2e. Plan AC12 (non-blocking, recorded not gated) recommends an operator real-device smoke on iOS Safari covering: (a) a long ticket still finger-scrolls top→bottom, (b) pull-down at the top dismisses, (c) pull-down while scrolled does not dismiss. This is not automatable in this repo (chromium-only Playwright) — flagged here for the record, not blocking this PR.
