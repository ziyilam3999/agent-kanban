# Folding-phone front-screen: bookkeeping shelf unreachable below the full-height column (#2499)

- **Task:** agent-kanban ticket #2499
- **Repo:** agent-kanban (primary clone `~/coding_projects/agent-kanban`, master `dd59d07`)
- **Role chain:** planner (this file) -> plan-review -> executor -> execution-review
- **Plan file:** `.ai-workspace/plans/2026-09-12-agent-kanban-folding-phone-shelf-unreachable-front-screen.md`
- **Branch-naming (#2462):** if this plan is committed on its own worktree branch, the branch name MUST lead with the task id, e.g. `2499-agent-kanban-folding-phone-shelf-unreachable-plan`. Never `plan-2499-...` / `worktree-2499-...` (the merge-ledger leg and completion gate derive the task id from a `^[0-9]+` anchor and only discover this plan from other checkouts via `refs/remotes/origin/2499-*`).

## Execution model

- **Model: subagent (delegate) — knob-A `delegate`, knob-B `test-oracle` + `reviewer` (both).**
- **Rationale:** The work is a single coherent, briefable surface (one production CSS change in `app/globals.css` plus a new `e2e/` real-interaction spec and the three UI-gate artifacts) — above the trivial-skip threshold (>1 file, user-facing UI, architectural-ish responsive-tier decision), so it is NOT an inline fix; it is fully briefable from this plan (no live-in-session coupling), so it is NOT inline-work. A single fresh executor subagent implements it in an isolated worktree. Evaluator is `both`: the RED-first Playwright reachability + scroll-delta spec is a real test-oracle, AND an independent execution-review subagent checks the UI-gate legs and no-regression claims. Plan-review (separate subagent) must PASS before execution.

## cairn / project-index citations

- `cairn:` (this exact bug, my own root-cause, T1 2026-09-12) — QUOTED: *"agent-kanban folding-phone-front-screen shelf-unreachable ROOT CAUSE: a responsive layout that installs a 100dvh viewport shell (grid auto/1fr + overflow:hidden, board scrolls internally) at ONE breakpoint tier (640-1023px) but NOT the smaller base tier (<640px) lets the base tier page-scroll freely; the .ak-strip.ak-board takes full natural height and the source-order-LAST sibling in .ak-main (the <Shelf>, rendered after board+dots in BoardView.tsx) falls below the entire tall column ... when you clamp a shell at a breakpoint to keep a footer/shelf reachable, the SMALLER tiers need the same clamp (or a sticky entry) or the footer drops off the fold there. Distinct from #83 (that bounded the OPENED body's internal scroll; this is the CLOSED shelf's position/reachability)."*
- `cairn:` (overflow-guard token-shape / measure the visual viewport, T1 2026-09-05) — QUOTED: *"A responsive-overflow guard is only as strong as its fixture's token shape ... mirror production's max token length in fixtures ... and measure the visual viewport, not layout scrollLeft."* -> drives the AC fixture-volume requirement (a realistic card count so the column is genuinely taller than the viewport) and the "measure real geometry, not computed style" test discipline.
- `cairn:` (opt-in drawer needs bounded height, T1 2026-09-11; the #83 lesson) — QUOTED: *"A drawer without max-height+overflow is not a scrollable panel, it's an ever-growing column."* -> the AC2 no-regression floor: the opened body must stay the bounded 60dvh self-scrolling panel #83 shipped.
- `project-index:` `.ai-workspace/PROJECT-INDEX.md` (agent-kanban) read; prior related plans on disk: `.ai-workspace/plans/2026-09-05-agent-kanban-fold-portrait-overflow.md`, `.ai-workspace/plans/2026-08-25-agent-kanban-fold8-4x3-bugfix-responsive.md`, and (#83) `.ai-workspace/plans/2026-09-11-shelf-drawer-bounded-scroll.md`.

## ELI5

Imagine a to-do board on a skinny folded-phone screen. It shows ONE tall column of cards, and if you have lots of cards the column is taller than the screen. At the very bottom, under the whole column, there is a little shelf that says "Bookkeeping 5 . Parked 2 . Deferred 1" — the place you tap to see the tidied-away cards. On a slightly bigger screen the app freezes the page to the screen size so the column scrolls INSIDE its own box and the shelf always shows at the bottom edge — you can always see it. But on the skinny folded-phone screen the app forgot to do that freezing, so the whole page just grows downward and the shelf falls off the bottom. To reach it you have to scroll ALL the way down past every card. That is annoying and easy to miss.

The fix: on the skinny phone screen, make the little closed shelf bar always reachable at the bottom of the screen (a pinned bar), so you never have to scroll the whole column to find it. When you tap it open, it still opens as the same bounded, scrollable panel we shipped last time (#83). We will PROVE it with a robot-finger test that first FAILS on today's code (shelf is off-screen) and PASSES after the fix, plus real screenshots judged by a vision grader and a production build check.

## Problem — root cause, re-measured from source at master dd59d07

Confirmed the ticket's root cause by reading source directly; it is correct.

**Render order (`components/BoardView.tsx`).** Inside `<main className="ak-main">` the children render in this source order:
1. `<LiveSwimlanes>` (only when `lanes.length >= 2`) — L500-507
2. `<div className="ak-strip ak-board">` (the horizontal column strip) — L509-529
3. `<div className="ak-dots">` (column jump-dots) — L531-555
4. `<Shelf ... />` (the collapsed bookkeeping/parked/deferred shelf) — **L561, source-order LAST**

**Base phone tier (<640px), CSS `app/globals.css`.**
- `body` (L108-118): `min-height: 100dvh; overflow-x: hidden;` — no height clamp; the page scrolls freely in the vertical axis.
- `.ak-app` (L174-178): `max-width: 1320px; margin: 0 auto; padding-bottom: 40px;` — an ordinary block, no height / no `overflow:hidden`.
- `.ak-main` (L187-189): `container-type: inline-size;` ONLY — **no `display:flex`, no `overflow:hidden`, no height clamp at this tier.** So `.ak-main` is a normal block and its four children stack in normal document flow.
- `.ak-strip` (L440-448): `display:flex; overflow-x:auto;` — a horizontal strip whose natural HEIGHT equals the tallest visible column's card list.
- `.ak-col` (L454-461): `flex: 0 0 88vw;` — one column fills 88% of the viewport width (1-up).
- `.ak-shelf` (L541-546): `margin: 4px 14px 20px;` — an ordinary full-width block.
- `@media (max-width: 640px)` (L1130-1171): touches ONLY the header/lanes cosmetics — **no shell clamp, no shelf positioning.**

**Consequence:** with a realistic number of cards the single 88vw column is taller than the viewport; `.ak-strip.ak-board` takes that full natural height, `.ak-dots` render under it, and the source-order-last `<Shelf>` lands below the entire tall column. The collapsed summary bar's `getBoundingClientRect().top` therefore exceeds `window.innerHeight` — it is below the fold and only reachable by scrolling the whole page to the very bottom.

**Why the 640-1023px tiers do NOT have the bug (the shell clamp, L2000-2027).** In the `@media` band `(min-width:900px and max-width:1023.98px)`, `(min-width:640px and max-width:899.98px and orientation:portrait)`, `(min-width:768px and max-width:899.98px and orientation:landscape)`:
- `.ak-app { height:100dvh; display:grid; grid-template-rows:auto 1fr; padding-bottom:0; overflow:hidden; }`
- `.ak-main { display:flex; flex-direction:column; min-height:0; overflow:hidden; }`
- `.ak-board { flex:1 1 auto; min-height:0; overflow:hidden; }`
So `.ak-main` is a height-bounded flex column: the board flexes to `1fr` and scrolls internally, and the source-order-last shelf sits UNDER the board WITHIN the viewport. Reachable at rest.

**Distinct from #83.** #83 (`.ak-shelf[open] > .ak-shelf__body`, L610-636) bounded the OPENED drawer body to a 60dvh self-scrolling panel. #2499 is the CLOSED shelf's POSITION/reachability on the base phone tier — orthogonal.

**Load-bearing coupling warning heeded (#1590 / fold8-4x3-bugfix, L1962-1999).** The shell clamp was DELIBERATELY scoped to fire ONLY where a grid tier is active. The comment documents the 840x660 dead-zone class: when the clamp hides overflow on `.ak-app`/`.ak-main`/`.ak-board` but `.ak-col` stays the un-scrollable base flex item (`flex:0 0 88vw; overflow:visible`), content has no scroll path on either axis. Any fix that extends the shell to the base tier MUST also give `.ak-col` an internal scroll path or it recreates exactly this dead-zone.

## Recommended fix candidate — (B) phone-tier pinned collapsed shelf entry

**Recommend candidate B: on the base phone tier (<640px) keep the free page-scroll but make the COLLAPSED `.ak-shelf` entry always reachable at the bottom edge of the viewport (e.g. a bottom-pinned/sticky bar); opening it reuses #83's bounded 60dvh self-scrolling body.**

Rationale and blast-radius trade-off (this is the recommendation the ticket asks for; the Binary AC below stays HOW-agnostic and would pass for ANY candidate that meets the outcome):

- **(B) smallest blast radius, directly answers the complaint.** It changes ONLY the shelf's own phone-tier positioning. The board keeps its natural free page-scroll (the most-used tier's fundamental behavior is untouched), so it cannot recreate the fold8-4x3 dead-zone (#1590 / 840x660) that candidate A risks. It answers the operator's literal words ("scroll all the way to the bottom to reach it") — a pinned collapsed bar is reachable within the initial viewport, no page-scroll — and keeps the counts VISIBLE at rest. It composes cleanly with #83: the collapsed bar is the pinned entry, the opened body is the already-shipped bounded 60dvh bottom-sheet, so no new scroll-container semantics and no #83 regression.
- **(A) extend the 100dvh shell to <640px — LARGEST blast radius, rejected as primary.** Touches the most-used tier and fundamentally changes base-phone behavior from free page-scroll to fixed-viewport + internal column scroll. It MUST also add `.ak-col { overflow-y:auto; min-height:0 }` at the base tier or it recreates the documented 840x660 dead-zone; and it fights the deliberate "shell only where a grid tier is active" gating (#1590 monotonicity). High risk for a bug whose scope is one shelf.
- **(C) 5th shelf dot in `.ak-dots` — medium blast radius, weakest for the goal, rejected.** Adds a non-column entry to a `role="tab"` tablist keyed on `COLUMNS.map` (BoardView.tsx L531-555), breaking the "N columns = N tabs" a11y contract and the pair-marker logic; `.ak-dots` is also hidden at some tiers (globals.css L2135 comment). It still hides the counts behind a tap and requires tap+scroll, so it does not make the shelf visible at rest.

**Watch-outs for executor + plan-review (flag, do not pre-decide the HOW):**
- **Sticky vs fixed, and the `overflow-x:hidden` sticky gotcha.** `html`/`body` carry `overflow-x:hidden` (L105/L117). An ancestor `overflow:hidden` can create a scroll container that changes/traps `position:sticky` on descendants in some engines. This is a load-bearing assumption (Rule 18) — the AC-1 real-interaction test IS the proof the pinned entry actually stays reachable on a real touch viewport; a computed-style check alone is insufficient (the 2026-08-25 incident).
- **Occlusion.** A bottom-pinned bar overlays part of the last column card. The outcome AC requires the last column card to stay fully readable (reserve bottom space / offset), verified as behavior — not a prescribed pixel value.
- **Expansion direction.** How the opened body grows (bottom-sheet upward) and the exact CSS mechanism are the executor's HOW plus the frontend-design POV, out of scope for this plan's intent.

## Intent — what and why (never how)

- **What:** on the folding-phone front/cover screen (portrait, width <640px) the collapsed bookkeeping shelf entry is reachable within the initial viewport without scrolling past the full-height column; the opened shelf body stays the bounded 60dvh self-scrolling panel; the 640-1023.98px tiers are unchanged.
- **Why:** the shelf is the only route to bookkeeping/parked/deferred tickets; today it drops off the fold on the most-cramped, real-device tier, so those tickets are effectively unreachable/undiscoverable (operator-reported, screenshot 8792cd2f).

## Files the executor is expected to touch

- `app/globals.css` — the base-tier (<640px) shelf-reachability fix. **Primary and only production-CSS change.**
- `e2e/` — a NEW real-interaction spec (e.g. `e2e/shelf-front-screen-reachable.e2e.spec.ts`) reusing the existing harness: `e2e/fixtures/board-fixture.ts` (`buildBoard({...})` for a production-volume board), `e2e/fixtures/touch.ts` (`touchDragAt`, `boxOf`, `fullyInViewport`, `ancestorScrollOffsets`, `anyOffsetIncreased`, `visualViewportOffsets`), mirroring the patterns in `e2e/shelf-scroll.e2e.spec.ts` (#83 opened-body oracle) and `e2e/fold8-scroll-reachability.e2e.spec.ts` (reachability oracle).
- UI-task-gate artifacts (paths at executor's discretion, must be cited in the ticket metadata): a `design_brief`/`design_pov` file (frontend-design POV), a `ui_evolve_verdict` file (`verdict: ACCEPT` + score), and the `interaction_test` marker file.
- `components/Shelf.tsx` / `components/BoardView.tsx` — likely NOT needed for candidate B (CSS-only). Touch only if the chosen mechanism genuinely requires markup; a CSS-only fix is preferred (Simplicity First).

## Shared-file ship-conflict risk

- **`app/globals.css` is the contended hot spot.** #83 (merged at dd59d07) and every fold/portrait lane edits this one file. Any OTHER in-flight agent-kanban UI lane touching `app/globals.css` will ship-conflict. Serialize the ship of this lane against any concurrent globals.css lane; rebase on latest `origin/master` before merge.
- **Single Vercel prod-build marker serializes the merge tail.** agent-kanban is in `PROD_BUILD_GUARD_REPOS` (default), so `gh pr merge` is gated by `hooks/prod-build-before-merge-guard.sh` on a fresh `production-build: agent-kanban@<head-sha> exit=0` marker bound to THIS PR's head sha — only one such merge can be in flight per head at a time.

## Non-goals / scope boundaries

- No change to the 640-1023.98px grid/paged tiers or the >=1024px desktop tier.
- No change to #83's opened-body bounded 60dvh scrolling behavior (it must be preserved, AC2).
- No change to `.ak-dots` a11y/tablist semantics (rules out candidate C by construction).

## Deferred-follow-ups:

- None. The "Non-goals / scope boundaries" and "watch-outs" above are scope FENCES for THIS fix, not deferred load-bearing work — each is either preserved-as-is (640-1023 tiers, #83 body, dots semantics) and verified by an AC, or an executor-time HOW decision (sticky-vs-fixed, expansion direction). No load-bearing work is being pushed to a later milestone. → file a task only if plan-review or execution-review surfaces a genuinely new deferral (e.g. candidate A's base-tier shell rework is later wanted for a different reason).

## Binary AC — RED-first, each independently and mechanically checkable

All e2e commands run from the agent-kanban repo root. The RED-on-prefix runs use master `dd59d07`; the GREEN runs use the executor's fix branch. Same spec file for both so the runs are directly comparable.

### AC1 — collapsed shelf reachable within the initial viewport on the folding-phone front screen (RED on master, GREEN on fix)

A new real-interaction Playwright spec, touch viewport portrait width <640px (e.g. `344x882`, `hasTouch:true isMobile:true`), loading a PRODUCTION-VOLUME board via `buildBoard({...})` deep enough that the single 88vw column is taller than the viewport (self-assert the card count first, per the overflow-guard token-shape lesson — the oracle must be able to vary). The spec asserts, with NO page scroll performed, that the collapsed `.ak-shelf__summary` bounding rect is fully within `[0, window.innerHeight]` (real geometry via `boxOf`/`fullyInViewport`, not `getComputedStyle`).

- **Check (RED):** `npx playwright test e2e/shelf-front-screen-reachable.e2e.spec.ts` on master `dd59d07` -> **non-zero exit**; the reachability assertion fails because `summary.top > innerHeight`. Record the RED run (branch/sha + measured `top` vs `innerHeight`) to a review-evidence file.
- **Check (GREEN):** the same command on the fix branch -> **exit 0**; the summary is within the initial viewport at rest.
- **Expected output:** master run prints a failing assertion naming `top` (e.g. ~>882) vs `innerHeight` (882); fix-branch run prints `passed`.

### AC2 — no regression to #83's bounded 60dvh opened body (GREEN on master AND fix)

At the same phone viewport, tapping the collapsed shelf opens the body, and a real touch/wheel gesture inside the opened `.ak-shelf__body` produces a positive `scrollTop` delta (the body is a bounded, self-scrolling panel, not an ever-growing column).

- **Check (behavior, primary):** the new spec's "opened-body scroll-delta" assertion (real gesture via `touch.ts`) passes on BOTH master `dd59d07` and the fix branch. Equivalently, `npx playwright test e2e/shelf-scroll.e2e.spec.ts` (the existing #83 oracle) still exits 0 on the fix branch.
- **Check (static confirm, secondary):** `command grep -nE 'max-height:\s*60dvh' app/globals.css` still returns the `.ak-shelf[open] > .ak-shelf__body` rule on the fix branch (exit 0, one match).
- **Expected output:** scroll-delta assertion `passed` on both branches; grep prints the `max-height: 60dvh` line.

### AC3 — no regression to the 640-1023.98px tiers (GREEN on master AND fix, unchanged)

At a grid-tier viewport (e.g. `768x1024`), the collapsed `.ak-shelf__summary` is within the initial viewport at rest — the existing shell behavior is unchanged.

- **Check:** the new spec's `768x1024` case asserts the collapsed summary bounding rect is within `[0, innerHeight]`; it passes IDENTICALLY on master `dd59d07` and the fix branch.
- **Check (diff-scope confirm):** `git diff dd59d07 -- app/globals.css` does NOT modify the shell-clamp block (globals.css L2000-2027) nor the collapsed-header block (L2029-2060). (Confirming the 640-1023 behavior is untouched; the AC3 e2e test is the authoritative behavioral proof.)
- **Expected output:** `768x1024` case `passed` on both branches; the diff touches only the base-tier region, not L2000-2060.

### AC4 — full UI-task gate (four artifacts, agent-kanban is Vercel-linked)

The change is user-facing UI, so all four UI-task-gate legs must leave their artifacts and the gate must pass:

- **Leg 1 (frontend-design POV):** a non-empty `design_brief` file (or `design_pov`) from the `/frontend-design` skill, cited via ticket `metadata.design_brief`/`design_pov`.
- **Leg 2 (ui-evolve):** real mobile + desktop screenshots of the built screen -> vision-judge -> a `ui_evolve_verdict` file containing a structured `verdict: ACCEPT` line + a rubric score + no regression, cited via `metadata.ui_evolve_verdict`.
- **Leg 3 (real-interaction test):** the AC1 spec's marker file (`interaction-test:` header; `asserts` includes a real gesture `scroll-delta` AND the collapsed-shelf reachability; `viewport=344x882` + `touch=true` on the same line; `red-on-prefix: dd59d07 (collapsed shelf top>innerHeight, reachability RED)`; `result: PASS`), cited via `metadata.interaction_test`.
- **Leg 4 (production build marker):** `bash ~/coding_projects/ai-brain/scripts/prod-build-marker.sh ~/coding_projects/agent-kanban --pr <n>` prints `production-build: agent-kanban@<head-sha> exit=0`.
- **Check:** `hooks/ui-task-gate.sh` passes (fail-closed) on the `TaskUpdate -> completed` for #2499 (all four artifacts present + well-formed); and `hooks/prod-build-before-merge-guard.sh` passes on `gh pr merge` for the PR (fresh marker bound to the head sha).
- **Expected output:** ui-task-gate exits 0 (no missing-artifact block); prod-build guard allows the merge; the prod-build marker line is present for the PR head sha.

## Review

Decision: PASS

Independent plan-review (cc-plan-review, Agent-tool FALLBACK path `[route-dispatch-fallback-ok]`, model:opus). I did NOT author this plan; I re-measured every load-bearing claim from source at master `dd59d0750a215947663bcd03dcb71f8463c27fda` (confirmed HEAD) before ruling.

### Root cause — INDEPENDENTLY CONFIRMED from source (not from the plan's narrative)
- **No 100dvh shell clamp below 640px** — CONFIRMED. `@media (max-width:640px)` (globals.css L1130-1171) touches only `.ak-header__row` / `.ak-status` / `.ak-lanes` cosmetics; no `.ak-app`/`.ak-main`/`.ak-board` height/overflow clamp. `body` (L108-118) = `min-height:100dvh; overflow-x:hidden` only; `.ak-app` (L174-178) = `max-width/margin/padding-bottom:40px` only; `.ak-main` (L187-189) = `container-type:inline-size` ONLY.
- **`.ak-strip.ak-board` takes full natural height** — CONFIRMED. `.ak-strip` (L440-448) = `display:flex; overflow-x:auto` (horizontal strip, no height clamp); `.ak-col` (L454-461) = `flex:0 0 88vw` (1-up).
- **`<Shelf>` renders source-order LAST in `.ak-main`** — CONFIRMED. BoardView.tsx: `.ak-strip.ak-board` (L509-529) -> `.ak-dots` (L531-555) -> `<Shelf>` (L561). `<Shelf>` = `<details class="ak-shelf"><summary class="ak-shelf__summary">` (Shelf.tsx L85-86), in normal flow.
- **No existing position on `.ak-shelf`** — CONFIRMED (grep `ak-shelf` x `position|sticky|fixed|bottom` = 0 hits). The shelf is genuinely in document flow, so with a tall column `summary.getBoundingClientRect().top > window.innerHeight`. The mechanism is deterministic, not asserted.
- **Shell clamp exists ONLY in the 640-1023 band** (L2000-2027) and the **#1590 dead-zone coupling warning** (L1962-1999, 840x660 class where `.ak-col` stays `flex:0 0 88vw; overflow:visible`) — both CONFIRMED verbatim. The plan's line citations are accurate throughout.

### Candidate B — SOUND; risk NOT under-sold
- B (phone-tier pinned collapsed shelf) genuinely makes the summary reachable within the initial viewport (sticky `bottom:0` pulls the source-order-last element up to the viewport bottom while its containing block is on-screen; releases to natural position at true page-bottom). It reuses #83's `max-height:60dvh; overflow-y:auto` body (L610-636) unchanged.
- The `overflow-x:hidden` sticky gotcha (html L105 / body L117 -> per CSS spec `overflow-y` computes to `auto`, which can create/trap a sticky scroll container per-engine) is a REAL, load-bearing assumption. The plan correctly treats it as Rule-18 unproven and makes AC1's REAL-INTERACTION geometry test the proof (not `getComputedStyle`) — the exact 2026-08-25 PR#73 lesson. Because AC1 is mechanism-agnostic, `position:fixed` remains a fallback if sticky is trapped. Correct posture.
- A vs C rejections are accurate, not strawmen: A would recreate the documented 840x660 dead-zone unless it also adds `.ak-col{overflow-y:auto;min-height:0}` (verified against the L1962-1999 warning); C breaks the `role="tab"` tablist keyed on `COLUMNS.map` (verified BoardView L531-555). B is correctly the smallest blast radius.

### Binary AC — RED-first and mechanically checkable against a REAL harness
- The e2e harness the ACs reuse EXISTS: `buildBoard()` (board-fixture.ts L171) + all six touch helpers `touchDragAt/boxOf/fullyInViewport/ancestorScrollOffsets/anyOffsetIncreased/visualViewportOffsets` (touch.ts L23/192/200/150/167/182), plus `shelf-scroll.e2e.spec.ts` and `fold8-scroll-reachability.e2e.spec.ts`, and `playwright.config.ts`. The plan does NOT understate executor scope.
- AC1 is genuinely RED-on-master: the geometry is deterministic given a tall board, and no existing spec contradicts it (`shelf.e2e.spec.ts` taps the summary at 390x844 only because it uses a SHORT default board — the bug needs production volume, which AC1 self-asserts). AC2 guards #83 (behavior + the static-confirm `command grep -nE 'max-height:\s*60dvh' app/globals.css`, file-bounded, matches L616). AC3 guards 640-1023 (768x1024 within-viewport + diff-scope confirm on L2000-2027 / L2029-2060, both verified as the correct blocks). AC4 = the full 4-leg UI-task gate. All exit-code checkable.
- Monotonicity (#1590): the new <640 rule is media-DISJOINT from the 640-1023 shell tiers; additive positioning with no clear-list / mutual-exclusion / last-writer arm — nothing stronger is erased.

### Non-blocking NAMED-RISK notes carried to execution-review (do NOT add AC arms to close these)
- **NR-2499-occlusion:** The watch-out asserts "the outcome AC requires the last column card to stay fully readable," but NO Binary AC actually verifies non-occlusion by the pinned bar. Coverage is real but non-binary (AC4 leg-2 ui-evolve vision-judge on mobile+desktop screenshots). Execution-review MUST confirm the last card is readable via those screenshots (or the executor adds a bottom-space-reserve assertion). Prose over-claims AC coverage here.
- **NR-2499-desktop:** Non-goal ">=1024 desktop unchanged" has no Binary AC; relies on AC4 leg-2 DESKTOP screenshots. Execution-review MUST confirm the CSS is media-scoped to <640 so it cannot leak to the desktop/grid tiers (an unconditional `position` rule would apply everywhere).
- **NR-2499-red-genuine:** AC1's RED depends on the executor building a tall-ENOUGH board. Mitigated by the plan's self-assert-card-count + record-the-RED-run discipline. Execution-review MUST verify the recorded master run shows `summary.top > innerHeight` by a real margin (a trivially-passing master = a dead RED / oracle-can't-vary).

### Mechanical publish note (not a plan defect)
`.ai-workspace/` is gitignored in agent-kanban (`.gitignore:18`); the 114 tracked `.ai-workspace/` files were force-added. This plan file and its `## Review` must be `git add -f`'d on a `2499-*` branch to be committed/pushed — else the plan (and this verdict) stays invisible cross-checkout (the 2026-08-10 B8 committed-but-unpushed class).

Decision: PASS
