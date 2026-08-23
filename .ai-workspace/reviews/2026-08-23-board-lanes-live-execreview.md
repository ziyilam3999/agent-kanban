# Execution-review — board-lanes-live (PR #71)

Task: `board-lanes-live` | Repo: agent-kanban | PR: https://github.com/ziyilam3999/agent-kanban/pull/71
Branch `board-lanes-live` -> master. Reviewer: independent execution-review seat (did NOT author or
implement this change). Every Binary AC and every carried named-risk note was verified by executing
checks against the actual diff, not by trusting the executor's prose.

## Decision: PASS

cairn: query "punch" matched — "Punch-out-gated liveness (board closedAt punch-ins) lies forever for
abnormally-[closed agents]" (t1-run-scratch/2026-07-26/ee426cae….jsonl:374) and "Fable-5 audit
confirmed the agent-kanban 'N LANES LIVE' pill can sho[w an inflated count]" (2026-07-24 jsonl:377)
— the exact over-count class this fix targets, already stoned. The fix's own primary killer
(role-blind closedAt) is the render-side answer to the "abnormally-closed / mis-filtered close-stamp"
weak edge those stones name.

## Named-risk note dispositions (receiving-end duty, #2434)

Two notes were carried to this seat (`named-risk-notes.mjs list --task board-lanes-live`):

DISPOSITION board-lanes-live-nrn1-artifact-receipt addressed — `hasOutcome()` (truthy
`c.artifact` OR non-empty `c.verdict`) is consumed ONLY in the agentId-LESS individuation branch,
in BOTH functions: `pipelineHasOpenPunchIn` (`} else if (!c.closedAt && !hasOutcome(c))`, the `else`
after `if (c.agentId)`) and `openPunchInClock` Pass-2 (`c.agentId ? !(agentClosedAnywhere.get(id))
: !c.closedAt && !hasOutcome(c)`). An agentId'd row's liveness is decided ENTIRELY by disjunct-1's
role-blind `buildAgentClosedAnywhere` (closedAt), never by artifact presence. Independently
witnessed with a throwaway probe: an agentId'd `executor` row carrying `artifact_path` but NO
`closedAt` anywhere, `updatedAt` 200 min ago (outside the 8-min recency window so recency cannot
mask it), STAYS LIVE (chainInFlight true, in computeActiveIds, openPunchInClock returns its ts). A
long silent mid-flight executor leg carrying an artifact is NOT darkened inside the 6h cap. The
note's FALSIFICATION trigger ("diff darkens an agentId'd role that has an artifact but no closedAt
for >8min") does NOT occur in this diff. The residual (a role self-appending its artifact seconds
before SubagentStop, bounded to the 8-min window) is the accepted disjunct-3 tail the plan documents.

DISPOSITION board-lanes-live-nrn2-roleblind-closedat-reuse observed-in-diff — the diff implements
role-blind closedAt EXACTLY as the note describes: `buildAgentClosedAnywhere(t)` scans EVERY comment
regardless of role (`if (!c.agentId) continue;` then `already || !!c.closedAt`), so ANY closedAt on
ANY row for an agentId marks that agent permanently stopped. The note's safety assumption (a later
row reusing an agentId after that agent's close is always attribution/reconcile — `run_source:
reconcile-spawns` — never a genuinely-live NEW role) is a WRITER-side property that this render-side
diff cannot and does not change; plan-review re-derived it against the live ai-brain ledgers and found
it holds today. The note's FALSIFICATION trigger ("a writer ever reuses one agentId for a
genuinely-live LATER open role after an earlier role for that same agentId already carries closedAt")
is a future writer-side change, not present in this diff. The long-term fix (writer-side ai-brain
hygiene — stamp closedAt / non-pipeline marker on bookkeeping appends at write time) is the plan's
carried deferred-follow-up. No present defect; not a block.

## Binary AC — verified by execution

Ran `npx jest` in the worktree: **44 suites, 436 tests, 0 failures** (baseline 429 + 7 new = 436,
arithmetic confirmed). The new file adds exactly 7 tests; no existing test file is modified (PR file
list: plan ADDED, `__tests__/lane-bookkeeping-punch-out.test.ts` ADDED, `lib/active.ts` MODIFIED
+80/-27) — AC-6 satisfied.

- **AC-1** (measured 1658-guard-build shape: agentX closed `research` + open artifact-bearing
  `planner`; agentY closed `plan-review` PASS) -> DARK: `chainInFlight` false, absent from
  `computeActiveIds`, no `deriveLanes` lane. PASS. Direction correct (NOT a lane). Traced: agentX &
  agentY both in `pipelineAgentIds`, both `agentClosedAnywhere=true` (research/plan-review closedAt)
  -> predicate returns false; focus disjunct withheld by `!hasAnyPipelineComment` narrowing; recency
  withheld (updatedAt outside window).
- **AC-2** (agentId-less open pipeline row bearing an artifact) -> DARK. PASS. Direction correct
  (`hasOutcome` true on the agentId-less row -> not an always-open unit).
- **AC-3** (agentId'd row, no closedAt anywhere, no outcome, ts in cap) -> STILL a lane. PASS.
  Direction correct (STILL a lane).
- **AC-4** (bare agentId-less AND outcome-less `{role, ts}` placeholder) -> STILL a lane. PASS.
  Direction correct — proves discrimination is on outcome evidence, not agentId presence; #1980
  degraded-spawn back-compat preserved.
- **AC-5** (lockstep) — AC-1 fixture: `chainInFlight` false AND `openPunchInClock` undefined; AC-3
  fixture: both report the open unit. PASS.
- **AC-6** — full suite green, no existing test modified. PASS.

## ANTI-VACUITY (independently reproduced)

Reverted `lib/active.ts` in the working tree to the pre-fix parent (`eff224e:lib/active.ts`) while
keeping the new test file, then ran the new suite:

- **AC-1 FAIL**, **AC-2 FAIL**, **AC-5 (AC-1 fixture arm) FAIL** — all at
  `expect(chainInFlight(ticket)).toBe(false)` with `Received: true` (the exact false-live bug: the
  old per-agentId scan filters the `research` close-stamp before the closedAt scan, so the agent
  reads punched-IN).
- **AC-3 PASS**, **AC-4 PASS**, **AC-6 sanity PASS** — direction-2 controls pass on BOTH old and new
  code, so they are held-out answer-key controls, not co-moving witnesses.

The tests genuinely discriminate old (buggy) from new (fixed) code — non-vacuous. Restored the fix;
verified the working tree is byte-identical to committed HEAD (`b71dcdd:lib/active.ts`) and `git
status --porcelain` is empty.

## G1 (lockstep) — CONFIRMED

The role-blind closedAt logic is a SINGLE shared helper `buildAgentClosedAnywhere(t)` called by BOTH
`pipelineHasOpenPunchIn` AND `openPunchInClock` Pass-1 (not hand-duplicated). Pass-2 individuation is
verbatim-identical between the two: agentId'd row open iff `!agentClosedAnywhere.get(id)`;
agentId-less row open iff `!c.closedAt && !hasOutcome(c)`. Divergence is structurally impossible.
AC-5 is the witness and passes.

## G2 (fixture window) — CONFIRMED

`buildTicket(rawTask, ledgerLines, mtimeMs, sessionId?, ledgerMtimeMs?)` — 3rd arg `mtimeMs`
becomes `ticket.updatedAt`. AC-1/AC-2 pass `NOW - OUTSIDE_WINDOW_MIN*MIN` where
`OUTSIDE_WINDOW_MIN = ACTIVE_WINDOW_MS/MIN + 20 = 28 min` (ACTIVE_WINDOW_MS = 8 min), while every
open-row `ts = WITHIN_CAP_MIN = 90 min` (inside the 6h INFLIGHT_LANE_CAP_MS). computeActiveIds
disjunct-3 (`nowMs - t.updatedAt <= windowMs`) therefore does NOT re-light the ticket, so the
"absent" assertion isolates the punch-in fix. Corroborated by anti-vacuity: the old-code failure
lands on the recency-independent `chainInFlight` assertion, proving recency is not masking a false
green.

## Monotonicity checklist (#1590)

- **`agentClosedAnywhere` OR-accumulation** (`already || !!c.closedAt`, per agentId, order-independent):
  stronger claim = "stopped"; weaker = "open". The final loop returns live only when
  `!agentClosedAnywhere.get(id)`, so a single closedAt on ANY row absorbs — a later open-looking row
  for the same agentId CANNOT erase it. Weaker cannot overwrite stronger.
- **agentId-less units stay independent** — `hasOutcome` darkens only the row that itself bears the
  outcome; a sibling agentId-less receipt (M2) does NOT erase a bare outcome-less placeholder (AC-4)
  on the same ticket. Cross-row, the stronger "receipt/done" does not over-reach into an unrelated
  live unit. Correct: a live degraded-spawn role alongside a finished orchestrator note keeps the
  lane lit.

## Scope + privacy

- PR touches exactly 3 files: `.ai-workspace/plans/2026-08-23-board-lanes-live-punchin.md` (ADDED),
  `__tests__/lane-bookkeeping-punch-out.test.ts` (ADDED), `lib/active.ts` (MODIFIED). `lib/lanes.ts`
  and `lib/build-board.ts` are UNTOUCHED — no conflict with board-inprogress-recency / PR #70. Base
  master, mergeable.
- Privacy scan per `docs/privacy-scan-invocation-contract.md`, canonical scanner
  `scripts/privacy-scan.sh --working`:
  - Paths scanned: the three diff paths above (plan, test, `lib/active.ts`).
  - Verdict line: `privacy-scan: CLEAN mode=working size=57053` (rc=0) — non-zero size, real content.
  - Positive control (same `--working` shape on a scratch copy with a seeded home-path needle):
    `privacy-scan: DIRTY (home-path matches=2, brand matches=0, email matches=0)` (rc=1) — instrument
    has power against this artifact's own match class, so the CLEAN result is evidence.

## Verdict

Decision: PASS. All six Binary AC pass on the fix and are non-vacuous (proven by the pre-fix red
reproduction with held-out controls). G1 lockstep shares one helper; G2 window is correctly outside
the recency window; the NRN-1 load-bearing safety property (artifact never darkens an agentId'd row)
holds by construction and by independent witness; NRN-2 is faithfully implemented with its residual a
carried writer-side follow-up. Scope is confined and privacy-clean.
