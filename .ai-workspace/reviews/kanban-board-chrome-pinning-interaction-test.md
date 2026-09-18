# kanban-board-chrome-pinning — real-interaction marker (UI-task gate leg 3)

interaction-test: e2e/board-chrome-pinning.e2e.spec.ts
asserts=scroll-delta,scrolltop-delta,pinned-geometry,contiguity,reachability,occlusion,visual-viewport-pan
viewport=390x844 touch=true
red-on-prefix=origin/master@c656df5 (390x844 real touch drag: `.ak-header`.top moved 0->-717 (delta -717px); `.ak-col__head`.top moved 168.77->-548.23 (delta -717px) — both selectors PRE-EXISTING at c656df5, measured via the standalone `_root-cause-probe.e2e.spec.ts` on the SAME clean c656df5 worktree/fixture, per the plan-review named-risk note kbcp-red-must-be-moving-element. The full 27-case spec itself: 22 failed / 5 passed at c656df5 (5 no-regression legs correctly GREEN at both shas); 1280x800: `.ak-shelf__summary`.top=5444.5, far outside the 800px viewport at rest.)
result=PASS

## RED run (origin/master @ c656df5, clean detached worktree, no live data/board.json)

```
Running 27 tests using 1 worker
  ✓   1 fixture self-assertion — the RED must be genuine (2.1s)
  ✘  2-15, 17-20, 23-26  (22 failures total — AC-1, AC-2, AC-3, AC-3b, AC-5, AC-7)
  ✓  16, 21, 22, 27      (5 no-regression legs — AC-4, AC-6 x2, AC-8 — correctly GREEN at both shas)
22 failed
5 passed (11.3m)
```

Root-cause probe (pre-existing selectors, same worktree/fixture):
```
[root-cause-probe 390x844] header.top 0->-717 (delta -717) colHead.top 168.765625->-548.234375 (delta -717)
[root-cause-probe 1280x800] shelf__summary.top=5444.53125 innerHeight=800
2 passed (5.2s)   # "passed" here = the probe's assertion that the BUG IS PRESENT was confirmed
```

## GREEN run (branch `kanban-board-chrome-pinning`)

```
Running 27 tests using 1 worker
  ... (all 27 cases)
27 passed (1.1m)
```

## Self-mutation test (dead-control check)

Fix temporarily undone on the branch (`overflow-x: clip` -> `overflow-x: hidden` on `html`+`body`, the
exact pre-fix value) -> AC-1/AC-2 (5 cases) went RED again (5 failed, real negative `headBox.top` values
proving the head scrolled away) -> fix restored -> same 5 cases GREEN again. Full transcript in
`.ai-workspace/reviews/kanban-board-chrome-pinning-red-evidence.md`.

## Full detail

Per-cell RED/GREEN transcripts, the root-cause probe's full output, and the self-mutation test's full
transcript are all in `.ai-workspace/reviews/kanban-board-chrome-pinning-red-evidence.md`.
