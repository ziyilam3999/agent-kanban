# Execution Review — #1867 pending-execution-review lane visibility (PR #65)

Decision: PASS

- **Task**: #1867 — a genuinely-running execution-review (PENDING verdict) falls through both
  lane-population filters, so the "N LANES LIVE" pill undercounts (false negative).
- **PR**: #65, branch `fix/1867-pending-review-lane-visibility`
- **Head reviewed**: `05f6f0c93edc24e5e2ce6c9d8b55297960e6856c` — verified equal to the PR's
  `headRefOid`, so this review covers exactly what will merge.
- **Reviewer**: execution-review seat, stateless. Did NOT author the plan or the code.
- **Date**: 2026-07-25

cairn: "#1880's cc-execution-review agent had been genuinely running since 13:33 (subagent
transcript actively written at 13:45) yet was INVISIBLE" — working-memory card
`infra-bugs/2026-07-25-1-lane-live-pill-1867-false-negative-live-confirmed`. Also matched:
`infra-bugs/1852-punch-clock-stream-pollution`, plus T1 stones 2026-07-24 ("Liveness punch-clock
(#1852 mechanism-b) is only as honest as its STREAM") and ("Board 'lanes live' indicators driven
by ledger/log file mtime, not actual process state").

---

## ELI5

The board has a little badge that says how many jobs are running right now. When a checker agent
starts checking someone's work, the ticket moves to the REVIEW pile — and the badge's two counting
rules only knew how to count "still being built" and "already passed, being shipped". A ticket
being checked *right now* matched neither, so the badge pretended nobody was working. This change
adds a third counting rule: "a checker is punched in and hasn't punched out yet". I re-ran every
test myself, deleted the fix to prove the new test really catches the bug, and poked at the one
place where adding a rule could accidentally *remove* a lane. It holds up. PASS.

---

## Per-check evidence

### 1. Diff read independently

3 files, +286 / −4:

| File | Change |
|---|---|
| `lib/active.ts` | New exported `pendingReviewInFlight()`; OR-ed into `computeActiveIds`' population filter |
| `lib/lanes.ts` | Same predicate OR-ed into `deriveLanes`' population filter; imports it from `./active` |
| `__tests__/lane-pending-review-visibility.test.ts` | New, 228 lines, 6 ACs |

No other file touched. `pipelineHasOpenPunchIn`, `chainInFlight`, `shippingAfterPass`, `isHeld`,
`toColumn` are all **unmodified** — confirmed from the diff, not from the commit message.

### 2. Predicate correctness — verified at source, not from the doc comment

**Both filters are genuinely wired.** `lib/active.ts` population filter now reads
`(in_progress || shippingAfterPass || pendingReviewInFlight) && !isHeld`; `lib/lanes.ts` reads the
matching negated form. The two filters agree on all three disjuncts.

**No import cycle.** `lanes.ts → active.ts → ui-meta.ts → board-schema.ts`, and `ui-meta.ts` /
`stage-bar.ts` import only `board-schema` / `ui-meta`. Verified by grepping the import lines, and
`tsc --noEmit` is clean.

**The predicate is exactly scoped to the PENDING state** — I re-derived this rather than trusting
the docstring:

- `t.column === "in_review"` is reachable only from `execReview ∈ {pending, resolved-nonfail}`
  (`lib/build-board.ts`, `toColumn`). `resolved-fail` maps to `in_progress`. So the doc's claim
  *"fail-class puts the column back in in_progress (never in_review)"* is **true at source**, which
  matters: were it false, a fail-class ticket would satisfy every conjunct and silently widen the
  predicate.
- `!shippingAfterPass(t)` then removes `resolved-nonfail`, leaving exactly `pending`.
- **The two verdict readers cannot disagree.** `toComment` and `newestExecutionReviewState` both
  call the same `resolveVerdict` helper (which includes the artifact `Decision:` fallback), so the
  ticket's `column` and `shippingAfterPass` are computed from the same resolution. A review that
  passed via the artifact fallback but carries no ledger `verdict` field therefore does **not** leak
  into the new predicate. This was the most plausible correctness hole and it is closed.

**#1852 non-regression — the three named semantics:**

- *Crashed reviewer stays dark.* `chainInFlight` delegates to `pipelineHasOpenPunchIn`, untouched
  here. A reviewer with `closedAt` and no verdict is punched OUT ⇒ predicate false. AC-2 pins it;
  I also re-derived it by reading the accumulator.
- *6h cap holds.* New population members reach `active` only through disjunct 1, which applies
  `nowMs - t.updatedAt <= inflightCapMs`. There is no bypass path. AC-3 pins it.
- *#1816 held-ticket exclusion holds.* `!isHeld(t)` sits **outside** the OR, so it still gates every
  member including the new ones.

AC-4 deliberately pins that an `on_hold` string on an `in_review` ticket does *not* suppress the
lane, because `isHeld` is column-gated to `in_progress` by #1816's own design. I agree with both the
behavior (a punched-in reviewer really is a live lane) and with pinning it, so a future `isHeld`
widening surfaces as a conscious decision.

### 3. Test suite + typecheck — re-run by me, not taken on report

```
Test Suites: 42 passed, 42 total
Tests:       393 passed, 393 total
tsc --noEmit → exit 0
```

Note for the record: the "42/42" in the executor's report is **suites**; the test count is 393. No
existing suite needed modification, which is itself evidence the change is additive.

### 4. Red-arm (delete-the-input) oracle — I ran it

Reverted **only** the two population filters back to `in_progress ∪ shippingAfterPass`, keeping
`pendingReviewInFlight` exported so the suite still compiles, then re-ran the new file:

```
✕ AC-1  expect(active.has("ut")).toBe(true)   → Received: false
✕ AC-4  expect(active.has("ut")).toBe(true)   → Received: false
✓ AC-2  ✓ AC-3  ✓ AC-5  ✓ AC-6
```

This is a correct red-arm: the failures land precisely on the added behavior, and the
non-regression ACs (2/3/5/6) stay green without the fix — i.e. they are genuinely testing the
preserved semantics, not free-riding on the change. Sources restored afterwards; working tree
verified clean (`git status --short` empty) before writing this file.

### 5. CI — checked directly

All 5 checks green on `05f6f0c`: `build (ubuntu-latest, 20)`, `build (windows-latest, 20)`,
`privacy`, `Vercel`, `Vercel Preview Comments`. `mergeable: MERGEABLE`,
`mergeStateStatus: CLEAN`.

### 6. cairn / prior-incident grounding

Searched `lane liveness`. This is the fourth member of a known family (#1403 undercount → #1481
mtime-proxy-both-ways → #1852 6h-latch/false-positives → #1867 false-negative). Two findings that
bear on the merge decision:

- The 2026-07-25 card confirms the mechanism live on real production data and describes exactly the
  fix shape this PR implements — the predicate, both filters, and the three preserved semantics.
  The code matches the diagnosis.
- The #1852 card records that the punch-clock **stream** still has three measured defects
  (backfilled open rows for dead agents, ghost duplicate open rows, cap re-arm on sweep), and that
  the ai-brain `sole-lane-parallelization-gate.sh` consumer (#1859) still counts lanes by ledger
  mtime. **None of those are in scope here and none are fixed by this PR.** Merging #65 closes the
  board-side false negative; it does not retire the family. Recorded so a green merge is not later
  read as "lane liveness is solved".

---

## Monotonicity checklist (#1590)

Three arms in or adjacent to the diff:

1. **`pipelineHasOpenPunchIn` per-agentId accumulate** (`alreadyClosed || !!c.closedAt`).
   Stronger claim = **punched-OUT**. A later open-looking row for the same agentId can never erase a
   `closedAt`, and the OR-accumulate is order-independent. **Unchanged by this diff**; re-verified by
   reading it.
2. **The population filter is a pure OR-widening.** No clear-list, no mutual exclusion, no
   last-writer-wins. `pendingReviewInFlight` can only ADD members to the population.
3. **The one real finding — widening the population is *not* monotone in the OUTPUT.** Disjunct 2's
   chain-less-focus fallback is conditioned on `inFlightIds.size === 0`. Adding an in-flight member
   flips that condition, which can darken a previously-lit chain-less focus ticket. I measured this
   rather than reasoning about it, running the same three fixtures against both filter states
   (rider = chain-less `in_progress`, last touched 20 min ago, outside the 8-min window):

   | Probe | master filters | PR #65 filters |
   |---|---|---|
   | C1 — pending-review **inside** cap + rider | `['rider']` | `['pend']` |
   | C2 — pending-review **beyond** 6h cap + rider | `['rider']` | `[]` |
   | C3 — `in_progress` chain **beyond** 6h cap + rider (never touches the new predicate) | `[]` | `[]` |

   **C1 is a strict improvement**: the lit lane moves from an agentless 20-min-stale rider to the
   genuinely-running reviewer — precisely the pathology the #1867 card describes at 13:41 ("the ONE
   shown lane was #1883, which had NO running subagent").

   **C2 is a 1→0 narrowing, but C3 proves it is pre-existing, not introduced here**: the identical
   outcome is already reachable on master through the `in_progress` door. The mechanism is
   #1852-r3's `hasAnyPipelineComment` focus-narrowing, not new code in this PR; #1867 only widens
   which populations can reach it. The weaker claim (chain-less focus fallback) correctly yields to
   the stronger claim (a genuine open pipeline punch-in exists somewhere), which is the documented
   intent of disjunct 2. And the lane it removes had no running agent, so the narrowing is more
   honest, not less.

   **Verdict on this arm: correct direction, acceptable side effect, not a blocker.**

---

## Non-blocking follow-ups

1. **No test pins the C1/C2 focus-fallback interaction.** A follow-up ticket should add a fixture so
   a future change to disjunct 2 shows up as a deliberate decision rather than silent drift — the
   same spirit as this suite's own AC-4 #1816 pin.
2. **Scope note (from cairn):** the punch-clock stream defects and the #1859 mtime-based consumer
   remain open. This PR is correctly scoped narrower than the family.
3. **Nit, no action.** `resolveVerdict` returns the raw token and `toComment` sets `c.verdict` only
   if it survives `redact()`. A verdict token that redacts to empty would make the column read
   `resolved-nonfail` while `shippingAfterPass` reads false, admitting such a ticket to the new
   predicate. Pathological, pre-existing (`chainInFlight` has identical exposure on master), and
   bounded by punch-out plus the 6h cap.
4. **UI-task gate not applicable.** The diff touches only `lib/*.ts` and `__tests__/` — no
   component, no CSS, no design surface. The pill's count changes; nothing visual does.

---

## Decision

**Decision: PASS**

The claimed fix is real and correctly wired into both filters; the three #1852 semantics
(crashed-reviewer-dark, 6h cap, held-ticket exclusion) are preserved by construction rather than by
assertion; the new suite red-arms correctly under a genuine revert; 393 tests and `tsc --noEmit`
pass on a re-run I performed myself; and CI is fully green on the exact head sha that will merge.
The one non-monotone output path is measured, doctrine-consistent, and demonstrably pre-existing.

Recommend merge. I am not merging — that is the orchestrator's call.
