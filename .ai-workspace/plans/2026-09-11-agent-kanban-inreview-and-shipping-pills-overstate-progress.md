# Plan: REVIEW-column and SHIPPING pills overstate a ticket's progress — key them on the current gating signal

**Task**: `agent-kanban-inreview-and-shipping-pills-overstate-progress`
**Repo**: agent-kanban (PUBLIC) — base `origin/master` @ `1d00251`
**Role**: planner (root-cause ritual: Understand → Save → Fix plan → Bake). Not implemented here; reviewed by an independent plan-review.
**cairn:** `[WM] ~/.claude/agent-working-memory/tier-b/topics/infra-bugs/2026-07-25-1-lane-live-pill-1867-false-negative-live-confirmed.md:22 — "Fix shape: new pendingReviewInFlight(t) predicate (in_review + status in_progress + chainInFlight open punch-in) OR-ed into BOTH lane-population filters (computeActiveIds + deriveLanes must stay matched)"` (queries `shippingAfterPass`, `latestReviewVerdict`, `in_review pill`, `SHIPPING stale`, `onHold isHeld`, `agent-kanban phase line verdict` via `node skills/cairn/bin/cairn-find.mjs`; T2/T3 were UNAVAILABLE — the ai-brain primary's `hive-mind-persist` is absent in the sparse checkout — so only T1 + working-memory were searched). Also T1 `2026-08-06/…:51 "A role spawn tagged to a COMPLETED ticket is invisible to the board's LANES LIVE"`. Lesson on record: `feedback_live_board_badge_must_key_on_current_gating_signal_not_blended_or_stale_verdict` (2026-09-11).
**project-index:** `.ai-workspace/PROJECT-INDEX.md` (skeleton 2026-09-05) → read `lib/ui-meta.ts`, `__tests__/{phase,monotonic-flow,card,on-hold,lane-pending-review-visibility}.test.ts`, plans #1410 (`2026-07-02-1410-monotonic-flow.md`), #1449, #1816, the #1867 review, #1468 stage-bar.
**Design leg (UI gate leg 1):** §Design POV below — this plan file is the design brief.

## ELI5
Every card on the board wears a small pill saying what it is doing right now. Two pills lie. (1) While a card is waiting for its final reviewer, the pill borrows the earlier reviewer's "PASS" and shows `◆ REVIEW · PASS` — as if the final check had already passed. (2) A card that passed its final review and was then parked by the operator (or just sat for days) keeps a green `✓ PASS — SHIPPING`, like a truck is on the road. The fix: the review pill only shows the final reviewer's own answer, and nothing until that reviewer answers; a parked card says `⏸ ON HOLD` even in the REVIEW column; and a passed card that has been quiet for over an hour AND whose pass is more than a day old dims to the existing `— STALE` instead of pretending to ship. Nothing else on the board changes — the old tests that guard the other pills stay green, untouched.

## Root cause (Understand) — measured at head `1d00251`, not taken from the brief
Re-probed with the repo's own `buildTicket` / `phaseLine` / `computeActiveIds` (planner scratch probes, see Executor notes). The brief's line numbers hold at head (`latestReviewVerdict` 168-177, `latestVerdictForRole` 188-194, `shippingAfterPass` 286-296, `isHeld` 138-140).

1. **Blended verdict on the REVIEW pill — CONFIRMED.** `phaseLine`'s `in_review` branch (L427) reads `latestReviewVerdict()` = `execVerdict ?? planVerdict`. Fixture F-A (plan-review PASS, exec-review row open, no verdict) renders `◆ REVIEW · PASS` / `var(--done)` on head. Live: the sentinel card the operator saw has since verdicted (exec PASS `2026-09-11T01:50Z`), so its mid-review state is no longer observable — F-A is the deterministic reproduction of the mechanism.
2. **Same class, one step further — the brief's suggested selector is not enough.** `latestVerdictForRole(t,'execution-review')` returns the newest exec-review comment THAT HAS a verdict. Fixture F-B (exec-review round-1 FAIL closed, executor rework, round-2 exec-review open) renders `◆ REVIEW · FAIL` on head and would still do so through `latestVerdictForRole` — a stale round-1 verdict shown while round 2 gates the column. The gating signal is the NEWEST exec-review row (the row `toColumn`'s `newestExecutionReviewState` and `shippingAfterPass` already key on); when it has no verdict the pill must be neutral.
3. **SHIPPING on a passed-then-held ticket — CONFIRMED, and the brief's proposed seam is a no-op.** `toColumn(in_progress, resolved-nonfail)` → `in_review`, and `isHeld()` is column-gated to `in_progress` (#1816 AC10, "terminal wins by construction"). So for a passed ticket `isHeld` is FALSE whatever `onHold` says: F-C (exec PASS 5 d ago, `on_hold` set, quiet 5 d, session live) renders `✓ PASS — SHIPPING` with `isHeld=false`; F-C2 (same, board write 2 min ago) is ALSO `computeActiveIds`-active — a parked card breathes and inflates "N LANES LIVE". Gating `shippingAfterPass` on `!isHeld` would change nothing. #1816's state table enumerated held+in_progress and held+completed, never held-after-PASS.
4. **Pinned constraint on the hold seam.** `__tests__/lane-pending-review-visibility.test.ts` AC-4 (#1867) deliberately PINS: a hold-marked ticket parked in REVIEW by a PENDING review with a RUNNING (punched-in) reviewer IS counted as a lane ("a running agent is a live lane regardless of the operator's parked-for-later intent … a future isHeld() widening shows up as a conscious decision, not silent drift"). Fixture F-K (that exact shape) on head: pill `◆ REVIEW · PASS` (defect 1), `active=true` (the pin). So the hold extension must stop where an agent is still running.
5. **A live session makes STALE unreachable — CONFIRMED on #2498.** Live replay now: `#2498 status=in_progress column=in_review onHold=undefined updatedAge=105.6 h shippingAfterPass=true isHeld=false → "✓ PASS — SHIPPING"`, exec-review PASS `closedAt 2026-09-06T16:35:19Z`, owning session live. #1449 made STALE a conjunction (`board-write age > 60 min AND session dead`); with a live orchestrator the pill can never dim, however old the PASS (F-D: 5-day-old PASS, live session → SHIPPING; the same fixture with a dead session → STALE). Recording `onHold` is the sibling ai-brain ticket; this plan makes the board honest with AND without that data.

## Intent (what & why — never how)
**What**
1. The REVIEW-column pill's verdict token is the verdict of the review that currently gates the column — the newest execution-review row. No verdict on that row ⇒ neutral `◆ REVIEW`. A plan-review verdict never appears on this pill; an earlier exec-review round's verdict never appears while a newer round is open. (The hand-built "in_review + FAIL" defensive shape keeps `◆ REVIEW · FAIL`.)
2. A held ticket whose gating review has already PASSED (nothing runs for it) receives the full ON HOLD treatment in the REVIEW column exactly as a held PROG-column card does today — `⏸ ON HOLD` pill, `--hold` hue, `ak-card--hold` (static rail, receded tile), `⏸ held Nd` footer, drawer chip — and never lights a lane. A held ticket whose reviewer is still punched in keeps the #1867 AC-4 pin: neutral `◆ REVIEW`, lane counted. Terminal still wins; queued stays queued.
3. SHIPPING gets an honest upper bound that does not depend on session death: a passed card that has been silent past the existing 60-min cap AND whose gating PASS is older than 24 h dims to the existing `✓ <VERDICT> — STALE` treatment even with a live session. Any fresh board write (e.g. a late ship-tail row) restores SHIPPING. Missing/unparseable timestamps or no clock fail CLOSED to SHIPPING (#1449's never-cry-wolf bias stands).
4. Unchanged, proven by their existing tests staying green UNEDITED: `latestReviewVerdict`'s blended contract (its 4 tests; the DONE pill still uses it), the #1449 liveness conjunction (3 cases), #1410 lane population + the mixed-ts pin, #1867 AC-1..AC-5, #1816 AC1-AC12 byte-identical baselines, #1468 stage-bar per-role classification, `card.test.ts`.

**Why**: the pill is the operator's at-a-glance answer to "is this moving?"; both measured cases said yes for cards that were not (`feedback_live_board_badge_must_key_on_current_gating_signal_not_blended_or_stale_verdict`). A rendered badge is only as honest as the exact predicate behind it.

## Design POV (frontend-design leg — this section is the design brief)
- **A pill states the CURRENT gate, never a memory of an earlier one.** `◆ REVIEW` in review-amber = "the gate has not spoken"; a verdict token appears only when the gating reviewer has spoken. Silence is the honest state.
- **Hold beats ship, and hold is a property of the ticket, not of a column.** `⏸ ON HOLD` keeps its ochre hue, static rail and receded tile in the REVIEW column exactly as in PROG (#1816 vocabulary reused verbatim). Rejected: a compound `✓ PASS — ON HOLD` (a third glyph combination for a fact the 4/4 pips and the drawer already carry).
- **A running agent outranks a parked-for-later note** (#1867 AC-4): the held-but-reviewing card stays neutral `◆ REVIEW` and counts as a lane; the moment the reviewer verdicts PASS the card flips to ON HOLD. Pill and lane never disagree because both read one predicate.
- **One vocabulary, zero new tokens.** The second road to STALE reuses the dim `✓ <VERDICT> — STALE` + aria "shipping stalled". No new glyph, hue, CSS rule, or layout; every string the fix can render was already judged in a prior ui-evolve verdict (#1110/#1114 phase line, #1410/#1449 shipping-stale, #1816 hold). Rejected: a day-count token (`STALE 5d`) — the footer already carries relative age; moving a held card back to the PROG column (breaks #1410's monotonic flow, changes meter counts, and #1816 deliberately left `toColumn` untouched to keep ai-brain's status consumers unaffected).

## UI-task gate — honest scoping (plan-review adjudicates)
A person looks at this text, so the gate applies; the change has NO interaction surface.
- **Leg 1 (frontend-design):** satisfied by §Design POV; cite `metadata.design_brief` = this plan's path.
- **Leg 2 (ui-evolve):** REQUIRED, scoped to ONE round on real renders — a local fixture board (the #1816 verdict's gitignored `data/board.json` local-override method, never published) carrying F-A (neutral REVIEW), F-K (held + running reviewer → neutral REVIEW, lane lit), F-C (ON HOLD in the REVIEW column), F-D (STALE with a live session) and one fresh SHIPPING control; desktop 1440×900 + mobile 390×844; rubric R1 legibility of the corrected pills, R2 honesty-at-a-glance (waiting-for-review vs passed, and parked/stalled vs shipping, are distinguishable without opening the drawer), R3 vocabulary consistency (nothing reads bolted-on); `verdict: ACCEPT` + score; regression guard = non-held/non-stale cards unchanged (mechanically: on-hold AC2/AC11 + card.test baselines). Cost: minutes — Playwright + the fixture override already exist. Alternative for plan-review to adjudicate: cite the prior verdicts and set `metadata.ui_gate_skip` — NOT recommended: the gate is fail-closed and that is exactly the silent skip the brief forbids.
- **Leg 3 (real-interaction):** `metadata.interaction_test_na` = `"phase-line pill text/hue selection only — no scroll, drag, tap or pointer surface changes; pure lib/ui-meta.ts function proven RED→GREEN by jest fixtures F-A..F-K"`. `metadata.interaction_test` is NOT cited (cross-key precedence: citing it would make the N/A moot).
- **4th artifact (production build):** CI runs `next build` on every PR (#81); `scripts/prod-build-marker.sh` must print `exit=0` bound to the PR head before `gh pr merge` (the merge guard enforces it).
- Rule-19 eyeball: the leg-2 screenshots are the eyeball.

## Scope boundary
Write surface: `lib/ui-meta.ts`; ONE new test file under `__tests__/`; `.ai-workspace/{plans,reviews}/…` (this plan, red-evidence, ui-evolve verdict, review files). Existing test files are NOT edited — if the executor believes one must change, that is a finding to surface in the PR, not a silent edit. Unchanged: `lib/build-board.ts` (`toColumn`), `lib/active.ts`, `lib/lanes.ts`, `lib/stage-bar.ts`, `components/*`, CSS, schema. Out of scope: recording `onHold` on operator-gated tickets (ai-brain `operator-hold-must-be-recorded-as-onhold-so-board-dims-gated-tickets`); the live blob publish.

### Binary AC
**Fixtures** (pure, number-fed; `NOW = 2026-09-11T12:00:00Z`; `LIVE = NOW − 1 min`, `DEAD = NOW − 2 h` passed as `sessionLastActive`; built through `buildTicket` on a `status: in_progress` task unless noted; "OPEN row" = an exec-review line with `agentId`, no `verdict`, no `closedAt`):

| id | shape | updatedAt |
|---|---|---|
| F-A | planner; plan-review `PASS`; executor; exec-review OPEN | NOW−5 min |
| F-B | plan-review `PASS`; exec-review `FAIL` (NOW−3 h); executor (NOW−2 h); exec-review OPEN (NOW−10 min) | NOW−5 min |
| F-C | `metadata.on_hold` set; exec-review `PASS` closedAt NOW−5 d | NOW−5 d |
| F-C2 | as F-C but exec PASS closedAt NOW−1 d | NOW−2 min |
| F-D | exec-review `PASS` closedAt NOW−5 d, no hold | NOW−5 d |
| F-E | exec-review `PASS` closedAt NOW−10 min | NOW−2 min |
| F-F | exec-review `PASS` ts NOW−7 h, no closedAt (the #1449 case-1 shape) | NOW−2 h |
| F-I | exec-review `PASS` closedAt NOW−5 d; ship-tail row ts NOW−2 min | NOW−2 min |
| F-J | exec-review `PASS` closedAt NOW−23 h | NOW−2 h |
| F-J' | as F-J with closedAt NOW−25 h | NOW−2 h |
| F-K | `on_hold` set; planner / plan-review `PASS` / executor all closed; exec-review OPEN (the #1867 AC-4 shape; ledger mtime NOW−12 min) | NOW−12 min |
| F-G | `on_hold` set; executor only (PROG column) | NOW−1 h |
| F-H | `status: completed`, `on_hold` set, exec-review `PASS` | NOW−1 d |
| F3 | hand-built: column `in_review`, status `in_progress`, exec-review `FAIL` (the existing monotonic-flow negative) | NOW−2 min |

- **AC-1 — Gating-role verdict only.** `phaseLine(F-A, false, NOW, undefined, LIVE)` → text `◆ REVIEW`, hue `var(--review)`, aria `in review`. RED on `1d00251`: `◆ REVIEW · PASS` / `var(--done)` (measured).
- **AC-2 — Newest exec-review row, not newest verdict.** `phaseLine(F-B, …)` → `◆ REVIEW`, `var(--review)`. RED on head: `◆ REVIEW · FAIL` / `var(--err)` (measured).
- **AC-3 — Hold beats ship, everywhere the hold treatment lives.** For F-C and F-C2 with `LIVE`: `phaseLine` text `⏸ ON HOLD`, hue `var(--hold)`, no `SHIPPING` substring; `renderToStaticMarkup(Card{ticket, nowMs: NOW, sessionLastActive: LIVE})` contains `⏸ ON HOLD` and `ak-card--hold` and not `SHIPPING`; `renderToStaticMarkup(Drawer{ticket, nowMs: NOW, onClose})` contains `⏸ ON HOLD`; `computeActiveIds([F-C2], true, NOW)` does NOT contain its id. RED on head: `✓ PASS — SHIPPING`; F-C2 `active=true`; no hold chip (measured).
- **AC-4 — Old PASS + quiet card dims even with a live session.** `phaseLine(F-D, false, NOW, SHIPPING_STALE_MS, LIVE)` → `✓ PASS — STALE`, `var(--fg-dim)`, aria contains `stalled`. RED on head: `✓ PASS — SHIPPING` (measured).
- **AC-5 — The bound is real, honored, and fails closed.** (a) F-J (23 h) → `✓ PASS — SHIPPING` (green control); (b) F-J' (25 h) → `✓ PASS — STALE` (RED on head); (c) F-I (5-day PASS, fresh ship-tail write) → `✓ PASS — SHIPPING` (green control); (d) F-D with `nowMs` omitted → `✓ PASS — SHIPPING` (the existing back-compat pin, green control); (e) F-D with the verdict row's `closedAt` absent and `ts` NOW−5 d → `✓ PASS — STALE` (RED on head); (f) F-D with `DEAD` → `✓ PASS — STALE` (green control — #1449's arm still works).
- **AC-6 — The running-reviewer pin survives.** `phaseLine(F-K, …)` → `◆ REVIEW` (RED on head: `◆ REVIEW · PASS`); `computeActiveIds([focus, F-K], true, NOW)` CONTAINS F-K's id (green control, #1867 AC-4). Further controls: F-G → `⏸ ON HOLD`; F-H → `✓ DONE · PASS` with no `ON HOLD` / `var(--hold)` in Card markup; F3 → `◆ REVIEW · FAIL` / `var(--err)`; F-E and F-F → `✓ PASS — SHIPPING`.
- **AC-7 — Hold-outs untouched and green.** At PR head: `npm test` exit 0, `npm run typecheck` exit 0; `git diff --name-only origin/master -- __tests__` lists exactly ONE path (the new test file). Named hold-outs inside that green run: `phase.test.ts` (`latestReviewVerdict` block, #1449 block), `monotonic-flow.test.ts` AC-1..AC-7 incl. F3 and the mixed-ts pin, `on-hold.test.ts` AC1-AC12, `lane-pending-review-visibility.test.ts` AC-1..AC-5, `card.test.ts`, `stage-bar*.test.ts`, `lanes.test.ts`, `active.test.ts`, `live-swimlanes.test.ts`.
- **AC-8 — Both-ends evidence on file.** `.ai-workspace/reviews/agent-kanban-inreview-and-shipping-pills-red-evidence.md` (new) records the NEW test file run against `1d00251` (scratch worktree) with exactly these RED members: AC-1, AC-2, AC-3 (every sub-assertion), AC-4, AC-5(b), AC-5(e), AC-6's pill assertion — and every control above green on head; then the all-green run at PR head with its SHA.
- **AC-9 — UI 3-leg gate artifacts.** (a) `metadata.design_brief` = this plan's path; (b) `.ai-workspace/reviews/agent-kanban-inreview-and-shipping-pills-ui-evolve-verdict.md` (new) with a `verdict: ACCEPT` line + score, judged on the real renders described in §UI-task gate; (c) `metadata.interaction_test_na` = the reason string above. Completion cites all three.
- **AC-10 — Public-repo privacy.** CI privacy job green; every new/changed file scanned per `docs/privacy-scan-invocation-contract.md` (`bash scripts/privacy-scan.sh --working <path>…`, CLEAN with `size>0`, plus one positive control) and the paths + verbatim verdict lines quoted in the PR body.
- **AC-11 — Production build.** The PR's CI `next build` job is green on the PR head; the prod-build marker is printed before merge.

## Rule-17 both-ends oracle
RED corpus on `1d00251` (all measured by the planner's probe): AC-1, AC-2, AC-3 (F-C pill, F-C2 pill + active, Card/Drawer markup), AC-4, AC-5(b), AC-5(e), AC-6 pill. GREEN controls that must not move: AC-5(a)(c)(d)(f), AC-6 lane count + F-G / F-H / F3 / F-E / F-F, AC-7's whole existing suite. The executor runs the new file once against `1d00251` (expect exactly the RED members) and once at PR head (expect all green), and files AC-8.

## Load-bearing assumptions (honest)
1. **24 h is a safe upper bound for a live ship tail's silence after PASS.** The post-PASS tail (merge → CI → install → close) is minutes-scale (#1410 doc); a queued ship-tail seat re-touches the ledger when it starts (F-I control). A deliberately parked card with no `onHold` then correctly reads STALE ("shipping stalled") rather than SHIPPING; the sibling ticket upgrades it to ON HOLD.
2. **The hold extension changes lane population only for held+PASSED tickets** (excluded), via the `!isHeld` filter both population filters already share (`active.ts:506`; `lanes.ts` reads `activeIds`), so they cannot drift.
3. **"Newest exec-review row" = last exec-review comment** — the ts-sorted-comments convention `shippingAfterPass` and `chainInFlight` already rely on; the mixed-ts divergence pin (monotonic AC-5(d)) stays as-is and documents the one pathological exception.
4. **The ui-evolve infra still runs at head** (Playwright + the local `data/board.json` override; last used 2026-09-05 / 09-10).

## Deferred follow-ups:
- Record `onHold` on operator-gated tickets (#2498 et al.) → ai-brain `operator-hold-must-be-recorded-as-onhold-so-board-dims-gated-tickets` (already filed; sibling lane).
- The `⏸ held Nd` footer on a held-in-REVIEW card measures board-write age (the same #1816 caveat) — no ticket; note only.
- If the 24 h bound ever cries wolf in production (a legitimately quiet, live ship tail > 24 h) → file with the measurement; none expected.
- `latestReviewVerdict` keeps blending for the DONE pill (correct there) — no change.

## Executor notes (mechanics allowed here — the AC table is the contract)
- The planner's scratch probes hold every fixture above, ready to lift into the new test file: `probe-red.ts` (fixtures + expected text) and `probe-live.ts` (#2498 replay) in the session scratchpad directory named in your system prompt. Never commit them; the fixture table above is the contract if they are gone.
- `latestVerdictForRole` is NOT the gating-row read AC-2 needs (it skips open rows); `shippingAfterPass`'s own last-exec-review-comment scan is. Do not touch `latestReviewVerdict` (AC-7).
- The hold seam that satisfies AC-3 AND AC-6 together: "held" = non-empty `onHold` AND (PROG column OR passed-and-shipping) — a running reviewer (pending review) is never "held". Keep it ONE predicate so Card / Drawer / lanes / pill cannot disagree (#1816 doctrine).
- STALE's existing conjunction keeps its first term (board-write age > cap) — that is what lets a late ship-tail write restore SHIPPING (AC-5c); the second term becomes "session dead OR gating PASS older than the new bound" (verdict age from `closedAt`, else `ts`; unparseable ⇒ arm inert). Bound: an exported constant in the same injectable shape as `SHIPPING_STALE_MS`.
- Worktree: `.claude/worktrees/agent-kanban-inreview-and-shipping-pills-overstate-progress` (branch = the exact slug); `node_modules` may need the primary-clone symlink.

## Execution model
Knob A = `delegate` (one worktree, one coherent surface). Knob B = `both`: the new jest file is the test oracle for AC-1..AC-8; independent execution-review + the ui-evolve vision judge carry AC-9..AC-11.

## Critical files (informative, not prescriptive)
- `lib/ui-meta.ts` (existing — the only production file that changes)
- `__tests__/phase-pill-honesty.test.ts` (new)
- `.ai-workspace/reviews/agent-kanban-inreview-and-shipping-pills-red-evidence.md` (new)
- `.ai-workspace/reviews/agent-kanban-inreview-and-shipping-pills-ui-evolve-verdict.md` (new)
- `.ai-workspace/plans/2026-09-11-agent-kanban-inreview-and-shipping-pills-overstate-progress.md` (new) — this plan

## Review

Decision: PASS

Stateless, adversarial plan-review (Round 1). I did NOT author this plan. Reviewed the canonical
agent-kanban copy at `ef8764a` and the code under review at that head (`lib/ui-meta.ts`), plus every
named hold-out test at `ef8764a`. Every load-bearing claim below was verified by reading the actual
code/tests, not the plan's narrative.

**AC-1/AC-2 — in_review pill (gating-role verdict only): VERIFIED SOUND.**
- RED genuine: traced head code. F-A (plan-review PASS + exec-review OPEN): `shippingAfterPass`=false,
  `latestReviewVerdict`=`execVerdict ?? planVerdict`=`undefined ?? "PASS"`=`PASS` → head renders
  `◆ REVIEW · PASS` (defect confirmed). F-B (round-1 FAIL closed, round-2 OPEN): newest exec-review
  comment is the OPEN row (verdict undefined) → `shippingAfterPass`=false; `latestReviewVerdict` skips
  the open row and returns round-1 `FAIL` → head renders `◆ REVIEW · FAIL` (defect confirmed).
- The fix's selector = the newest exec-review COMMENT-position scan (same one `shippingAfterPass` uses),
  NOT `latestVerdictForRole` (which skips open rows and would keep showing the stale round-1 FAIL — the
  plan's executor note calls this out correctly). F3 (newest exec-review comment = FAIL, no newer round)
  still renders `◆ REVIEW · FAIL` — preserved.
- Does NOT reimplement/touch `latestReviewVerdict`: its 4 unit tests test the function directly and the
  DONE pill still calls it. Confirmed NO existing `phaseLine` test asserts the blended
  plan-verdict-on-in_review behavior (`phase.test.ts:80` is executor-only → `◆ REVIEW`;
  `phase.test.ts:69` is exec-PASS → SHIPPING) — so the in_review selector change breaks no existing test.

**AC-3/AC-6 — hold beats ship + #1867 running-reviewer pin: VERIFIED SOUND, and disjointness holds.**
- The seam extends `isHeld` to `onHold && (column==='in_progress' || shippingAfterPass(t))`. Verified
  MONOTONIC against every named hold-out by reading the tests:
  - `on-hold.test.ts` AC10 (`isHeld(completed+onHold)`) stays false: `shippingAfterPass` requires
    `status==='in_progress'`; a completed ticket is `status:'completed'` → both disjuncts false. Terminal
    still wins.
  - `on-hold.test.ts` AC5/AC6 (in_progress-column fixtures): first disjunct already true → unchanged.
  - `lane-pending-review-visibility.test.ts` AC-4 (#1867 pin: held + OPEN exec-review): newest
    exec-review row is open → `shippingAfterPass`=false, column `in_review` → `isHeld`=false → lane still
    counted. PIN PRESERVED. AC-5 (no onHold) unaffected.
- Disjointness (components/* unchanged) is SOUND: `Card.tsx:74,85` derive `ak-card--hold` purely from
  `isHeld(ticket)` (no independent column gate); `Drawer.tsx:294,331` gate the hold chip on
  `isHeld(ticket)`; `active.ts:506` filters `!isHeld(t)`. Extending `isHeld()` in `lib/ui-meta.ts`
  propagates the pill + rail + drawer chip + active-set exclusion (AC-3's `computeActiveIds` exclusion of
  F-C2) WITHOUT editing any component or active.ts. Single-predicate #1816 doctrine intact.

**AC-4/AC-5 — SHIPPING second STALE arm (24h verdict-age): VERIFIED SOUND, #1449 preserved.**
- The new STALE condition is `ageExceedsCap AND (sessionDead OR verdictOlderThan24h)` — a WEAKENING of
  the second conjunct (fires in strictly more cases), the intended honesty direction. Verified it does
  NOT flip any hold-out: `phase.test.ts` #1449 fixtures and `monotonic-flow.test.ts` shipping fixtures
  all carry a verdict ts of 05:00→NOW 12:00 = **7h < 24h**, so the new arm is INERT for them and the
  existing `age AND sessionDead` conjunction decides exactly as before (case1 LIVE→SHIPPING,
  case2 DEAD→STALE, case3 unknown→SHIPPING, back-compat nowMs-omitted→SHIPPING). RED genuine: F-D (5-day
  verdict, LIVE) renders SHIPPING at head (no 24h bound), STALE after.
- AC-5(c) F-I (fresh ship-tail board write) keeps `ageExceedsCap` false via the first conjunct →
  SHIPPING, so a legitimately-live-but-old-PASS tail that re-touches the board is not falsely dimmed
  (load-bearing assumption 1). Fail-closed on unparseable timestamp (arm inert) matches #1449 bias.

**AC-7 — exactly ONE new test file, no existing-test edits: ACHIEVABLE (this was the highest risk).**
Confirmed no existing test asserts any behavior the fix changes: the in_review-selector change, the
`isHeld` extension, and the second STALE arm each leave every named hold-out
(`phase.test.ts`, `monotonic-flow.test.ts`, `on-hold.test.ts`, `lane-pending-review-visibility.test.ts`,
`card.test.ts`) green UNEDITED. `card.test.ts` byte-identical baselines are all on the in_review+PASS
(shipping) fixture, unaffected by the pill/hold changes.

**UI-task gate scoping — HONEST, not a rubber-stamped skip.** Leg-1 satisfied by §Design POV. Leg-2
ui-evolve is REQUIRED (one round on real renders), and the plan explicitly REJECTS `metadata.ui_gate_skip`
as the silent skip the gate forbids — proportionate, because the change introduces the ON HOLD visual
treatment into the REVIEW column (a genuinely new visual state), not merely a verdict string. Leg-3
`interaction_test_na` reason is specific and defensible (pure text/hue function, no pointer surface).
Adjudicated: honest scoping, accepted.

**Rule-17 both-ends oracle:** non-vacuous — every RED member produces a materially different (wrong)
output at head vs the GREEN target (traced), and the GREEN controls are outputs that must not move. The
oracle can return both RED and GREEN.

Non-blocking notes for the executor / execution-review (do NOT re-open the plan to enumerate defenses):
- N1 (clarity, self-correcting via the oracle): AC-5(a)/(b) and the F-J/F-J' rows do not state the
  session-liveness arg. Only a LIVE session makes F-J' (25h) RED-on-head and F-J (23h) a real green
  control; a DEAD session would let the existing arm decide and leave the new 24h bound untested. Pin
  `LIVE` explicitly in the new test's F-J/F-J' calls.
- N2 (named-risk, gaming theorem — registered durably): every finite mechanical AC set admits a
  fixture-memorizing stub; that is a theorem about AC sets, not a defect in this plan. Execution-review
  must confirm the diff is a genuine selector+predicate change (newest-exec-review comment-position scan +
  `isHeld` extended with `shippingAfterPass`), NOT a stub pattern-matching F-A..F-K.
- N3: execution-review should confirm AC-8 red-evidence actually shows the RED members RED at `1d00251`,
  and AC-9(b) ui-evolve verdict is produced on REAL renders (not stubbed).

Head reviewed: agent-kanban `ef8764a` (canonical) / ai-brain carrier `e8e3ea66` (byte-identical plan copy).

---

### Execution-review (Round 1) — stateless, adversarial, last line before ship

Decision: PASS

Full verdict artifact: `.ai-workspace/reviews/2026-09-11-agent-kanban-inreview-and-shipping-pills-execution-review.md`
(byte-identical on the ai-brain carrier branch). I did NOT write this code. Verified against the
`lib/ui-meta.ts` diff at PR head `2f838ddc9ee9e6a60f5cf60539321109a6c3fee2` and by RUNNING the tests
myself.

- **Badges key on the current gating signal (quoted diff):** in_review neutral path is now
  `const verdict = newestExecutionReviewVerdict(ticket);` (comment-position scan of exec-review rows;
  undefined for an open row → neutral `◆ REVIEW`), replacing `latestReviewVerdict(ticket)`;
  `isHeld` widened to `Boolean(onHold) && (column === "in_progress" || shippingAfterPass(ticket))`
  with the in_review branch checking `isHeld()` FIRST; STALE widened to
  `ageExceedsCap && (sessionDefinitelyDead || verdictTooOld)` with `SHIPPING_STALE_VERDICT_AGE_MS = 24h`.
- **RED-first reproduced independently:** 13 failed / 10 passed at `1d00251` — exactly the plan's
  Rule-17 corpus and the executor's red-evidence table. GREEN at head: full suite 512/512, new file
  24/24, typecheck exit 0, AC-7 = exactly one new test file.
- **UI-gate legs:** design brief = §Design POV (present); ui-evolve verdict ACCEPT 12/12 on REAL
  desktop+mobile renders (both PNGs eyeballed — genuine, honest, distinct); `interaction_test_na`
  cited (specific ≥20-char reason), `interaction_test` not cited → valid leg-scoped N/A. Prod-build
  marker (`scripts/prod-build-marker.sh <repo-root> --pr 82`, head-bound) is a REQUIRED ship-tail
  step, not yet present — flagged, not a FAIL (CI `next build` already GREEN on head).
- **Named-risk notes:** `NO-NOTES` for this task → receiving-end disposition duty skipped.

Head reviewed: agent-kanban PR #82 head `2f838ddc9ee9e6a60f5cf60539321109a6c3fee2`.
