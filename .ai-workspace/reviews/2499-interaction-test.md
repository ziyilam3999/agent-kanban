# Interaction-test marker — #2499 folding-phone front-screen shelf reachability

**Role:** executor (self-authored, per the UI-task gate's structured marker contract)
**Task:** `2499` (agent-kanban)
**Spec:** `e2e/shelf-front-screen-reachable.e2e.spec.ts` (AC1/AC1b/AC2/AC3 describe blocks)
**Evidence:** `.ai-workspace/reviews/2499-folding-phone-shelf-reachable-red-evidence.md` (full
measured RED + GREEN runs, all regression sweeps)

## Structured fields (ui-task-gate.sh schema)

```
interaction-test:
asserts=reachability,scroll-delta
viewport=344x882 touch=true
red-on-prefix=dd59d07 (collapsed shelf summary top=5499.75 >> innerHeight=882 — page-scroll
  required at rest; margin ~4618px, self-asserted as genuine via a tall-enough production-volume
  board — nr-2499-red-genuine)
result=PASS
```

## What each assertion is, concretely

- **`reachability`** — AC1: `getBoundingClientRect()` (real geometry, never `getComputedStyle`)
  of `.ak-shelf__summary`, asserted fully inside `[0, window.innerHeight]` with `window.scrollY
  === 0` confirmed (no page scroll performed) — RED on master `dd59d07`, GREEN on the fix branch.
- **`scroll-delta`** — AC2: a real CDP touch-drag (`touchDragAt`, `Input.dispatchTouchEvent`,
  never a synthetic `element.dispatchEvent`) inside the OPENED `.ak-shelf__body`, asserted to
  produce a positive `scrollTop` delta — GREEN on BOTH master and the fix branch (a no-regression
  guard on #83's already-shipped bounded 60dvh panel).
- Also covered in the same spec (not separately gate-scored, but load-bearing for the named-risk
  notes): AC1b occlusion guard (nr-2499-occlusion, last-card-vs-pinned-bar non-overlap) and AC3
  grid-tier no-regression (768x1024, unaffected by this fix).

## Real measured RED (master `dd59d07`)

```
[AC1] summary.top=5499.75 summary.bottom=5536.96875 innerHeight=882
```

## Real measured GREEN (fix branch, this PR head)

```
[AC1] summary.top=837.78125 summary.bottom=881 innerHeight=882
```

AC2 (scroll-delta): PASS on master (2.2s) AND the fix branch (2.2s) — no regression.
AC3 (grid-tier 768x1024): PASS on master (2.1s) AND the fix branch (2.0s) — identical outcome.

Result: **PASS**.
