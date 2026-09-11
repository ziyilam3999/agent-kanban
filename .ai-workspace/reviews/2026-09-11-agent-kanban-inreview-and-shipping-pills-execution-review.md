# Execution-review — agent-kanban REVIEW/SHIPPING pill honesty

Decision: PASS

Task: `agent-kanban-inreview-and-shipping-pills-overstate-progress`.
Repo/PR: `ziyilam3999/agent-kanban` #82 — head `2f838ddc9ee9e6a60f5cf60539321109a6c3fee2`, base `master`.
Plan: `.ai-workspace/plans/2026-09-11-agent-kanban-inreview-and-shipping-pills-overstate-progress.md`.

Stateless, adversarial execution-review — I did NOT write this code. Every Binary AC below was
verified against the actual `lib/ui-meta.ts` diff and by RUNNING the tests myself (GREEN at PR head
AND a RED reproduction at the pre-fix base `1d00251`), not by trusting the green check or the
executor's own claims.

## Named-risk notes disposition
`node hooks/named-risk-notes.mjs list --task agent-kanban-inreview-and-shipping-pills-overstate-progress`
→ `NO-NOTES`. Nothing was carried forward for this task, so the receiving-end disposition duty is
skipped. (Plan-review's N2 gaming-theorem note was recorded as a non-blocking note-to-reviewer, not a
carried named-risk note; it is nonetheless dispositioned below under "Not a stub".)

## The badges DO key on the current gating signal (not a blend or a stale round)

**1. `latestReviewVerdict` no longer decides the in_review pill — a current-signal selector replaces it.**
The neutral/pending path in the `in_review` branch changed from `const verdict = latestReviewVerdict(ticket);`
to `const verdict = newestExecutionReviewVerdict(ticket);`. The new selector:
```
function newestExecutionReviewVerdict(t: Ticket): string | undefined {
  let v: string | undefined;
  for (const c of t.comments) {
    if (c.role === "execution-review") v = c.verdict;
  }
  return v;
}
```
This is a comment-POSITION scan (comments arrive oldest-first → last exec-review match is the newest
row), the same convention `shippingAfterPass` uses. It returns `undefined` both when the newest
exec-review row is open (no verdict) AND when there is no exec-review comment at all → neutral
`◆ REVIEW`. It is deliberately NOT `latestVerdictForRole('execution-review')` (which skips an open row
and would surface a stale prior round's verdict). `latestReviewVerdict` is untouched (the DONE pill
still uses it, its 4 unit tests stay green). Fixes AC-1 (F-A: plan-review PASS never bleeds onto the
in_review pill) and AC-2 (F-B: a stale round-1 FAIL never shows while round 2 is open).

**2. `shippingAfterPass()` now respects held — "hold beats ship".** `isHeld()` widened from
`Boolean(onHold) && column === "in_progress"` to
`Boolean(onHold) && (column === "in_progress" || shippingAfterPass(ticket))`, and the `in_review`
branch checks `isHeld(ticket)` FIRST (before the shipping sub-branch). A deliberately-parked ticket
whose gating review already passed now renders `⏸ ON HOLD`, never `✓ PASS — SHIPPING`. Fixes AC-3.

**3. SHIPPING gets an honest verdict-age upper bound that does not depend on session death.** STALE
changed from `ageExceedsCap && sessionDefinitelyDead` to
`ageExceedsCap && (sessionDefinitelyDead || verdictTooOld)`, where `verdictTooOld` is the newest
exec-review verdict's age (from `closedAt`, else `ts`) exceeding the new exported
`SHIPPING_STALE_VERDICT_AGE_MS = 24h`. Fixes AC-4/AC-5.

## Monotonicity checklist (#1590) — every clear/exclusion/last-writer arm

- **`newestExecutionReviewVerdict` (last-writer-wins loop):** the NEWEST exec-review row wins;
  an older round's verdict cannot survive because a later iteration overwrites it — including
  overwriting a prior FAIL/PASS with `undefined` when the newest row is open (exactly AC-2). Stronger
  claim = "the row currently gating the column"; weaker (earlier round) provably cannot erase it.
- **`isHeld` disjunction:** the running-reviewer shape (F-K: onHold + open exec-review in the
  in_review column) is excluded from BOTH disjuncts (column ≠ in_progress; `shippingAfterPass` false
  because the newest exec-review row is open) → NOT held → keeps its lane. Stronger claim = "a running
  agent is a live lane" (#1867 AC-4 pin); it wins because `isHeld` returns false. Verified live:
  `isHeld(F-K) === false`, `computeActiveIds([focus, F-K]).has("fk") === true`.
- **`isHeld` terminal-wins:** completed+onHold (F-H) → `shippingAfterPass` requires
  `status === "in_progress"` and column ≠ in_progress → both disjuncts false → not held. Terminal
  status still wins by construction. Verified: `isHeld(F-H) === false`, pill `✓ DONE · PASS`.
- **STALE disjunction:** the second STALE arm is a strict WEAKENING (adds an OR term → fires in more
  cases), the intended honesty direction. The critical monotonic guard: `ageExceedsCap` is ANDed
  FIRST, so a fresh board write (F-I, ship-tail row 2 min ago) keeps `ageExceedsCap` false →
  SHIPPING regardless of verdict age. The stronger "actively shipping" reading (fresh write) can
  never be erased by the weaker STALE reading. Fail-closed: unparseable/missing verdict timestamp →
  `verdictAgeMs` undefined → arm inert (never a bogus STALE); `nowMs` omitted → back-compat SHIPPING.

## Not a stub (plan-review N2 — the finite-AC gaming theorem)
The diff is a genuine selector + predicate change to real functions consumed by the whole pill/
lane/card/drawer surface, NOT a fixture-memorizing stub pattern-matching F-A..F-K. Confirmed by
reading each changed function directly: `newestExecutionReviewVerdict`,
`newestExecReviewVerdictAgeMs`, the widened `isHeld`, the extracted `heldPhaseLine`, and the widened
STALE disjunction — all operate on arbitrary ticket shapes, none reference the test fixtures.

## RED-first oracle — independently reproduced (not asserted)
I created a detached worktree at `1d00251` (pre-fix `lib/ui-meta.ts`), copied the committed test file
in minus the one bonus assertion importing the new `SHIPPING_STALE_VERDICT_AGE_MS` export (absent at
that SHA — would fail the whole suite to COMPILE), and ran it. Result:
`Tests: 13 failed, 10 passed, 23 total` — EXACTLY the plan's Rule-17 RED corpus and matching the
executor's red-evidence table member-for-member:
- RED (13): AC-1 F-A pill; AC-2 F-B pill; AC-3 F-C/F-C2 phaseLine, F-C/F-C2 Card markup,
  F-C/F-C2 Drawer markup, F-C2 computeActiveIds exclusion; AC-4 F-D live-STALE; AC-5(b) F-J' 25h;
  AC-5(e) F-D ts-fallback; AC-6 F-K pill. Every RED member received `✓ PASS — SHIPPING` /
  `◆ REVIEW · PASS` / `◆ REVIEW · FAIL` at head — a materially different (wrong) output.
- GREEN controls (10) that already held on master: AC-5(a) F-J 23h, AC-5(c) F-I fresh write,
  AC-5(d) no-clock back-compat, AC-5(f) F-D DEAD session, AC-6 F-K lane count, F-G, F-H, F3, F-E, F-F.
Non-vacuous both-ends oracle: every RED member differs from its GREEN target; every named control
that should already pass on master does.

## GREEN at PR head — full suite + scope + typecheck (run by me)
- `npx jest` (whole repo): `Test Suites: 51 passed, 51 total | Tests: 512 passed, 512 total`.
- `npx jest __tests__/phase-pill-honesty.test.ts`: 24/24 passed.
- `npm run typecheck` (`tsc --noEmit`): exit 0.
- AC-7 scope: `git diff --name-only origin/master...HEAD -- __tests__` = exactly one path,
  `__tests__/phase-pill-honesty.test.ts`. No existing test file edited; every named hold-out
  (phase, monotonic-flow, on-hold, lane-pending-review-visibility, card, stage-bar, lanes, active,
  live-swimlanes) green UNEDITED inside the 512.

## UI-task gate legs (report — the completion gate blocks ticket→completed without these)
- **Leg 1 — design POV / brief:** the plan's §"Design POV" is a non-empty, on-purpose design brief
  (pill states the current gate; hold beats ship; running agent outranks parked note; one vocabulary,
  zero new tokens). Plan cites `metadata.design_brief` = the plan path. Artifact EXISTS. The task
  board record does not yet carry the `design_brief` metadata key — the orchestrator stamps it at the
  ticket→completed transition citing this artifact.
- **Leg 2 — ui-evolve verdict:** `.ai-workspace/reviews/agent-kanban-inreview-and-shipping-pills-ui-evolve-verdict.md`
  carries a structured `verdict: ACCEPT`, total 12/12 (R1/R2/R3 each 4), regression guard PASS, scored
  on REAL Playwright screenshots (`playwright-core` headless Chromium, `next dev`, gitignored local
  `data/board.json` fixture, never published). NOT a computed-style/at-rest check. I eyeballed both
  committed PNGs (Rule 19): `.ai-workspace/design/screens-pill-honesty/desktop-board.png` (1440×900)
  and `mobile-board-review.png` (390×844) — genuine rendered boards showing all five corrected states
  (#505 `✓ PASS — SHIPPING`, #501/#502 neutral `◆ REVIEW`, #504 `✓ PASS — STALE`, #503 `⏸ ON HOLD` +
  `⏸ held 5d`) and "3 LANES LIVE" including #502 (the #1867 running-reviewer lane). Real, honest, and
  distinct at a glance.
- **Leg 3 — interaction test:** the plan cites `metadata.interaction_test_na` (a ≥20-char specific
  reason: "phase-line pill text/hue selection only — no scroll, drag, tap or pointer surface changes;
  pure lib/ui-meta.ts function proven RED→GREEN by jest fixtures F-A..F-K") and DELIBERATELY does NOT
  cite `metadata.interaction_test`. Cross-key precedence therefore consults the N/A. The change has no
  pointer/scroll/drag surface (pure text/hue selection in a lib function) — the leg-scoped N/A is
  legitimate. No cited FAIL/incomplete `interaction_test` marker exists to be laundered.
- **4th artifact — production build:** agent-kanban is in `PROD_BUILD_GUARD_REPOS`. The CI `build
  (ubuntu-latest, 20)` job (`next build`) is GREEN on head `2f838dd`. The
  `scripts/prod-build-marker.sh <agent-kanban-repo-root> --pr 82` marker (bound to head `2f838dd`) is
  produced at ship by the merge-time guard and does NOT yet exist. NOT a FAIL — it is a REQUIRED
  ship-tail step the ship-tail seat must run before `gh pr merge`.

## AC-10 privacy (per docs/privacy-scan-invocation-contract.md)
Scanned the 5 changed text artifacts with `bash scripts/privacy-scan.sh --working <path> ...` (paths:
the plan, red-evidence, ui-evolve-verdict, `__tests__/phase-pill-honesty.test.ts`, `lib/ui-meta.ts`).
Verbatim verdict: `privacy-scan: CLEAN mode=working size=81766`. Positive control (identical
invocation shape, scratch copy carrying a seeded `<home-dir-path-pattern>` needle):
`privacy-scan: DIRTY (home-path matches=1, ...)` — the instrument had power against this artifact's
own match class. The two committed PNGs are binary; the CI `privacy` job (GREEN on head) covers the
full changeset including them.

## PR state
Base `master`, head `2f838ddc9ee9e6a60f5cf60539321109a6c3fee2`, `mergeStateStatus: CLEAN`,
`mergeable: MERGEABLE`, state OPEN. All 5 CI checks GREEN: build, fold-front-screen-overflow-guard,
privacy, Vercel, Vercel Preview Comments.

## Verdict
Decision: PASS. The `lib/ui-meta.ts` diff genuinely keys each badge on the CURRENT gating signal:
the in_review pill on the newest execution-review row (neutral when it has no verdict — no blend, no
stale round), and SHIPPING behind an isHeld-first check plus a session-independent 24h verdict-age
STALE bound. The RED-first evidence is real (reproduced 13/10 at `1d00251`), the fix is a genuine
selector+predicate change not a stub, monotonicity holds on every arm, scope is exactly one new test
file, the full suite + typecheck are green, and the three UI-gate artifacts (design brief, ui-evolve
ACCEPT 12/12 on real renders, interaction_test_na) are present and valid. Required ship-tail step:
produce the `prod-build-marker.sh ... --pr 82` marker bound to head `2f838dd` before merge.
