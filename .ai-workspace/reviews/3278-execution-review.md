# 3278 execution-review — board-live details (#2) under the size cap

Reviewer: execution-review seat (fresh, did not write the code). PR ziyilam3999/agent-kanban#93,
branch `3278-details-cap`, head reviewed `3287f3b4823dcada3bad65765b8db1975a8f8091`.
Contract: `.ai-workspace/plans/2026-10-19-3278-details-under-cap.md` (size: S, no plan-review row).
cairn: `cairn-find --task 3278 "board-live"`: the only hit is the #3072 working-memory card (the
page reads the pinned issues through declared loaders). No prior lesson covers #2 trimming.

Decision: NEEDS-WORK

One-line reason: the code is right and every Binary AC passes when I run it, but the ticket is
stamped size S. That stamp skipped plan-review (#3154). The diff does not fit S, so the waiver
does not hold. Fix: restamp the ticket M and run one plan-review round on the existing plan. No
code change is needed.

## Findings

1. **F1 — size-misstamp (BLOCKING, process).** The #3154 rubric says: S = one file or
   config-only, no new smoke; M = 2-5 files, one smoke. Leaving out `.ai-workspace/`, this diff
   touches 2 files. The first is `scripts/board-live-push.mjs` (+29/-5). The second is
   `__tests__/board-live-size-smoke-test.sh` (+97), which gets a NEW smoke arm with its own
   synthesized fixture, its own pinned RED control and a growth arm. That is M by the rubric. The
   ledger has no plan-review row, so the run relied on the size-S waiver. My seat duty for a
   waived S whose diff is not S is NEEDS-WORK with `size-misstamp`.
   Remedy: restamp M, run plan-review on the existing plan, then re-run or re-confirm
   execution-review. The technical results below carry forward unchanged.

2. **F2 — LOW, page wording for a cut ticket (operator-visible, not blocking).** A ticket outside
   the row cap opens a sheet with its title, its column and no description. Under Timeline it
   says "No role steps recorded yet." (page `openSheet`, ai-brain `tools/board/page/index.html`
   :548-558). For a cut ticket that has ledger steps, that sentence is false. On today's real data
   this hits 58 of 82 active rows (41 todo, 17 stale in_progress last touched 2026-10-11). Of the
   cut rows, 2578, 2940 and 3128 have 10 steps each, 2682 has 4 and 3072 has 3.
   Only one cut ticket is on a focus list: #3117 (wiki focus, status waiting, todo). It loses
   only its description line. Being todo, it never had a timeline.
   No live lane is cut (see 2b). The plan accepts this fallback on purpose (Non-goals: no page
   change). Before the fix, the whole push was refused and every ticket was stale, so this is a
   large net gain. Follow-up: a page-side "details not carried for older tickets" line when the
   details loader is ok but the entry is missing.

3. **F3 — LOW, the bound is not a hard constant.** The details loop adds every
   `lanes.filter(recent)` entry with no `laneCap` clamp. The code comment and the plan call
   (laneCap + 24) × per-entry "a constant". In practice the lane count comes from the selectors
   (5 today). Using today's largest real entry (1,327 bytes): 5 lanes gives 38,483 bytes, 8 lanes
   gives 42,464 and 12 lanes gives 47,772. All are under 50,000, so this is not a live risk.
   Escaped description characters (quotes, newlines) can also push an entry a little past its
   240-character cut. Informational only.

4. **F4 — INFO, ledger check unresolvable from this vantage.** `3role-ledger.mjs check --task
   3278` (plain and `--merge-head <head>`) BLOCKs with "plan-unresolvable … refs consulted:
   refs/remotes/origin/3278, refs/remotes/origin/master". It is looking in the ai-brain refs for
   an agent-kanban plan, which is the known cross-repo artifact-resolution gap. It does not
   reflect the diff. The orchestrator should handle it at ship time.

## Brief checks (run, not read)

1. **Real data, no-network print.** I captured the kanban selector output read-only and ran the
   fixed feed with `--details-body` on today's real board. Result: **22,046 bytes** (rc 0). The
   exact pre-fix blob `0555ad2`, given a scratch print-only patch, gives **65,754 chars** on the
   same data, which is over the 60,000 cap and matches the live incident. Headroom on real data
   is about 28,000 bytes under the 50,000 target.
   Fixture shape: the synthesized fixture has 40 in_progress rows, 420-char descriptions and 12
   ledger rows each. It is heavier per row than today's board (pre-fix 87,494 vs real 65,754).
   Today's board has 82 active rows, half of them todo with no timeline. Per entry after the
   trim, the fixture is close to the real maximum (1,305 vs 1,327 bytes). So it is not a replica
   of today, but it is a fair stress test of the per-entry bound and the row cap.

2. **Dashboard data loss.**
   - (a) Fields: the `details` loader (page :466-473) reads only `v.details`, plus `d` and `tl`
     per entry. `openSheet` reads `r/v/t/c/m/e/a` per step. All of them are present: the smoke's
     field check passes, and the trimmed helper `tlTrimOf` builds the same object shape as
     `tlOf`. The dropped top-level `generatedAt` on #2 is not read anywhere. The page's
     generatedAt reads are :364/:402/:416/:891-892 (#1 and #4 only), and the render-harness #2
     fixture already omits it.
   - (b) Live lanes: the lane loop runs AFTER the capped active loop and is not capped, so a lane
     is never dropped. I proved it by running a scratch fixture whose 4 lanes are the 4 OLDEST
     active rows (9637-9640). All 4 are present, each with 6 timeline steps (28 entries in all).
     On real data all 5 summary lanes (3282, 3278, 3275, 3249, 3100, all live) have #2 entries.
   - (c) Cut tickets: see F2. The sheet is not broken, but it says "No role steps recorded yet."
     even for tickets that have steps. One focus-watched ticket (#3117) loses its description
     line. Severity: LOW.

3. **RED control honest.** In the details arm, the pinned blob `0555ad2` runs with only node on
   PATH. It aborts with `board-live details (auto) too large: 87494` (rc ≠ 0), and the smoke
   asserts both the message and that the number is over 60,000. Mutation runs on scratch copies
   of the feed, using the extracted details arm:
   - control (unmutated): rc 0, 31,328 / 31,316 bytes
   - trim and cap both removed (420/10/no cap): `FAIL: #3278 GREEN: the #2 body is 87454 bytes`
   - row cap removed only: `FAIL … 52201 bytes`
   - trim removed, cap kept: `FAIL … 52478 bytes`
   - `generatedAt` restored: `FAIL: top-level keys == [details]`

   Every lever is load-bearing in the smoke.

4. **Unset target refuses, no network.** With `BOARD_AI_BRAIN` unset, the smoke exits rc 1 with
   `FAIL: BOARD_AI_BRAIN is not set …`. With it set to an empty string, the result is the same
   (rc 1). The check is at line 22, before any feed run (the first feed run is after line 40).

5. **#3 shelf byte-identical.** I patched scratch copies of the pre-fix blob and of the fixed
   feed to print the shelf body under `--dry-run`, then ran both on real data with `--now`
   pinned. Both bodies are 18,285 bytes, `cmp` rc 0, and the sha256 values match. In the code,
   `descOf`/`tlOf` and the shelf loop are untouched; only new helpers were added.

## Monotonicity (#1590)

The `details` map is last-writer-wins. The capped active loop writes first, then the uncapped
lane loop writes the same ids. The lane claim is the stronger one: it is always included and
always gets a timeline. Because it writes last, the row cap (the weaker claim) cannot erase it.
This is confirmed by the oldest-lane run in check 2(b).

## Named-risk notes

`node hooks/named-risk-notes.mjs list --task 3278` printed `NO-NOTES 3278`, so there is nothing to
disposition.

## Commands run (exit codes)

| Command (paths shortened: `<wt>` = worktree, `<ab>` = ai-brain, `<s>` = scratch) | rc |
|---|---|
| `tsx scripts/kanban-lanes.ts` (primary checkout, read-only) > `<s>/kb.json` | 0 |
| `node <wt>/scripts/board-live-push.mjs --board <real board> --kanban-json <s>/kb.json --details-body` → 22,046 bytes | 0 |
| pre-fix blob `0555ad2` with a scratch print-only patch, same inputs, `--dry-run` → 65,754 chars | 0 |
| `BOARD_AI_BRAIN=<ab> bash __tests__/board-live-size-smoke-test.sh` (full smoke) | 0 |
| extracted details arm × {control, mut1, mut2, mut4, mut3} | 0, 1, 1, 1, 1 |
| oldest-lanes scratch fixture `--details-body` (lanes 9637-9640 present) | 0 |
| `env -u BOARD_AI_BRAIN bash __tests__/board-live-size-smoke-test.sh` | 1 |
| `BOARD_AI_BRAIN= bash __tests__/board-live-size-smoke-test.sh` | 1 |
| shelf body old vs new (`--dry-run` scratch print) + `cmp` | 0 / 0 / 0 |
| `node <ab>/skills/cairn/bin/cairn-find.mjs --task 3278 "board-live"` | 0 |
| `node <ab>/hooks/named-risk-notes.mjs list --task 3278` | 0 (NO-NOTES) |
| `node <ab>/hooks/3role-ledger.mjs check --session … --task 3278 [--merge-head <head>]` | BLOCK (F4) |

No live push was run, nothing wrote to the board issues, and no state file was written. The one
guard-crossing run (the pinned RED inside the smoke) had gh absent from PATH.

Override env vars used: none.
