# Execution-review verdict — #2499 folding-phone front-screen shelf reachability

Decision: PASS

- **Role:** execution-review (independent; did NOT author the plan or the code).
- **PR:** agent-kanban #84, branch `2499-folding-phone-shelf-reachable`, head `d5958b3`, base `master` (`dd59d07`).
- **Plan (plan-review PASS `71d942a`):** `.ai-workspace/plans/2026-09-12-agent-kanban-folding-phone-shelf-unreachable-front-screen.md`.
- **Method:** every Binary AC re-run/re-measured against the actual diff and both branches — the executor's report was NOT trusted. cairn searched (`position fixed`, `ui verification`).

## What the fix is (verified from the diff, not the prose)

`git diff dd59d07 d5958b3` touches 8 files: 5 `.ai-workspace/` docs, `.github/workflows/ci.yml` (+7, adds the new spec to the CI guard job), `app/globals.css` (+80, purely additive — 0 deletions), and `e2e/shelf-front-screen-reachable.e2e.spec.ts` (+265, new). The CSS change is a SINGLE `@media (max-width: 639.98px)` block that pins the COLLAPSED `.ak-shelf` via `position: fixed; bottom: 0; z-index: 15`, reserves `.ak-strip.ak-board { padding-bottom: 72px }` for occlusion clearance, adds a grabber-pip `::before`, and bumps `.ak-shelf__summary { padding-top: 17px }`. The `sticky→fixed` pivot is the plan's own sanctioned fallback. The `e2e/fixtures/` are NOT in the diff — the spec's fixture is byte-identical on both branches, so the RED is genuine, not a fixture-shim.

## AC verification (independently re-run)

**AC1 — RED-on-master, GREEN-on-fix (GENUINE).** I created a detached worktree at `dd59d07`, copied ONLY the new spec in (product code + fixtures pristine), and ran it:
- Master `dd59d07`: AC1 **FAILS** — `[AC1] summary.top=5499.75 summary.bottom=5536.97 innerHeight=882` → `top` exceeds `innerHeight` by **~4618px** (a ~6.2× viewport margin, not a coin-flip). Reproduces the executor's recorded RED exactly.
- Fix branch `d5958b3`: AC1 **PASSES** — `[AC1] summary.top=837.78 summary.bottom=881 innerHeight=882` (within `[0,882]`, `scrollY===0`).
- The oracle can vary: the fixture self-assertion (`.ak-col` == 41 cards AND `.ak-strip.ak-board` height > 2× innerHeight) PASSES on master, so the tall board is real.

**AC2 — no #83 regression.** The AC2 scroll-delta test (real CDP touch-drag inside the opened `.ak-shelf__body`) PASSES on BOTH master and the fix branch (I ran it on both). Static confirm: `command grep -nE 'max-height:\s*60dvh' app/globals.css` → exit 0, one match (line 616); the `#83` opened-body rule is byte-identical (only appears in the diff inside the new comment block, never modified).

**AC3 — no 640-1023.98px regression.** The AC3 `768x1024` case PASSES identically on both branches. Diff-scope: the single globals.css hunk is `@@ -648,6 +648,86 @@`, nowhere near the shell-clamp (master L2000-2027) or collapsed-header (L2029-2060) blocks — neither is modified.

**AC4 — UI-task gate (4 legs), all real:**
- Leg 1 frontend-design POV: `.ai-workspace/design/2499-folding-phone-shelf-pinned-bar-design-brief.md` — non-empty, carries a `design_pov:` line and a bottom-sheet rubric.
- Leg 2 ui-evolve: `.ai-workspace/reviews/2499-ui-evolve-verdict.md` — `verdict: ACCEPT`, 20/20 (≥16 threshold, no axis <3), scored from REAL screenshots of the PRODUCTION build (`next build && next start`, explicitly NOT `next dev` — the dev-only "N" badge was excluded). Screenshots not vendored (session scratchpad, prior convention) → not independently eyeballed, but its occlusion (R3) and desktop-leak (R4) claims are cross-checked by my own mechanical runs below.
- Leg 3 real-interaction test: `.ai-workspace/reviews/2499-interaction-test.md` — well-formed marker (`asserts=reachability,scroll-delta`; `viewport=344x882 touch=true`; `red-on-prefix=dd59d07 ...`; `result=PASS`). Independently reproduced.
- Leg 4 production build: PR body carries `production-build: agent-kanban@d5958b3... cmd=npm run build exit=0 dirty=0`.

## sticky→fixed pivot soundness (independently checked on the fix branch)

- Base-tier page scroll intact: AC1b scrolls to the true page bottom and still measures cleanly.
- Horizontal snap strip intact: `e2e/fold8-scroll-reachability.e2e.spec.ts` 28/28 PASS on the fix branch, including "strip horizontal snap-scroll works by real swipe (scrollLeft changes + snaps)" at 390x844.
- #1590 dead-zone: the 640-1023 × 620-750 band sweep (incl. 840x660) all reachable — no dead-zone recreated by the `padding-bottom` reserve.
- #83 opened body: AC2 GREEN both branches (above).

## Monotonicity (#1590)

globals.css is purely additive (80 insertions, 0 deletions). The only override arms (`.ak-shelf` margin→0 + position:fixed, `.ak-shelf__summary` padding-top, `.ak-strip.ak-board` padding-bottom) are ALL media-scoped to `max-width:639.98px` and disjoint from the ≥640px tiers. The stronger claim (pinned/reachable at <640) wins only where intended; nothing load-bearing at ≥640 is erased (proven by AC3 + the desktop non-leak check).

## Privacy scan (per docs/privacy-scan-invocation-contract.md)

Ran `bash scripts/privacy-scan.sh --working <each of the 8 PR files>` (wrapper-immune, `command grep` for isolation). Aggregate verdict: `DIRTY (home-path matches=1, brand matches=0, email matches=0, credential-secret matches=0, scan-cmd-fragment matches=0)`. The lone home-path match is a `<macos-home-path>/<fictional-name>/`-shaped fragment at `.github/workflows/ci.yml` — a FICTIONAL placeholder (a made-up name, not the operator), PRE-EXISTING on master (`git show dd59d07:.github/workflows/ci.yml` carries it; the PR adds no home-path line), inside a comment documenting a redaction fixture; the repo's own CI privacy gate explicitly excludes this file (`':(exclude).github/workflows/ci.yml'`). Every PR-ADDED file (plan/reviews/design/globals.css/e2e spec) scans CLEAN. Positive control: a seeded `<macos-home-path>/<name>/<secret-path>`-shaped needle in a previously-CLEAN copy → `DIRTY (home-path matches=1)`, exit 1 — instrument had power. No employer-brand / email / credential token anywhere. **This PR introduces zero privacy leaks.**

## Named-risk note dispositions (carried by plan-review, bound by id)

DISPOSITION nr-2499-occlusion addressed — executor added a bottom-space reserve (`.ak-strip.ak-board { padding-bottom: 72px }`, ~72px vs the bar's ~50-60px footprint) AND a mechanical AC1b assertion (`lastCardBox.bottom <= shelfBox.top + 1`). I independently ran AC1b on the fix branch (scrolls to true page bottom): PASS. ui-evolve R3 corroborates on the production screenshot.
DISPOSITION nr-2499-desktop addressed — the position rule is media-scoped to `@media (max-width: 639.98px)` ONLY (confirmed in the diff — one block, no unconditional rule). AC3 768x1024 passes identically on both branches, and my throwaway computed-position leak-check with a positive control measured `.ak-shelf` position = `static` at 1440x900 and 768x1024 but `fixed` at 344x882 — no leak above the phone tier, and the control proves the check can detect `fixed`.
DISPOSITION nr-2499-red-genuine addressed — I reproduced the master RED myself: `summary.top=5499.75 >> innerHeight=882` (~4618px margin), with the spec self-asserting 41 `todo` cards AND a column >2× viewport height (both PASS on master). A shrunk fixture would fail the self-assertion loudly; the RED is not a dead control.

## Pre-merge action items (ship-mechanics, not AC defects)

1. **Ticket metadata wiring:** `hooks/ui-task-gate.sh` reads artifact paths from ticket `metadata` (`ui_evolve_verdict` / `design_brief` or `design_pov` / `interaction_test`). Ticket `2499.json` currently cites NONE of these keys, so the gate will (correctly) block `TaskUpdate→completed`. The orchestrator must set those three metadata keys to the artifact paths before completing #2499. (Artifacts themselves are all present + well-formed.)
2. **Re-bind the prod-build marker:** committing this verdict changes the PR head sha off `d5958b3`; the existing `production-build` marker binds to `d5958b3`. Ship-tail must re-run `prod-build-marker.sh` against the FINAL head sha before `gh pr merge` (already acknowledged in the PR body).

## Verdict

All four Binary AC independently verified (AC1 genuine RED→GREEN, AC2/AC3 GREEN on both branches, AC4 four real artifacts). The sticky→fixed pivot is sound and media-disjoint; monotonicity holds; privacy clean; all three named-risk notes disposed. Ready for cross-repo ship (agent-kanban PR #84, base master, real-CI merge-gate class) once the two ship-mechanics items above are done.

Decision: PASS
