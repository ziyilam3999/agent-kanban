# Execution-review — agent-kanban Fold 8 (4:3 unfolded) responsive board

- **Task**: `agent-kanban-fold8-4x3` (3-role model; execution-review seat — last line of defense before ship)
- **PR**: #73 · branch `agent-kanban-fold8-4x3` → base master · head `05615ec13d7da9048c312d6966dd8951ce1c417e` (OPEN/MERGEABLE, verified this turn)
- **Reviewer**: execution-review (independent; did NOT author or execute this work). Every AC re-run against the actual PR-head diff, never trusted from the PR body or executor report.
- **Session**: 6bae4820-a911-4659-b95f-f7058c3071d1
- cairn: searched `node skills/cairn/bin/cairn-find.mjs "responsive container query grid"` — nearest hit `[T2] hive-mind-persist/session-notes/2026-06-14-1470062246.md:9` ("A dashboard CSS grid using `repeat(6,1fr)` with no responsive breakpoints…"), the same lesson the planner cited; no prior foldable/container-query design lesson beyond it.

## Review

Decision: PASS

Zero blockers. All 10 Binary AC (AC-0…AC-9) independently re-verified by RUNNING the checks against the PR-head worktree at `05615ec1`, not by reading claims. The two carried named-risk notes are dispositioned below. Scope is clean, privacy is clean (with a positive control), monotonicity holds.

### Named-risk note dispositions (receiving-end duty, #2434)

DISPOSITION fold8-4x3-assumption-c-fullbleed-precondition observed-in-diff — The full-bleed precondition holds in the shipping config. (1) No in-flow / width-stealing sidebar was introduced: the base `.ak-drawer` is `position: fixed` (globals.css) and the grid-tier drawer override (`@media (min-width:900px) and (max-width:1023.98px)`) changes only `left/right/top/bottom/width/border` — it does NOT alter `position`, so the drawer stays a fixed overlay and the board remains full-bleed. (2) The viewport-keyed shell clamp (`@media (min-width:640px) and (max-width:1023.98px)`) and the container-keyed tiers (`@container (min-width:640px)…(max-width:899.98px)` ∪ `@container (min-width:900px)…(max-width:1023.98px)` = 640–1023.98) share the IDENTICAL 640 / 900 / 1023.98 numeric boundaries, so shell and tiers flip in lockstep. AC-2 and AC-6 (both green at 750×1000 and 1000×750) exercise the agreeing full-bleed config.

DISPOSITION fold8-4x3-container-size-height-collapse not-applicable — The 0-height collapse trap is structurally avoided: `container-type: size` is NEVER used in the file (`command grep -n container-type app/globals.css` → the only real declaration is `container-type: inline-size` on `.ak-main` at L172; the two other occurrences are explanatory comments). The 2×2 height guard is `@media (min-height: 700px)` AND-ed with the width `@container` query — assumption (b)'s sanctioned alternative — so `.ak-board`'s height comes from the ordinary flex box chain (`.ak-app` 100dvh grid → `.ak-main` flex column → `.ak-board flex:1 1 auto`), never from size containment. Non-zero column heights confirmed live: AC-2's `scrollHeight > clientHeight` (both positive) passed, and the 750×1000 screenshot shows fully-laid-out columns.

### Per-AC result (all re-run against PR head)

| AC | Verdict | Evidence (independently re-run) |
|----|---------|--------------------------------|
| AC-0 (Rule-18 smoke) | PASS | Playwright AC-0 test green in BOTH runs: `CSS.supports('container-type: inline-size') === true` AND `.ak-board` re-tiles 4-track (1000×750) → 2-track (750×1000) on a live, same-session viewport resize. |
| AC-1 (1000×750 4-up) | PASS | `.ak-board` = 4 col tracks × 1 row; all 4 `.ak-col` boxes inside viewport; `scrollWidth ≤ clientWidth` and `docScrollWidth ≤ innerWidth`. Test green + screenshot eyeballed. |
| AC-2 (750×1000 2×2) | PASS | `.ak-board` = 2×2 grid; TODO `.ak-col` `overflow-y ∈ {auto,scroll}` with `scrollHeight > clientHeight`; scrolling it moves only its own scrollTop (siblings + window unchanged); no page scroll. Test green. |
| AC-3 (collapsed header) | PASS | Both tiers: `.ak-header` ≤ 48px; every `.ak-meter__seg` has zero-area box (parent `display:none`); exactly one visible `.ak-meterbar` with 4 `.ak-meterbar__seg`, TODO (count 21) segment ≥ all others (ordering holds). Test green ×2 tiers. |
| AC-4 (390×844 phone NON-REGRESSION) | PASS | `.ak-board` `display:flex`, `overflow-x` scrollable, `scroll-snap-type` contains `x mandatory`; `.ak-dots` visible with 4 dots; first `.ak-col` ≈ 343.2px ±2; page scrolls; bottom-sheet drawer anchored to bottom edge, ~full width. Test green + screenshot: 4 fat stat tiles + bottom-sheet drawer w/ drag handle preserved. |
| AC-5 (1440×900 desktop NON-REGRESSION) | PASS | `.ak-board` = 4 tracks; `.ak-dots` `display:none`; side-panel drawer: right edge at viewport right, width 440px ±2, top ≈ 0, bottom ≈ viewport bottom. Test green + screenshot: 4 fat tiles + 4-up + right-side 440px panel. |
| AC-6 (100dvh shell) | PASS | Both tiers: `.ak-app` `display:grid`, `grid-template-rows` = 2 tracks, rendered height = innerHeight ±2; no page scroll. Test green ×2 tiers. |
| AC-7 (grid-tier drawer + swimlane clearance) | PASS | 1000×750 drawer is the SIDE panel (440px, full height, right edge); at both grid tiers `.ak-lanes scroll-margin-top` (48px) ≥ rendered header height. Test green. |
| AC-8 (UI-GATE — quality, not presence) | PASS | See honesty finding below. Design brief is a real bold POV; ui-evolve verdict = ACCEPT + 7.1/10 + both regressions PASS, graded against the correct brief; all 4 screenshots eyeballed and correct. |
| AC-9 (repo checks) | PASS | `npx tsc --noEmit` exit 0; `npx jest` → 45 suites / **445 tests, 445 passed** (claim 445/445 confirmed); `npm run build` → "Compiled successfully", 6/6 static pages, full route table, `.next/BUILD_ID` present. |

### Re-run outputs (raw)
- **tsc**: `--noEmit` → exit 0, no output.
- **jest**: `Test Suites: 45 passed, 45 total` · `Tests: 445 passed, 445 total`.
- **build**: `✓ Compiled successfully in 844ms` · `✓ Generating static pages (6/6)` · route table printed · `BUILD_ID present`.
- **Playwright run 1**: `10 passed (28.2s)` — AC-0..AC-7 all green.
- **Playwright run 2** (flake catch): `10 passed (26.7s)` — identical, no flake.

### AC-8 ui-evolve honesty finding
The verdict (`.ai-workspace/reviews/fold8-4x3-ui-evolve-verdict.md`) carries an explicit RE-RUN NOTE: the FIRST judge run graded a substitute doc (`docs/design-direction.md`) because the task brief did not yet exist in the worktree (a caller race); the committed run re-graded against the correct `docs/fold8-4x3-design-brief.md`. I confirmed the committed verdict is genuinely graded against the REAL brief — it cites brief-specific content that exists ONLY in the fold8 brief (the "black-box telemetry console / flight recorder" POV, §4 header collapse, §5 compact-card spec) — and the ACCEPT is honest, not green-washed: it scores 7.1/10 and DOCKS real points (spacing→5, rhythm→5) for a genuine portrait dead-zone, plus a hierarchy nit on the TODO meter segment. Both regression checks (390×844, 1440×900) are PASS with specific structural evidence vs the pre-existing `screens-1816/*` captures. I independently eyeballed all 4 committed screenshots (Rule 19): landscape 4-up, portrait 2×2 (dead-zone visible, matches the verdict — aesthetic, not a functional AC failure), phone bottom-sheet, desktop side-panel — all correct, on-purpose, no dev-text leakage, no clipping, no placeholder.

### Scope check
Diff touches ONLY the allowed surface: `app/globals.css`, `components/BoardView.tsx` (adds `ak-board` class to the strip div + comment — verified minimal, strip handlers inert in grid), `components/PipelineMeter.tsx` (adds `.ak-meterbar` twin, renders both readouts unconditionally), the new `e2e/fold8-4x3-grid-tiers.e2e.spec.ts` + `e2e/fixtures/board-fixture.ts` (`extraTodoCount` opt), plus workspace artifacts (plan, design brief, Fable critique, ui-evolve verdict, 4 screenshots). No creep, no unrelated files.

### Monotonicity check (#1590)
- **CSS cascade (last-writer-wins)**: base phone strip (unqueried) → grid tiers (640–1023.98, capped) → desktop `@media (min-width:1024px)` block (unedited, LATER in source order). Stronger claim "desktop pixels don't move" wins two ways: the grid tiers are `max-width`-capped at 899.98/1023.98 so they don't match ≥1024 at all, AND the desktop block is later in source order. The weaker grid-tier arm cannot erase the stronger desktop arm. AC-5 + AC-8 confirm no desktop regression.
- **meter vs meterbar (mutual exclusion)**: base `.ak-meterbar{display:none}` (weaker default); grid tiers set `.ak-meter{display:none}` + `.ak-meterbar{display:flex}` (media-scoped, stronger). Phone/desktop keep tiles + hide bar; grid tiers hide tiles + show bar. AC-3 + screenshots confirm the two are never both present, and neither state erases the other's contract.
- **drawer (bottom-sheet vs side-panel)**: base bottom-sheet → grid-tier 900–1023.98 side-panel (later source order, same specificity, wins) → desktop ≥1024 side-panel. The 640–899.98 2×2 tier deliberately keeps the base bottom sheet. AC-4/AC-5/AC-7 confirm each regime. Monotonic and correct.

### Privacy scan (per docs/privacy-scan-invocation-contract.md)
- **Invocation**: `bash scripts/privacy-scan.sh --working <path>` (canonical `--working`, never `--staged <path>`).
- **Paths scanned**: `app/globals.css`, `components/BoardView.tsx`, `components/PipelineMeter.tsx`, `e2e/fold8-4x3-grid-tiers.e2e.spec.ts`, `e2e/fixtures/board-fixture.ts`, `.ai-workspace/plans/2026-08-25-fold8-4x3-responsive.md`, `.ai-workspace/reviews/fold8-4x3-ui-evolve-verdict.md`, `docs/fold8-4x3-design-brief.md`, `docs/fold8-4x3-fable-critique.md`.
- **Verdict line**: `privacy-scan: CLEAN mode=working size=148527` (exit 0) — non-zero size confirms real content was scanned, not a false size=0.
- **Positive control**: identical invocation shape on a scratch file seeded with a known email needle → `privacy-scan: DIRTY (… email matches=1 …)` exit 1. The instrument has power against this run's match class, so the CLEAN is evidence, not an assertion.

*Employer-brand note: "Samsung Galaxy Z Fold 8" is a product/device name, not the regulated employer token — its presence is expected and confirmed clean by the brand-regulated class (brand matches=0 on the seeded control shape and CLEAN on the real files).*

### Verdict
**PASS.** The change delivers the planned Fold 8 responsive behavior — a container-query 4-up (1000×750) and 2×2 (750×1000) middle tier with a collapsed ≤48px header, proportional segmented meter, 100dvh per-column-scroll shell, and grid-tier side-panel drawer — while byte-preserving the sub-640 phone strip and ≥1024 desktop contracts. All 10 AC re-verified live (Playwright 10/10 ×2, tsc 0, jest 445/445, build 0), both named-risk precondition notes hold in the shipping config, scope is contained, privacy is clean with a positive control, and the ui-evolve ACCEPT is honestly earned against the correct brief. Ship-ready.
