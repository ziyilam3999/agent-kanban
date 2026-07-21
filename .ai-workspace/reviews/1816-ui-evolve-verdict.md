# ui-evolve verdict — #1816 "⏸ ON HOLD" status

verdict: ACCEPT

- **Total: 20 / 20** (threshold: ≥16/20 AND no axis <3 — cleared)
- Scored against the plan's §"ui-evolve rubric R1–R5" (`.ai-workspace/plans/2026-07-21-1816-on-hold-status.md`), from REAL Playwright screenshots (Python `playwright` 1.x, headless Chromium) of the app running locally (`npm run dev -p 3816`) against a local fixture at `data/board.json` (gitignored local-dev override — never published to the live blob, see AC15 note below). The fixture exercises all four §3g states: `#402`/`#403` (normal in_progress, actively breathing), `#1493` (on-hold, unblocked), `#1512` (on-hold AND blocked by `#1434`), `#1288` (on-hold but `completed` — terminal-wins).

## Per-axis scores (0–4 each)

| # | Axis | Score | Evidence |
|---|---|---|---|
| R1 | Legibility / WCAG | **4** | Measured contrast `--hold` `#c99a4c` on `--panel` `#10161c` = **7.117:1** (recomputed independently via the sRGB→linear relative-luminance formula, matching the plan-review's pre-verification) — clears AA (4.5:1) with headroom. `crop-header-strip.png` shows the `REVIEW` column's bright amber tab directly beside the ochre `⏸ ON HOLD` cards in `crop-hold-cards.png` — visibly duller/cooler, never confusable with review-amber at a glance; also distinct from `.ak-blocked`'s coral (visible side-by-side on `#1512`). |
| R2 | The honest-still duality *(load-bearing)* | **4** | Directly measured via `getComputedStyle` on the rail element (not a guessed still-frame diff), 6 samples at 300ms spacing on the SAME rendered page: the active card `#402`'s rail (`ak-card--active`) genuinely oscillates — `animationName: "ak-rail-breathe"`, opacity cycling `0.72 → 1.00 → 0.72` with a moving `box-shadow` glow (0px–12px blur) — while the held card `#1493`'s rail (`ak-card--hold`) holds fixed at every sample: `animationName: "none"`, `opacity: "1"`, `boxShadow: "none"`. The two states are unambiguous and live-verified, not merely visually plausible. `crop-active-cards.png` vs `crop-hold-cards.png` show the same contrast at the pixel level (soft green halo vs a flat, non-glowing bar). |
| R3 | At-a-glance rail | **4** | `desktop-board.png`: the two ochre-railed on-hold cards (`#1493`, `#1512`) are immediately spottable in the IN PROGRESS column against the cyan-railed normal cards (`#402`, `#403`) without reading any phase-line text — the static hue + ~0.82 recede does the job at a glance, confirmed on both desktop and the mobile IN PROGRESS lane (`mobile-board-inprogress.png`). |
| R4 | Footer + orthogonal blocked | **4** | `crop-hold-cards.png` / `desktop-board.png`: `#1493`'s footer renders `⏸ held 4d` cleanly in its own pill. `#1512` (state 3 — on-hold AND blocked) renders BOTH the coral `⛔ blocked by #1434` pill AND the ochre `⏸ held 1d` pill side by side, each its own bounded pill with visible gap — no overlap, no wrapping, no crowding. Same layout holds on mobile (`mobile-board-inprogress.png`). |
| R5 | Idiom, not slop | **4** | `⏸` sits naturally beside the existing phase glyph vocabulary (`▶` on `#402`/`#403`, `✓` on `#1288`) — same mono weight, same case convention. Motion obeys the opacity/transform-only rule (R2 measurement: no layout-affecting properties touched). The drawer's on-hold reason block (`desktop-drawer-onhold.png`, `mobile-drawer-onhold.png`) sits directly above the pipeline/timeline, styled with the same card-border + tinted-background idiom as the rest of the drawer body — reads as a native section, not a bolted-on afterthought. The `⏸ ON HOLD` drawer chip sits adjacent to the existing `IN PROGRESS` chip, same shape/size/font as every other `.ak-chip`. |

## Regression guard (pass/fail, not scored) — **PASS**

- **Non-held card height + footer unchanged vs today**: `__tests__/on-hold.test.ts` AC2 asserts a non-held Card's full markup is **byte-identical** to a baseline string captured from the pre-#1816 component (not recomputed) — this is a mechanical guarantee, not a visual guess. Also visually confirmed: `#402`/`#403` in `desktop-board.png` render with the pre-existing single-line footer (`X ago` only), matching the pre-feature layout.
- **Ochre treatment never truncates the phase line**: `⏸ ON HOLD` (9 chars incl. glyph) is shorter than the existing `▶ EXECUTOR`/`▶ PLAN-REVIEW` phase-line text it can appear alongside — no ellipsis/clipping observed on any held card in any screenshot, desktop or 390px mobile.
- **Terminal status wins (state 4)**: `#1288` (`status: completed`, stale `onHold` string still present in the fixture task) renders `✓ DONE · PASS` in green with NO ochre rail and NO "ON HOLD" text anywhere — visually confirmed in `mobile-board-done.png` and mechanically confirmed by `__tests__/on-hold.test.ts` AC10.

## Screenshots (this run)

All under `.ai-workspace/design/screens-1816/`:
- `desktop-board.png` — 1440×1000, full board, all four §3g states visible in the IN PROGRESS column plus the DONE terminal-wins case.
- `desktop-drawer-onhold.png`, `desktop-drawer-onhold-blocked.png` — drawer detail for states 2 and 3.
- `mobile-board-todo.png`, `mobile-board-inprogress.png`, `mobile-board-done.png` — 390×844, the three relevant column lanes.
- `mobile-drawer-onhold.png`, `mobile-drawer-onhold-blocked.png` — mobile bottom-sheet drawer, states 2 and 3.
- `crop-header-strip.png`, `crop-hold-cards.png`, `crop-active-cards.png` — 2× zoom crops isolating the hue-distinctness (R1) and breathing-vs-static (R2) comparisons for close inspection.

## AC15 note (no live publish)

`data/board.json` is gitignored (`.gitignore` lines 3-10: `/data/board.json`, `/data/board.json*`, etc.) — it is a local-dev-only override never committed, never uploaded via `scripts/upload-board.ts`, and the live `BOARD_BLOB_URL` env var was never set during this session (`resolveSource` in `lib/load-board.ts` only reaches the blob path when that var is present). The #1578 fixture-board-publish-guard was not exercised because no publish command targeting the fixture was ever run — verified by session history (only `npm run dev` was invoked, no `kanban:upload`/`kanban:sync`).

## Method note

Same discipline as the `#1516` precedent (`.ai-workspace/reviews/1516-ui-evolve-verdict.md`): real screenshots, a fixed rubric, an explicit ACCEPT/REVERT gate, a regression guard, and a live `getComputedStyle` measurement (not a guessed visual diff) for the load-bearing R2 axis.
