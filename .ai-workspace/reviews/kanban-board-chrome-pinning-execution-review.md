# kanban-board-chrome-pinning — execution-review verdict

**Role:** execution-review (stateless, independent — did NOT author the plan or the code)
**Task:** kanban-board-chrome-pinning
**PR:** agent-kanban #87, branch `kanban-board-chrome-pinning` @ head `217f40c4`
**Baseline (RED control):** `origin/master` @ `c656df5`
**Approved plan:** ai-brain `origin/kanban-board-chrome-pinning-plan-review-r1:.ai-workspace/plans/2026-09-17-kanban-board-chrome-pinning.md` (plan-review PASS r1)
**Session:** 4236cea4-95cc-455b-8763-1f4c84184b41

Decision: PASS

## How I reviewed
Cold and adversarially, from OUTSIDE the diff, in isolated detached worktrees of BOTH shas
(`.claude/worktrees/_er-red-c656df5` @ c656df5, `.claude/worktrees/_er-green-branch` @ 217f40c4 —
each with only `data/board.sample.json` and no live `data/board.json`, so no SSR fixture poisoning
per NR-7). I wrote my OWN independent real-interaction probe using ONLY pre-existing selectors, ran
the executor's committed spec myself at both shas, ran the canonical privacy scan with a positive
control, and adjudicated all 3 stated caveats. Real-interaction measurements below were replicated
across TWO widths and TWO shas plus a full self-mutation revert/restore cycle (axes: viewport-width,
sha, fix-present — all agree).

## Named-risk note disposition (receiving-end duty, #2434)

DISPOSITION kbcp-red-must-be-moving-element addressed — I independently re-ran a real-CDP-touch-drag
probe at `c656df5` using ONLY selectors that exist there (`.ak-header`, `.ak-col__head`,
`.ak-shelf__summary`) and measured a GENUINE MOVING-REAL-ELEMENT RED, not a `[data-ak-chrome]`
selector-absent locator error. My probe (independent of the executor's uncommitted `_root-cause-probe`):
- 390x844 real touch drag: `.ak-header`.top `0 -> -688`; `.ak-col__head`.top `168.8 -> -519.2` (both
  supposedly-sticky elements scroll away ~688px); list `maxScrollDelta=692`.
- 344x882: `.ak-header` `0 -> -716`; `.ak-col__head` `168.8 -> -547.2` (replicated at the 2nd width).
- 1280x800 wheel: `.ak-header` `0 -> -480`; `.ak-col__head` `135.5 -> -344.5`; `.ak-shelf__summary`.top
  `5444.5` at rest — far below the 800px viewport (unreachable bottom bar).
- The `[data-ak-chrome="top"]`, `[data-ak-chrome="bottom"]`, `.ak-col-heads-mobile` selectors printed
  ABSENT at c656df5 — which is why the executor honestly anchored the red-on-prefix on pre-existing
  selectors. My numbers agree with the recorded evidence (header ~-717, shelf 5444.5). The recorded
  RED (red-evidence.md, interaction-test.md) names the real-selector arm numbers. Duty closed.

## Independent real-interaction confirmation of BOTH overflow fixes (concrete rect deltas)

Fix 1 — root `html`/`body` `overflow-x: hidden` -> `clip` (un-traps the viewport as sticky containing block):
GREEN branch, 390x844 real touch drag: `.ak-header`/`[data-ak-chrome="top"]`.top `0 -> 0` (stays put);
list `maxScrollDelta=700`. Desktop 1280x800 wheel: `.ak-header`.top `0 -> 0` (stays put);
`[data-ak-chrome="bottom"]`/`.ak-shelf__summary` now at `760.8` (restBottom=800 = viewport bottom —
reachable, vs 5444.5 at c656df5).

Fix 2 — second trap at `.ak-strip{overflow-x:auto}`, fixed by HOISTING a new sibling `.ak-col-heads-mobile`
OUTSIDE `.ak-strip` (not by changing `.ak-strip`'s overflow, so horizontal column-snap is preserved):
GREEN branch, 390x844: `.ak-col-heads-mobile`.top `126.8 -> 126.8` (stays pinned) while the in-flow
`.ak-col__head` (still inside `.ak-strip`, by design) scrolls `165.4 -> -534.6`. The pinned mirror is
the sibling, correctly un-trapped.

Dead-control (self-mutation, my own run on the branch worktree): reverting `clip` -> `hidden` re-broke
the pinning — `.ak-header` `0 -> -665`, `.ak-col-heads-mobile` `126.8 -> -538.2`; restoring the fix
returned it to `0 -> 0` / `126.8 -> 126.8`. The oracle is a live control that varies with the fix, not
a dead assertion.

## Binary AC re-run from outside the diff

- AC-0 (RED genuine + recorded): re-confirmed at c656df5 — genuine moving-element RED on pre-existing
  selectors (above); the committed spec's 5 no-regression legs (fixture self-assert, AC-4, AC-6 x2,
  AC-8) also PASS at c656df5, so the RED is isolated to the real pinning legs. red-evidence.md cites
  c656df5 and names failing arms.
- AC-1/AC-2/AC-3/AC-3b/AC-5/AC-6/AC-7/AC-8 (committed spec on branch): I re-ran the full spec myself —
  27/27 PASS. Printed budgets: phone `topBand+bottomBand = 194.66 <= 200`; desktop `175.44 <= 178`.
- AC-9 (full regression, independent runs): typecheck exit 0; `npx jest` 51 suites / 515 tests PASS,
  exit 0 (fresh worktree, not crawling nested copies). E2E: my own focused run of the plan-named
  no-regression specs on the branch = 139/139 PASS (`fold-front-screen-overflow` [the NR-5 containment
  oracle], `shelf`/`shelf-scroll`/`shelf-front-screen-reachable`, `fold8-4x3-grid-tiers`/`-portrait-2col
  -paging`/`-portrait-2x2`/`-scroll-reachability`/`-uiux-redesign`, `lane-reveal`, `live-swimlanes`,
  `drawer-pulldown-dismiss`, `drawer-long-subject`). A separate independent full-suite run under
  `next dev` showed 176/178, with only 2 perf-budget specs non-green
  (`board-render-perf-unchanged-tick` AC-4, `fold8-inp-under-poll` AC-3a). I resolved both against the
  DELTA RULE and the SHIPPED build (see caveat 1) — no green-at-c656df5 spec is red on the branch under
  the production build.
- AC-10a (design brief): 107 lines (>=60); coverage grep 17 (>=8); `## Rubric` section present. A
  genuinely bold POV (telemetry-console idiom: "instrument panel" top, "pull-tab tray riveted to the
  housing" bottom; justifies keeping the 4-tile meter over the grid bar because an already-green e2e
  pins `.ak-meter` visible). NR-3 satisfied — not a plan restatement.
- AC-10b (ui-evolve verdict): `verdict: ACCEPT`, score 4.8, 7 production-server screenshots present,
  explicit no-regression section.
- AC-10c (interaction marker): `viewport=390x844 touch=true`, `red-on-prefix=...c656df5`, `result=PASS`,
  no FAIL/RED structured line — greps pass.
- AC-10d (prod-build marker): PR body carries
  `production-build: agent-kanban@217f40c490502b4fa5fd0da00065eb55af551815 ... exit=0`; marker sha ==
  headRefOid (prefix-match true).
- AC-10e (metered-UI N/A): `git diff origin/master...HEAD --stat -- app/api lib/load-board.ts
  lib/board-cache.ts lib/board-freshness.ts` EMPTY; BoardView fetch/poll grep = 0. Absence confirmed by
  the empty diff plus the zero-match grep.
- AC-10f (gate hooks): `ui-task-gate.sh` + `prod-build-before-merge-guard.sh` are PreToolUse(TaskUpdate)
  hooks fired at the orchestrator's completion call — not standalone-invocable by executor or reviewer.
  Reported as an orchestrator-completion-step check: ALL gated artifacts are present and well-formed
  (design brief, ui-evolve verdict, interaction marker, red-evidence, prod-build marker matching head).
- AC-11 (published): `git ls-tree origin/kanban-board-chrome-pinning` shows 11 `.ai-workspace/(design|
  reviews)/*kanban-board-chrome-pinning*` entries (>=5) + `e2e/board-chrome-pinning.e2e.spec.ts`.

## Adjudication of the 3 stated caveats

1. AC-9 perf flakiness — INVESTIGATED, resolves to a DEV-MODE + host-load artifact, NOT a regression;
   the executor's specific claim needed correcting but the conclusion (no perf regression) holds on the
   shipped build. Details:
   - The diff touches ZERO fetch/poll/cache path (AC-10e) and does not modify any `*perf*`/`*inp*`/
     `*tick*` `.spec.ts` (verified: `git diff --name-only | grep -iE 'perf|inp|tick'` matches only 2
     `board-render-perf-parity` snapshot PNGs, with no `.spec.ts` among them). The only new JS is a
     `ResizeObserver` on the header that fires on header resize — off the poll/tick hot path those
     budgets measure.
   - Correction to the executor's caveat: an independent full-suite run under `next dev` failed 2 specs
     (`board-render-perf-unchanged-tick`, `fold8-inp-under-poll` AC-3a), and they did NOT clear in
     isolation under dev — so the executor's "pass cleanly in isolation" claim is inaccurate FOR DEV,
     and the failing specs are not exactly the ones the executor named. This is why I did not
     rubber-stamp.
   - Delta-rule + shipped-build resolution: `board-render-perf-unchanged-tick` AC-4 also FAILS at
     `c656df5` under dev (Received 1953ms vs 2665ms on the branch — same "first-window-huge" JIT/compile
     signature), so it is RED AT BASELINE — the delta rule is not violated. I then ran BOTH perf specs
     against the BRANCH PRODUCTION build (`npm run build` exit 0, `next start`) on a quiet host (load
     1.45): 5/5 PASS — `board-render-perf-unchanged-tick` windows=`[0,0,0]` (the 2665ms dev cost was
     compilation warmup, absent in production), `fold8-inp-under-poll` AC-3a/AC-3b 0 longtasks both
     viewports. The perf budgets are calibrated for the production build (the environment that ships and
     the one the executor measured); under it there is no regression. NR-6 satisfied: measured
     unchanged-tick main-thread cost = 0ms, 0 longtasks — the pinned strip did not regress INP/tick
     budgets. Not a blocker.
2. AC-10f gate hooks: correctly characterized — orchestrator-completion-step hooks, artifacts all in
   place (see AC-10f above). Not a blocker.
3. ui-evolve dim-1 = 4/5 (at-rest duplicate "TO DO N" label): acceptable documented tradeoff, not a
   blocker. My probe confirms the doubling: at rest the pinned `.ak-col-heads-mobile` (top 126.8) and
   the in-flow `.ak-col__head` (top 165.4) both render "TO DO N" ~16px apart; on first scroll the
   in-flow one scrolls away and only the pinned mirror remains. It is purely cosmetic, at-rest-only,
   and both elements exist for the real CSS-containing-block reason (the in-flow head is trapped inside
   `.ak-strip`; the hoisted mirror is the un-trapped pinned one). The plan explicitly anticipated this
   (Option B note: hoisting "duplicates column state on the phone strip"). ui-evolve scored it 4/5 with
   overall 4.8 ACCEPT, above the gate bar. Named as a DEFERRED post-merge cosmetic follow-up (suppress
   the in-flow phone head once the mirror is pinned); not ship-blocking.

## Monotonicity checklist (#1590)
- AC-9 delta rule (no spec green at c656df5 may go red on the branch) is the monotone guard; the weaker
  "add new pin" arm does not erase the stronger "no regression at #84/grid cells (GREEN at both shas)".
  Confirmed across the sha axis: the phone shelf stays pinned at BOTH shas (799.8 at c656df5 and on the
  branch); the 5 no-regression legs pass at both shas.
- Second-trap fix HOISTS a sibling rather than changing `.ak-strip{overflow-x:auto}` — horizontal
  column-snap preserved AND vertical pinning added; the horizontal-scroll claim is not weakened.
- `fold-front-screen-overflow.e2e.spec.ts` (the NR-5 containment oracle) is UNTOUCHED by the diff — the
  containment claim is not weakened; AC-7 (no visual-viewport pan) passes on the branch.

## Privacy / employer-brand
`bash scripts/privacy-scan.sh --working <8 changed text files>` -> `CLEAN mode=working size=167518`
(paths: design-brief.md, interaction-test.md, red-evidence.md, ui-evolve-verdict.md, app/globals.css,
components/BoardView.tsx, components/Shelf.tsx, e2e/board-chrome-pinning.e2e.spec.ts). Positive control
(seeded credential needle) -> `DIRTY (credential-secret matches=1)` — instrument has power. The scanner
includes a `brand` class; the CLEAN verdict carries 0 brand matches. No employer-brand string found.

## Verdict
PASS. Both overflow fixes are real (independently confirmed by moving-element rect deltas plus a live
dead-control across width/sha/fix-present axes), the named risk is a genuine moving-element RED, the
AC groups re-run pass, all 4 UI-gate artifacts are present/well-formed with the prod-build marker bound
to head, privacy is clean, and the 3 caveats are non-blocking.
