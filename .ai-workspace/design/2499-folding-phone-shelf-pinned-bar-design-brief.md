# Design Brief — #2499: folding-phone front-screen pinned collapsed shelf bar

- **Ticket:** #2499 (agent-kanban), `Bookkeeping shelf unreachable on folding-phone front screen`.
- **Plan:** `.ai-workspace/plans/2026-09-12-agent-kanban-folding-phone-shelf-unreachable-front-screen.md`
  (candidate B, plan-review PASS `71d942a`).
- **Surface:** the collapsed `.ak-shelf` bar only, on the base phone tier (<640px). The opened
  body (`.ak-shelf[open] > .ak-shelf__body`, the #83 bounded 60dvh panel) and every tier ≥640px
  are byte-for-byte untouched.

## The problem this brief answers

The plan's Binary AC is mechanism-agnostic ("a phone-tier pinned/sticky collapsed shelf entry")
— it does not prescribe HOW the pinned bar should look. A bare `position:fixed; bottom:0` on the
existing `.ak-shelf` block, with no other treatment, would read as a bug (a floating rectangle
clipped to the viewport edge, indistinguishable from a debug overlay) rather than a deliberate
product surface. This brief is the POV for making it read as intentional.

## Direction chosen: a bottom-sheet handle, not a floating footer

The board already speaks one idiom consistently: a dark "telemetry console" — `--panel`/`--line`
bordered cards, `--font-mono` mono type, `--shelf` (`#8d99a6`, steel-grey, WCAG ~5.9:1) reserved
specifically for "this is administrative noise, not a live signal" (per the S1 shelf design brief,
`.ai-workspace/design/2026-09-07-board-noise-s1-shelf-design-brief.md`). The pinned bar needed to
extend that idiom, not introduce a new one:

1. **Rounded top corners only** (`12px 12px 0 0`), flush bottom edge — reads as a tray/drawer
   rising from the bottom edge of the device, the same visual grammar as a native iOS/Android
   bottom sheet. A bar with all four corners rounded (or none) would read as a floating chip or a
   plain footer instead — wrong affordance for something that expands upward.
2. **An elevation shadow, cast upward** (`box-shadow: 0 -8px 20px -4px rgba(0,0,0,0.45)`) —
   separates the bar from the content scrolling underneath it. Without this the bar's opaque
   `--panel` fill would still read correctly against the dark background at rest, but during a
   scroll gesture a card passing directly under the bar's edge would look like it's clipping into
   it rather than passing behind an elevated surface.
3. **A centered grabber pip** (`32px x 3px`, `--fg-faint`, 6px from the top edge) — the one
   established cross-platform signifier for "this bar is interactive, drag or tap to expand." The
   board's existing shelf already has a CSS-only rotating caret (`▸`) inside the summary text for
   the SAME affordance once the viewer's eye reaches the text — the pip adds the same signal
   at a glance, before reading any text, which matters here because the whole point of pinning is
   glanceability without engagement.
4. **No hue change** — the bar stays the shelf's own `--panel` fill / `--shelf` label color,
   deliberately NOT a brighter/accent treatment. Promoting it to a louder color would fight the
   `--shelf` token's whole reason for existing (administrative noise reads as neutral, never as a
   live/urgent signal) — pinning it for reachability is not license to also make it visually loud.

## Why NOT the alternatives

- **A full-width, square-cornered, flush-to-edge bar with no shadow** — rejected. Reads as an
  accidental viewport-clipped fragment (the classic "forgot a `position:fixed` guard" bug look),
  not a deliberate surface. Nothing distinguishes it from `.ak-shelf`'s own ordinary in-flow
  block styling, so a viewer has no visual cue that ITS behavior changed (now always-visible,
  expands in place) versus every other block on the page.
- **A translucent/blurred bar (`backdrop-filter`)** — rejected. The board's console aesthetic
  uses OPAQUE panels throughout (`--panel` is a solid fill everywhere else — cards, drawer,
  header); a translucent shelf bar would be the one glass-morphism element in an otherwise flat
  aesthetic, and would also risk the pinned bar's own text losing contrast against whatever
  scrolls underneath it (an accessibility regression the flat aesthetic doesn't have to reason
  about elsewhere).
- **An accent-colored (mint `--live`) treatment** — rejected. `--live` is reserved for genuinely
  live/active telemetry (the LIVE/IDLE badge, active lane dots); using it here would make the
  shelf read as "something is happening" when the shelf's whole design intent (S1 brief) is the
  opposite — administrative, neutral, closed by default.

## Occlusion (nr-2499-occlusion) as a design constraint, not just a layout bug

The plan-review named-risk note treats non-occlusion as a behavior guard (verified by the AC1b
Playwright assertion + these screenshots), but it is also a DESIGN constraint: a pinned bar that
clips the bottom quarter of the last visible card would look broken even if the geometry
"technically" satisfies the letter of a looser AC. The `72px` reserved `padding-bottom` on
`.ak-strip.ak-board` (comfortably larger than the bar's own ~50-60px rendered footprint) is sized
so the last card's full bottom border and any tap-target padding clear the bar with visible
breathing room in the screenshots below, not a 1px-exact fit.

## Rubric for the ui-evolve pass (this brief's contract with that leg)

1. **Intentionality** — does the pinned bar read as a deliberate bottom-sheet handle (rounded top
   corners + shadow + grabber pip), not a clipped/floating fragment?
2. **Idiom consistency** — same `--panel`/`--line`/`--shelf`/`--font-mono` tokens as the rest of
   the shelf and the board; no new hue, no glass-morphism.
3. **No occlusion** — the last visible column card is fully readable (not clipped) once the page
   is scrolled to its true bottom, and the bar never overlaps card text at any scroll position in
   the captured frames.
4. **No desktop/grid-tier leak** — the ≥640px screenshots show the bar's ordinary un-pinned,
   in-flow block styling, unchanged from before this task (nr-2499-desktop).
5. **Legibility at rest** — the "Bookkeeping N · Parked N · Deferred N" summary text and caret
   are fully legible against the bar's own background in every captured frame.

design_pov: A bottom-sheet-style pinned bar (rounded top corners, upward drop shadow, centered
grabber pip, same --panel/--shelf/--font-mono tokens the rest of the shelf already uses, no new
hue) so the phone-tier collapsed shelf reads as a deliberate, always-reachable tray rising from
the device edge — not a viewport-clipped floating fragment — while staying visually neutral
(administrative noise, never a live signal) and never occluding the last column card.
