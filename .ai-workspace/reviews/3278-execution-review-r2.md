# 3278 execution-review, round 2: board-live details (#2) under the size cap

Reviewer: execution-review seat, round 2 (fresh agent, did not write the code or the plan). PR
ziyilam3999/agent-kanban#93, branch `3278-details-cap`, head reviewed `fb1a4e9` (code head
`3287f3b`). Contract: `.ai-workspace/plans/2026-10-19-3278-details-under-cap.md` (now `size: M`).
cairn `--task 3278 "board-live"`: one relevant hit, the #3072 working-memory card (the page reads
the pinned issues through declared loaders). No earlier lesson covers trimming #2.

Decision: PASS

One-line reason: the only round-1 block (size-misstamp) is fixed. The ticket and plan are now M,
and a plan-review PASS is on the branch. No code changed since `3287f3b`. I re-ran every technical
check myself, and all of them still hold on today's real data.

## Findings

1. **F1 (round-1 blocker): RESOLVED.** The ticket store shows `metadata.size = M` and the plan
   says `size: M` (commit 1f4f426). `.ai-workspace/reviews/3278-plan-review.md` has
   `Decision: PASS`. Between `3287f3b` and `fb1a4e9`, `git diff --stat` touches only
   `.ai-workspace/` files (the plan's size line and two review files). `scripts/` and
   `__tests__/` are byte-unchanged, so this round reviews the same code as round 1. The ledger
   check now blocks only on the round-1 NEEDS-WORK row, and this round's own row replaces it.

2. **F2: LOW, deferring it to #3287 is acceptable.** Tickets cut from #2 open a sheet that says
   "No role steps recorded yet." even when they have steps. On today's real data, 58 of 82 active
   rows are cut and 9 of those have steps (2578, 2940 and 3128 have 10 each; 2682 has 4; 3072 has
   3; 2935 has 2; 1570, 2501 and 3133 have 1). Only one cut ticket is on a focus list: #3117
   (wiki). It is todo with 0 steps, so its sheet is honest and it loses only its description
   line. No live lane and no in-flight focus ticket is cut (see check 2). The worst outcome is a
   misleading sentence on stale or old tickets. Before this fix the whole push was refused, so
   EVERY ticket was stale. The fix belongs in the ai-brain page (`openSheet`), which is a
   different repo and outside this Cost ticket's Non-goals. Shipping now with #3287 tracking the
   wording is the right trade.

3. **F3: LOW (carried note), the lane term has no clamp.** Today the board has 5 live lanes. The
   largest real entry is 1,319 bytes, so the 50,000 target holds up to about 13-14 lanes, and
   the 60,000 guard is the fail-closed backstop above that. Clamping lanes would be wrong because
   it would cut live lanes. Disposition below.

4. **F4: INFO, the smoke still does not pin lane retention.** A mutant feed with the lane loop
   removed (`m-nolane`) passes the extracted smoke details arm (rc 0). The fixture's 4 lanes are
   also its 4 newest rows, so the row cap hides the gap. The property itself holds in the shipped
   code, which I proved on an oldest-lanes fixture (check 2b). The same fixture tells the code
   apart from the mutant: the mutant drops all 4 or 8 lanes, the shipped code keeps all of them.
   Suggested follow-up (not blocking): add that oldest-lanes assertion to the smoke, maybe with
   #3287.

## Brief checks (run, not read)

1. **Real data, no-network print.** I captured the kanban selectors from the primary checkout
   (read-only, 4 kb lanes). Then I ran the fixed feed with `--details-body` on today's real board
   and ledger, with `--now` pinned and `gh` absent from PATH. Result: **23,209 bytes** (rc 0; an
   earlier run minutes before gave 23,078 as the live ledger moved). The body has 24 entries. The
   largest entry is 1,319 bytes and the longest description is 239 characters. The top-level keys
   are exactly `[details]`. The pre-fix blob `0555ad2` (scratch copy, print-only patch) gives
   **67,028 bytes** with 82 entries on the same inputs, which is over the 60,000 cap and matches
   the live refusal. That leaves about 27,000 bytes of headroom under the 50,000 target.
   Is the fixture really today-shaped? Not exactly, but it is fair. It has 40 in_progress rows,
   each with 12 steps and a 420-character description. Today's board has 82 active rows, many of
   them todo or stale with no timeline. Per row, the fixture is heavier than today: before the
   fix it measures 87,494 against today's real 67,028. After the trim, its per-entry size
   (~1,305 bytes) is close to today's real maximum (1,319). It is a stress test of the per-entry
   bound and the row cap, not a replica of today's board.

2. **Dashboard data loss** (ai-brain `tools/board/page/index.html`).
   - (a) Fields. The `details` loader (:466-473) reads only `v.details` and, for each entry, `d`
     and `tl`. `openSheet` (:535-575) parses `tl` and reads `r/t/c/v/m/e/a` on each step. All of
     these are present: the smoke's field check passes, and `tlTrimOf` builds the same object as
     `tlOf`, just with `slice(-6)`. The dropped top-level `generatedAt` is not read by the
     `details` loader.
   - (b) Live lanes are never cut. The capped active loop runs first. The uncapped
     `lanes.filter(recent)` loop runs second and writes the same map last. On real data, all 5
     summary lanes (3282, 3275, 3278, 3249, 3100, all live) have #2 entries with timelines (6, 4,
     5, 6 and 6 steps). On a synthesized oldest-lanes fixture (fake 96xx ids, lanes = the OLDEST
     active rows), the shipped code keeps 4/4 and 8/8 lanes, each with 6 steps (28,686 and
     32,782 bytes). The lane-dropping mutant loses 4/4 and 8/8.
   - (c) Cut tickets: see F2. The sheet shows the title, the column and no description, then
     "No role steps recorded yet." The only operator-watched (focus) ticket cut is #3117, which
     is todo with no steps, so nothing it shows is false. Severity: LOW.

3. **RED control honest.** The full smoke passes (rc 0). Its details arm runs the pinned blob
   `0555ad2` with only node on PATH, and it aborts on `board-live details (auto) too large:
   87494`. The arm asserts both the message and that the number is over 60,000. I extracted the
   details arm and ran it against scratch copies of the feed:
   - control (unmutated): rc 0, 31,328 / 31,316 bytes
   - trim removed (420/10): rc 1, `FAIL: #3278 GREEN: the #2 body is 52478 bytes`
   - row cap removed: rc 1, `… 52201 bytes`
   - trim and cap both removed: rc 1, `… 87454 bytes`
   - `generatedAt` restored: rc 1, `FAIL: top-level keys == [details]`
   - lane loop removed: rc 0 (see F4; my oldest-lanes check catches it)

4. **Unset target refuses with no network.** `env -u BOARD_AI_BRAIN` and `BOARD_AI_BRAIN=` both
   give rc 1 with `FAIL: BOARD_AI_BRAIN is not set …`. The check is at smoke line 22, before any
   feed run or fixture build.

5. **#3 (shelf) is byte-identical.** I made scratch copies of the pre-fix blob and of the fixed
   feed that print the shelf body under `--dry-run`, then ran both on real data with `--now`
   pinned. Both bodies are 18,285 bytes, `cmp` gives rc 0, and both sha256 values start with
   `9a0f95380f3f289f`. In the diff, `descOf`, `tlOf` and the shelf loop are untouched. The only
   removed lines are the two old #2 `for` loops.

6. **The print path makes no network call.** `--details-body` exits (feed line 391) before
   `upsertIssue`, the state-file read and write, and every `gh` call (:399-400). This is the same
   pattern as `--focus-body`.

## Monotonicity (#1590)

The `details` map is last-writer-wins. The capped active loop writes first and the uncapped lane
loop writes last. The lane claim is the stronger one: it is always kept and always gets a
timeline. Because it writes last, the row cap (the weaker claim) cannot erase it. The
oldest-lanes run in check 2(b) confirms this.

## Named-risk notes (#2434)

`named-risk-notes.mjs list --task 3278`, run from the agent-kanban worktree, prints two NOTE lines.
Run from the ai-brain primary it prints `NO-NOTES 3278`, because the notes live in the
agent-kanban `.ai-workspace/named-risk-notes`.

DISPOSITION lanes-term-unclamped observed-in-diff: the lane loop is unclamped by design, which is correct because live lanes are never cut. Today there are 5 lanes, so 23,209 bytes on real data; the 50,000 target holds to about 13-14 lanes and the 60,000 all-or-nothing guard fails closed above that. Accepted as a watched ceiling, no change needed now.
DISPOSITION lane-retention-not-in-ac addressed: re-verified against the actual diff on oldest-lanes fixtures (4/4 and 8/8 lanes present with 6 steps each; the lane-dropping mutant loses all of them) and on real data (5/5 live lanes present). The smoke gap is noted as F4, follow-up only.

## Commands run (exit codes)

Paths are shortened: `<wt>` = the worktree, `<ab>` = the ai-brain primary, `<s>` = session
scratch.

| Command | rc |
|---|---|
| `git -C <wt> fetch origin 3278-details-cap` + `diff --stat 3287f3b origin/3278-details-cap` (only `.ai-workspace/`) | 0 |
| `node <ab>/skills/cairn/bin/cairn-find.mjs "board-live"` and `--task 3278 "board-live"` | 0 / 0 |
| `tsx scripts/kanban-lanes.ts` (primary checkout, read-only) > `<s>/kb.json` | 0 |
| `node <wt>/scripts/board-live-push.mjs --kanban-json <s>/kb.json --now … --details-body` (gh absent) → 23,209 bytes | 0 |
| pre-fix blob `0555ad2` scratch print-only copy, same inputs, `--dry-run` → 67,028 bytes | 0 |
| fixed feed `--focus-body` + cut analysis (58 cut, 9 with steps, focus-cut = #3117 only) | 0 |
| `BOARD_AI_BRAIN=<ab> bash __tests__/board-live-size-smoke-test.sh` (full smoke) | 0 |
| `env -u BOARD_AI_BRAIN bash …smoke…` / `BOARD_AI_BRAIN= bash …smoke…` | 1 / 1 |
| extracted details arm × {control, trim, cap, both, generatedAt, no-lane} | 0, 1, 1, 1, 1, 0 |
| oldest-lanes fixture `--details-body` × {4, 8 lanes} × {shipped, no-lane mutant} + lane check | shipped 0/0, mutant 1/1 |
| shelf body old vs new (`--dry-run` scratch print) + `cmp` | 0 / 0 / 0 |
| `node <ab>/hooks/named-risk-notes.mjs list --task 3278` (from `<wt>`) | 0 (2 NOTE) |
| `node <ab>/hooks/3role-ledger.mjs check --session … --task 3278` (before this round's row) | BLOCK (round-1 NEEDS-WORK row, superseded by this round) |

No live push was run, nothing wrote to the board issues, and no state file was written. Every
real-data feed run had `gh` absent from PATH. Two guards blocked me once each. The rule-12 guard
blocked a `$()` beside `git -C`, and the cairn-search guard blocked my first write of this file
before the `--task` search. Each time I took the guard's own named fix.

Override env vars used: none.
