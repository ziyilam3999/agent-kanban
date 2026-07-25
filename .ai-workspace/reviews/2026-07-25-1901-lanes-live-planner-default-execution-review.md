# Execution review — #1901 "LANES LIVE must not claim PLANNER active on zero-ledger tickets"

- **PR:** [#66](https://github.com/ziyilam3999/agent-kanban/pull/66)
- **Branch:** `1901-lanes-live-planner-default`
- **Reviewed HEAD:** `9321c5a8eab463491d8011933ddb6d79c334dc29` (verified against `origin/1901-lanes-live-planner-default` — identical)
- **Parent / merge-base:** `1aef8f61b2d987a18abfbf7a476e017303429598`
- **Role:** execution-review (stateless — did NOT author this fix)
- **Date:** 2026-07-25

## VERDICT: PASS

Both root-cause bugs are real, both are fixed at the source, the fix is minimal and
evidence-shaped, and every claim in the PR body that I could test independently held up.
Two non-blocking follow-ups are listed at the bottom; neither is a code defect.

---

## 1. Test suite and typecheck — re-run independently, not trusted

Run in a **fresh worktree** at the PR head with a clean `npm ci` (not the executor's tree):

| Check | Command | Claimed | **Measured** |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | clean | **exit 0, no output** |
| Tests | `npx jest` | 42 suites / 408 tests | **42 suites passed / 42, 408 tests passed / 408** |

The claimed numbers are exact. No skipped suites, no `todo`, no snapshot obsolescence
(`Snapshots: 0 total`).

## 2. Both bugs are real — reproduced RED against the PRE-fix parent

I checked out the parent commit `1aef8f61` into a second worktree, confirmed
`grep -c noRoleEvidence lib/lanes.ts lib/stage-bar.ts` → `0` (genuinely pre-fix code), then
carried **only the two updated pre-existing test files** forward onto it. Both fail there:

**Bug 1 — `lib/lanes.ts` `deriveLanes()`, array-index default survives an empty loop**

```
__tests__/lanes.test.ts:80
  expect(lane.currentStageIndex).toBeNull()
  Received: 0
```

`currentStageIndex` was initialized to `0` and raised by `for (i…) if (rolesSeen.has(PIPELINE_ROLES[i])) currentStageIndex = i`.
With zero comments the loop body never executes, so the leftover `0` — *planner, by array
position* — was rendered as the lit stage. Confirmed a logic bug on genuinely-empty
evidence, not a stale-render artifact.

**Bug 2 — `lib/stage-bar.ts` `resolveStageBar()`, `.find()` lands on element 0**

The `on-hold.test.ts` byte-identical drawer baseline is the smoking gun. Pre-fix rendered
markup:

```html
<div class="ak-pipeline" role="img" aria-label="stage: PLANNER active">
  <div class="ak-pipeline__step ak-pipeline__step--current ak-pipeline__step--glow" …>PLANNER</div>
  …
<p class="ak-timeline__empty">No role events recorded yet.</p>
```

The **same DOM** simultaneously asserts `stage: PLANNER active` (with the `--current --glow`
treatment) and `No role events recorded yet.` — a self-contradiction inside one element,
which is exactly the mislabel the ticket describes. `PIPELINE_ROLES.find(r => !rolesSeen.has(r))`
returns `PIPELINE_ROLES[0]` whenever `rolesSeen` is empty.

Both pre-existing tests genuinely pinned the bug as expected behaviour. Updating them was
required, not convenient.

**The baseline refresh is surgical.** I diffed the two `EXPECTED_NO_HOLD_DRAWER` string
literals character-by-character. The complete set of changed bytes:

- `stage: PLANNER active` → `stage: working, no role recorded yet`
- `ak-pipeline__step--current ak-pipeline__step--glow` → `ak-pipeline__step--pending`

Every other byte of that ~1.5 KB drawer baseline is identical. Nothing else was smuggled
into the anti-regression fixture, so it still guards what it always guarded (#1816's
on-hold feature must not alter a non-held ticket's drawer).

## 3. Fix shape — both array-default sites closed, not one

The concern was symptom-patching one site. Both are closed, and closed at the **shared
selector** rather than at the two render surfaces:

- `resolveStageBar` computes `noRoleEvidence = !PIPELINE_ROLES.some(r => rolesSeen.has(r))`
  and short-circuits to `pointer = null` before the forward-flow `.find()` is reachable.
- `deriveLanes` consumes **that same signal** (`stageBar.noRoleEvidence`) rather than
  re-deriving emptiness, so the drawer bar and the swimlane track cannot drift apart —
  preserving the #1468 invariant the selector exists to enforce.
- `LiveSwimlanes` handles `currentStageIndex === null` explicitly.

The predicate correctly counts only **pipeline** roles, so `orchestrator` / `research`
comments are not mistaken for chain evidence — pinned by a test.

I grepped for remaining array-position defaults (`PIPELINE_ROLES[0]`, `.find(`, `.indexOf(`,
`currentStageIndex`) across `lib/`, `components/`, `app/`. The two surviving sites are both
now unreachable-as-defaults:

- `lib/lanes.ts:111` `currentStageIndex = 0` — reachable only in the `else` branch, where
  `noRoleEvidence` is false, so ≥1 pipeline role is in `rolesSeen` and the loop assigns at
  least once. Dead as a default; retained only to satisfy definite assignment.
- `lib/stage-bar.ts:142` `.find(…)` — now guarded by the `noRoleEvidence` branch. Still has
  gapped-chain behaviour, discussed in §6.

## 4. Monotonicity checklist (#1590)

Every mutual-exclusion / precedence arm in the diff, with the stronger claim named and
erasure ruled out:

**Arm A — `resolveStageBar` branch chain.** Order is `noRoleEvidence` → `execPass` →
`execFail` → `planFail` → forward-flow. The **weakest** claim (an assertion of *absence* of
evidence) is placed **first**, which is normally the dangerous ordering. It is safe here by
construction, not by luck: `execPass`/`execFail` are gated on
`execReached = rolesSeen.has("execution-review")` and `planFail` on
`planReached = rolesSeen.has("plan-review")`; both roles are members of `PIPELINE_ROLES`, so
any of those three being true **forces** `noRoleEvidence === false`. The weaker claim
therefore can never erase a stronger one — the branch is only entered when all three
stronger branches are provably false. Empirically corroborated: all pre-existing #1468
fail-class / bounce fixtures stay green.

**Arm B — `deriveLanes` branch chain.** Order is `reworking && pointer` → `noRoleEvidence` →
forward. Strongest first. `reworking` is set only by `execFail`/`planFail`, which are
disjoint from `noRoleEvidence` by Arm A's argument. No erasure.

**Arm C — pill `look` precedence** (`forceGreyFromIndex` → pointer match → review verdict →
`reached`). Under `noRoleEvidence`: `forceGreyFromIndex` is `null`, `pointer` is `null` so
`role === pointer` is never true for a role string, and `reached` is false for all four. All
pills resolve `pending`. No arm can manufacture a lit pill from a null pointer.

**Arm D — `LiveSwimlanes` state ternary.** `failedStage === idx` is tested *before* the
`currentStageIndex === null` branch. A lane cannot hold both, because `failedStage` is
assigned only inside `deriveLanes`' `reworking` branch, disjoint from the `null` branch. Safe.
Note the null branch is behaviourally redundant for the *class* computation (`idx < null`
coerces to `idx < 0` → false; `idx === null` → false, so all stages would land `pending`
anyway) — but the accompanying `aria-label` guard is genuinely **load-bearing**: without it,
`stage ${null + 1} of 4` would emit the false string `"stage 1 of 4"`. Good catch by the
executor; the explicit class branch is defensive against a future refactor and costs nothing.

## 5. "WORKING" vocabulary matches `phaseLine()` — no third vocabulary

`lib/ui-meta.ts` `phaseLine()`, `in_progress` / no work-role / `active === true`:

```ts
return { text: "▶ WORKING", hueVar: "var(--live)", ariaLabel: "in progress, working now" };
```

The new chip matches on **all three** dimensions that matter:

| | `phaseLine()` | new lane chip |
|---|---|---|
| Text | `▶ WORKING` | `▶ WORKING` (`LiveSwimlanes.tsx:54`) |
| Hue | `var(--live)` | `color: var(--live)` (`.ak-lane-working`) |
| Glyph | `▶` (existing `▶ ◆ ✓ ✕ ⛔` vocabulary) | `▶` |

Repo-wide grep for `WORKING` shows exactly two render sites — `ui-meta.ts:373` and
`LiveSwimlanes.tsx:54` — plus their tests and comments. No third string was introduced.

**The `WORKING` vs `STARTED` branch is also correct**, which is a subtle point worth
recording: `phaseLine` splits `▶ WORKING` (active) from `▶ STARTED` (parked), and the lane
chip hard-codes `WORKING`. That is right rather than lucky, because `deriveLanes` gates every
lane on `if (!activeIds.has(t.id)) continue;` (`lib/lanes.ts:83`) — the same `computeActiveIds`
set `Card.tsx:38` passes as `phaseLine`'s `active` argument. A parked ticket is never a lane,
so the `STARTED` branch is unreachable on this surface.

The three aria strings differ per surface (`"in progress, working now"` /
`"stage: working, no role recorded yet"` / `"working, no stage evidence yet"`). This is **not**
a vocabulary fork — it matches the pre-existing pattern where `buildAriaLabel` already emits
`"stage: …"`-prefixed labels while `phaseLine` emits `"in progress, …"`. All three are honest
and none names a role.

**`status` vs `column`:** `noEvidenceAriaLabel()` switches on `ticket.status` while
`phaseLine()` switches on `ticket.column`. I checked `toColumn()` in `lib/build-board.ts` for
divergence in the zero-evidence state and found none: `execReview` derives from ledger lines,
so a zero-ledger ticket is always `"none"`, giving `in_progress→in_progress`,
`completed→done`, `pending→todo` (since `hasPipelineRoleComment` is false). The two fields
agree on exactly the inputs this function sees.

## 6. Adjacent defect — verified real, verified NOT a regression

The PR body discloses that a **gapped** chain (executor row present, planner row never) still
disagrees across surfaces. I probed it directly rather than taking the note on faith, running
the identical fixture against both commits:

```
executor-only ticket, one ledger row:
  parent 1aef8f6:  drawer_pointer=planner  aria="stage: PLANNER active; EXECUTOR passed"  swimlane_index=2
  PR head 9321c5a: drawer_pointer=planner  aria="stage: PLANNER active; EXECUTOR passed"  swimlane_index=2
```

**Byte-identical before and after.** The defect is real — it is the same
"claims PLANNER without planner evidence" class one ledger row later, and it is exactly the
#1821 single-role shape this ticket cares about — but this PR neither introduces nor worsens
it. The disclosure in the PR body is accurate and specific, and the test comment at
`__tests__/stage-bar.test.ts` that forward-references it is **not** a phantom reference: the
"Adjacent defect noted, deliberately NOT fixed here" section genuinely exists in the PR body.
Deferring a forward-flow semantics change out of a bug fix is the right call.

## 7. Non-blocking follow-ups

**(a) The PR body's bolded invariant is overstated.** It reads:

> **The invariant shipped: the board never claims a SPECIFIC role is active without ledger
> evidence that the role is running.**

§6 shows the drawer still emits `stage: PLANNER active` for an executor-only ticket with zero
planner evidence, and the PR's own "Adjacent defect" section concedes this. The bolded
sentence and that section contradict each other. The accurate scope is *"…without **any**
ledger evidence"* — the zero-evidence case, which is what actually shipped. Worth tightening
so a future reader doesn't inherit the stronger claim as settled fact.

**(b) The promised follow-up ticket does not exist.** The PR says the adjacent defect is
"flagged for a follow-up ticket rather than smuggled in", but a search of the local task board
(`~/.claude/tasks/`) finds only `1901.json` — no ticket covering the gapped-chain forward-flow
pointer. Since the local board is the ticket SSOT, the defect is currently recorded only in a
PR body and a code comment, which is where findings go to die. It should be ticketed at
identification.

Neither blocks the merge: (a) is prose in a PR description and (b) is a tracking action
outside the diff.

## Summary of what I verified myself

- [x] PR head SHA matches `origin/1901-lanes-live-planner-default` (`9321c5a8`)
- [x] All 5 CI checks SUCCESS at this head (2× build ubuntu/windows, privacy, Vercel, Vercel Preview Comments)
- [x] `npx tsc --noEmit` clean in a fresh worktree — exit 0
- [x] `npx jest` → 42/42 suites, 408/408 tests, in a fresh worktree with clean `npm ci`
- [x] Bug 1 reproduced RED at parent (`Received: 0`, expected null)
- [x] Bug 2 reproduced RED at parent (drawer emits `PLANNER active` + `--current --glow` alongside "No role events recorded yet")
- [x] `on-hold.test.ts` baseline refresh is byte-surgical — only the two pipeline-segment substrings changed
- [x] Both array-default sites fixed at the shared selector, not patched per-surface
- [x] No remaining reachable array-position default
- [x] Monotonicity: all four arms disjoint by construction; no weaker claim can erase a stronger one
- [x] `▶ WORKING` / `var(--live)` matches `phaseLine()` exactly; `WORKING`-vs-`STARTED` branch correct via the `activeIds` gate
- [x] Adjacent defect probed on both commits — real, pre-existing, unchanged by this PR
- [x] Forward reference in the test comment resolves to a real PR-body section
