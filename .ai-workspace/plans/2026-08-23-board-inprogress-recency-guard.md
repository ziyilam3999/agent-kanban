# Board in-progress column — recency guard on the pending→in_progress promotion

## ELI5
The board has one rule that says: *"if a ticket ever had a pipeline robot (planner / plan-review / executor / execution-review) touch it, show it as In-Progress."* It never checks **when** the robot last touched it. So a ticket a lane worked once — then abandoned days or weeks ago — sits in the In-Progress column forever. Today that inflates In-Progress to **23** when only **4** lanes are actually live (the other 19 were last touched 1–19 days ago). The fix: the "started" promotion only counts when a pipeline robot touched the ticket **recently**. A stale started-but-idle ticket falls back to To-Do, where it belongs.

## Execution model
**subagent (delegate).** Rationale: a single coherent write surface (the export-time column-classification logic in `lib/build-board.ts` + its exporter caller + the two test files), briefable from this plan's Binary AC with no live-session coupling — so it goes to one executor after a plan-review PASS, then an independent execution-review. Not inline (>10 LOC across 3+ files + a board-semantics decision, past the trivial-skip bar); not phased (one atomic change).

## Problem (measured 2026-08-23)
- Deduped board columns: todo 539 · in_progress **23** · in_review 1 · done 589.
- Of the 23 in_progress: **4** have `status==="in_progress"` AND a pipeline comment < 1.5h old (the genuinely-live lanes: `1658-guard-build`, `1658-SL-2`, `1660-scanner-build`, `1660-SL-2`). The other **19** are `status==="pending"` (or a stale `in_progress`) whose newest pipeline-role comment is **24.5h – 456h (1–19 days) old**.
- Root cause: `lib/build-board.ts` `toColumn` — the `pending` branch returns `hasPipelineRoleComment ? "in_progress" : "todo"`, and `buildTicket` computes `hasPipelineRoleComment` as *"any pipeline-role comment EVER"* (`ledgerLines.some(l => PIPELINE_ROLE_SET.has(l.role))`) — with no recency term. (#1304 added the promotion; it was never given an expiry.)
- Empirical gap is clean: newest-pipeline-comment age is **<1.5h for all 4 live** and **>24.5h for all 19 stale** — no ticket sits between, so any threshold in (1.5h, 24.5h) separates them.
- The task-file mtime is NOT a usable recency signal: editing a task JSON (e.g. moving a stale ticket to `pending`) bumps its mtime, so `updatedAt` reads "fresh" for a ticket nobody is working. The **newest pipeline-role LEDGER COMMENT timestamp vs now** is the honest "is a lane on it" signal.

## Fix (single mechanism, pure + testable)
1. Add a documented constant `IN_PROGRESS_ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000` (6h) to `lib/build-board.ts`. Rationale: comfortably exceeds a single active lane's worst-case role runtime + orchestrator turnaround (roles here run minutes–~1h, with gaps between role spawns), while sitting ~4× below the 24.5h floor at which a started-but-abandoned ticket lingers. A pending ticket whose newest pipeline comment is older than this is "started-but-idle" → todo.
2. `buildTicket` gains a `nowMs: number` parameter (the export instant — the exporter already has `Date.now()` for `SessionSummary.live`). It computes `hasRecentPipelineComment` = there exists a ledger line whose `role ∈ PIPELINE_ROLE_SET` AND `nowMs - Date.parse(line.ts) <= IN_PROGRESS_ACTIVE_WINDOW_MS` (a non-finite/blank ts is treated as NOT recent — fail-safe to todo). It passes `hasRecentPipelineComment` to `toColumn` in place of the ever-touched boolean.
3. `toColumn` signature is UNCHANGED (its 3rd param is still the promotion flag); only its meaning tightens from "ever" to "recently". Update its doc comment to say "recently" and cite the window.
4. `scripts/export-board.ts` passes `nowMs` (a single `Date.now()` captured once per export) into every `buildTicket` call.
5. The `status==="in_progress"` and `status==="completed"` branches are UNTOUCHED — the 4 live lanes (all `status==="in_progress"`) are unaffected by this change; only the `pending` promotion gains the recency term.

## Binary AC (checkable from outside the diff)
1. **Unit — promotion expires:** `toColumn("pending", "none", true)` still returns `"in_progress"` (param semantics preserved), AND a new `buildTicket` test: a pending ticket whose only pipeline comment is 7h before `nowMs` → column `"todo"`; the same ticket with the comment 1h before `nowMs` → column `"in_progress"`. RED without the fix: the 7h case returns `"in_progress"`.
2. **Unit — non-pipeline / no-comment unaffected:** a pending ticket with only an `orchestrator` comment (any age) → `"todo"` (unchanged); a pending ticket with zero comments → `"todo"` (unchanged).
3. **Integration — real export:** running the exporter over the live `~/.claude/tasks` + ledgers yields `in_progress` count **== the number of tickets with `status==="in_progress"` that are not in review** (i.e. the 4 live), NOT 23. Verify: `npm run export:board` then count deduped `column==="in_progress"`.
4. **No regression:** `__tests__/build-board.test.ts` + `__tests__/lane-pending-review-visibility.test.ts` pass (updated for the new `nowMs` param); `npm test` green. The 4 genuinely-live tickets stay `in_progress`; the 19 stale ones move to `todo`; `done`/`in_review`/`todo`-baseline semantics otherwise unchanged.

## Files
- `lib/build-board.ts` — add `IN_PROGRESS_ACTIVE_WINDOW_MS`; `buildTicket` gains `nowMs` + computes `hasRecentPipelineComment`; `toColumn` doc updated (signature unchanged).
- `scripts/export-board.ts` — capture one `nowMs = Date.now()` per export, thread into `buildTicket`.
- `__tests__/build-board.test.ts`, `__tests__/lane-pending-review-visibility.test.ts` — update `buildTicket` call sites for `nowMs`; add the recency cases (AC-1, AC-2).

## Scope boundary (clarifications — nothing deferred that needs tracking)
- The deployed Next.js render code is deliberately NOT touched: the `column` is computed at export time and baked into board.json, so a re-export + `kanban:sync` refreshes the live blob with zero Vercel redeploy. This is a property of the existing architecture, not deferred work.
- The 19 stale tickets are honest backlog and are deliberately NOT data-edited: the fix reclassifies them mechanically as todo. The 3 stale `in_progress` records already moved to `pending` this session are handled by the same recency gate.
- The `LANES LIVE` pill (5-min `LIVE_WINDOW_MS`) is already correct and unchanged.

## Deferred-follow-ups:
- none — this fix is self-contained. The "Scope boundary" items above are architectural facts / correct-by-the-fix reclassifications, not deferred work, so no follow-up task is required. If a future need arises to make `IN_PROGRESS_ACTIVE_WINDOW_MS` operator-tunable via env, file-when-triggered (no task now).

## Review

### Round 1 (plan-review, independent/adversarial — did NOT author this plan)

Decision: NEEDS-WORK

cairn: `[T1] .../2026-07-25/...jsonl:156` — "1-LANE-LIVE 2026-07-25 = #1867 recurring, live-confirmed: a PENDING execution-review…" (board lane-count false-signals are a recurring class here; the recency direction of this fix is aligned with that history). Also `[T1] .../2026-08-01/...jsonl:308` — "Board/ticket status fields (e.g. 'in_progress') can be stale even when the underlying process is dead" (directly supports the plan's root cause).

The DIAGNOSIS is correct and the recency SIGNAL is the right one. Two blockers on IMPLEMENTABILITY + AC quality must be resolved before code. Both have bounded resolutions; no redesign is needed.

**Confirmed-sound (verified against source):**
- **Check 1 (root cause) — CONFIRMED.** `toColumn` pending branch (`lib/build-board.ts:206-208`) is exactly `return hasPipelineRoleComment ? "in_progress" : "todo"`. `buildTicket` (`:335-337`) computes the flag as `ledgerLines.some((l) => PIPELINE_ROLE_SET.has(l.role))` — pure "ever-touched", zero recency term. The plan's root-cause prose matches the code.
- **Check 2 (signal choice) — CONFIRMED.** `updatedAt = Math.max(mtimeMs, ledgerMtimeMs ?? 0)` (`:347`) folds the ledger FILE mtime, which bumps on ANY append (and the task-file mtime bumps on any status edit) — so `updatedAt`/mtime is genuinely unusable as "is a lane on it," exactly as the plan argues. Using the per-comment `line.ts` is the honest signal; `newestExecutionReviewState` already does `Date.parse(line.ts)` with a NaN guard (`:294-295`), so the "non-finite ts → not recent → todo" fail-safe is implementable and has direct precedent.
- **Check 5 (purity) — CONFIRMED (given a clean signature).** Passing `nowMs` in keeps `build-board.ts` pure (matches `buildBoard`'s documented "no Date.now() inside" contract). `Date.parse(ts)` + non-finite→not-recent is safe.
- **Check 7 (regression scope) — CONFIRMED at the branch level.** The `in_progress`, `completed`, and `in_review` (#1410 monotonic) paths read `status`/`execReview` only and are disjoint from the pending-branch flag; the 4 live lanes (all `status==="in_progress"`) are structurally unaffected. The ONLY regression surface is the caller/signature issue below (Blocker 1).
- **Monotonicity (#1590):** the change STRENGTHENS the promotion condition ("ever" → "recent"); it removes tickets from `in_progress`, never adds. No clear-list / last-writer-wins / mutual-exclusion arm is touched, and the weaker prior claim cannot erase the stronger #1410 in_review handling (different branch). No monotonicity violation.

---

**BLOCKER 1 — The `buildTicket` caller inventory is incomplete and the `nowMs` signature is under-specified; as scoped, AC-4 ("npm test green") cannot hold and there is a concrete un-listed regression.**

Evidence (executed, not narrated):
- `git grep buildTicket` finds **17 test files + 2 scripts** calling it, not "export-board + 2 tests" (plan §Files / Check-4). The MISSED production/script caller is `scripts/ac0-1980-lanes-open-punch-in-clock-audit.ts:350` (a real 5-arg call: `buildTicket(task, ledger, parsed.mtimeMs, sid, ledgerMtimes.get(...))`). ~15 additional test files call it too.
- `__tests__/monotonic-flow.test.ts:83-92` (NOT in the plan's file list) asserts: `pending` task + a `planner` comment `ts: "2026-07-02T04:00:00.000Z"` → `in_progress`. `__tests__/build-board.test.ts:69` and `:83` (listed) have the same shape. So at least one un-listed test's truth now depends on the new recency semantics.
- The plan says `buildTicket` "gains a `nowMs: number` parameter" — i.e. REQUIRED. `npm run typecheck` = `tsc --noEmit`; a required positional `number` makes every non-updated call site a TS2554 arity error → typecheck RED. `jest.config.js` uses `preset: "ts-jest"` with a transform that overrides only `jsx` (not `isolatedModules` at the transform level), so ts-jest type-checks → the suite goes RED across the ~15 un-updated files as well. AC-4 is therefore unmeetable with the scoped Files list.
- Parameter POSITION is unspecified. Current signature: `(rawTask, ledgerLines, mtimeMs, sessionId?, ledgerMtimeMs?)`. Inserting `nowMs` before the two trailing optionals would break `export-board.ts:275` (positional 5-arg) AND the audit's 5-arg call. Only appending LAST is non-breaking.

Bounded resolution (pick ONE, and state it in the plan):
- **(1a) PREFERRED — optional + fail-safe-to-old-behavior.** Signature: `buildTicket(rawTask, ledgerLines, mtimeMs, sessionId?, ledgerMtimeMs?, nowMs?)`. Define the omitted-`nowMs` semantics EXPLICITLY: when `nowMs === undefined`, preserve the pre-fix ever-touched promotion (so all ~15 un-listed callers keep their current columns and stay green); when provided, apply the recency gate. `export-board.ts` passes the existing `now` (already `Date.now()` at `:243`) as the 6th arg. Files touched then really are just export-board's call + the recency assertions — the plan's §Files becomes honest.
- **(1b) enumerate + update ALL 17 test files + `scripts/ac0-1980-…audit.ts`**, and reconcile `monotonic-flow.test.ts:83`'s pending assertion with the new semantics. (Heavier; contradicts the plan's "minimal impact" framing.)

---

**BLOCKER 2 — AC-3 is pinned to a mutable live value, and its equated invariant contradicts the feature it is meant to verify.**

AC-3 asserts real-export `in_progress` count "== the number of tickets with `status==="in_progress"` that are not in review (i.e. the 4 live), NOT 23."
- "== 4" hardcodes today's live-lane count. By executor-run time the live board differs (lanes complete / new lanes start) — a correct fix could then report 2 or 7 and "fail" AC-3. This is the "never pin an artifact to a mutable value you control" anti-pattern.
- The equality "in_progress column == status-in_progress-not-in-review" is FALSE BY DESIGN whenever a `pending` ticket has a genuinely-recent (<6h) pipeline comment — which is exactly the promotion this fix exists to keep. So a correct implementation can fail AC-3, or AC-3 can pass for the wrong reason.

Keep the robust half ("count dropped from 23"). Bounded resolution (pick one):
- Reword to the real INVARIANT: real-export `in_progress` count < 23, AND every ticket in the exported `in_progress` column satisfies `status==="in_progress"` OR (`status==="pending"` AND ≥1 pipeline-role comment within `IN_PROGRESS_ACTIVE_WINDOW_MS` of the export `nowMs`). Checkable from `board.json` + ledgers, not fragile to an exact count, and not self-contradictory.
- OR replace AC-3 with a DETERMINISTIC fixture-fed integration test (synthetic `tasks/` + ledger dirs through the exporter, asserting the column counts) — removes live-data fragility entirely.

---

**Non-blocking notes (for the executor):**
- **N1 (DRY / drift):** `lib/active.ts:47` ALREADY defines `INFLIGHT_LANE_CAP_MS = 6 * 60 * 60 * 1000` (6h), with a rationale nearly identical to the plan's ("comfortably exceeds the multi-hour silent executor legs … bounding a zombie lane to under a working day"). `active.ts` imports only `./board-schema` + `./ui-meta` (no `build-board`), so `build-board` could import it with NO require cycle. Decide DELIBERATELY: reuse it, or keep a separate `IN_PROGRESS_ACTIVE_WINDOW_MS` because the axes differ (LANES-LIVE pill liveness vs pending→column promotion). Either is defensible — but the plan should acknowledge the existing 6h constant rather than silently mint a second identical magic number that can drift.
- **N2 (determinism):** `export-board.ts:243` already has `const now = Date.now()` threaded into `buildSessionSummary`/`buildBoard`. REUSE that same `now` for the buildTicket recency arg — do NOT add a second `Date.now()` (a second read makes session-liveness and column-recency use slightly different clocks within one snapshot). The plan's "single Date.now() per export" is free.
- **N3 (inertness guard — for execution-review):** under resolution 1a, if production `export-board` forgets to pass `nowMs`, the fix is fully INERT (board still shows 23) while every unit test passes — the "shipped opt-in guard = zero protection until installed" shape. Keep AC-3 real-export-based (or fixture-integration), and execution-review must confirm export-board's actual call threads `nowMs`.

**Check-4 answer (buildTicket call sites the plan's file list must reconcile):** 2 scripts — `scripts/export-board.ts:275`, `scripts/ac0-1980-lanes-open-punch-in-clock-audit.ts:350` — plus 17 test files: `build-board`, `lane-pending-review-visibility`, `lane-disjunct2-focus-residual`, `lane-ghost-agentid-dedup`, `lane-heartbeat-undercount`, `lane-inflight-undercount`, `lane-mtime-undercount`, `lane-open-punch-in-clock`, `lane-punchout-cap-immunity`, `lane-role-handoff-gap`, `lane-round-reuse-undercount`, `liveness`, `monotonic-flow`, `on-hold`, `orphan-backlog`, `research-inflight-lane`, and (the seam-B verdict/artifact blocks inside) `build-board`. Most use `inProgressTask(...)` (status `in_progress`, unaffected behaviorally), so resolution 1a leaves them green untouched; the ones that matter for reconciliation are the `pending`+pipeline-comment assertions in `build-board.test.ts` and `monotonic-flow.test.ts`.

Re-review scope for Round 2: only whether Blocker 1 (signature + full caller reconciliation, AC-4 now provably green) and Blocker 2 (AC-3 rephrased to a non-mutable invariant or a fixture test) are resolved. The diagnosis and signal choice are already accepted.

---

## Round 1 fold — FINAL SPEC (supersedes §Fix / §Binary AC / §Files above wherever they conflict)

The Round-1 diagnosis + recency signal are accepted. This section applies the reviewer's bounded resolutions verbatim; the executor builds to THIS.

**B1 → resolution 1a (optional, fail-safe-to-old-behavior).** `buildTicket` signature becomes `buildTicket(rawTask, ledgerLines, mtimeMs, sessionId?, ledgerMtimeMs?, nowMs?)` — `nowMs` OPTIONAL and APPENDED LAST (no existing positional 5-arg caller breaks: `scripts/export-board.ts:275`, `scripts/ac0-1980-lanes-open-punch-in-clock-audit.ts:350`, and all 17 test files stay arity-valid and behaviorally green). Semantics: `nowMs === undefined` → preserve the pre-fix ever-touched promotion (`hasPipelineRoleComment`); `nowMs` provided → apply `hasRecentPipelineComment` (a `PIPELINE_ROLE_SET` line with `nowMs - Date.parse(line.ts) <= INFLIGHT_LANE_CAP_MS`, non-finite ts → not recent). ONLY `scripts/export-board.ts` opts in.

**N1 → reuse the existing constant.** Import `INFLIGHT_LANE_CAP_MS` (6h) from `lib/active.ts` into `lib/build-board.ts` (no require cycle — active.ts imports only board-schema + ui-meta). Do NOT mint a second `IN_PROGRESS_ACTIVE_WINDOW_MS`. A use-site comment notes the shared 6h "is this lane still alive" threshold spans both the lanes-live cap and the pending→column promotion.

**N2 → reuse export-board's existing clock.** `scripts/export-board.ts` passes its EXISTING `const now = Date.now()` (`:243`) as the 6th `buildTicket` arg — no second `Date.now()`.

**B2 → AC-3 rewritten to a non-fragile invariant (replaces the "== 4" pin).** After `npm run export:board`, over the deduped board: (a) `in_progress` count < 23 (dropped from the pre-fix value), AND (b) EVERY ticket in the exported `in_progress` column satisfies `status === "in_progress"` OR (`status === "pending"` AND ≥1 pipeline-role comment within `INFLIGHT_LANE_CAP_MS` of the export `nowMs`). Checkable from `board.json` + ledgers; not pinned to a mutable live count; not self-contradictory. (Optionally ALSO add a deterministic fixture-fed integration test — synthetic tasks/ + ledger dirs through the exporter asserting the counts — but the invariant above is the required AC.)

**N3 → inertness guard (execution-review MUST confirm).** Because 1a is fail-safe-to-old-behavior, if production `export-board` forgets to pass `nowMs` the fix is fully INERT while every unit test passes (the "shipped opt-in guard = zero protection" shape). Execution-review MUST verify the ACTUAL `export-board.ts` call threads `nowMs`, AND that a real `npm run export:board` produces `in_progress` < 23 with the invariant (b) holding — not just green unit tests.

**Files (corrected).** `lib/build-board.ts` (import `INFLIGHT_LANE_CAP_MS`; `buildTicket` gains optional `nowMs?`; recency branch; `toColumn` doc). `scripts/export-board.ts` (thread existing `now` as 6th arg). `__tests__/build-board.test.ts` + `__tests__/lane-pending-review-visibility.test.ts` (add the recency assertions AC-1/AC-2, passing `nowMs` explicitly). The other ~15 test files + the audit script need NO change (optional-param backward-compat) — verify they stay green, do not edit them.

Deferred-follow-ups: none — all Round-1 blockers/notes are resolved in-place above; env-tunable window remains file-when-triggered (no task now).

---

### Round 2 (plan-review, independent/adversarial — did NOT author this plan or the fold)

Decision: PASS

Round-2 scope discipline applied: block ONLY on an unresolved Round-1 blocker, a fold-refuted premise, or a NEW defect the fold introduced. All three Round-1 items are resolved and I found no new correctness defect. Every fold claim was verified by executing against the real repo (not read from the fold's own narrative).

cairn: `[T1] .../2026-08-23/6bae4820-...jsonl:256` — "When a UI/board rule marks an item 'in progress' based on 'was ever touched' … use the timestamp of the actual event (e.g. last log/comment) as a recency signal" — directly endorses this fix's signal choice, consistent with the Round-1 citations.

**B1 — RESOLVED (verified against source).** The FINAL SPEC adopts resolution 1a exactly: `buildTicket(rawTask, ledgerLines, mtimeMs, sessionId?, ledgerMtimeMs?, nowMs?)` — `nowMs` OPTIONAL and APPENDED LAST, fail-safe to the pre-fix ever-touched promotion when `undefined`. I confirmed the live signature is `(rawTask, ledgerLines, mtimeMs, sessionId?, ledgerMtimeMs?)` at `lib/build-board.ts:321-326`, so appending a 6th optional param keeps every positional caller arity-valid. **Caller-count claim verified independently**: `git grep -l buildTicket` returns exactly **17 test files + 2 scripts** (`scripts/export-board.ts:275` 5-arg positional, `scripts/ac0-1980-…audit.ts:350` 5-arg positional) — the fold's "17 test files stay arity-valid … other ~15 test files + the audit script need NO change" arithmetic (17 − the 2 edited files = 15) is correct. The count is right in the direction that matters: optional-last backward-compat protects ALL 19 non-edited callers, so AC-4 ("npm test green") is now structurally achievable. (Minor note, non-blocking: Round-1's prose enumeration listed 16 test files, omitting `lane-punchout-exporter.test.ts`; the headline "17" is the correct number and drives the resolution, so this does not change risk.)

**B2 — RESOLVED (verified).** The mutable "== 4" equality is replaced by the invariant the blocker demanded: (a) real-export `in_progress` count **< 23**, AND (b) EVERY exported `in_progress`-column ticket satisfies `status==="in_progress"` OR (`status==="pending"` AND ≥1 `PIPELINE_ROLE_SET` comment within `INFLIGHT_LANE_CAP_MS` of the export `nowMs`). The fold header explicitly supersedes §Binary AC where it conflicts, so the old AC-3 pin is dead. The invariant is a sound necessary condition for the fix (pending→in_progress only via `hasRecentPipelineComment`; in-review tickets live in a disjoint column) and is checkable from `board.json` (`generatedAt` = the export `nowMs`, per `scripts/export-board.ts:243/285`) + ledgers, with no pinned live count.

**N3 — RESOLVED as an observable AC.** The fold makes the inertness guard an execution-review MUST: verify the ACTUAL `export-board.ts` call threads `nowMs` AND that a real `npm run export:board` yields `in_progress` < 23 with invariant (b) holding — not merely green unit tests. That is checkable from outside the diff (run the exporter, read board.json + ledgers), which closes the "fail-safe-to-old-behavior makes a forgotten thread-through fully inert while units pass" hole. Correctly carried to execution-review rather than defended by enumeration.

**No new defect from the fold (checked).** N1's constant-reuse (`import INFLIGHT_LANE_CAP_MS` from `lib/active.ts:47`, which IS `export const`) introduces no require cycle: `active.ts` imports only `./board-schema` (type) + `./ui-meta` (its two `build-board` mentions are prose comments, not imports), and `build-board.ts` already imports `./ui-meta` — so the reuse is clean and kills the drift risk of a second identical 6h magic number. N2's clock reuse (`scripts/export-board.ts:243` `const now = Date.now()` as the 6th arg) is free. **Monotonicity (#1590):** the diff has no clear-list / mutual-exclusion / last-writer-wins arm; it STRENGTHENS the pending-promotion ("ever" → "recent within 6h") only when `nowMs` is supplied, and production (`export-board`) supplies it — so no weaker claim can erase a stronger one, and the fail-safe default preserving old behavior for un-updated test callers is intentional backward-compat, not an erasure. The `in_progress`/`completed`/`in_review` branches remain untouched (`lib/build-board.ts:194-210`), so the 4 live lanes are structurally unaffected.

Verdict: the fold resolves B1, B2, and N3 with no new correctness defect. Executor builds to the `## Round 1 fold — FINAL SPEC`. Execution-review's load-bearing check is the N3 observable AC (real export threads `nowMs` and yields `in_progress` < 23 with invariant (b)).
