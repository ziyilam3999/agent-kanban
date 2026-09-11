# Red-evidence — agent-kanban-inreview-and-shipping-pills-overstate-progress

Task: `agent-kanban-inreview-and-shipping-pills-overstate-progress`. Plan:
`.ai-workspace/plans/2026-09-11-agent-kanban-inreview-and-shipping-pills-overstate-progress.md`.
RED baseline: `origin/master 1d00251` (unmodified `lib/ui-meta.ts`). GREEN: this PR's branch head
(SHA recorded below after the final commit).

New test file (the plan's Scope boundary — the ONE new file this PR adds under `__tests__/`):
`__tests__/phase-pill-honesty.test.ts`, 24 tests across AC-1..AC-6.

## Method

The RED run used a throwaway detached-HEAD worktree (`git worktree add ... 1d00251 --detach`,
removed immediately after capture — never merged, never pushed) with the exact same test file copied
in, MINUS the one bonus assertion that imports `SHIPPING_STALE_VERDICT_AGE_MS` (a new export that
does not exist on `1d00251` — importing it would fail the WHOLE suite to *compile*, masking which
individual assertions are genuinely RED vs which are honest green controls; that one bonus test is
not part of any plan AC, so dropping it for the RED-only run does not touch the RED/GREEN evidence for
AC-1..AC-6). The committed test file (with that import) is unmodified from what ran at PR head.

## RED run — `origin/master 1d00251`, 23 of 24 assertions (the AC-bearing ones)

```
Test Suites: 1 failed, 1 total
Tests:       13 failed, 10 passed, 23 total
```

**RED (13) — exactly the members the plan's Rule-17 corpus predicts:**

| AC | Assertion | Expected | RED (1d00251) received |
|---|---|---|---|
| AC-1 | F-A neutral pill | `◆ REVIEW` | `◆ REVIEW · PASS` |
| AC-2 | F-B neutral pill | `◆ REVIEW` | `◆ REVIEW · FAIL` (stale round-1 verdict) |
| AC-3 | F-C phaseLine | `⏸ ON HOLD` | `✓ PASS — SHIPPING` |
| AC-3 | F-C2 phaseLine | `⏸ ON HOLD` | `✓ PASS — SHIPPING` |
| AC-3 | F-C Card markup | contains `⏸ ON HOLD` | contains `SHIPPING`, no ON HOLD |
| AC-3 | F-C2 Card markup | contains `⏸ ON HOLD` | contains `SHIPPING`, no ON HOLD |
| AC-3 | F-C Drawer markup | contains `⏸ ON HOLD` | no ON HOLD chip |
| AC-3 | F-C2 Drawer markup | contains `⏸ ON HOLD` | no ON HOLD chip |
| AC-3 | F-C2 `computeActiveIds` exclusion | `active.has("fc2") === false` | `true` (breathes, inflates the lane count) |
| AC-4 | F-D STALE under a LIVE session | `✓ PASS — STALE` | `✓ PASS — SHIPPING` |
| AC-5(b) | F-J' (25h) STALE | `✓ PASS — STALE` | `✓ PASS — SHIPPING` |
| AC-5(e) | F-D ts-fallback STALE | `✓ PASS — STALE` | `✓ PASS — SHIPPING` |
| AC-6 | F-K neutral pill (the #1867 shape) | `◆ REVIEW` | `◆ REVIEW · PASS` |

**GREEN controls that already held on `1d00251` (10) — confirms the RED corpus is honestly scoped,
not a blanket failure:**

- AC-5(a) F-J (23h, under the bound) → SHIPPING
- AC-5(c) F-I (fresh ship-tail write) → SHIPPING
- AC-5(d) F-D with `nowMs` omitted → SHIPPING (back-compat pin)
- AC-5(f) F-D with a DEAD session → STALE (#1449's existing liveness arm)
- AC-6 F-K lane-count (`computeActiveIds` contains `"fk"`) — the #1867 fix already shipped; only the
  PILL assertion for F-K was RED, never the lane count
- AC-6 F-G (held, PROG column) → ON HOLD
- AC-6 F-H (completed + stale onHold) → DONE, no ON HOLD in markup
- AC-6 F3 (hand-built in_review + FAIL) → `◆ REVIEW · FAIL`
- AC-6 F-E (fresh PASS) → SHIPPING
- AC-6 F-F (the #1449 case-1 shape, 7h-old verdict, LIVE session) → SHIPPING

This is a non-vacuous Rule-17 oracle: every RED member differs from its GREEN target, and every named
control that should already pass on master does pass on master.

## GREEN run — PR head

```
$ npm test
Test Suites: 51 passed, 51 total
Tests:       512 passed, 512 total
```

`__tests__/phase-pill-honesty.test.ts` alone: **24/24 passed** (the 23 above, all now GREEN, plus the
`SHIPPING_STALE_VERDICT_AGE_MS` export-shape bonus assertion).

`npm run typecheck`: exit 0.

Head SHA: recorded in the PR description / commit this file ships in — `git log -1 --format=%H` on
this branch after the commit that includes this file.

## AC-7 — scope discipline

`git diff --name-only origin/master -- __tests__` lists exactly one path:
`__tests__/phase-pill-honesty.test.ts`. Every named hold-out ran GREEN inside the same full-suite run
above (`phase.test.ts`'s `latestReviewVerdict` block + `#1449` block, `monotonic-flow.test.ts`
AC-1..AC-7 incl. F3 and the mixed-ts pin, `on-hold.test.ts` AC1-AC12,
`lane-pending-review-visibility.test.ts` AC-1..AC-6, `card.test.ts`, `stage-bar*.test.ts`,
`lanes.test.ts`, `active.test.ts`, `live-swimlanes.test.ts` — none edited, all green).
