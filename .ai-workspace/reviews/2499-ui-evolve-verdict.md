# ui-evolve verdict — #2499 folding-phone front-screen pinned collapsed shelf bar

**verdict: ACCEPT**

- **Total: 20 / 20** (threshold: ≥16/20 AND no axis <3 — cleared)
- Scored against the design brief's rubric
  (`.ai-workspace/design/2499-folding-phone-shelf-pinned-bar-design-brief.md` §"Rubric for the
  ui-evolve pass"), from REAL Playwright screenshots (Node `@playwright/test` 1.61.1, headless
  Chromium) of the app's PRODUCTION BUILD (`next build && next start`, deliberately NOT `next
  dev` — the dev server injects a floating Next.js dev-tools "N" badge fixed at the bottom-left
  corner that visually overlapped the pinned bar in an earlier capture pass; that badge is
  dev-mode-only and never ships to production/Vercel, so it is not a real defect, but screenshots
  were re-captured against the production server so the judged frames match what actually ships).

## Per-axis scores (0–4 each)

| # | Axis | Score | Evidence |
|---|---|---|---|
| R1 | Intentionality | **4** | `shots/344x882-phone-at-rest.png` and `.../344x882-phone-shelf-open.png` — rounded top corners (`12px 12px 0 0`), an upward drop shadow separating the bar from content scrolling underneath, and a centered grabber pip read unmistakably as a deliberate bottom-sheet handle, not a viewport-clipped fragment. The caret (`▸`→rotated) and the panel's upward growth on open confirm the "tray rising from the edge" read carries through into the interaction, not just the static frame. |
| R2 | Idiom consistency | **4** | Same `--panel` fill / `--line` border / `--font-mono` type / `--shelf` label color as the rest of the shelf (S1 design brief, `2026-09-07-board-noise-s1-shelf-design-brief.md`) — no new hue, no glass-morphism. The opened body's `CHORE` kind chips (`shots/344x882-phone-shelf-open.png`) are the SAME `.ak-tag`-shaped chip already used elsewhere on the board — the pinned treatment introduces zero new visual language. |
| R3 | No occlusion | **4** | `shots/344x882-phone-scrolled-bottom.png` — the LAST `todo`-column card (#8039, "Fold8 AC-probe fixture ticket #40") renders fully, including its full timestamp line, with visible dark clearance before the pinned bar begins. Cross-checked against the automated AC1b assertion (`e2e/shelf-front-screen-reachable.e2e.spec.ts`, "the last card ... is NOT occluded") — PASS, `lastCardBox.bottom <= shelfBox.top + 1` — so this is not just a single-frame eyeball, it holds as a Playwright-measured invariant. |
| R4 | No desktop/grid-tier leak | **4** | `shots/768x1024-gridtier-at-rest.png` and `shots/1440x900-desktop-at-rest.png` — the shelf renders in its ordinary in-flow, un-pinned block position at both cells, byte-for-byte the pre-existing look (nr-2499-desktop). Cross-checked against `git diff dd59d07 -- app/globals.css`, which shows the fix is scoped to a SINGLE new `@media (max-width: 639.98px)` block, disjoint from the ≥640px shell-clamp/collapsed-header blocks. |
| R5 | Legibility at rest | **4** | Every captured frame (`344x882-phone-at-rest.png`, `-scrolled-bottom.png`, `-shelf-open.png`, and both regression frames) shows the "▸ Bookkeeping N · Parked N · Deferred N" (or the expanded group/card content) fully legible against the bar's own `--panel` background — no clipping, no contrast loss, no overlap with the grabber pip (the `padding-top: 17px` clearance on `.ak-shelf__summary` holds). |

## Regression guard (pass/fail, not scored) — **PASS**

- **No #83 regression**: the opened body still renders as the bounded, scrollable panel (visible
  card stack in `344x882-phone-shelf-open.png`); the automated AC2 scroll-delta assertion PASSES
  on both master and this branch (see `.ai-workspace/reviews/2499-folding-phone-shelf-reachable-red-evidence.md`).
- **No 640–1023.98px tier regression**: `768x1024-gridtier-at-rest.png` is visually unchanged from
  the pre-existing shell-clamped layout; the automated AC3 assertion PASSES identically on both
  branches.
- **No ≥1024px desktop regression**: `1440x900-desktop-at-rest.png` shows the ordinary 4-up grid,
  no pinned/fixed elements anywhere in the frame.

## Screenshots (this run, production server, `next build && next start -p 3961`)

- `344x882-phone-at-rest.png` — folding-phone front screen, no scroll performed, pinned collapsed
  bar reachable at the bottom edge.
- `344x882-phone-scrolled-bottom.png` — scrolled to the true page bottom; the last `todo` card is
  fully clear of the pinned bar (nr-2499-occlusion).
- `344x882-phone-shelf-open.png` — the pinned bar's OPEN state, bottom-sheet expansion with real
  shelf content (8 bookkeeping + 3 parked fixture tickets), same #83 bounded scrollable panel.
- `768x1024-gridtier-at-rest.png` — the existing 640-1023.98px shell-clamped tier, unaffected.
- `1440x900-desktop-at-rest.png` — ≥1024px desktop tier, unaffected.

(Captured to a session scratchpad, not committed to the repo — same convention as prior ui-evolve
runs, which cite screenshot filenames without vendoring the binaries into the PR.)

## Method note

Screenshots were captured against `next build && next start` (the production server), not `next
dev` — the dev server's floating Next.js dev-tools indicator (a framework-injected "N" badge
fixed at the bottom-left corner) visually overlapped the pinned bar's grabber pip in an initial
capture pass. That overlap is a `next dev`-only artifact (absent from `next build`/`next
start`/the real Vercel production deploy — confirmed by re-capturing against the production
server, where it does not appear) and is unrelated to this fix's CSS; noted here for the record
so a future reviewer does not mistake a dev-mode screenshot for a real production defect.
