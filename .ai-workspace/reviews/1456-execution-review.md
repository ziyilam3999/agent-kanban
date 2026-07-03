# Execution review — #1456 (auto-reveal the Live Swimlanes panel on a genuine `<2 → >=2` transition)

Scope note: this is a code review of one PR. Every claim below is a single reproducible
check (exact command shown), not a benchmark; re-run any of them with the cited command.

**Decision: PASS** (execution / code review), with named merge-preconditions owned by
downstream legs (see "REQUIRED BEFORE MERGE"). The executor's **code and every
code-facing Binary AC (AC1–AC7, AC11)** are correct and independently verified — the
RED-first wiring oracle genuinely discriminates (non-vacuous), the suite + typecheck are
green, privacy is clean, and no new network/poll was introduced. The outstanding items
are the **separate ui-evolve leg (AC9)** and **artifact-commit plumbing (AC8, plan,
screenshots)** — NOT execution-code defects, but they DO block the actual ship.

- **Reviewer:** stateless execution-reviewer (did NOT write this code).
- **PR:** https://github.com/ziyilam3999/agent-kanban/pull/55 — base `master`, head `1456-lane-reveal`.
- **Worktree:** `<repo>/.claude/worktrees/1456-lane-reveal` (Rule-12 isolated worktree off `origin/master`).
- **cairn:** searched — `cairn-find "lane"` → *"Option 2 (swimlanes gated to N≥2) is the
  most honest fix … board shows N≥2 swimlanes when work is truly parallel"* (#1295, the
  original build) confirms the `>=2` gate is intended; `cairn-find "scroll"` →
  *"A source-level contract test that only asserts CSS declarations or prop values"* is
  weak (#1447) — which is exactly why AC1 is a behavioral spy, not a string test.

---

## Verification results (all re-run independently in the worktree)

| Check | Command | Result |
|---|---|---|
| typecheck (AC4) | `npm run typecheck` | **exit 0** |
| full suite (AC3) | `npx jest` | **28 suites / 294 tests passed** (baseline was 26/279 → +15 new) |
| AC5 no-new-network (components/, added lines) | `git diff origin/master...HEAD -- components/ \| grep '^+' \| grep -v '^+++' \| grep -Ec "fetch\(\|POLL_MS\|setInterval"` | **0** |
| AC6 scroll-margin-top | inside `.ak-lanes` blocks | **2 declarations** (desktop `104px` L653; `<=640px` override `148px` L799) |
| AC7 privacy (real ci.yml pattern, fail-closed) | `git grep -nIE '(/Users/\|/home/\|[A-Za-z]:[\\/]Users[\\/])[A-Za-z0-9._-]+/' -- . ':(exclude)*.example' ':(exclude).github/workflows/ci.yml' ':(exclude)__tests__/*'` | **rc=1, no match → CLEAN** |

---

## Per-AC verdict

### AC1 — Behavioral wiring oracle (RED-first, non-vacuous) — PASS ✅ (independently re-verified)
The whole ballgame (R1). I re-checked BOTH ends myself:

**GREEN (branch):** `npx jest lane-reveal` → 5/5 wiring cases pass, all 294 suite tests green.

**RED (master-equivalent):** I reverted **only** `components/BoardView.tsx` to
`origin/master` (leaving the new test file + `lib/lane-reveal.ts` in place) and re-ran
the wiring oracle. Result:

```
✕ (a) fires exactly once on a genuine <2 -> >=2 transition
✓ (b) does NOT fire on a present->present transition (2 -> 3)
✓ (c) first-load seed proof: mounting already at >=2 does NOT fire
✕ (d) reduced motion -> scrollIntoView called with behavior:"auto"
✓ (e) does NOT fire while the ticket Drawer is open

● (a) … expect(jest.fn()).toHaveBeenCalledTimes(expected)
    Expected number of calls: 1
    Received number of calls: 0
      > 215 |     expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
```

This is an **EXECUTED assertion failure** (the test reached line 215/251 and observed
spy calls = 0, `0 !== 1`), **NOT a compile/import error** — the oracle imports only
`BoardView` (unchanged public signature on both master and branch) plus `motion-dom`
symbols that exist regardless of branch. Cases (b)/(c)/(e) correctly PASS on master
(they assert `not.toHaveBeenCalled`), so the file genuinely *discriminates* wiring
present vs absent. Non-vacuity is real. BoardView was restored to HEAD afterward
(`git status` clean).

### AC2 — Guard-decision matrix (pure fn, node-env) — PASS ✅
`lib/lane-reveal.ts::decideLaneReveal` is a clean pure function; `lane-reveal-decision.test.ts`
covers 10 cases (transition-fires, already-visible→no, drawer-open→no, `>=2→>=2`→no,
disappear `>=2→<2`→no, both-guards→no, reduced-motion→`auto`, motion→`smooth`). Flipping
any single guard clause (`prevCount < 2 && currentCount >= 2`, `!alreadyVisible`,
`!drawerOpen`) fails at least one case. Backstops guard-LOGIC vacuity; correctly does
NOT substitute for AC1's wiring check. Included in the 294-test green run.

### AC3 — `npm test` exits 0 — PASS ✅  28 suites / 294 tests, jest exit 0. Global `testEnvironment` stays `node`; the jsdom oracle is isolated via a per-file `@jest-environment jsdom` docblock (confirmed L1-3 of `lane-reveal.test.ts`), so the 20+ existing node-env suites are untouched.

### AC4 — `npm run typecheck` exits 0 — PASS ✅

### AC5 — No new network / no metered-cost regression (#1138) — PASS ✅
`components/` added-lines grep = **0**. The broader all-changed-files count (5) is
**entirely inside `__tests__/lane-reveal.test.ts`** (the `POLL_MS` mirror + the `fetch`
mock the oracle needs) — zero production network. The reveal is a pure `useEffect` over
the already-derived `lanes.length`; no `fetch`, no `setInterval`, no `POLL_MS` change, no
`/api/board` cache-header change. Metered-cost budget preserved.

### AC6 — `scroll-margin-top` on `.ak-lanes` — PASS ✅
Two real declarations, both inside `.ak-lanes` blocks: `104px` (desktop base, L653) and
`148px` (`@media (max-width:640px)` override, L799 — correctly larger because the header
wraps to 2 rows there). A third hit at L648 is a comment. Tolerant of variable header
height (the right call vs a brittle sticky `top` offset).

### AC7 — Privacy grep clean — PASS ✅
Ran the **real ci.yml pattern** fail-closed (`grep -nIE … rc=1 = no match`, plus a
`grep -Ec`/line-count belt-and-suspenders = 0 over all changed non-test files). No
`/Users/` or `/home/` home paths, no employer/internal tokens, no personal email in any
tracked non-test file. (Note: the exact `':!__tests__/*'` short-form pathspec errors on
this host's git — "Unimplemented pathspec magic '_'"; I used the equivalent
`':(exclude)__tests__/*'` long form, which CI's git accepts as the same exclusion.)

### AC8 — `design_brief` present — PARTIAL ⚠️ (content exists, UNTRACKED — see merge-preconditions)
`.ai-workspace/design/1456-lane-reveal-design.md` exists (160 lines, decisive POV +
rejected alternatives), but **only in the primary clone's working tree** — it is NOT
committed on the `1456-lane-reveal` branch and NOT in `git ls-files`. It will not ship
with the PR as-is.

### AC9 — `ui_evolve_verdict` present — NOT MET ❌ (owned by the separate ui-evolve leg; out of my scope per brief)
`.ai-workspace/design/1456-ui-evolve-verdict.md` **does not exist anywhere** (searched
worktree + primary clone; verdicts exist for #1447/#1174/#1295 but none for #1456). The
four e2e screenshots (`screens-1456/{d,m}-{before,after}*.png`) are on disk but
**untracked**, and there is no vision-judge `verdict: ACCEPT` + rubric-score file. My
brief explicitly says "DO NOT run ui-evolve," so this is a downstream leg still owed —
recorded here as a hard merge-precondition, not an execution-code defect.

### AC10 — execution-review PASS — this document.
### AC11 — plan-review PASS — PASS ✅  The plan's `## Review` section records
"plan-review verdict: PASS — 2026-07-03 (round 2)" resolving R1–R3 + r4–r7.

---

## Risky-logic scrutiny (I tried to break these)

1. **1→2+ transition fires EXACTLY once — CONFIRMED.**
   `prevLaneCountRef` is seeded from `lanes.length` at first render (not `useRef(0)`), and
   the effect deps are `[lanes.length, selectedId, reduce]` — **`lanes.length` (a number,
   the exact mount predicate), NOT `laneCount = activeIds.size`** (r4 folded correctly).
   The effect updates `prevLaneCountRef.current = currentCount` on every run.
   - **2→3:** `crossedIntoView = 2<2 && 3>=2 = false` → no fire. ✓
   - **Unrelated re-render / stable-count poll:** `lanes.length` unchanged → effect
     doesn't re-run; even if it did (selectedId/reduce change), prev==current → no fire. ✓
   - **2→1→2 flapping:** fires on the genuine 1→2 up-cross only; a repeat up-cross while
     the panel is on-screen is then suppressed by the already-visible guard. No repeated
     viewport yank. ✓
   - **First load already at >=2:** seed = current → no cross → no fire (shown by AC1(c)
     executed on both ends). ✓

2. **Guard-2 "already-visible" (the jsdom-blind case) — CONFIRMED a real check, NOT a no-op.**
   `isAlreadyInViewport(el)` reads `el.getBoundingClientRect()` and returns `true` only
   when the panel is *fully* within the viewport (`top>=0 && left>=0 && bottom<=vh &&
   right<=vw`); a zero-size rect (not-yet-laid-out / jsdom) returns `false` (safe default:
   reveal rather than wrongly suppress). `decideLaneReveal` gates
   `reveal = crossedIntoView && !alreadyVisible && !drawerOpen`, so an on-screen panel is
   correctly suppressed. The geometry test is genuine (reads real layout), not a stub. The
   plan honestly discloses (r5) that this runtime computation has **no automated proof**
   (jsdom rects are all-zero) and rests on the ui-evolve visual leg — accurate, no
   over-claim. The negative case (already-visible ⇒ no scroll) is therefore code-correct
   but not yet visually confirmed (blocked on the missing AC9 leg).

3. **Reduced-motion — CONFIRMED.** `behavior = reducedMotion ? "auto" : "smooth"`;
   AC1(a) covers `smooth`, AC1(d) covers `auto` (both re-run by me). CSS also disables the
   arrival glow under `@media (prefers-reduced-motion: reduce)` (`.ak-lanes--arrive
   { animation: none !important; border-color: var(--live) }`, L827-830) — a static border
   stands in. No focus theft (scrollIntoView only, no `.focus()`).

4. **Horizontal-overflow — no regression in the code.** `.ak-lanes` uses margin/padding +
   flex-column; the `<=640px` override stacks lanes full-width; `scroll-margin-top` does
   not affect layout width. The e2e spec asserts `document.scrollWidth <= clientWidth` on
   BOTH desktop (1440) and mobile (390). (The e2e assertion exists in-spec; it requires a
   real browser run — captured by the ui-evolve/e2e leg, not this jest-scoped review.)

5. **Arrival-cue = box-shadow/border-color only (zero layout shift) — CONFIRMED.**
   `@keyframes ak-lanes-arrive` animates only `box-shadow`/`border-color`; no transform of
   surrounding flow. Telemetry-console "no layout shift" rule respected.

### Minor non-blocking observations (cosmetic, not defects)
- **Stuck `arrive` class edge-case (cosmetic).** The reveal effect's cleanup clears
  `arriveTimer` on any dep change (`lanes.length`/`selectedId`/`reduce`). If the user
  opens a card (`selectedId` change) within the 1.9s `ARRIVE_MS` window right after a
  reveal, `setArrive(false)` never fires and `ak-lanes--arrive` stays applied. The CSS
  animation still completes visually (it ends at the neutral 100% keyframe), and the
  *scroll* — the primary function — is unaffected; the only effect is a hypothetical later
  reveal not replaying the glow. Purely cosmetic, out-of-scope to block.

---

## REQUIRED BEFORE MERGE (not execution-code defects — owned by orchestrator / ui-evolve leg)

These do NOT reflect on the executor's code, but the PR must not merge until they are
resolved (the `hooks/ui-task-gate.sh` fail-closed backstop will correctly block the
completion `TaskUpdate→completed` without them):

1. **AC9 — run the ui-evolve leg.** Produce `.ai-workspace/design/1456-ui-evolve-verdict.md`
   with a `verdict: ACCEPT` line + rubric score, referencing the mobile + desktop
   screenshots, plus an explicit no-visual-regression statement. This is the taste gate
   (knob B = "both") and is currently missing entirely.
2. **AC8 + plan + screenshots — commit to the PR branch.** The design_brief
   (`1456-lane-reveal-design.md`), the plan (`2026-07-03-1456-lane-reveal.md`), and the
   four `screens-1456/*.png` currently live only as untracked/primary-clone files, so they
   will not ship via PR (Plan-First "ships via PR" + the UI-task gate needs the
   design_brief on file). Add them to the branch before ship (#861-class artifact-location
   split — reviewer/planner cwd is the primary clone, not the worktree).

---

## Summary

The executor delivered correct, well-guarded code with a **genuinely non-vacuous**
RED-first oracle (independently re-verified both ends — RED on master-equivalent, GREEN on
branch), a clean pure-function guard matrix, green suite + typecheck, clean privacy, and
zero new network — every code-facing AC (AC1–AC7, AC11) passes. **Decision: PASS** for the
execution/code review. The remaining work (AC9 ui-evolve verdict; committing
AC8/plan/screenshots) is downstream-leg / plumbing, explicitly out of execution-review
scope, and is flagged above as a hard precondition the orchestrator must clear before merge.
