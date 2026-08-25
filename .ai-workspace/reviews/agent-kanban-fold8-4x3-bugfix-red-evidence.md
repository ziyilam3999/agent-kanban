# Red-evidence — agent-kanban-fold8-4x3-bugfix

Task: `agent-kanban-fold8-4x3-bugfix`. Plan:
`.ai-workspace/plans/2026-08-25-agent-kanban-fold8-4x3-bugfix-responsive.md`. Fix baseline:
`origin/master fdbc415fd0c8f6851be010f105715a176c54911d` (PR #73 merged). All RED runs below ran
against an unmodified worktree checkout of `fdbc415` (product code untouched, new spec files added);
all GREEN runs ran the SAME spec files, SAME frozen harness parameters, against the fix branch
`agent-kanban-fold8-4x3-bugfix-exec`.

## Attribution correction (plan-review non-blocking note #1)

The plan's "Verified ground truth" cited `data/board.json ≈5.25MB, ~1195 tickets` as read "at
fdbc415". That file is **not tracked at fdbc415** — `git show fdbc415:data/board.json` fails;
`/api/board` loads via `lib/load-board.ts`'s `loadBoard()`, which reads `BOARD_BLOB_URL` (Vercel
Blob) in production, falling back to `data/board.json` (untracked, local-dev-only) or
`data/board.sample.json` (tracked, small) otherwise. The 5.25MB/~1195-ticket figure is the
**operator's production Blob board** (the source of their INP measurement), not a repo file. AC-3's
synthetic scale (`buildBoard`'s `bigPayload` option, 1000 tickets / `descriptionBytes:3000` ->
measured 3.25MB serialized, see AC-3 below) is an independent synthetic fixture and is unaffected by
this correction.

## Line-number correction (plan-review non-blocking note #2)

Grip `touch-action:none` is at `app/globals.css:1204` (plan cited 1173); drawer `max-height:86dvh` is
at `app/globals.css:1183`. Mechanism unaffected — this bugfix did not touch `components/Drawer.tsx` or
its CSS block; the drawer's own touch-vs-scroll gesture logic was not the dominant AC-3 cost (measured
below — the dominant cost was BoardView's own render coupling, not Drawer's listeners).

## AC-1 (bug 1 — landscape scroll reachability) [RED->GREEN]

`npx playwright test e2e/fold8-scroll-reachability.e2e.spec.ts`

Harness: real CDP touch-drag gestures (`Input.dispatchTouchEvent`, `touchStart`/`touchMove*`/
`touchEnd`), touch mobile context (`hasTouch:true, isMobile:true, deviceScaleFactor:2.6`), a synthetic
board with 30 extra `todo` tickets (`buildBoard({liveLanes:0, extraTodoCount:30})`) so the column
genuinely overflows. The probed card is the FIRST card (in DOM/column order) not fully inside the
viewport at load (dynamic per-cell, not a fixed fixture id) — reachability is asserted generically: an
ancestor's `scrollTop` (or `window.scrollY`) increases AND the card's `getBoundingClientRect()` ends
fully inside the viewport, walked from the card element up through `<html>` (never pinned to
`.ak-col`, per A5 / plan-review note #4).

### AC-1a — 840x660 (structural dead zone)

- **RED on fdbc415**: `startedOffscreen=true` (precondition confirmed — card genuinely off-viewport
  at load), `scrolled=false`, `reachedAfter=false`. Zero scroll offset moved anywhere in the ancestor
  chain after 10 real touch-swipe attempts — the dead zone is real, matching the by-construction
  prediction (H1 CONFIRMED, no STOP condition; AC-1a's RED leg was the A1 gate).
- **GREEN on fix**: reachable — `1 [chromium] ... AC-1a ... (2.6s)` PASS.

### AC-1b — 1000x750 (nominal Fold-open landscape, 4-up tier)

- **On fdbc415**: already GREEN (`2.5s` PASS) — the 4-up tier's `.ak-col{overflow-y:auto}` already
  provides a scroll path here, independent of the dead-zone mechanism. Per the plan, this is evidence
  about H1's boundary arm, not a dead control (AC-1a carries the red leg for H1).
- **GREEN on fix**: PASS (`2.5s`), unchanged.

### AC-1c — band sweep, 24 cells (width x height in [640,750,840,900,1000,1023] x [620,660,700,750])

- **RED on fdbc415 at exactly 6 cells** — every cell where width in {640,750,840} (the
  640-899.98cqw band, gated to the 2x2 tier) AND height in {620,660} (below the 2x2 tier's own
  `min-height:700px` gate): `640x620`, `640x660`, `750x620`, `750x660`, `840x620`, `840x660`. All 6
  fail with `reachedAfter=false` — the dead-zone boundary matches the CSS gate arithmetic exactly (no
  false positives/negatives at the 620/660 vs 700/750 height split, or the 640/750/840 vs 900/1000/1023
  width split).
- **GREEN on fdbc415 at the remaining 18 cells** (all widths at height>=700, and all of width
  900/1000/1023 at every height — the 4-up tier is width-only) — these are legitimate boundary-arm
  passes, not dead controls (same reasoning as AC-1b).
- **GREEN on fix at all 26 cells** (24 sweep cells + AC-1a + AC-1b run in the same file):
  `28 passed (1.2m)` full-file run.

## AC-2 (bug 2 — portrait 2x2 coherence + poll stability) [GREEN on master -> regression FENCE, per the plan's own honest gate]

`npx playwright test e2e/fold8-portrait-2x2.e2e.spec.ts` at 750x1000.

- **Geometry leg** (4 `.ak-col` visible, 2 rows x 2 cols, no pairwise overlap, all inside `.ak-board`,
  no body-level page scroll): **GREEN on fdbc415** (`2.0s` PASS) and **GREEN on fix** (`2.0s` PASS).
- **Real-interaction sync leg** (touch-scroll column A, then deliver a CHANGED intercepted `/api/board`
  payload simulating a live poll tick at the real 5s cadence, assert column A's `scrollTop` is
  preserved + geometry still holds): **GREEN on fdbc415** (`10.3s` PASS) and **GREEN on fix**
  (`10.3s` PASS).
  - Harness note: the FIRST version of this leg measured `scrollTopAfterGesture` immediately after the
    touch gesture and saw a ~60px drift by the time of the poll-tick check — traced (via an isolated
    debug run outside the suite) to native touch-scroll MOMENTUM continuing to settle for ~300ms after
    `touchend`, independent of any poll activity (confirmed: the SAME drift occurred with no poll route
    swap at all). Fixed by waiting for `scrollTop` to stabilize across consecutive 150ms samples before
    capturing the baseline — this is a harness-precision fix, not a product change, and it changed the
    RESULT from a false-red artifact to an honest, reproducible GREEN.
- **Honest gate applied**: per the plan's AC-2 text ("If NO leg reproduces in Chromium emulation, the
  spec still ships as a regression fence, the residual is the operator real-device smoke (AC-7)") —
  neither leg reproduced "out of sync" in Chromium touch emulation. This spec ships as a **regression
  fence**, not a RED->GREEN fix. The AC-7 real-device smoke is the residual for bug 2 specifically.

## AC-3 (bug 3 — responsiveness under the live poll) [RED->GREEN]

`npx playwright test e2e/fold8-inp-under-poll.e2e.spec.ts` at 750x1000 AND 1000x750.

Frozen harness: intercepted `/api/board` serving `buildBoard({liveLanes:0, bigPayload:{count:1000,
descriptionBytes:3000}})` — measured serialized size **3.25MB** (1003 tickets; calibrated via a
standalone script before freezing, see below), the SHIPPED poll cadence (`POLL_MS=5000`, no test-only
override), CDP `Emulation.setCPUThrottlingRate({rate:4})`. **4x throttle reproduced clean red on the
first attempt — the plan's escalation to 6x was not needed and the parameter stays frozen at 4x for
both red and green runs.** `PerformanceObserver('longtask', {buffered:true})` and
`PerformanceObserver('event', {durationThreshold:16, buffered:true})` collectors installed via
`page.addInitScript` (attached before any app JS runs).

Payload-size calibration (independent of the repo — see attribution correction above):
```
count=1000 descBytes=2500 -> 1003 tickets, 2.75MB
count=1200 descBytes=2500 -> 1203 tickets, 3.30MB
count=1000 descBytes=3000 -> 1003 tickets, 3.25MB   <- FROZEN (>=1000 tickets AND >=3MB, both margins)
```

### AC-3a — idle-tick cost (>=3 UNCHANGED-payload poll ticks, ZERO longtasks >=100ms)

Harness refinement: the observation window starts AFTER poll tick #1 has already fired (+ settle
buffer) — tick #1 is an unavoidable one-time "first observation" of the payload on BOTH master and the
fix (there is no prior fetch to diff against), so the window covers only genuinely-steady-state ticks
#2/#3/#4 (each byte-identical to the previous), the real scenario the operator hit (an already-open
board left running).

- **RED on fdbc415** (both viewports): exactly 3 longtasks >=100ms, one per observed tick, landing
  almost exactly 5000ms apart:
  - 750x1000: `{start:10734.2, duration:516}`, `{start:15719.4, duration:512}`, `{start:20721.8,
    duration:507}`
  - 1000x750: `{start:10721.2, duration:514}`, `{start:15721.3, duration:506}`, `{start:20718.0,
    duration:507}`
- **GREEN on fix** (both viewports): `totalInWindow:0, big:0` — zero longtasks of ANY size in the
  observation window, not just zero >=100ms.

### AC-3b — interaction latency (worst input delay <100ms, worst event duration <200ms)

Real gestures: (i) tap a card (drawer opens), (ii) touch-scroll the drawer body, (iii) touch-scroll a
board column — each timed to straddle poll ticks #2/#3/#4 respectively (tick #1 is let through
undisturbed for the same "unavoidable first observation" reason as AC-3a).

- **RED on fdbc415** (both viewports): worst input delay already under threshold
  (750x1000: `31.6ms`, 1000x750: `28.8ms`, both <100ms) but worst event **duration** far over:
  750x1000: `632ms` (vs <200ms), 1000x750: `640ms` (vs <200ms).
  - Root-cause note (Rule 18 live-test): an isolated debug run confirmed the ~600ms duration
    reproduces on a tap-to-open-drawer ALONE, with the big board fully loaded and ZERO poll
    interference (tapped at t~3.2s, well before the first 5s tick) — `608ms` duration on a plain click.
    An EARLIER debug attempt (tap at t~1s) had measured only `160ms` for the "same" interaction and
    briefly suggested drawer-open cost was cheap; that measurement was a false negative caused by a
    race against the SSR sample-board's small initial paint (the big intercepted board had not yet
    swapped in) — re-run with an explicit wait for the full ticket count landed, confirmed the ~600ms
    cost is real and poll-independent. **This is why the fix required BoardColumn.tsx, not just the
    poll gate** (see the fix section below).
- **GREEN on fix** (both viewports): worst delay `29-38ms` (<100ms), worst duration `96-104ms`
  (<200ms).

## AC-4 (non-regression controls) [GREEN->GREEN, hold-out]

- **Phone 390x844** (touch context): strip horizontal snap-scroll by real touch swipe (`scrollLeft`
  increases), drawer opens. **GREEN on fdbc415** (`3.0-3.2s` PASS) and **GREEN on fix** (`3.0s` PASS).
  Harness note: `.ak-strip`'s own 14px left padding produces a non-zero initial `scrollLeft` (~14) on
  load, from Chromium's scroll-snap settle — reproduced independently of touch/mobile context (measured
  identically at `deviceScaleFactor` 1/2/2.6/3 with a plain minimal fixture) — not a bug, not a
  regression; the test records `before` as a baseline rather than asserting it is exactly 0.
- **Desktop 1440x900** (mouse, no touch): 4 columns visible, real wheel-scroll reaches a below-fold
  card in a 4-up column, drawer works. **GREEN on fdbc415** (`2.1s` PASS) and **GREEN on fix**
  (`2.1s` PASS).

## AC-5 (suite + CI)

- `npm run typecheck`: exit 0 (both before and after the fix).
- `npm test` (jest): **445/445 passed, 45/45 suites** on the fix branch.
  - One EXISTING suite (`__tests__/lane-reveal.test.ts`, 2 tests) initially broke when the poll fix
    switched from `res.json()` to `res.text()` (a content-equality short-circuit needs the RAW body) —
    the test's `global.fetch` mock only implemented `.json()`, so `res.text()` threw inside the
    `try/catch`, silently swallowing the error and leaving `scrollIntoView` never called. Fixed by
    adding `text: async () => JSON.stringify(b)` to the mock, alongside the existing `json:` — this
    makes the mock match the REAL `Response` object's actual surface (a real `fetch` Response
    genuinely implements both methods); it does not weaken or skip any assertion in the test.
- PR CI (typecheck + jest per `.github/workflows/ci.yml`) — Playwright is local/gate-run, not CI; a
  green CI check is NOT proof of AC-1/2/3 (per the plan's hard constraint).

## AC-6 (UI gate)

Fresh ui-evolve validation on the FIXED build (screenshots at 1000x750, 750x1000, 390x844):
**verdict ACCEPT, overall 7.1/10** (equal to the prior fold8-4x3 run's 7.1/10, satisfying "score >=
prior"). Evidence: `.ai-workspace/ui-evolve/agent-kanban-fold8-4x3-bugfix/verdict.md` +
`shots/*.png`. None of this bugfix's three changed surfaces (the narrowed shell-clamp media query, the
poll's WHEN-not-WHAT timing change, the BoardColumn code-organization extraction) affect what these
three viewports render — confirmed by direct screenshot comparison against the prior run's captures,
not re-derived from scratch (see the verdict file for the full reasoning). Screenshots are NOT proof
for AC-1/2/3.

## AC-7 (real-device residual — recorded, not merge-gating)

Chromium/CDP touch emulation is necessary-but-NOT-sufficient for the real device (cairn precedent,
#1455 drawer). **This PR needs an operator real-device smoke on the physical Samsung Fold 8, both
orientations — scroll (up/down and left/right in landscape), drawer open/scroll/dismiss, and tap
latency — before this is considered fully resolved on-device.** If the operator still sees ANY of the
three original bugs after this merges, file a board ticket IMMEDIATELY (loose-end-ticketing standing
rule) and re-open via a new 3-role chain; do not silently patch further without a fresh red repro.

## Dead-control disposition (plan-review non-blocking note #3)

`e2e/fold8-4x3-grid-tiers.e2e.spec.ts` (tracked at fdbc415 — the prior computed-style/structural spec
that PASSED while the device was broken) was run, UNMODIFIED, against the fix branch:
**24/24 tests GREEN** (`fold8-4x3-grid-tiers.e2e.spec.ts` AC-0 through AC-7, unchanged). It is NOT cited
as evidence for AC-1/2/3 above and was NOT deleted or modified to dodge any conflict — it stays green
honestly because the fix's CSS change only narrows the shell-clamp's applicability to a height<700
sub-band that none of THAT spec's fixed viewports (1000x750, 750x1000, 390x844, 1440x900) fall into.

## Privacy scan (per `docs/privacy-scan-invocation-contract.md` in ai-brain)

Invocation: `bash scripts/privacy-scan.sh --working <path>` (named `--working` explicitly, never
`--staged`), against every new/changed file in this PR: `app/globals.css`, `components/BoardView.tsx`,
`components/BoardColumn.tsx`, `e2e/fixtures/board-fixture.ts`, `e2e/fixtures/touch.ts`,
`e2e/fold8-inp-under-poll.e2e.spec.ts`, `e2e/fold8-portrait-2x2.e2e.spec.ts`,
`e2e/fold8-scroll-reachability.e2e.spec.ts`, `__tests__/lane-reveal.test.ts`, and this file's own
`.ai-workspace/ui-evolve/agent-kanban-fold8-4x3-bugfix/verdict.md`.

- **Scanner's own verdict line**: `privacy-scan: CLEAN mode=working size=125783` (exit 0). `size` is
  non-zero — a genuine content scan, not an empty/narrowed surface.
- **Positive control** (same invocation shape, a scratch copy seeded with a home-path needle):
  `privacy-scan: DIRTY (home-path matches=1, brand matches=0, email matches=0,
  credential-secret matches=0)` (exit 1) — confirms the scanner has real power against this artifact
  class before trusting the CLEAN result above.
- The plan itself (`.ai-workspace/plans/2026-08-25-agent-kanban-fold8-4x3-bugfix-responsive.md`) is
  gitignored and was NOT committed into this branch (per A6).

## Non-goals honored

No visual redesign; phone (<640) and desktop (>=1024) stay untouched (AC-4 hold-out, GREEN on both
master and fix, confirms this). No poll-interval change (`POLL_MS` is still `5000`, untouched — only
WHEN a re-render happens changed, never the cadence). No existing e2e/jest suite weakened or skipped
(the one jest mock edit is a completeness fix, documented above under AC-5).
