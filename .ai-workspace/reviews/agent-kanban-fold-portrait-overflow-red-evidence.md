# Both-ends evidence — agent-kanban-portrait-overflow-fold-front-screen-misclassified-as-phone

**Role:** executor
**Spec:** `e2e/fold-front-screen-overflow.e2e.spec.ts`
**Method:** the SAME spec file was run twice — once with `app/globals.css` reverted to its exact
`origin/master@0b275b0` (pre-fix) content, once at this branch's PR head (post-fix) — everything
else (fixture, spec, touch helpers) held constant. This isolates the CSS change as the only
variable between the two runs.

## RED run — `app/globals.css` == `git show 0b275b0:app/globals.css`, spec == PR-head spec

`PW_WEB_SERVER=1 npx playwright test e2e/fold-front-screen-overflow.e2e.spec.ts --reporter=list`

**16 of 34 tests failed** — exactly the Rule-17 both-ends RED corpus named in the plan (AC-1 @
390/412; AC-2 @ 390/412 [touch + wheel = 4 tests]; AC-3 @ 390; AC-4 @
390/412/672/750(×2)/832/900/1024/1200):

| AC | Cell | Assertion | Expected | Received (RED) |
|---|---|---|---|---|
| AC-1 | 390x844 | `scrollWidth <= clientWidth` | <=390 | 602 |
| AC-1 | 412x915 | `scrollWidth <= clientWidth` | <=412 | 602 |
| AC-2 | 390x844 | `visualViewport.offsetLeft===0` (touch drag) | 0 | 212 |
| AC-2 | 390x844 | `visualViewport.offsetLeft===0` (wheel) | 0 | 212 |
| AC-2 | 412x915 | `visualViewport.offsetLeft===0` (touch drag) | 0 | 190 |
| AC-2 | 412x915 | `visualViewport.offsetLeft===0` (wheel) | 0 | 190 |
| AC-3 | 390x844 | `visualViewport.offsetLeft===0` (600px injected stub + drag) | 0 | 231 |
| AC-4 | 390x844 | `id.right <= row.right+1` | <=~370 | 538.97 |
| AC-4 | 412x915 | `id.right <= row.right+1` | <=~392 | 538.97 |
| AC-4 | 672x850 | `id` does not intersect `.ak-lane-track` | false | true |
| AC-4 | 750x832 | `id` does not intersect `.ak-lane-track` | false | true |
| AC-4 | 750x1000 | `id` does not intersect `.ak-lane-track` | false | true |
| AC-4 | 832x750 | `id` does not intersect `.ak-lane-track` | false | true |
| AC-4 | 900x1000 | `id` does not intersect `.ak-lane-track` | false | true |
| AC-4 | 1024x800 | `id` does not intersect `.ak-lane-track` | false | true |
| AC-4 | 1200x800 | `id` does not intersect `.ak-lane-track` | false | true |

**18 of 34 passed** — exactly the plan's named GREEN controls that must not move: AC-1 @ 640-1200
(6 cells); AC-2/AC-3 @ 750x1000; AC-4 @ 640x1000 (stacked-tier control); AC-5 (all 3 cells, tier
selection unaffected by the CSS change); the fixture self-assertion tests (payload-only, no CSS
dependency).

(Absolute pixel values differ from the planner's original scratch-probe numbers — 602 vs the
planner's 588, 212/190/231 vs the planner's cited 198/176 — because this spec's own fixture (2
live lanes: a 71-char id AND an 80-char id AND a 105-char subject token, vs. the planner's 1-lane
probe) and gesture parameters (60%-of-width drag anchored at 85% vs. the planner's own probe
gesture) differ. Same mechanism, same class, same order of magnitude — the numbers this spec
itself reproduces are the load-bearing oracle values, not the planner's original probe numbers.)

## GREEN run — `app/globals.css` == this branch's PR head (the fix), same spec

`PW_WEB_SERVER=1 npx playwright test e2e/fold-front-screen-overflow.e2e.spec.ts --reporter=list`

**34 of 34 passed.** Every RED member above flips GREEN; every GREEN control stays GREEN.

## No-regression (AC-6)

Full existing Playwright suite (`npx playwright test`, all 15 e2e spec files) run at PR head:
**129 of 132 passed.** The 3 failures are ALL in `board-render-perf-unchanged-tick.e2e.spec.ts`
and `fold8-inp-under-poll.e2e.spec.ts` — machine-load-sensitive main-thread-cost/longtask perf
budgets, unrelated to this task's CSS/layout change. Confirmed pre-existing, not a regression: the
SAME test (`board-render-perf-unchanged-tick.e2e.spec.ts` AC-4(i)) was re-run against the
UNMODIFIED `0b275b0` baseline on this same (loaded) machine and failed identically (1858ms vs the
50ms budget, vs 2595ms on the fixed branch — same order of magnitude, same test, same failure
mode, present on BOTH branches). The other 2 (`fold8-inp-under-poll.e2e.spec.ts` longtask checks)
passed on an isolated re-run once the machine was less loaded, confirming flakiness rather than a
real defect. `npm run typecheck` and `npm test` (jest, 478 tests / 49 suites) both exit 0 at PR
head.

## AC-10 — the guard runs in CI, and a revert is RED there too

`.github/workflows/ci.yml` gained a new `fold-front-screen-overflow-guard` job: checkout, Node 20,
`npm ci --ignore-scripts`, `npx playwright install --with-deps chromium`, then
`PW_WEB_SERVER=1 npx playwright test e2e/fold-front-screen-overflow.e2e.spec.ts --project=chromium
--reporter=list` — one project (the repo's sole `chromium` project), one spec file. The RED run
above used this exact test command against a reverted `app/globals.css` — the same signal this CI
job would produce on a scratch revert-only branch (16/34 failing); the GREEN run used the same
command at PR head (34/34 passing). Making this job a REQUIRED status check is a branch-protection
repo setting (operator-owned, deferred per the plan's Deferred follow-ups) — this task installs
the job so it actually RUNS and reports on every PR, closing the "shipped but never executes" gap
(root-cause D).

## AC-1(a) hold-out (numeric-id board stays green)

The full existing suite above includes specs that still use the DEFAULT numeric-id fixture shape
(`buildBoard()` with no `productionShaped` option — e.g. `live-swimlanes.e2e.spec.ts`,
`lane-reveal.e2e.spec.ts`) and all pass unchanged — the fix does not regress the short-id case.
