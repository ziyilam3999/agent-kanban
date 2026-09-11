# ui-evolve verdict — REVIEW/SHIPPING pill honesty

verdict: ACCEPT

- **Total: 12 / 12** (R1-R3, 0-4 each; threshold per the plan: legible, honest-at-a-glance,
  vocabulary-consistent, no regression — cleared with no axis below 4)
- Scored against the plan's §"UI-task gate — honest scoping" rubric
  (`.ai-workspace/plans/2026-09-11-agent-kanban-inreview-and-shipping-pills-overstate-progress.md`),
  from REAL Playwright screenshots (`playwright-core` 1.x, headless Chromium) of the app running
  locally (`npx next dev -p 3919`) against a local fixture at `data/board.json` (gitignored
  local-dev-only override — same method as the #1816/#1455/#1516 precedents; never published to the
  live blob — see the "no live publish" note below). The fixture carries exactly the five states the
  plan's §UI-task gate names: `#501` (F-A — mid exec-review, neutral REVIEW), `#502` (F-K — held +
  still-punched-in reviewer, neutral REVIEW, lane lit), `#503` (F-C — held + passed review, ON HOLD in
  the REVIEW column), `#504` (F-D — 30h-old PASS + a LIVE session, STALE), `#505` (a fresh PASS,
  SHIPPING control).

## Per-axis scores (0-4 each)

| # | Axis | Score | Evidence |
|---|---|---|---|
| R1 | Legibility of the corrected pills | **4** | `desktop-board.png` / `mobile-board-review.png`: `#501`/`#502` render a plain amber `◆ REVIEW` with no verdict token — legible as "still waiting", not truncated, not blended with any other text. `#504`'s `✓ PASS — STALE` and `#503`'s `⏸ ON HOLD` both render cleanly in the dimmed/ochre hues respectively, fully readable at both 1440px and 390px. |
| R2 | Honesty-at-a-glance (waiting-for-review vs passed, parked/stalled vs shipping — without opening the drawer) | **4** | Five cards, five genuinely distinct readings, zero drawer opens needed: `#505` green `✓ PASS — SHIPPING` (moving), `#501`/`#502` amber `◆ REVIEW` (still waiting — no borrowed verdict), `#504` dim `✓ PASS — STALE` (passed but gone quiet), `#503` ochre `⏸ ON HOLD` + `⏸ held 5d` (deliberately parked, not shipping). This is the direct fix target: on unpatched code `#501`/`#502` would have shown a borrowed `· PASS` and `#503` would have shown `✓ PASS — SHIPPING` — both defects that made a non-moving card look like it was moving. Side-by-side in one column, the five now read honestly at a glance. |
| R3 | Vocabulary consistency (nothing reads bolted-on) | **4** | `⏸ ON HOLD` on `#503` reuses the EXACT #1816 glyph/hue/footer treatment already used in the PROG column (`⏸ held 5d`, ochre rail) — same idiom, new column, zero new tokens. `◆ REVIEW` on `#501`/`#502` is the pre-existing neutral pending glyph, simply no longer decorated with a verdict it hasn't earned. `✓ PASS — STALE` reuses the exact dimmed `--fg-dim` treatment #1449 already shipped. No new glyph, hue, or layout was introduced by this fix — confirmed by reading the diff (`lib/ui-meta.ts` only; no CSS/component changes). |

## Regression guard (pass/fail, not scored) — **PASS**

- **Non-held, non-stale cards are unchanged**: `#505` (fresh SHIPPING) renders identically to the
  pre-fix shape (`✓ PASS — SHIPPING`, green, same layout) — confirmed both visually and mechanically
  by `__tests__/monotonic-flow.test.ts`'s AC-6 shipping-pill tests (unedited, still green) and this
  task's own `__tests__/phase-pill-honesty.test.ts` F-E/F-F controls.
- **The #1867 running-reviewer pin still lights a lane**: `#502` (held + open exec-review) is one of
  the "3 LANES LIVE" swim-lane rows at the top of both screenshots, and its rail is the live teal
  color, not the static ochre held treatment — a running agent still outranks the parked note, exactly
  as `__tests__/lane-pending-review-visibility.test.ts` AC-4 pins mechanically.
- **Card/Drawer byte-shape for a non-held, non-stale card is untouched**: `on-hold.test.ts` AC2/AC11's
  byte-identical baselines stayed green (unedited existing test file), which is the mechanical
  guarantee behind this visual claim.

## Screenshots (this run)

All under `.ai-workspace/design/screens-pill-honesty/`:
- `desktop-board.png` — 1440x900, full board. The lane strip (top) shows `#505`/`#501`/`#502` as the
  3 live lanes; the REVIEW column lists all 5 fixtures with their corrected pills.
- `mobile-board-review.png` — 390x844, touch context, navigated to the REVIEW column via the
  `role="tab" aria-label="In Review"` dot (the app's own mobile column-jump control) — shows all 5
  fixtures stacked, same pill vocabulary as desktop.

## No live publish

`data/board.json` is gitignored (`.gitignore` lines 1-10: `/data/board.json`, `/data/board.json*`,
etc.) — a local-dev-only override, never committed, never uploaded via `scripts/upload-board.ts`, and
`BOARD_BLOB_URL` was never set during this session (`resolveSource` in `lib/load-board.ts` only
reaches the blob path when that var is present) — verified by session history: only `npx next dev` was
invoked, no `kanban:upload`/`kanban:sync`.

## Method note

Same discipline as the `#1816`/`#1455`/`#1516` precedents: real screenshots (desktop + mobile touch
context), a fixed rubric scoped to this task's own §UI-task gate text, an explicit ACCEPT/REVERT gate,
and a mechanical regression guard (the existing named hold-out test suites, unedited and green) rather
than a re-guessed visual diff.
