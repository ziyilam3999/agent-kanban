# AC-7 — Both-ends evidence: agent-kanban-shelf-bookkeeping-drawer-body-unbounded-no-internal-scroll

**Plan:** `.ai-workspace/plans/2026-09-11-shelf-drawer-bounded-scroll.md` (plan-review PASS)
**Spec:** `e2e/shelf-scroll.e2e.spec.ts` (12 tests) + no-regression check on `e2e/shelf.e2e.spec.ts` (2 tests)
**Pre-fix baseline:** `752a531c30608537b69c814ce9b52a830f399ffe` (full 7+ char sha per plan-review
carry-forward note #2)

**Scope note:** every number below is a single local Playwright run (`--project=chromium`, this
machine, this session) — not a repeated-N statistical benchmark. Each run is reproducible via the
exact `npx playwright test` invocations named in each section, against the exact CSS/spec state
described; this file itself becomes the git-tracked, PR-carried artifact once committed.

## 1. RED run against pre-fix `752a531` (app/globals.css swapped to that commit's version; test spec
   + production-volume fixture kept at PR-head shape — the fixture extension is additive test
   infrastructure, not part of the fix under test)

Command: `PW_WEB_SERVER=1 npx playwright test e2e/shelf-scroll.e2e.spec.ts --project=chromium --reporter=list`
with `app/globals.css` checked out from `752a531` (`git show 752a531:app/globals.css`).

| # | AC | Cell | Assertion | Expected | Received |
|---|---|---|---|---|---|
| 1 | AC-1 | 390x844 | `scrollHeight > clientHeight` | `> 16931` | `16931` |
| 2 | AC-2 | 390x844 | `scrollTop` delta after real touch swipe | `> 0` | `0` |
| 3 | AC-5 | 390x844 | Parked label pinned within `bodyBox.top + 24` | `<= 24` | `13987.89` |
| 4 | AC-1 | 1440x900 | `scrollHeight > clientHeight` | `> 14665` | `14665` |
| 5 | AC-2 | 1440x900 | `scrollTop` delta after real wheel event | `> 0` | `0` |

This single run measured **7 passed, 5 failed** — the 5 failures match the plan's predicted RED
corpus for AC-1/AC-2/AC-5, with one honest discrepancy on AC-3 (below).

### Honest discrepancy: AC-3 did not independently RED on the plain `752a531` baseline this run

The plan (line 59) predicted AC-3 would RED at both cells alongside AC-1/AC-2. Measured this run:
AC-3 passed on `752a531` at both cells instead. Root cause: AC-3's assertion is "the first/last card
is fully inside the body's own bounding box" — on the pre-fix unbounded body this is trivially true,
because the body's box simply grows to contain every card (nothing is ever clipped when there is no
`max-height`). The assertion only discriminates when the body IS height-constrained (post-fix), where
a broken sticky/overflow implementation could still clip an edge card even though the container is
bounded. This does not weaken the overall Rule-17 corpus: AC-1 and AC-2 (the assertions that actually
test "is the panel bounded and does it capture the gesture") both RED exactly as predicted, so the
suite as a whole still has a genuine pre/post discriminator this run. AC-3 remains a valid GREEN-side
regression check (it verifies reachability is preserved once bounding is added) — it just is not
itself a RED-control member of the corpus. Reported honestly per the executor brief rather than
silently reinterpreted or dropped.

AC-4 also did not RED on the plain `752a531` baseline at either cell this run (nothing overflows
without a wide child present) — this matches the plan exactly (line 59: "AC-4's document-level
reading" is a GREEN control that must not move). AC-4's RED control lives on a separate no-pin
scratch variant, §2 below.

## 2. AC-4 scratch-variant RED (plan L49's RED control, oracle-must-vary check)

Two scratch CSS variants were tried locally against PR-head's spec, both injecting a wide child then
driving a REAL gesture (touch drag on mobile, wheel on desktop) directly over it — never a raw
`element.scrollLeft = x` JS write (see the interaction-test marker's rationale: a raw write is a
CSSOM escape hatch no real user gesture can trigger, and — measured live this session — Chromium
still lets a JS write move `scrollLeft` through `overflow-x:hidden` when the other axis is `auto`, so
it is not a valid discriminator for this property).

**Variant A — `overflow-x:hidden` removed only (`touch-action:pan-y` still present):**

| Cell | Gesture | `scrollLeft` (single-run measurement) |
|---|---|---|
| 390x844 (touch) | real touch drag | `0` (still passes — `touch-action:pan-y` independently blocks horizontal touch panning, defense-in-depth doing its own job) |
| 1440x900 (wheel) | real wheel | `328` (RED) |

**Variant B — `overflow-x:hidden` AND `touch-action:pan-y` both removed (the fuller "no explicit
horizontal pin at all" scratch variant):**

| Cell | Gesture | `scrollLeft` (single-run measurement) |
|---|---|---|
| 390x844 (touch) | real touch drag | `216` (RED) |
| 1440x900 (wheel) | real wheel | `328` (RED) |

Both cells RED this run once every horizontal-pin mechanism is removed, demonstrating the AC-4 oracle
is capable of varying (Rule-17 both-ends check) — not a statistical claim, a single reproducible
counter-example run. Honest note: on mobile specifically, `touch-action:pan-y` (not
`overflow-x:hidden`) is the property that actually blocks a real touch-gesture horizontal pan — both
properties ship in the fix and are each independently doing real work (`overflow-x:hidden` for
wheel/keyboard and as the CSS-level pin the plan asked for; `touch-action:pan-y` for touch
specifically).

## 3. GREEN run at PR head (this branch, full CSS + spec)

Command: `PW_WEB_SERVER=1 npx playwright test e2e/shelf-scroll.e2e.spec.ts e2e/shelf.e2e.spec.ts --project=chromium --reporter=list`

All 12 tests in `e2e/shelf-scroll.e2e.spec.ts` passed, plus both pre-existing tests in
`e2e/shelf.e2e.spec.ts` (AC-1.4 desktop, AC-1.5 mobile real-interaction — no regression), this run:

```
14 passed (28.8s)
```

## 4. No-regression (AC-6) — full existing suites, this session's runs

- **Jest** (`npm test`): `Test Suites: 51 passed, 51 total` / `Tests: 512 passed, 512 total`.
- **Playwright full suite** (`PW_WEB_SERVER=1 npx playwright test --project=chromium --reporter=list`,
  all specs): `142 passed`, `4 failed` this run. All 4 failures appear to be pre-existing and
  unrelated to this change — checked by re-running the same 3 spec files against the plain pre-fix
  `752a531` baseline (before any of this task's edits) and observing the same failure class there
  too:
  - `board-render-perf-parity.e2e.spec.ts` — AC-6 static visual-parity screenshot diff
    ("board-top-desktop") — a pixel-diff against a baseline snapshot, unrelated to shelf CSS; failed
    the same way on `752a531`.
  - `board-render-perf-unchanged-tick.e2e.spec.ts` — AC-4 main-thread cost budget (`<= 50ms`,
    received `1983ms`/`4656ms` across separate runs) — machine-load-sensitive, matches the same
    documented precedent in `.ai-workspace/reviews/agent-kanban-fold-portrait-overflow-red-evidence.md`
    ("confirmed pre-existing, not a regression"); failed the same way on `752a531`.
  - `fold8-inp-under-poll.e2e.spec.ts` (2 cells, 750x1000 and 1000x750) — AC-3a zero-longtask
    budget, received 1-4 longtasks — same precedent class; flaky under machine load, observed across
    both PR-head and isolated re-runs this session, unrelated to any file this task touches.

  None of these three spec files import, reference, or exercise `.ak-shelf`, `app/globals.css`'s
  shelf rules, or `e2e/fixtures/board-fixture.ts`'s new `shelfVolume` option.

## Summary (this session's single-run measurements)

| Leg | This-run result |
|---|---|
| RED on `752a531` (AC-1/AC-2/AC-5 both cells) | Observed — 5/5 as predicted |
| AC-3 RED-control claim | Did not hold on the plain baseline — reported honestly in §1, does not weaken the corpus |
| AC-4 RED-control (scratch variant, oracle-must-vary) | Observed on the fuller no-pin variant, both cells |
| GREEN at PR head | Observed — 14/14 shelf tests, no regression on existing shelf spec |
| No-regression on full suite | Observed — 142/146 Playwright (4 pre-existing/unrelated per baseline re-run), 512/512 jest |
