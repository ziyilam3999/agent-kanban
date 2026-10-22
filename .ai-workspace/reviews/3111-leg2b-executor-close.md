# #3111 leg 2b executor close (run 1, 2026-10-22)

PR (draft, unmerged): https://github.com/ziyilam3999/agent-kanban/pull/96
Branch 3111-leg2b-referee; first checkpoint 89856c6 pushed, close-file commit follows.

## Premise-check result (dispatch first step)

The plan named four overlay blocks plus the "newer round wins" pass in `scripts/board-live-push.mjs`; master had since changed the file in #3272, #3278, #3290. Where each lives now (measured at 912f8ff before my diff):

| overlay the plan names | where it lived | disposition |
|---|---|---|
| `flowOf` pass | `const FLOW` + `flowOf()` (old lines 130-148) | deleted |
| kanban-parity block | `let kb … const PIPE … if (kb) {…}` (old lines 201-234), SHAPE DRIFT: #3272 tracked `scripts/kanban-lanes.ts` and pointed the block's tsx spawn at it (the plan knew only the untracked live copy); the block contained the "A newer round wins" pass (old lines 219-231) | deleted together with the `--kanban-json` seam AND the tracked `scripts/kanban-lanes.ts` (adapted deletion step — the tracked selector existed only to feed the block); the #3272 size smoke's selector/deploy-join arms re-pointed |
| status-tables stopgap | "Stopgap until #3098" block (old lines 235-250) | deleted |
| orchestrator-lane override | "Orchestrator-run lanes" block (old lines 251-261) | deleted |
| "newer round wins" pass | inside the kanban-parity block (above) | deleted with it; the sibling ledger-driven #3073 "rework resets later steps" pass (old lines ~318-331), which rewrote the same `flow` field, is deleted too (adaptation, recorded here) |

Later fixes kept intact: #3272/#3278 size caps and all-or-nothing pre-push body checks, #3290 focus-join fail-loud guards, #3272 #4 focus-list split, #3244 wiki links, unknown-flag guard. The #3290 fail-loud smoke is adapted (its stub status-tables gains the pool-count shape + a stub lane-state reader; `--kanban-json` dropped from its invocations; its must-fire grep accepts the new `lane-referee-failed:` line for the dead-status-tables arms — same abort class, all fail-loud assertions unchanged, and the `BASE_MJS` #4-body equivalence arm still passes against the origin/master blob).

## What was built

`scripts/board-live-push.mjs`: lanes/shipTail/laneCounts/stage/seat/model/effort come only from ai-brain `status-tables --json`; per-ticket `state`/`tailOpen`/`since` (and `legMerged`, D4) from the lane-state reader (`hooks/lane-state.mjs`); both readable through file seams `--status-tables-json` / `--lane-state-json`. Summary gains `shipTail`, `laneCounts {work, workCap, shipTail, shipTailCap}`, per-row `state`/`legMerged` (key present only when true), `laneSource: "lane-state"`; D6 list placement (`columnOfRef`) derives from reader state, never board.json. `laneCap` is the referee's work ceiling (no resolve-mode spawn, no literal). Deleted besides the overlays: `stageOf` + the `lastLedgerRow`/`ROLE_ORDER` cross-repo import, `zaiModel`/`planFor`/`execModel`, the `recent`/`live`-from-ledger lane construction, `kb.shelf` (shelf kinds now a board-side count of non-work kinds), the resolve-mode laneCap spawn. Fail-closed: missing/unreadable/garbled seam file, dead spawn, payload without `lanes.rows`/`tickets`, over-bound input (4 MiB seam file, 1000 lane rows, 5000 reader tickets), pool counts disagreeing with rows, or an id in both pools → `lane-referee-failed: …` on stderr, exit 1, no summary on stdout, before any upsert.

## AC results (command, rc, observed)

| AC | command | rc | observed |
|---|---|---|---|
| AC3/AC4 | `BOARD_AI_BRAIN=<ai-brain> bash __tests__/board-live-push-parity-smoke-test.sh` (arm A = AC3's exact command on `tests/fixtures/board-truth`) | 0 | laneSource lane-state; lanes [9301,9412,9414,9415] == AC1's held set; shipTail [9302,9411], stages begin `ship-tail`; 9410 in neither list, rows `legMerged: true`, column in_progress; laneCounts {work:4,workCap:4,shipTail:2,shipTailCap:2}; lanes.length 4 <= laneCap 4; 9301 stage `suite running`, rows entry in_progress although board.json says in_review; 9413 failed-back-to, no legMerged key |
| AC20 | same smoke (arm B: ai-brain cadence ledger/tasks at run time + committed `cadence-board.json`) | 0 | lanes [9304,9305]; shipTail []; 9303 legMerged true, in neither list; 9304/9305 no legMerged key, In-progress; laneCounts {2,4,0,2} |
| AC6 new side | `node -e` diff of the fixture A dry-run vs ai-brain `expected-old.json` | 0 | all three keys differ: 9410 live true → absent+legMerged; 9411 cur execution-review → `ship-tail open — waiting-to-merge`; lanesPublished 6 → 4 |
| AC7 agent-kanban arm | `command grep -c "flowOf\|A newer round wins\|kanban-lanes\|computeActiveIds\|lastPer\[" scripts/board-live-push.mjs` | 1 (count 0) | 0 matches; `node --check` rc 0; `git ls-files scripts/board-live-push.mjs` prints the path |
| fail-closed + seam | referee smoke arms C/D/E | 0 | committed synthetic seam fixture deep-equals `expected-summary.json`; 8 must-fire shapes abort rc 1 with `lane-referee-failed:` and empty stdout; empty referee = legal quiet board (0 lanes, zero counts, no invented state, columns pass through) |
| regressions | `bash __tests__/board-live-size-smoke-test.sh`; `bash __tests__/board-live-push-failloud-test.sh` (+ `BASE_MJS=<origin/master blob>`); `npx jest` | 0 / 0 / 0 | summary 32183 B (cap 48000), details 31328 B (target 50000), pre-fix RED controls still fire (66472 B / 87494 B aborts); fail-loud all arms green incl. #4-body byte-equivalence vs base; jest 53 suites / 545 tests pass |

## Fix contract

- RULE: the board shows only what the lane referee says; no second set of rules on the board side can change a lane, stage or count — every board-side lane rule in the push path is deleted, and a dead/lying referee aborts the push instead of being patched over.
- SIBLING-SEARCH: `grep -rln "currentStageIndex\|computeActiveIds\|deriveLanes\|in_review\|laneCap\|stage" scripts lib app components --include=*.ts --include=*.tsx --include=*.mjs --include=*.sh` → 17 files. CHANGED: `scripts/board-live-push.mjs` (the push path; the only lane/column logic left is the D6 mapping off the reader's own state fields). LEFT, with reason: `lib/active.ts`, `lib/lanes.ts`, `lib/stage-bar.ts`, `lib/build-board.ts`, `lib/board-schema.ts`, `lib/ui-meta.ts`, `components/*` (the Vercel kanban page's render-time selectors — the paid kanban this ticket switches off; out of Leg 2b's push-path scope, retired by the AC14 audit); `scripts/lanes-live.ts` (the #1901 test oracle CLI, driven only by `__tests__/ledger-only-lane-export.test.ts`, never by the push path); `scripts/ac0-1980-…-audit.ts`, `scripts/ac0-real-hook-…smoke.sh`, `scripts/ac10-cross-repo-outcome-smoke.sh` (audit smokes over the page selectors, same switch-off scope); `scripts/export-board.ts` / `scripts/on-task-change.sh` (column COUNT summary statistics of board.json only — no lane/stage decision). Also `grep -n "column" scripts/export-board.ts` → 2 hits, both count-only.
- HELD-OUT (own variants, on synthetic fixtures, none taken from a review round): must-fire — status-tables seam file missing; seam file garbled (`{`); payload without lanes.rows; seam file over the 4 MiB bound; referee counts disagree with its rows; ticket in both pools; lane-state seam missing; reader payload without tickets. Must-not-fire — committed synthetic fixture run (deep-equal); empty-but-valid referee (quiet board); open-tail row lands Review with no legMerged invented; board column passes through when the reader has no state for the ticket.
- PR-TABLE (observed column = measured command + exit code):

| variant | direction | expected | observed |
|---|---|---|---|
| `--status-tables-json` → nonexistent path | must-fire | rc 1, `lane-referee-failed: --status-tables-json seam unreadable: ENOENT`, empty stdout | smoke arm D: rc 1, exact line, stdout empty |
| seam file containing `{` | must-fire | rc 1, `…payload is not valid JSON` | rc 1, exact line |
| payload `{"focus":{}}` (no lanes.rows) | must-fire | rc 1, `…payload has no lanes.rows` | rc 1, exact line |
| 5 MiB seam file | must-fire | rc 1, `…5242946 bytes (bound 4194304)` | rc 1, exact line |
| work.n=2 with 1 work row | must-fire | rc 1, `…counts (2 work, 0 ship-tail) disagree with its rows (1, 0)` | rc 1, exact line |
| same id in work + ship_tail rows | must-fire | rc 1, `…is in both the work and the ship-tail pool` | rc 1, exact line |
| `--lane-state-json` → nonexistent path | must-fire | rc 1, `--lane-state-json seam unreadable: ENOENT` | rc 1, exact line |
| reader payload `{"held":[]}` (no tickets) | must-fire | rc 1, `…no tickets map` | rc 1, exact line |
| committed seam fixture (full run) | must-not-fire | rc 0, deep-equals expected-summary.json | rc 0, deep-equal |
| empty referee (rows [], tickets {}) | must-not-fire | rc 0, 0 lanes, counts {0,caps,0,caps}, no legMerged anywhere | rc 0, all four hold |
| fixture A frozen chain (spawn path) | must-not-fire | rc 0, AC4's pinned values | rc 0, all pinned values |
| cadence fixture B (spawn path) | must-not-fire | rc 0, AC20's pinned values | rc 0, all pinned values |

- INPUT-BOUND: seam files refused over 4 MiB (fs.statSync before read), lane rows refused over 1000, reader tickets refused over 5000, spawn outputs bounded by execFileSync's 20 s timeout and 1 MiB maxBuffer; every bound fails CLOSED (`lane-referee-failed:` + exit 1 before any body build or upsert) — the class cannot loop (single read, no recursion), cannot DoS past the bound (refusal precedes the read), and cannot fail open (no fallback rule set exists to fall back to).

## Changed files

`scripts/board-live-push.mjs` (referee rewrite, overlays deleted); `scripts/kanban-lanes.ts` (DELETED — #3272's tracked selector, dead with the parity block); `__tests__/board-live-push-parity-smoke-test.sh` (re-pointed: referee arms A/B/C/D/E + AC7 arm, #3244 wiki arms kept); `__tests__/board-live-size-smoke-test.sh` (selector arms removed, laneSource arm re-pointed, `--kanban-json` dropped from live-script invocations; pinned pre-fix RED controls untouched); `__tests__/board-live-push-failloud-test.sh` (stub carries the referee shape + stub reader; referee abort accepted; #4-body-only BASE_MJS equivalence); `__tests__/fixtures/board-live-referee/**` (new committed synthetic seam fixtures: board.json, status-tables.json, lane-state.json, focus/focus-progress.mjs, expected-summary.json, cadence-board.json); `.ai-workspace/plans/2026-10-15-3111-board-truth.md` (committed with the first checkpoint per dispatch).

## Suites touched

`__tests__/board-live-push-parity-smoke-test.sh`, `__tests__/board-live-size-smoke-test.sh`, `__tests__/board-live-push-failloud-test.sh` (jest untouched; `npx jest` 53/545 green). package.json unchanged.

## Privacy

`grep -c` for the home basename (plain, dash, underscore forms) over every changed file: 0 each; positive control prints 1. All fixture rows synthetic (DEMO/fake ids 98xx, 93xx mirror shapes authored from plan text); no employer name; no real project key.

## Residuals

ai-brain still lacks `tests/fixtures/board-truth/expected-board.json`, `cadence/expected-board.json` and `cadence/board.json` (recorded "pending for Leg 2b" by the leg 1a/2a reviews) — this leg's diff stays in agent-kanban (cross-repo at RUN time only), so those deep-equal files need an ai-brain-side commit (operator or sanctioned cross-repo step; leg 2a precedent ai-brain PR #1887). Until then AC3/AC20's deep-equal is covered by the referee smoke's pinned-value arms and the committed expected-summary.json. `scripts/lanes-live.ts` + `lib/` selectors remain for the Vercel page (switch-off audit AC14 retires them).

override env vars used: none
