# 3278 plan-review — board-live details (#2) under the size cap

Reviewer: plan-review seat (fresh; did not write the plan or the code). Plan under review:
`.ai-workspace/plans/2026-10-19-3278-details-under-cap.md` (restamped S -> M after ER r1
size-misstamp, commit 1f4f426; this round reviews the plan as written, with the existing build
on branch `3278-details-cap` as evidence of what its AC pin). cairn `board-live` from the
ai-brain primary: one hit, the #3072 working-memory card (`session-state-20260909-3085…:42`,
dashboard line — the page reads the pinned issues through declared loaders), matching the plan's
own citation; two older unrelated board-liveness cards. No prior lesson contradicts the plan.

## Review

DISPATCH-NONCE:OR-NONCE-3eca9806e7601246

Decision: PASS

One-line reason: every load-bearing premise of the plan held up under execution — the fixed feed
is under the cap with headroom by construction, the smoke's RED/GREEN/growth/refuse-unset arms all
fire as written, and the dashboard's real read set is exactly what the plan says it is. The four
findings below are real but none warrants another round: two are plan-wording inaccuracies whose
code behavior is correct and verified (carried as named-risk notes), one is an accepted trade-off
correctly deferred cross-repo, and one item passes outright.

## Findings

1. **F1 — MEDIUM (plan wording, not code): the "worst case is a constant" claim is false in its
   lane term; state the ceiling, do NOT clamp.** The plan says the worst case is
   "(laneCap + N) × the per-entry bound — a constant, independent of how many tickets exist".
   The ticket-independence half is true (verified: doubled board 31,316 bytes). The lane half is
   not: the details construction applies no lane clamp — `lanes.filter(recent)` is unclamped —
   and the `laneCap` the formula names is an unrelated summary field (the SSOT work_ceiling,
   default 4; today's board already shows 5 recent lanes, so the formula does not even describe
   today). Refuted by execution on a synthesized oldest-lanes fixture (fake 97xx ids, scratch in
   tmp/, nothing copied): 12 lanes → 46,981 bytes; 16 lanes → **52,199 bytes — over the plan's
   50,000 target**; the 60,000 hard guard would refuse at roughly 21 lanes. This is not a live
   risk: the lane count is governed by the operator's work ceiling (4-5 today), and if it were
   ever breached the #3272 all-or-nothing guard refuses the whole push — the designed fail-closed,
   the same safe failure this ticket exists to fix the cause of. Clamping lanes would be the wrong
   remedy: it would cut live lanes, violating the plan's own retention intent (finding F3).
   Remedy: the plan (or a follow-up note) should restate the bound as (L_recent + 24) ×
   per-entry, honest about L. Carried as named-risk note `lanes-term-unclamped` (registered
   2026-10-19).

2. **F2 — MEDIUM (operator honesty, accepted trade-off): 58 of 82 rows lose their detail sheet
   and the page then says "No role steps recorded yet." for tickets that HAVE steps. This is a
   follow-up, not a fix in this ticket.** The plan knowingly accepted this fallback — it quotes
   the no-entry rendering ("No role steps recorded yet. — verified present in the page code") and
   Non-goals exclude any dashboard-page change. ER r1 measured the blast radius on today's real
   data: 58 of 82 active rows fall outside the 24-row cap (41 todo, 17 stale in_progress), and
   cut tickets with real timelines (2578/2940/3128 at 10 steps each) open a sheet whose Timeline
   line is factually false. The sentence is misleading, but the outcome is honest at the ticket
   level: pre-fix, the whole push was refused and EVERY ticket's detail was stale; post-fix, cut
   tickets still ride #1 and live lanes are never cut. The fix belongs in the ai-brain page
   (`tools/board/page/index.html`, `openSheet`), a different repo this plan correctly scoped out
   — folding it in would expand a Cost ticket into a cross-repo page change. Verdict: file as a
   follow-up ticket on the ai-brain side ("details not carried for older tickets" line when the
   details loader is ok but the entry is missing); do not hold #3278 for it.

3. **F3 — MEDIUM (AC-power gap, covered in the build): live-lane retention is stated in the
   Intent but pinned by no Binary AC — and the smoke's fixture masks it.** The dispatch asked
   whether the plan's AC say lanes are never cut; they do not. AC 1-7 would all pass for an
   implementation that drops lanes from #2 entirely (a smaller body still measures ≤ 50,000; the
   field checks only cover carried entries). Worse, the smoke cannot catch it either: the
   details-arm fixture makes the lanes (9601-9604) the 4 MOST-recently-updated active rows, so
   their presence is guaranteed by the row cap whether or not the lane loop runs. The property is
   real and the build honors it — re-verified by execution here: on my oldest-lanes scratch
   fixture (lanes = the oldest active rows), all lane ids are present in every printed body
   (12/16/20-lane runs), matching ER r1's own oldest-lane run and the code's monotonic last-write
   (the uncapped lane loop writes after the capped active loop, so the cap can never erase a
   lane). Per the round-scope contract I do not ask the fold to add an enumerated AC arm for an
   already-verified property; carried as named-risk note `lane-retention-not-in-ac` so
   execution-review re-checks lanes-present on an oldest-lanes fixture against the actual diff.

4. **F4 — PASS item: every Binary AC is runnable and checkable from outside the diff, and the
   harness refuses with no network when its target is unset.** Run fresh in this round, from the
   worktree, not read: the full extended smoke exits 0 (summary 45,563 ≤ 48,000; pre-fix summary
   blob 66,473 > 62,000; details GREEN 31,328 and doubled-board 31,316, both ≤ 50,000; RED
   control pinned to blob 0555ad2 aborting the whole push at 87,494 > 60,000 with gh absent from
   PATH; field checks including top-level keys == [details]); `env -u BOARD_AI_BRAIN` and
   `BOARD_AI_BRAIN=` both exit 1 with the refusal at line 22, before any feed invocation. All
   seven AC map one-to-one onto arms I executed; none requires reading the diff to check. The
   `--details-body` print is a no-network, no-state exit, same pattern as `--focus-body`.

## Named-risk notes registered (durable carry, #2434)

- `lanes-term-unclamped` — the 50,000 target breaks at ~15 recent lanes (measured 52,199 at 16);
  recalibrate or restate the ceiling if the lane count ever rises past 14; never clamp lanes.
- `lane-retention-not-in-ac` — a lane-dropping implementation would pass every Binary AC
  (fixture lanes coincide with the 4 newest rows); execution-review must re-verify lanes-present
  on an oldest-lanes fixture.

## Commands run (exit codes)

| Command (paths shortened: `<wt>` = worktree, `<ab>` = ai-brain primary, relative) | rc |
|---|---|
| `node <ab>/skills/cairn/bin/cairn-find.mjs "board-live"` | 0 |
| `BOARD_AI_BRAIN=<ab> bash __tests__/board-live-size-smoke-test.sh` (full smoke, details arm included) | 0 |
| `env -u BOARD_AI_BRAIN bash __tests__/board-live-size-smoke-test.sh` / `BOARD_AI_BRAIN= …` | 1 / 1 |
| lane-growth scratch (synthesized 97xx ids, lanes = OLDEST rows): `--details-body` × {12, 16, 20} lanes → 46,981 / 52,199 / 52,199 bytes, lane ids present in all | 0 |
| `node <ab>/hooks/named-risk-notes.mjs register --task 3278 --id lanes-term-unclamped …` | 0 |
| `node <ab>/hooks/named-risk-notes.mjs register --task 3278 --id lane-retention-not-in-ac …` | 0 |

No live push was run, nothing wrote to the board issues, no state file was written, and the one
guard-crossing invocation (the pinned RED inside the smoke) ran with gh absent from PATH.

Override env vars used: none.
