# kanban-board-chrome-pinning — RED / GREEN evidence

**Task:** kanban-board-chrome-pinning
**RED baseline:** `origin/master` @ `c656df5b0c71693192e5321bf75d2c4f2cddfabf` (matches the plan's cited
baseline exactly — `git rev-parse origin/master` reconfirmed at branch time).
**GREEN:** branch `kanban-board-chrome-pinning`.
**RED run environment:** a fresh, clean, DETACHED worktree of `c656df5` (`.claude/worktrees/_red-baseline-c656df5`,
removed after the run) — NOT the primary clone. The primary clone carries a live `data/board.json`
(3.8MB snapshot, confirmed present at run time) which the plan's NR-7 documents as SSR-poisoning the
fixture-driven e2e specs; the clean worktree's only board source is `data/board.sample.json`, matching
the plan's prescribed methodology.

## AC-0 — the new spec (`e2e/board-chrome-pinning.e2e.spec.ts`), byte-identical across both shas

RED run command: `PW_BASE_URL=http://localhost:3941 npx playwright test e2e/board-chrome-pinning.e2e.spec.ts --reporter=list`

```
Running 27 tests using 1 worker
  ✓   1 fixture self-assertion — the RED must be genuine › EXTRA_TODO board yields the expected card count AND a column far taller than the viewport (2.1s)
  ✘   2 AC-1 — top strip stays put under real touch scroll (390x844) (30.0s)
  ✘   3 AC-1 — top strip stays put under real touch scroll (344x882) (30.0s)
  ✘   4 AC-2 — contiguity (390x844) (30.0s)
  ✘   5 AC-2 — contiguity (344x882) (30.0s)
  ✘   6 AC-2 — contiguity (1280x800) (30.0s)
  ✘   7 AC-3 — bottom bar pinned, touch (390x844) (30.0s)
  ✘   8 AC-3 — bottom bar pinned, touch (344x882) (30.0s)
  ✘   9 AC-3 — bottom bar pinned, touch (390x660) (30.0s)
  ✘  10 AC-3 — bottom bar pinned, touch (667x375) (30.0s)
  ✘  11 AC-3 — bottom bar pinned, wheel (768x1024) (30.0s)
  ✘  12 AC-3 — bottom bar pinned, wheel (1280x800) (30.0s)
  ✘  13 AC-3 — bottom bar pinned, wheel (1440x900) (30.0s)
  ✘  14 AC-3b — no occlusion of the last card (390x844 touch) (30.0s)
  ✘  15 AC-3b — no occlusion of the last card (1280x800 wheel) (30.0s)
  ✓  16 AC-4 — drawer + scrim layer above the pinned bar (390x844 touch) [no-regression leg — GREEN at both shas, as intended]
  ✘  17 AC-5 — height budget (390x844) (30.0s)
  ✘  18 AC-5 — height budget (344x882) (30.0s)
  ✘  19 AC-5 — height budget (390x660) (30.0s)
  ✘  20 AC-5 — desktop budget (1280x800 wheel) (30.0s)
  ✓  21 AC-6 — Live Swimlanes scrolls away with the list (390x844 touch) [no-regression leg — GREEN at both shas]
  ✓  22 AC-6 — Live Swimlanes scrolls away with the list (1280x800 wheel) [no-regression leg — GREEN at both shas]
  ✘  23 AC-7 — no horizontal overflow / pan, production shape (390x844) (30.0s)
  ✘  24 AC-7 — no horizontal overflow / pan, production shape (344x882) (30.0s)
  ✘  25 AC-7 — no horizontal overflow / pan, production shape (412x915) (30.0s)
  ✘  26 AC-7 — no horizontal overflow / pan, production shape (667x375) (30.0s)
  ✓  27 AC-8 — grid tier (768x1024) unchanged [no-regression leg — GREEN at both shas]

  22 failed
  5 passed (11.3m)
```

Exit: **non-zero (22 failed)**. The 5 GREEN cases are the spec's own explicitly-designed no-regression
legs (AC-4, AC-6 x2, AC-8, plus the fixture self-assertion) — behavior the plan says must NOT change, and
which does not depend on the fix.

**nr-2499/kbcp named-risk note (carried from plan-review, id `kbcp-red-must-be-moving-element`):** the
`data-ak-chrome="top"|"bottom"` attributes and the new `.ak-col-heads-mobile` element are ABSENT at
`c656df5` (they do not exist until this branch), so most of the 22 failures above are Playwright locator
timeouts ("element not found" after 30s) — a RED that is genuine (non-zero exit) but does not, by itself,
independently DEMONSTRATE the underlying moving-element bug via a pre-existing selector. Per the plan-
review's explicit instruction, the red-on-prefix claim is anchored below on a SEPARATE probe using ONLY
selectors that already exist at `c656df5` (`.ak-header`, `.ak-col__head`, `.ak-shelf__summary`).

## Root-cause probe — genuine moving-element RED on PRE-EXISTING selectors (c656df5)

A throwaway probe spec (`e2e/_root-cause-probe.e2e.spec.ts`, never committed — evidence-only, run from
the same clean `c656df5` worktree against the same board fixture) measured `getBoundingClientRect()`
before/after a REAL CDP touch drag / at-rest read, using selectors that exist on master:

```
Running 2 tests using 1 worker
[root-cause-probe 390x844] header.top 0->-717 (delta -717) colHead.top 168.765625->-548.234375 (delta -717)
✓  1 390x844: .ak-header and .ak-col__head move with a real touch drag (sticky trapped) (2.6s)
[root-cause-probe 1280x800] shelf__summary.top=5444.53125 innerHeight=800
✓  2 1280x800: .ak-shelf__summary sits far outside the viewport at rest (unreachable bottom bar) (2.3s)
2 passed (5.2s)
```

(These tests assert the BUG is present — i.e. they PASS by confirming the trap, hence "2 passed" here
means "2 confirmations of broken behavior," not "the pinning works.") Both numbers independently
corroborate the planner's own measured probe table in the plan (390x844: `.ak-header` 0→-640/-606-class,
`.ak-col__head` 169→-471-class movement; desktop: shelf top ~69400 not in viewport for the planner's
deeper fixture, ~5444 here for this spec's shallower 40-extra-todo fixture — same "far outside the
viewport" shape, fixture-depth-scaled).

## GREEN — the branch, same spec, same fixture

Run command: `PW_BASE_URL=http://localhost:3942 npx playwright test e2e/board-chrome-pinning.e2e.spec.ts --reporter=list`

```
Running 27 tests using 1 worker
  ... (all 27 cases)
  27 passed (1.1m)
```

Exit: **0 (27 passed, 0 failed)**.

## Self-mutation test (producer self-verify) — ACTUALLY RUN, not narrated

With the fix applied, the sticky trap was temporarily re-introduced on the LIVE branch worktree (a
byte-for-byte backup of `app/globals.css` taken first; both `html`/`body` `overflow-x: clip` lines
reverted to the exact pre-fix `overflow-x: hidden`), the dev server hot-reloaded, and AC-1/AC-2 re-run:

```
$ cp app/globals.css /tmp/globals.css.bak
$ sed -i '125s/overflow-x: clip;/overflow-x: hidden;/; 139s/overflow-x: clip;/overflow-x: hidden;/' app/globals.css
$ PW_BASE_URL=http://localhost:3942 npx playwright test e2e/board-chrome-pinning.e2e.spec.ts -g "AC-1 |AC-2 " --reporter=list
  ✘  AC-1 — top strip stays put under real touch scroll (390x844)
  ✘  AC-1 — top strip stays put under real touch scroll (344x882)
  ✘  AC-2 — contiguity (390x844)
  ✘  AC-2 — contiguity (344x882)  [headBox.top -590.23, expected >= -1]
  ✘  AC-2 — contiguity (1280x800) [headBox.top -348.45, expected >= -1]
  5 failed
$ cp /tmp/globals.css.bak app/globals.css   # restore the real fix
$ PW_BASE_URL=http://localhost:3942 npx playwright test e2e/board-chrome-pinning.e2e.spec.ts -g "AC-1 |AC-2 " --reporter=list
[AC-1 390x844] top.top 0->0 head.top 126.765625->126.765625
[AC-1 344x882] top.top 0->0 head.top 126.765625->126.765625
  5 passed (13.6s)
```

Confirms the oracle is a LIVE control: it goes RED the instant the fix is undone (5/5 fail, with real
negative `headBox.top` values proving the column head is scrolling AWAY, not stuck) and GREEN the
instant it is restored — never a dead assertion that would pass regardless of the underlying CSS.

## Budget numbers (printed by the spec itself, GREEN branch)

- 390x844 / 344x882 / 390x660 (after the AC-1 gesture): `topBand=149.4375 bottomBand=45.21875
  sum=194.65625` (budget 200px — HEAD reference, un-pinned: 241px).
- 1280x800 (after a wheel): `topBand=136.21875 bottomBand=39.21875 sum=175.4375` (budget 178px — HEAD
  reference, un-pinned: 178px, no growth).

## No-employer-brand / privacy note

All numbers above are synthetic-fixture geometry (`buildBoard()` test data) and CSS pixel measurements —
no ticket content, user data, or employer-identifying strings appear anywhere in this file.
