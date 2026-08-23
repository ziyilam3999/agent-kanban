# Execution-review — board-inprogress-recency (PR #70)

Decision: PASS

Role: execution-review (stateless, independent — did NOT write this code). Reviewer verified every
Binary AC against the actual diff + a live-run of the tests, not the executor's prose.

- PR: https://github.com/ziyilam3999/agent-kanban/pull/70  (branch `board-inprogress-recency` → master)
- Head reviewed: 9a3f8d3 "fix(build-board): gate pending→in_progress promotion on comment recency"
- Plan (authoritative): `.ai-workspace/plans/2026-08-23-board-inprogress-recency-guard.md` → `## Round 1 fold — FINAL SPEC`
- cairn: `node skills/cairn/bin/cairn-find.mjs "recency"` →
  `[T1] .../2026-08-23/6bae4820-...jsonl:256` "When a UI/board rule marks an item 'in progress' based on
  'was ever touched' … use the timestamp of the actual event (last log/comment) as a recency signal" —
  directly endorses this fix's signal choice.

## Named-risk notes (receiving-end duty, #2434)
`node hooks/named-risk-notes.mjs list --task board-inprogress-recency` → `NO-NOTES board-inprogress-recency`.
Nothing was carried for this task; disposition duty skipped (no notes to disposition).

## Diff scope (verified vs origin/master)
5 files: `lib/build-board.ts` (+45), `scripts/export-board.ts` (+10/-5), `__tests__/build-board.test.ts`
(+112), `__tests__/board-inprogress-recency-export.test.ts` (new, +195), and the plan `.md` (role
artifact). `lib/lanes.ts` UNTOUCHED. `lib/active.ts` NOT modified — import-only (`INFLIGHT_LANE_CAP_MS`
imported into build-board.ts). No require cycle: active.ts imports only `./board-schema` + `./ui-meta`,
and build-board.ts already imports `./ui-meta`. buildTicket caller inventory confirmed independently: 17
pre-existing test files + 2 scripts; the `scripts/ac0-1980-…-audit.ts` caller is untouched and relies on
the fail-safe (omit nowMs → old behavior).

## Per-AC verdicts

### AC-1 — promotion expires (stale pending→todo; fresh pending→in_progress): PASS
- Unit (build-board.test.ts, 78/78 green): AC-1 stale (comment `INFLIGHT_LANE_CAP_MS+60s` before nowMs)
  → `todo`; AC-2 fresh (60s before nowMs) → `in_progress`; boundary case (exactly AT the cap, `<=`
  inclusive) → `in_progress`.
- `toColumn` signature UNCHANGED (only its doc comment tightened "ever"→"recently"); param semantics
  preserved — `toColumn("pending", …, true)` still returns `"in_progress"`.
- Also proven end-to-end through the real export (see AC-5).

### AC-2 — non-pipeline / no-comment unaffected: PASS
- "stale pipeline comment PLUS a fresh orchestrator-only comment still stays todo" (orchestrator excluded)
  → green. AC-4 test: pending + zero comments → `todo`. Unparseable `ts` → treated as no-signal → `todo`.

### AC-3 — genuine status==="in_progress" unaffected: PASS
- Unit: `status==="in_progress"` stays `in_progress` regardless of comment age (even with nowMs supplied),
  and with zero comments. Integration: LIVE ticket (in_progress, comment 6h+past cap) stays in_progress.
- Live board: all 114 in_progress-column tickets are `status==="in_progress"` — untouched by the gate.

### AC-4 — FAIL-SAFE back-compat (buildTicket WITHOUT nowMs reproduces old ever-touched promotion): PASS
- Code: `nowMs === undefined ? ledgerLines.some(PIPELINE_ROLE_SET) : <recency-gated>`. Unit AC-4:
  buildTicket without nowMs → very-stale pending still `in_progress` (ever-touched); pending + no comments
  → `todo`. This is the load-bearing back-compat for the 19 non-updated callers (17 test files + the
  ac0-1980 audit script) — all omit nowMs and keep current columns. Verified those files are NOT in the
  diff, so they stay behaviorally identical.

### N3 / AC-5 — inertness guard + real-export invariant (MOST IMPORTANT): PASS
- Threading is REAL, not inert. `scripts/export-board.ts:243` `const now = Date.now()` (captured once,
  same clock as `buildSessionSummary` and `generatedAt`, N2 satisfied) is threaded as the 6th `buildTicket`
  arg at `:288`. Verified by reading the file, not just the diff.
- INDEPENDENT MUTATION PROOF: removed `now` from the export call → the AC-5 hermetic integration test
  turned RED ("Expected: todo, Received: in_progress" — STALE ticket came back in_progress, the exact N3
  failure mode). Restored the file (`git checkout`), tree clean. This proves the AC-5 test genuinely
  detects a forgotten thread-through — it is NOT a fix-that's-inert-while-units-pass.
- AC-5 hermetic integration test (spawns the REAL export script) green: stale-pending→todo,
  fresh-pending→in_progress, live-in_progress→unaffected; invariant (b) holds; in_progress = exactly the
  recent/live tickets.
- LIVE-DATA sanity check (ran the real exporter over `~/.claude/tasks`): invariant (b) — every
  in_progress-column ticket is `status==="in_progress"` OR (`pending` AND ≥1 pipeline comment within
  `INFLIGHT_LANE_CAP_MS` of `generatedAt`) — holds with **0 violations** across 114 in_progress tickets.
  The fix is ACTIVELY working: **21 live pending tickets** have only stale (>6h) pipeline comments; pre-fix
  all 21 would be promoted to in_progress, post-fix ALL 21 are correctly in the `todo` column and **0**
  stale-pending remain in in_progress.
- On the "in_progress dropped ~25→6 / < 23" claim: the live board has grown massively since the plan
  snapshot (done 1094 vs plan-time 589 — a much larger all-sessions population), and now legitimately has
  114 `status==="in_progress"` tickets, which the recency gate does not touch (AC-3). The absolute "< 23"
  clause is the mutable-count pin Round-1 plan-review explicitly flagged (B2) and is moot on today's board;
  the non-fragile, load-bearing AC — invariant (b) + real threading — is fully met. Not a fix defect.

### AC-6 — suite green (`npm test`): PASS
- Full jest suite on the PR branch, with a valid environment (node_modules symlinked): **438 passed /
  438 total, 0 failures.**
- The executor's reported "5 fail in board-freshness-watchdog.test.ts" is an ENVIRONMENT artifact, NOT a
  diff regression and NOT a logic failure. Root cause proven: the PR-branch worktree had **no
  `node_modules`**, so the watchdog test's hardcoded `node_modules/.bin/tsx` spawn path (line 172) was
  ENOENT → `spawnSync` returned `status: null` immediately (1 ms, not a 30s timeout) → 5 assertions on
  `r.status === 0` failed. Evidence: (a) the failing test imports ONLY `../lib/board-freshness`, none of
  the changed code, and is byte-identical to origin/master (`git diff origin/master…HEAD` on the test +
  its dep is empty); (b) the failures are immediate ENOENT, not timeouts; (c) symlinking node_modules into
  the worktree → all 438 pass. (Note: my initial "master green vs PR red" full-suite comparison was
  confounded because I had symlinked node_modules into the master check-worktree but not the PR worktree;
  correcting that made the PR suite fully green.) The executor's "pre-existing" wording is imprecise, but
  the conclusion — the diff does not cause these — is correct.

### Scope: PASS
Only lib/build-board.ts + scripts/export-board.ts + the two test files (+ the plan artifact). lanes.ts
untouched; active.ts import-only; no require cycle.

### Privacy: CLEAN
Followed the invocation contract: named paths + reported scanner verdict + positive control. Ran the
repo's CI privacy patterns (`.github/workflows/ci.yml` privacy job) over the changed files.
- Home-path class over the non-exempt changed files (`lib/build-board.ts`, `scripts/export-board.ts`, the
  plan `.md`): `git grep -nIE '(/Users/|/home/|…)…'` → **rc=1 CLEAN**. Positive control:
  `/Users/alice/secret/plan.md` MATCHES the same pattern (rc=0) — scanner proven live.
- `build-board.test.ts`'s `/Users/alice/` occurrences are synthetic redaction-test fixtures that CI
  intentionally exempts (`:(exclude)__tests__/*`); the new integration test uses `os.tmpdir()` — no
  hardcoded home path.
- Real blob-host class over changed files → no real `*.public.blob.vercel-storage.com` (positive control
  `abc123.public.blob.vercel-storage.com` MATCHES the pattern). Board-snapshot / board.json classes:
  structurally clean (diff adds no `data/` files, no board.json).

### Monotonicity checklist (#1590): no violation
The diff STRENGTHENS the pending→in_progress promotion ("ever touched" → "touched within
INFLIGHT_LANE_CAP_MS") — and ONLY when `nowMs` is supplied. Stronger claim = the recency-gated promotion,
which production (`export-board`, the only opt-in caller) uses. Weaker claim = the ever-touched promotion,
which survives ONLY for the ~19 un-updated callers via the explicit `nowMs === undefined` fail-safe — this
is intentional back-compat (a different call passing a different arg), and it cannot erase the stronger
claim (production always passes nowMs). No clear-list / mutual-exclusion / last-writer-wins arm is touched;
the `in_progress` / `completed` / `in_review` (#1410 monotonic) branches are untouched, so the weaker prior
cannot erase the stronger #1410 in_review handling (disjoint branch).

## Bottom line
Every Binary AC in the FINAL SPEC is met and independently verified (unit + hermetic integration + a
mutation proof of the N3 threading + a live-data invariant check showing 21 stale-pending tickets correctly
demoted with 0 invariant violations). Suite is green (438/438) in a valid environment; the executor's 5
"failures" are a worktree node_modules artifact, not a regression. Scope, privacy, and monotonicity all
clean. Ship.
