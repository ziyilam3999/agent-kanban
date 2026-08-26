# Plan: Fold 8 PORTRAIT iteration — two-column paged board (landscape 4-up is LOCKED and untouched)

- task: `agent-kanban-fold8-uiux-redesign` (portrait iteration round) · role artifact: planner
- baseline for THIS round: **PR #75 head `1b5bac3`** on branch `agent-kanban-fold8-uiux-redesign` (base master `daa97750`). Build ON this head — do NOT rebase, do NOT touch the landscape tiers. NOTE: the primary clone's checkout is behind origin/master (pre-#74), so every file path below is as it exists on the PR branch head / its worktree, not the primary checkout.
- date: 2026-08-26 · session: 6bae4820-a911-4659-b95f-f7058c3071d1
- operator verdict (2026-08-26 review of PR #75 screenshots): **LANDSCAPE 4-up APPROVED + LOCKED.** **PORTRAIT: iterate** — "show 2 columns at a time, with the ability to scroll to the next 2 columns. evaluate and suggest. use frontend-design to review the ui."
- locked landscape contract: `.ai-workspace/plans/2026-08-25-agent-kanban-fold8-uiux-redesign.md` — its AC-1 (one-row 4-up: `gridTemplateColumns` → 4 tracks ∧ `gridTemplateRows` → 1 track at the landscape cells + sweep) is preserved verbatim by AC-6 below. Its D3 glance card (pips + model-pill retired, subject ≥14px) is KEPT.
- cairn: searched `fold8`, `portrait`, `snap`, `carousel` via `cairn-find.mjs`. Matched: *"session-state-20260825-fold8-bugfix-lanes.md — Re-shipping Fold8 on computed-style + static-screenshot verification — that IS the incident"*. That lesson (real-interaction verification, never computed-style-only) shapes AC-2/AC-4 and the ui-gate hook now enforces it mechanically. `snap`/`carousel` queries surfaced no task-relevant lessons.

## ELI5

Hold the fold-open tablet upright and today you get a 2×2 grid: all four lists crammed on one screen, each squashed into a short little box that shows only two or three cards before you have to scroll inside it. You can *see* everything but you can't *read* anything — four shallow boxes competing for one screen.

After this change, upright mode shows just **two tall lists side by side** — "TO DO" and "IN PROGRESS", the work happening right now. Each list is the full height of the screen, so you see five or six cards at a glance instead of two or three. To check the other two lists ("IN REVIEW" and "DONE"), you **swipe sideways, like turning a page** — the board glides over and snaps cleanly onto the second pair. You always know the other page exists because a thin sliver of the next list peeks in at the edge, and a little row of four dots under the board lights up the two lists you're looking at (tap a dot to jump). This is the exact same swipe-and-dots pattern the phone layout already uses — just two lists per page instead of one. The cleaned-up cards from the last round (big title, no tiny badges) stay exactly as they are. Sideways/landscape mode is untouched: still all four columns in one row, exactly as approved.

Why this reads better than the 2×2: reading a list is a top-to-bottom activity, and the 2×2 cut every list's height in half to keep them all on screen. Two-at-a-time gives each list its full height back — you trade "glance at all four" for "actually read the two that matter now", and the swipe keeps the other two one gesture away.

## Intent (what & why — never how)

**What**: On the Fold 8 held in portrait, the board presents exactly two full-height, independently-scrollable columns at a time, with a real horizontal swipe that pages cleanly to the other two columns, an always-visible signal that more columns exist, and the shipped glance-card declutter intact. Landscape behavior (locked 4-up) and phone/desktop are byte-identical in behavior.

**Why**: The operator reviewed the shipped portrait 2×2 and judged it still not right; their direction is 2-at-a-time paging. The 2×2's weakness is structural: at the real ~672×850 canvas each quadrant gets ~350px of height ⇒ ~2–3 visible cards per column — census without readability. Two full-height columns at ~46–50% width each land in the proven ideal reading measure (~310–360px) AND roughly double visible card depth per column. The kanban's left-to-right pipeline order makes the page split natural: page A = the live edge (TO DO · IN PROGRESS), page B = the outcome tail (IN REVIEW · DONE).

## Evaluation of the operator's direction (frontend-design lens) — evaluate & suggest

**The suggestion is right, and it is the app's own idiom.** The base phone layout is ALREADY a horizontally snap-paged strip — `.ak-strip` is `scroll-snap-type: x mandatory` with `.ak-col { flex: 0 0 88vw; scroll-snap-align: start }`, a next-column peek (12vw), and the `.ak-dots` pagination row (active dot stretches into a phosphor pill). Portrait fold = that same strip grown up to two columns per page. So this is not a new pattern bolted on; it is the existing design system expressed at a second density. Landscape stays the fixed 4-up console; the strip family (phone ×1, portrait fold ×2) is the moving-window family.

**Honest tradeoff, named**: the PR #75 ui-evolve verdict *praised* the portrait 2×2 for making a sparse 1-card column read as "a quiet lane, not a half-empty page" (its Spacing 6/10 dinged LANDSCAPE for exactly the full-height-empty-band effect). Full-height portrait columns re-expose that band when a column is sparse. Mitigations: (a) the dense columns (TO DO · IN PROGRESS) live on page A — the default view; sparse IN REVIEW/DONE live on page B, visited deliberately; (b) the existing `.ak-col__empty` dashed placeholder and the sticky head keep an empty lane structured; (c) the operator has weighed census-vs-readability and chosen readability — this plan encodes that choice. The ui-evolve re-judge (AC-8) is the check that the trade nets positive.

**Refinement beyond the literal ask** (the "suggest" half): pure 2-then-2 paging with no signal risks the exact failure this task exists to fix — columns nobody can discover. So the plan commits to a **dual affordance**: a thin peek of the adjacent column at the viewport edge (preattentive, zero chrome) PLUS the already-built dots re-enabled with the visible PAIR lit (a discrete "you're on 1–2 of 4", tappable to jump). And paging is **page-snap, not column-snap**: the board only ever rests on page A or page B — never a straddled 2·3 view — so the two pages behave like two stable screens, matching the operator's mental model ("the next 2 columns").

## Design commitments (frontend-design POV)

**POV**: the flight-recorder identity (phosphor-on-ink, mono telemetry, hue rails) is untouched — what changes is portrait's reading posture: from "four shallow gauges" to **"two deep instruments per screen; flip the page."**

- **P1 — One strip family, three densities.** Phone (<640) = 1-up strip. Portrait fold (640–899.98cqw, portrait-shaped) = **2-up strip** (this plan). Landscape fold / desktop = fixed 4-up. The portrait tier reuses the strip's existing snap/dots vocabulary rather than inventing a carousel.
- **P2 — Two pages, page-snap.** Page A = TO DO · IN PROGRESS; page B = IN REVIEW · DONE. A settled swipe always rests with a page pair fully visible (snap stops at column 1 and column 3 only, or a behavioral equivalent). No resting straddle.
- **P3 — Dual "more columns" affordance in the app's own language.** (i) A **peek**: a ≥16px sliver of the adjacent off-page column intersects the viewport edge (col 3 peeks right on page A; end-clamping mirrors a col-2 sliver left on page B). (ii) **Dots re-enabled** in this tier (they are `display:none` in the shipped 2×2): 4 dots, the two visible columns' dots lit (the phone keeps exactly 1 lit — same component, density-aware), dot tap jumps pages.
- **P4 — Full-height columns, calm cards.** Each visible column ≈46–50% of the container (≥300px at the named cells), full board height, per-column vertical scroll, sticky in-column head (name ≥12.5px + count). The D3 glance card ships unchanged: no pips, no model pill, subject ≥14px, base (non-compact) padding. Portrait now shows ~10–12 readable cards vs 16 cramped ones.
- **P5 — Engagement envelope: portrait-shaped, no height precondition.** The tier engages for every portrait-proportioned canvas at 640–899.98cqw — replacing the 2×2 tier's `min-height:700` axis entirely (the knife-edge class from the last incident dies on this axis too). Portrait/landscape tiers become mutually exclusive by shape, killing the #1590 source-order coupling in the 768–899.98 band. The 2×2 tier is **retired** (superseded, not kept as a fallback). Landscape <768 slivers fall to the strip — the locked plan's Non-goals explicitly bless that fallback.
- **P6 — Honest subjectivity split.** Geometry/gesture/indicator are AC-carried; "reads better" is judged by a fresh ui-evolve run (ACCEPT, overall ≥7.4 — no regression from PR #75's 7.4) and the operator visual gate before merge.

**Rejected** (named, with reasons): per-column snap (finer control but allows a straddled 2·3 rest — breaks the two-stable-pages model and invites accidental 1-column advances); a "1–2 / 4" fraction label (chrome the dots already encode); dots-only without peek (a static-looking 2-col board reads as "this is the whole board" — the original sin of this task); keeping the 2×2 as a tall-portrait fallback (two portrait layouts = two behaviors to learn and test for zero user win); a 3-up compromise (~215px columns — below the readable measure this canvas affords).

## Non-goals

- **Landscape: LOCKED.** No change to the landscape 4-up tiers (768–899.98 landscape extension + 900–1023.98 width-only), their CSS, or their AC. AC-6 fences this.
- Phone (<640) and desktop (≥1024) behavior byte-identical (AC-6 hold-outs).
- The 900–1023.98cqw portrait-width band (big portrait tablets) keeps today's width-only 4-up — outside this plan.
- No poll/caching/payload changes; no board-data or schema changes; no reskin (tokens, hues, fonts, motion, drawer, swimlanes, header untouched except where an AC names them).

### Binary AC

All checkable from outside the diff: Playwright against the running app (touch context, `hasTouch`, real CDP gestures via the PR-branch `e2e/fixtures/touch.ts`, deep-board + modelVersion-bearing fixture), exit codes, artifact files. Computed-style checks are valid only for presence/typography arms, never as the layout/interaction proof (the incident lesson; the ui-gate hook enforces a real-interaction spec). **Portrait cells**: **750×1000** and **672×850** (both mandatory for every portrait AC); robustness cells 672×690 and 860×1000 where named. RED evidence is captured against **PR head `1b5bac3`** (the current-portrait build) with the new spec before implementing.

**AC-1 — Portrait is a 2-col page (not 2×2, not all-4).** At both portrait cells:
  (a) exactly **2** `.ak-col` are fully inside the viewport (bounding-box); each fully-visible column's width is 42–52% of the board container's clientWidth and ≥300px; the board has real horizontal overflow (`scrollWidth > clientWidth + 4`). The shipped 2×2 MUST FAIL this (it shows 4 fully-visible columns and no h-overflow) — RED on `1b5bac3`.
  (b) all 4 columns share ONE row: max column-top spread < one card height (no second y-band).
  (c) on load (page A), the two fully-visible columns are TO DO and IN PROGRESS, and a ≥16px horizontal sliver of column 3 intersects the viewport (the peek).

**AC-2 — Real-gesture paging with page-snap (the mandatory REAL-INTERACTION spec).** At both portrait cells, in a touch-enabled mobile context, committed as a Playwright spec:
  (a) a real horizontal touch swipe (right-to-left) on the board produces board `scrollLeft` delta > 0 and, after snap settle, columns 3 AND 4 are both fully visible (page B). RED on `1b5bac3` (no h-overflow ⇒ delta 0).
  (b) snap lands on pages: after any single settled swipe from page A, the resting `scrollLeft` equals the page-A or page-B resting position (±8px); a rest where the fully-visible pair is {col 2, col 3} does not occur.
  (c) the reverse swipe returns to page A (`scrollLeft` back to ≈0 ±8px).
  (d) vertical reachability on BOTH pages: a real vertical touch drag inside column 1 (page A) and column 4 (page B) increases that column's `scrollTop` (delta > 0) and brings a below-fold card fully into view (deep fixture).

**AC-3 — "More columns" affordance asserted in the DOM.** At both portrait cells:
  (a) the dots row (`.ak-dots`) is visible (not `display:none`) with 4 dot elements — RED on `1b5bac3` (hidden in the shipped portrait tier);
  (b) on page A exactly 2 dots carry the active/current marker (class or computed style distinguishable from the inactive dots) and they correspond to columns 1–2; after the AC-2(a) swipe, the active pair corresponds to columns 3–4;
  (c) a real tap on the dot for a currently-offscreen column brings that column fully into view.

**AC-4 — Poll-tick stability of both scroll axes + INP.** At 750×1000 under the real 5s poll cadence (PR #74 methodology, changed payload delivered):
  (a) NEW invariant: while resting on page B, a poll tick that re-renders cards does NOT move the board off page B (`scrollLeft` still at the page-B rest ±8px);
  (b) a column's `scrollTop` set by a real drag survives the tick (carried from the PR-branch `fold8-portrait-2x2` spec's sync leg, re-targeted to the new layout);
  (c) INP under the poll stays <200ms (the PR-branch `fold8-inp-under-poll` spec green at 750×1000).

**AC-5 — Glance-card declutter preserved (control — stays green).** At both portrait cells: zero visible role-pip elements in board cards; zero visible model-pill elements (with the modelVersion-bearing fixture from PR #75 so the arm is non-vacuous); card subject computed font-size ≥14px; card vertical padding ≥ the base card's (no compact variant); column-head name ≥12.5px. GREEN on `1b5bac3` and must stay GREEN.

**AC-6 — Landscape LOCKED no-regression + hold-outs (control — stays green).** The locked plan's AC-1 assertions pass unchanged: at 890×660, 840×660, 768×650, 1000×750 and the sweep {768, 816, 890, 932, 1000} × {608, 660, 750} — 4 `.ak-col` fully visible, no horizontal overflow, `gridTemplateColumns` → 4 tracks ∧ `gridTemplateRows` → 1 track, per-column real-touch scroll works. Hold-outs: 390×844 renders the phone strip (1 visible column, **exactly 1** active dot — fences the dots component change) and 1440×900 the desktop 4-up. No landscape-tier CSS rule or landscape spec assertion is modified; any such edit must be called out in the PR body and re-justified.

**AC-7 — No dead zone across the partition.** At every cell in AC-1/AC-2/AC-6 plus the boundary cells 672×690 (short portrait — newly ENGAGED by P5's height-gate removal: must render the 2-col paged tier and pass AC-2(d)-style reachability) and 750×710 (landscape <768 sliver — leaves the retired 2×2: must fall back to a working scroll path that reaches a below-fold card, strip page-scroll acceptable per the locked Non-goals): some real touch scroll path reaches a below-fold card. No cell renders an unscrollable clamp (the PR #74 dead-zone class).

**AC-8 — Two-leg UI gate + operator visual approval BEFORE merge.** (a) This plan's Design commitments section serves as the design-brief artifact; (b) a FRESH ui-evolve verdict file exists with `verdict: ACCEPT` and overall **≥7.4** (PR #75's current score — no regression), judged on real screenshots that include BOTH portrait pages (page A and page B) at 750×1000 and 672×850, plus landscape informational shots; (c) the screenshots are presented to the operator and explicit approval received before the PR merges (the orchestrator runs the operator gate; this plan only requires the artifact + the wait).

**AC-9 — Suite green.** `npm run typecheck` exit 0; `npm test` (jest) exit 0; full Playwright e2e suite exit 0.

## Rule-17 both-ends oracle

| Member | Cell | On `1b5bac3` (pre-fix) | After fix |
|---|---|---|---|
| RED: exactly-2-fully-visible + h-overflow (AC-1a) | 750×1000, 672×850 | FAIL (2×2: 4 visible, no overflow) | PASS |
| RED: swipe `scrollLeft` delta > 0 → cols 3–4 visible (AC-2a) | both | FAIL (delta 0) | PASS |
| RED: `.ak-dots` visible in portrait (AC-3a) | both | FAIL (`display:none`) | PASS |
| CONTROL: landscape one-row 4-up (AC-6) | 890×660 et al. | PASS | PASS (unchanged) |
| CONTROL: declutter arms (AC-5) | both portrait | PASS | PASS |
| CONTROL: phone strip 1 active dot / desktop 4-up (AC-6) | 390×844 / 1440×900 | PASS | PASS |

Red-evidence numbers are filed (PR #74/#75 `red-evidence` pattern) by running the new spec against `1b5bac3` BEFORE implementing.

## Spec-amendment inventory (deliberate — each called out in the PR body)

The portrait contract changes, so the PR-branch specs that assert the OLD portrait 2×2 are amended deliberately — never silently:
- `e2e/fold8-portrait-2x2.e2e.spec.ts` (on PR branch) — the 2×2 geometry leg is superseded by the new paged-portrait spec; the scroll-survives-poll leg is CARRIED (re-targeted per AC-4(b)). Rename/replace is fine; the poll-sync invariant must not be lost.
- `e2e/fold8-uiux-redesign.e2e.spec.ts` (on PR branch) — portrait 2×2 geometry arms updated to the paged contract; the density/declutter arms stay as-is (they are AC-5's vehicle).
- `e2e/fold8-4x3-grid-tiers.e2e.spec.ts` (on PR branch) — portrait tier-map rows updated to the new tier; landscape rows untouched.
- ALL landscape describe-blocks/assertions: unmodified (AC-6).

## Load-bearing assumptions (honest)

1. Real portrait canvas ≈672×850 (prior round's DPR inference, probe-confirmed 2×2 engagement at 672). 672 gives 32px margin above the 640 container floor; the 640–672 band still engages the tier (columns degrade to ~293px there — acceptable, un-AC'd).
2. The base strip's snap machinery is sound at 2-up density — it ships on phone today. The new tier composes existing mechanics; it does not build a new scroller.
3. The dots pair-lit change is a shared-component edit; the phone strip must keep exactly 1 active dot (fenced mechanically by AC-6's 390×844 hold-out) and the dots' tablist a11y contract must not end up with two `aria-selected` tabs (visual pair-marker + single logical selection is the sanctioned shape; executor's call within that).
4. `scrollLeft` stability across poll re-renders (AC-4a) is asserted, not assumed — if React's card-list re-render resets the board's scroll position, fixing that IS in scope (it is the difference between a usable and an unusable page B).
5. PR #75's modelVersion-bearing e2e fixture is already on `1b5bac3`, so AC-5's model-pill arm is non-vacuous without further fixture work.

## Executor notes (mechanics allowed here — still your call; the AC matrix is the contract)

- **Sketch (informative)**: the portrait tier can be "the base strip at 2-up density" — override `.ak-col` flex-basis to ≈46–47cqw (the peek falls out of the arithmetic; end-clamping auto-mirrors it on page B), keep base `scroll-snap-type: x mandatory`, restrict snap stops to page starts (e.g. `scroll-snap-align: none` on even columns — columns are the board's only children), `scroll-padding-inline-start` matching board padding, full-height columns via the shell clamp + `.ak-col { overflow-y:auto; min-height:0 }` + sticky head background, dots un-hidden. The shipped 2×2 grid block is retired in the same band.
- **Shell-clamp LOCKSTEP (the PR #74 dead-zone lesson)**: the clamp OR-list (`app/globals.css` ~L1666 on the PR branch) currently carries the 2×2's exact gate `(min-width:640px) and (max-width:899.98px) and (min-height:700px)`. Replace that arm with the NEW tier's exact gate in the same edit — the clamp must track exactly the cells where a tier is active, or 750×710-class cells go dead (AC-7 is the catch). Inside the tier, the board needs `overflow-x:auto` re-asserted AFTER the clamp block's `overflow:hidden` (source order wins; the tier blocks already sit after the clamp).
- **Gate recommendation**: `@media (orientation: portrait)` + `@container (min-width:640px) and (max-width:899.98px)` — mutually exclusive with the landscape extension by shape (no cascade-order dependency left in 768–899.98), and no height axis at all (P5). If you choose differently, AC-7's partition sweep is the contract.
- **Dots**: `visibleCount = max(1, floor(clientWidth / (scrollWidth / COLUMNS.length)))`; light dots `[idx, idx+visibleCount)`; keep a single logical `aria-selected`; `scrollToCol` from a dot tap should land the tapped column's PAGE (assumption 3). Phone behavior unchanged.
- **Touch ergonomics**: `overscroll-behavior-x: contain` on the board (Android edge-swipe back-nav hazard); axis-locking between horizontal paging and in-column vertical scroll is native — do not add JS gesture handling.
- **Branch/worktree**: continue on the existing PR #75 branch `agent-kanban-fold8-uiux-redesign` in its worktree (`.claude/worktrees/agent-kanban-fold8-uiux-redesign`) — the task id is the branch's leading token (naming rule satisfied). Non-numeric task ⇒ the numeric-anchored ledger merge gate SKIPS; the orchestrator's manual ledger check applies.
- **Red evidence first**: run the new paged-portrait spec against `1b5bac3` and file the numbers before implementing.
- Commit this plan file onto the PR branch with the implementation (it currently lives in the primary clone working tree).

## Execution model

**subagent (`delegate`)** — one executor continuing in the existing PR worktree. One coherent write surface (portrait tier CSS + dots component + spec amendments), not parallelizable, far above trivial-skip. Knob B = **both**: the extended Playwright suite is the test oracle (AC-1..7, 9); independent execution-review + ui-evolve vision judge + operator gate carry the design-quality residual (AC-8).

## Critical files (informative, not prescriptive — all paths as on PR #75 branch head `1b5bac3` / its worktree; the primary checkout is behind origin/master)

- `app/globals.css` — the 2×2 tier block (`@media (min-height:700px){@container (min-width:640px) and (max-width:899.98px)}`, ~L1728 on the branch) is what gets REPLACED; the shell clamp OR-list (~L1666); base strip/dots (~L424–518). Landscape blocks (the 768–899.98 landscape extension + 900–1023.98 4-up + desktop): DO NOT TOUCH.
- `components/BoardView.tsx` — `.ak-dots` render + `onStripScroll`/`scrollToCol` (~L283–379) for the pair-lit dots.
- `e2e/fold8-portrait-2x2.e2e.spec.ts` (on PR branch), `e2e/fold8-uiux-redesign.e2e.spec.ts` (on PR branch), `e2e/fold8-4x3-grid-tiers.e2e.spec.ts` (on PR branch), `e2e/fixtures/touch.ts` (on PR branch), `e2e/fixtures/board-fixture.ts` — the AC harness to amend/extend; plus a new paged-portrait spec file, e.g. `e2e/fold8-portrait-2col-paging.e2e.spec.ts` (new).
- `.ai-workspace/plans/2026-08-25-agent-kanban-fold8-uiux-redesign.md` — the locked landscape contract this plan builds on.

## Review

**Round-1 Decision: PASS** — reviewer: independent plan-review role (stateless, did NOT author this plan; Agent-tool fallback dispatch `[route-dispatch-fallback-ok]`). Every load-bearing premise below was verified by EXECUTION against the committed PR head `1b5bac3` (not the plan's own narrative). The design is faithful to the operator ("2 columns at a time + scroll to the next 2"), the ACs are binary and checkable from outside the diff with REAL red members and REAL green controls, and the single most important property — the operator-approved LOCKED landscape 4-up — is genuinely protected by a real no-regression AC. Two durable named-risk notes are registered (see below); one REQUIRED executor pre-flight is called out. None rises to a plan-AC blocker.

### What I verified against the real code at `1b5bac3` (committed HEAD, 1982-line globals.css)

- **Landscape 4-up EXISTS on the baseline and is a real control (AC-6 is not testing a fiction).** Confirmed two tiers on committed HEAD: `@media (orientation: landscape) { @container (min-width:768px) and (max-width:899.98px) }` → `repeat(4,1fr)` one-row (globals.css HEAD:~L1812), plus the width-only `@container (min-width:900px) and (max-width:1023.98px)` → `repeat(4,1fr)` (HEAD:~L1876). Every AC-6 cell (890×660, 840×660, 768×650, 1000×750, and the {768,816,890,932,1000}×{608,660,750} sweep) is landscape-shaped and lands in one of those two tiers → genuinely 4-up-one-row on the baseline. AC-6 asserts geometry (4 cols fully visible, no h-overflow) + computed 4×1 tracks + per-column REAL touch scroll — a legitimate stays-green control, not computed-style-only.
- **Portrait/landscape mutual exclusivity is SOUND (P5 holds).** The new portrait tier (`@media (orientation:portrait) @container 640-899.98`) and the landscape 4-up (`@media (orientation:landscape) @container 768-899.98`) can NEVER both match — orientation partitions them. This genuinely severs the #1590 source-order coupling the OLD 2×2 (un-orientation-guarded `min-height:700`) had with landscape-4up. Monotonicity: no clear-list/last-writer arm can erase the other; the retired-2×2 collision (if the executor forgets to retire it) is caught by AC-1 (a surviving 2×2 shows 4 cols → fails "exactly 2").
- **AC-2 is a GENUINE real-interaction spec, not computed-style in disguise.** Real CDP touch via `e2e/fixtures/touch.ts`, asserts board `scrollLeft` delta > 0 → cols 3&4 fully visible, page-snap rest positions (no {col2,col3} straddle), reverse swipe, and per-column `scrollTop` delta on BOTH pages. RED member verified: at 750×1000 and 672×850 the baseline renders the 2×2 grid (`@media(min-height:700){@container 640-899.98}`, HEAD:~L1746) with no h-overflow → a horizontal swipe yields delta 0 → AC-2(a) fails red. Real.
- **Rule-17 oracle members all verified against real CSS:** RED exactly-2+h-overflow (2×2 shows 4, no overflow) ✓; RED swipe-delta (delta 0 on 2×2) ✓; RED `.ak-dots` visible (2×2 tier has `.ak-dots{display:none}`, HEAD) ✓; CONTROL landscape 4-up (exists, green) ✓; CONTROL declutter (2×2 tier carries `.ak-pips{display:none}`, `.ak-model{display:none}`, `.ak-card__subject{font-size:14px}`, `.ak-col__name{font-size:12.5px}` — matches AC-5's arms exactly) ✓; CONTROL phone 1-dot/desktop 4-up ✓.
- **AC-5 model-pill arm is non-vacuous (mechanism present).** `e2e/fixtures/board-fixture.ts` on HEAD supports `opts.modelVersion`/`effort` and a `modelPill` fixture option (the Round-1 R1 fix from the 2026-08-25 plan already landed) — so the executor CAN render a `.ak-model` pill and prove `display:none` does real work. Executor MUST actually pass a modelVersion-bearing card in the portrait spec.
- **AC-8's ≥7.4 floor is an HONEST derived number.** PR #75's `fold8-uiux-redesign-ui-evolve-verdict.md` overall is exactly **7.4/10**; "no regression from 7.4" is correct.
- **DOM mechanism is sound.** `components/BoardView.tsx:344` renders one element `className="ak-strip ak-board"`, so the grid tiers override the flex base on the SAME node; the plan's "portrait = base strip at 2-up density" (re-assert `overflow-x:auto` after the clamp's `overflow:hidden`, override `.ak-col` flex-basis ~46-47cqw, snap-align on page-start cols) composes existing machinery. The pair-lit dots formula `floor(clientWidth/(scrollWidth/4))` yields 1 on phone (col≈88vw) and 2 in portrait (col≈47cqw) — phone-1-dot is mechanically fenced by AC-6's 390×844 hold-out.

### REQUIRED executor pre-flight (operational — mechanically backstopped by AC-6, but do NOT skip)

**The worktree is DIRTY: it carries a STAGED revert that deletes the locked landscape.** `git -C .claude/worktrees/agent-kanban-fold8-uiux-redesign status` shows `M app/globals.css` — a staged 1872-line version (−115 lines vs committed `1b5bac3`'s 1982) that REMOVES the entire `@media (orientation:landscape)` 768-899.98 4-up extension AND the portrait declutter. If the executor implements on top of this dirty tree, or commits it, the operator-approved LOCKED landscape 4-up is DELETED, and the plan's "run the new spec against `1b5bac3` for red-evidence" step would be run against a corrupted baseline (landscape would falsely appear broken). **Executor MUST reset the worktree to clean committed `1b5bac3` (e.g. `git -C <worktree> restore --staged --worktree app/globals.css`, confirm `git status` clean) BEFORE red-evidence and implementation.** AC-6 is the mechanical catch if this is missed (landscape sweep goes RED), so it cannot silently ship — but the red-evidence corruption risk is why this is a required pre-flight, not just a nicety. Registered as durable named-risk note `fold8portrait-dirty-worktree-landscape-revert` (discoverable via `node hooks/named-risk-notes.mjs list --task agent-kanban-fold8-uiux-redesign --repo <agent-kanban>`).

### Named-risk notes carried (durable, registered — NOT blockers)

1. **`fold8portrait-dirty-worktree-landscape-revert`** — the dirty-worktree hazard above.
2. **`fold8portrait-fullheight-empty-band-uievolve`** — PR #75's ui-evolve (7.4) explicitly praised the 2×2 for making a 1-card column read as "a quiet lane, not a half-empty page," *because shallow quadrant rows*. The new FULL-HEIGHT 2-up columns re-expose that empty-band pathology on page B (IN REVIEW/DONE, the sparse 1/1 columns). AC-8's fresh ui-evolve ≥7.4 is a GENUINE go/no-go that can legitimately fail — a sub-7.4 result is a design-direction question for the operator, not a fixture artifact to wave off. The plan names this tradeoff honestly (§Evaluation) and gates it correctly; execution-review/ui-evolve owns the decidable "did it actually net positive?" call on the real render.

### Non-blocking tightenings (executor's call — each already backstopped by an existing AC)

- **AC-6 does not assert `.ak-dots` stays hidden in landscape.** The dots re-enable is a shared-component change; landscape 4-up relies on its own `.ak-dots{display:none}`. Structurally safe as long as the executor doesn't touch that rule, but consider adding "`.ak-dots` not visible at the landscape cells" to AC-6, mirroring the 390×844 "exactly 1 dot" fence, to make the shared-component blast radius explicit.
- **Declutter re-carry is implicit.** Retiring the 2×2 block (P5) deletes the declutter CSS that lives inside it; the new portrait tier must re-carry `.ak-pips/.ak-model{display:none}` + subject 14px + col-name 12.5px. AC-5 catches it (goes RED if dropped), but an explicit executor reminder would prevent a wasted red-evidence cycle.
- **AC-1(a) width band 42-52% is loose on the high side** (2×52%=104% can't fit 2 cols), but the conjoined "exactly 2 fully visible" + "≥16px peek at 672" arms constrain the real value to ~46-47%. Harmless; noting for transparency. At the 640-672 low end columns degrade to ~293px (<300, correctly un-AC'd per assumption #1) — 672 is the mandatory floor cell and 46-47cqw there = 309-316px ≥300, so the AC holds at every mandated cell.
- Consider carrying the phone "horizontal snap scroll still works" assertion (present in the 2026-08-25 AC-3(c), dropped from AC-6's 390×844) — base `.ak-strip` snap is untouched by this plan so the risk is low, but it costs nothing to keep.

### Monotonicity checklist (#1590)

Mutual-exclusion / clear-list arms in the intended diff: (1) new-portrait-2up vs landscape-4up in 768-899.98 — severed by orientation, neither can erase the other, no source-order dependency (the P5 improvement over the old un-guarded 2×2); (2) new-portrait vs retired-2×2 — 2×2 removed; if a stray 2×2 survives, stronger claim = new-portrait, weaker = 2×2, caught by AC-1 "exactly 2"; (3) shell-clamp OR-list — arm #2 (2×2 `min-height:700` gate) replaced by the portrait gate, arm #3 (landscape) preserved, AC-7 catches a mistracked clamp; (4) dots-re-enable — portrait shows dots, other tiers hide them, orientation/width-partitioned, phone-1-dot fenced by AC-6. All arms are severed by partitioning or caught by a binary AC.

**Convergence:** Round 1 full adversarial review complete. No load-bearing premise refuted; the core ticket properties (2-up paging + landscape-4up preservation) are protected by real ACs with real red/green members verified against `1b5bac3`. The executor may start after the REQUIRED worktree-reset pre-flight.

<!-- plan-review verdict: PASS — Round 1 (full adversarial) — reviewer: cc-plan-review (Agent-tool fallback dispatch, [route-dispatch-fallback-ok]) — 2026-08-26 -->
plan-review: PASS (Round 1)

## Execution Review

**Decision: PASS** — reviewer: execution-review role (stateless, adversarial; did NOT author this plan or the diff). Full verdict artifact: `.ai-workspace/reviews/fold8-portrait-2col-paging-execution-review.md` (committed to this PR-head branch). Reviewed PR #75 head `1b6e8c1` in its own PR-head worktree.

- **Landscape 4-up = BYTE-IDENTICAL to the approved `1b5bac3`.** The "Landscape 4-up extension → EOF" 189-line block extracted from both commits `diff`s empty (exit 0); it shifted +55 lines with zero internal change; the whole `globals.css` +55 growth is in the portrait tier. The `globals.css` `1b5bac3→1b6e8c1` diff touches only the portrait shell-clamp arm + the retired-2×2→portrait-2up tier; no `repeat(4,…)` landscape rule changed. AC-6 landscape sweep GREEN confirms live. Executor's "landscape byte-identical" claim VERIFIED.
- **Portrait oracle independently re-reproduced (my own numbers, not the executor's):** GREEN at head = `fold8-portrait-2col-paging.e2e.spec.ts` **11/11 pass (41.6s)**; RED with app code reverted to pre-paging `1b5bac3` (spec+fixtures kept at head) = **8 fail / 3 pass**, incl. AC-2 real CDP swipe → `scrollLeft = 0` (`Expected: > 0 / Received: 0`) — the predicted delta-0 signature. The 3 passing on the pre-paging build are the landscape-only controls, proving the RED is scoped to the paging change. Genuine real-interaction test (CDP `Input.dispatchTouchEvent`, asserts scrollLeft deltas + snap rest positions), NOT computed-style in disguise.
- **All 9 AC re-verified at head:** AC-1..AC-7 PASS (paging spec + landscape spec + full suite); AC-8 ui-evolve `verdict: ACCEPT`, `overall: 7.5/10` (≥7.4) with page A & B at 750×1000 and 672×850, operator gate DONE per orchestrator; AC-9 `tsc` exit 0, `jest` 445/445, full Playwright **90/90 (5.8m)**.
- **Named-risk notes dispositioned** (bound to id in the verdict artifact): `fold8portrait-dirty-worktree-landscape-revert` → not-applicable (worktree clean, landscape byte-identical in HEAD — falsification met); `fold8portrait-fullheight-empty-band-uievolve` → addressed (fresh ui-evolve 7.5 ≥ 7.4 with page-B captures; empty band honestly named + quantified on a sparse control, recorded as top follow-up, not waved off; operator-accepted ship-as-is).
- **Privacy scan (contract-compliant):** `bash scripts/privacy-scan.sh --working .ai-workspace/reviews/fold8-portrait-2col-paging-execution-review.md` → `privacy-scan: CLEAN mode=working size=12258` (exit 0); positive control (same invocation on a scratch copy carrying a seeded AWS-secret needle) → `privacy-scan: DIRTY (… credential-secret matches=1)` (exit 1) — instrument had power.

<!-- execution-review verdict: PASS — 2026-08-26 — head 1b6e8c1 + this verdict commit -->
execution-review: PASS
