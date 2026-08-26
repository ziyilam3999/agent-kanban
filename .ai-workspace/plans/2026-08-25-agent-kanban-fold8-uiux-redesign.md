# Plan: Fold 8 UI/UX REDESIGN — landscape must be a real 4-column kanban; portrait must be readable at a glance

- task: `agent-kanban-fold8-uiux-redesign`  ·  role artifact: planner
- baseline: `origin/master` = `daa97750` (post PR #74 scroll/INP bugfix)
- date: 2026-08-25  ·  session: 6bae4820-a911-4659-b95f-f7058c3071d1
- design lineage: `docs/fold8-4x3-fable-critique.md` + `docs/fold8-4x3-design-brief.md` (PR #73), bugfix plan `2026-08-25-agent-kanban-fold8-4x3-bugfix-responsive.md` (PR #74)
- cairn: searched `fold8`, `responsive` via `cairn-find.mjs`. Matched: *"session-state-20260825-fold8-bugfix-lanes.md — DIAGNOSIS captured: LANDSCAPE single-column = base `.ak-strip{flex:0 0 88vw}` … Re-shipping Fold8 on computed-style + static-screenshot verification — that IS the incident"*. That incident lesson (real-interaction verification, never computed-style-only) shapes every AC below.

## ELI5

The fold-open tablet has two ways to hold it. Held sideways (landscape), the board is supposed to show all four lists next to each other — but on the real device it still shows ONE giant list you have to swipe through, because the "show four columns" rule only turns on if the screen is at least 900 pixels wide AND the "show four boxes" rule needs 700 pixels of height — and the real device, after the browser's own bars eat their share, is a hair too small for BOTH rules. So it falls back to the phone layout. We measured this: at 890×660 the board is one huge column; at 904×700 it's four. The device lives on the wrong side of that knife edge.

Held upright (portrait), the four-box grid DOES appear, but every card is stuffed with tiny 9-pixel badges, four progress dots, a model tag, and cramped padding — sixteen busy cards at once. It reads like a wall of static.

The fix has two halves. One: make "four columns side-by-side" turn on for ANY sideways-held tablet screen, with generous margin below the real device's size — no more knife edges. Two: in both fold layouts, make each card a calm "glance card" — bigger title, keep the one line that says why the card is where it is, drop the micro-badges (they stay in the detail drawer you get by tapping). The dark phosphor console look stays exactly as it is.

## Intent (what & why — never how)

**What**: On the unfolded Fold 8, the board must present a true multi-column kanban in landscape (all 4 columns simultaneously visible, each independently scrollable) and a readable, decluttered quadrant board in portrait — robust to the real device's browser-chrome-shaved, DPR-dependent canvas, not tuned to an idealized 1000×750/750×1000.

**Why**: The operator reports (with screenshots) that landscape still shows a single swipe-through column and portrait is "too complex for user to read". Probe-verified root cause (see ground truth): the shipped tier gates (4-up requires container ≥900px; 2×2 requires viewport height ≥700px) both just miss the real canvas, so landscape falls through to the phone strip. Portrait's structure works but per-card density (4 rows of 9–13.5px micro-elements × ~16 visible cards) defeats glanceability. A kanban whose columns are invisible has lost its reason to exist; a board you can't read at arm's length has too.

## Execution model

**subagent (`delegate`)** — one executor in an isolated worktree branched from `origin/master` (`daa97750`). Rationale: one coherent write surface (globals.css tiers + card/column markup + e2e specs) with tightly coupled changes — not parallelizable, and far above trivial-skip (multi-file, architectural layout decision). Knob B evaluator = **both**: the extended Playwright e2e suite is the test oracle (AC-1/2/3/5), plus independent execution-review and the ui-evolve vision judge + operator gate (AC-4) for the design-quality residual no test can score.

## Verified ground truth (probed live at `daa97750`, Chromium touch context, real 1192-ticket board — cite, don't re-derive)

| Viewport | Baseline regime | Cols fully visible | Notes |
|---|---|---|---|
| 1000×750 | 4-up grid | 4 | **already GREEN on baseline** — NOT a red-repro point |
| 904×700 | 4-up grid | 4 | colW 210, per-col scroll works |
| **890×660** | **phone STRIP (h-scroll)** | **1** | colW 783 (88vw) — the operator's landscape screenshot |
| **840×660** | **phone STRIP** | **1** | colW 739 |
| **768×650** | **phone STRIP** | **1** | colW 676 |
| 750×1000 | 2×2 quadrant | 4 | structure OK; subject 13.5px, pips + model pill rendered, compact 9px card padding — the density complaint |
| 390×844 | phone STRIP | 1 | correct (hold-out) |
| 1440×900 | desktop 4-up, page scroll | 4 | correct (hold-out; header ~118px) |

**Real-device canvas inference** (from the two screenshots + which tiers fired): portrait showed the 2×2 ⇒ portrait CSS width ≥640; landscape showed the strip ⇒ landscape CSS width <900 (the width-only 4-up tier did not fire). Physical 2448×1848 ⇒ DPR ∈ (2.72, 2.89) ⇒ DPR ≈ 2.75: **landscape ≈ 890 × ~610–670 (after browser chrome), portrait ≈ 672 × ~850**. Both orientations sit in the dead cell / at the margins of the shipped gates. Any redesign keyed to thresholds NEAR these numbers repeats the incident class ("CONFIG ≠ CAPABILITY envelope"): thresholds must sit WELL below the target canvas.

## Design commitments (frontend-design POV — deliberate, committed, refine-not-reskin)

**POV**: the board's identity is a flight recorder — every gauge visible at once, phosphor-on-black, mono telemetry. That identity is correct and untouched. What changes is the *reading distance*: an unfolded Fold on a desk is read at arm's length, so the fold tiers become a **glance tier** — census of four always on screen, one clear title per card, forensic detail one tap away in the drawer. Structure adapts; the aesthetic does not.

### D1 — LANDSCAPE: 4-up, all four columns, committed (N=4)
Every landscape-proportioned tablet-band canvas renders **all 4 columns side-by-side**, each with its own vertical scroll, no horizontal scrolling to discover columns, and **no height precondition**.
- **Why 4-up and not 2×2**: landscape's abundance is horizontal; a 2×2 would waste it and halve column depth (~2 cards per quadrant at the real ~630px usable height vs 4–6 in full-height columns). Column widths land at ~194–234px on the plausible canvas range — proven readable here: baseline already renders 210px columns at 904×700 and 236px on desktop, with 2-line-clamped subjects. Sub-~194px widths (landscape narrower than 768px — split-screen only, never the full unfolded device) are outside the 4-up commitment (see Non-goals + Deferred).
- **Engage-by-default**: the 4-up must hold across the whole AC-1 sweep (widths 768–1023 × heights 608–750), i.e. ≥120px of margin below the estimated real canvas on the width axis and NO dependence on the height axis. Killing the knife-edge class is the design requirement; the executor picks the mechanism.

### D2 — PORTRAIT: keep the quadrant 2×2, cut the noise (structure was right; density was wrong)
- **Rejected — option (a), single stacked column with collapsible sections**: a ~640–720px-wide card is a 100+-character reading measure that is mostly dead space (the exact pathology `fold8-4x3-fable-critique.md` §1 documents for 88vw cards), and it hides 3 of 4 states below the fold — the flight-recorder census breaks. Collapsing sections adds an interaction tax to see what a kanban exists to show.
- **Committed — option (b), decluttered 2×2**: at ~316–355px, quadrant columns are the ideal card measure. "Too complex" decomposes into per-card noise, not wrong structure — so the noise goes (D3) and the structure stays: TODO · IN PROGRESS top, IN REVIEW · DONE bottom, each quadrant independently scrollable, sticky in-quadrant heads.
- **Hierarchy**: quadrant heads step up as the anchor a reader orients by — column name + count more prominent than today (name ≥12.5px vs 11.5 baseline). Portrait spends its vertical abundance on whitespace: base card padding (not the compact variant) and breathing room between cards.

### D3 — The glance card (both fold tiers, landscape 4-up + portrait 2×2)
- **Retired from the card** (both live on in the tap-open drawer): the 4 role pips (already styled "secondary/dimmed" — at arm's length they are texture, not signal) and the 9px model/effort pill (illegible at this distance).
- **Promoted**: subject is the unambiguous anchor — **≥14px** (13.5 baseline), 2-line clamp kept.
- **Kept exactly as-is**: the phase line (the single meta row that says WHY the card sits in its lane — the strongest per-card signal), ticket id, relative time, blocked/hold chips (safety-critical), research/ship-tail chips (rare, event-worthy), hue rails, glow/lift motion, all tokens and atmosphere.
- Phone (<640) and desktop (≥1024) cards are untouched.

### D4 — Honest subjectivity split
"Optimized" and "not too complex" are partly taste. Objective proxies carried by the AC: column count + geometry (AC-1), the density deltas (AC-2), real-gesture reachability + INP (AC-3). The subjective residual is covered by an explicit **operator visual-approval gate**: ui-evolve screenshots at both orientations are shown to the operator BEFORE merge (AC-4) — the operator, not the executor, owns "it looks right now".

## Non-goals

- No reskin: tokens, hues, fonts, atmosphere, motion, drawer, swimlanes, header/meterbar are out of scope except where an AC names them.
- Phone (<640) and desktop (≥1024) pixels do not move (AC-3 hold-outs).
- Landscape narrower than 768px (split-screen slivers): any non-dead-zone fallback is acceptable (today's strip or the 2×2); no redesign commitment here.
- No poll/caching/payload changes (PR #74 territory — fenced by AC-3, not reopened).
- No board-data or schema changes.

### Binary AC

Every AC is checkable from outside the diff (Playwright against the running app, exit codes, artifact files). Interaction ACs use the PR #74 harness style — real CDP touch (`e2e/fixtures/touch.ts`), bounding-box geometry, PerformanceObserver — **never computed-style-only for layout/interaction claims** (that was the incident). AC-2's typography/density assertions are computed-VALUE checks by nature, and are only valid alongside the geometry + gesture ACs, never instead of them. RED evidence is captured against `daa97750` with the same spec files before the fix lands (PR #74's red-evidence pattern).

**AC-1 — Landscape is a real 4-column kanban (N=4).** In a touch context, at **890×660** and **840×660** (red-proven strip cells) and across the sweep {768, 816, 890, 932, 1000} × {608, 660, 750} (floor lowered 616→608 per Round-1 note — real landscape height dips to ~610):
  - (a) exactly 4 `.ak-col` are simultaneously fully inside the viewport (bounding-box geometry), the board has no horizontal overflow (`scrollWidth ≤ clientWidth + 4`), **and the layout is four column-tracks in a SINGLE row** — mirror the `fold8-4x3-grid-tiers` probe: computed `gridTemplateColumns` resolves to 4 tracks AND `gridTemplateRows` to 1 track (or the geometry equivalent: 4 distinct col x-bands sharing one y-band, max col-top spread < one card height). This one-row arm is asserted at the red cells (890×660, 840×660, 768×650) AND every sweep cell — not only the already-green 1000×750. A 2×2 with 4 visible columns MUST FAIL this arm (D1 rejects 2×2 in landscape);
  - (b) real interaction: a CDP touch drag inside the deep column increases that column's `scrollTop` (delta > 0) and brings a below-fold card fully into the viewport (PR #74 `fold8-scroll-reachability` deep-board fixture).
  - RED on `daa97750`: 890×660 and 840×660 render 1 visible column with horizontal strip scroll (probe table above); additionally 890×750 renders a baseline 2×2 (reviewer-proven), which is RED under the one-row arm. 1000×750 is **already green on baseline** and serves as a stays-green fence inside the sweep, not as red evidence.

**AC-2 — Portrait (and the shared glance card) measurably decluttered.** At **750×1000** and **672×850** (real-device estimate):
  - (a) geometry: exactly 4 `.ak-col` fully visible arranged 2×2 (two distinct column x-bands × two row y-bands), each column's content independently scrollable via real touch drag;
  - (b) density deltas, each individually RED on `daa97750`: (1) zero visible role-pip elements inside board cards (baseline: rendered); (2) zero visible model-pill elements inside board cards, **with the e2e fixture extended so the arm can be RED**: `e2e/fixtures/board-fixture.ts` must attach `modelVersion` (+ effort) to ≥1 board card's current-actor comment so `.ak-model` actually renders on `daa97750` (≥1 visible = RED), then removal from the card → 0 (GREEN). Without the fixture change this arm is already-green (the baseline fixture sets no `modelVersion`, so `.ak-model` count is 0 — reviewer-measured) and pill removal would be an untested no-op; (3) card subject computed font-size ≥14px (baseline 13.5px); (4) card vertical padding ≥ the base card's (baseline portrait compacts to 9px top); (5) column-head name ≥12.5px (baseline 11.5px);
  - (c) no information lost: tapping a card opens the drawer and the drawer still presents the pipeline-role and model/effort information (real tap, text visible) — GREEN on baseline and must stay GREEN.
  - The landscape 4-up points inherit (b)(1)–(3) at 890×660 (same glance card).

**AC-3 — No regression of PR #74 or the hold-out contract points.**
  - (a) PR #74's specs stay green unmodified: `fold8-scroll-reachability`, `fold8-inp-under-poll`, `fold8-portrait-2x2`, plus `fold8-4x3-grid-tiers` updated only where this redesign deliberately changes the tier map (any edit to it is called out in the PR body);
  - (b) INP under the 5s poll stays under budget (<200ms, PR #74 methodology) at 890×660 (new 4-up cell) and 750×1000;
  - (c) hold-outs unchanged: 390×844 renders the phone strip (1 visible column, horizontal snap scroll, dots visible); 1440×900 renders the desktop 4-up with page scroll (no per-column overflow scrolling) and full header — same probe values as the ground-truth table;
  - (d) no dead zone anywhere in the tablet band: at every swept cell in AC-1/AC-2 plus 768×650, some real touch scroll path reaches a below-fold card.

**AC-4 — Two-leg UI gate + operator visual approval BEFORE merge.**
  - (a) a design-brief artifact for THIS redesign exists (this plan's D1–D4 exported/referenced per the UI-task gate) and a ui-evolve verdict file exists with `verdict: ACCEPT` and score ≥ 7.1 (the PR #74 baseline score), judged on real screenshots at **1000×750 and 750×1000**, with informational shots at 890×660 and 672×850;
  - (b) the screenshots are presented to the operator in-conversation and an explicit operator approval is received BEFORE the PR merges (Rule 19 eyeball + D4's subjective-residual gate). Screenshots are necessary-not-sufficient — AC-1/2/3 carry the interaction proof.

**AC-5 — Suite green.** `npm run typecheck` exit 0; `npm test` (jest) exit 0; the full Playwright e2e suite exit 0.

## Load-bearing assumptions (honest)

1. **Real-device canvas estimate** (landscape ≈890×~630, portrait ≈672×~850, DPR 2.75) is inferred, not device-measured. Mitigation: AC-1's sweep spans 768–1023 × 608–750 and AC-2 pins 672-wide portrait, so the design holds across the whole plausible envelope, not one guess. Residual: AC-4(b)'s operator approval is on real-device screenshots if the operator provides them, else emulated — final real-device confirmation rides the operator gate, mirroring PR #74's AC-7 pattern.
2. **1000×750 is already green on baseline** — any reviewer or executor treating it as the red-repro will falsely conclude "cannot reproduce". The red cells are 890×660 / 840×660 / 768×650 (probe-proven this session).
3. Portrait 2×2 must keep engaging at 672px container width — only 32px above the 640 phone floor. The phone floor stays at 640 (phone hold-out protection); if the executor finds the real portrait width below ~660 in practice, that is a plan-amendment conversation, not a silent gate move.
4. Removing pips/model-pill from fold-tier cards assumes the drawer already carries both (baseline behavior — AC-2(c) fences it).

## Deferred-follow-ups:

- **Real-device canvas measurement** (actual CSS px + DPR of the operator's Fold 8, both orientations) — DEFERRED; the AC sweep covers the plausible envelope. → file a task only if AC-4(b)'s operator screenshots contradict the inference.
- **Landscape <768px split-screen band** (a considered layout instead of the strip/2×2 fallback) — DEFERRED, no evidence any real usage hits it. → file-when-triggered (operator report or device screenshot in that band).
- **Desktop per-column scroll** (critique §4a suggested it; desktop is a hold-out here) — DEFERRED. → file a task if the operator asks for it on desktop; none filed now.

## Critical files (informative, not prescriptive)

- `app/globals.css` — tier gates (~L1644–1830), base strip/col (~L425–520), card anatomy (~L521–1170), `.ak-main` container declaration (~L171)
- `components/Card.tsx` (pips / model pill markup), `components/BoardColumn.tsx` (col head), `components/BoardView.tsx` (shell markup)
- `e2e/fold8-*.e2e.spec.ts` + `e2e/fixtures/touch.ts`, `e2e/fixtures/board-fixture.ts` — the AC harness to extend
- `docs/fold8-4x3-design-brief.md`, `docs/fold8-4x3-fable-critique.md` — prior design POV this plan refines

## Executor notes (mechanics allowed here, still the executor's call)

- The tier-gate mechanism is your choice (container-query width bands, viewport orientation media pairing, or both) — the AC matrix is the contract. Note: `.ak-main` is `container-type: inline-size` only, so container `orientation`/height features are NOT queryable on it; viewport `@media (orientation)` paired with container width bands is the established pattern in this file. Whatever you pick, PR #74's lesson stands: the shell overflow clamp must track exactly the cells where a grid tier is active, or you recreate the dead zone.
- Branch naming: leading token must be the task id — `agent-kanban-fold8-uiux-redesign` (e.g. `agent-kanban-fold8-uiux-redesign-impl`). Non-numeric task ⇒ the numeric-anchored ledger merge gate SKIPS; the orchestrator's manual ledger check applies.
- Red evidence first: run the new/extended specs against `daa97750` and file the numbers (PR #74's `red-evidence` pattern) before implementing.
- Baseline emulation needs `hasTouch` (AC gestures require it) and the deep-board fixture so columns overflow at every swept cell.
- **Fixture for AC-2(b)(2)**: extend `e2e/fixtures/board-fixture.ts` so ≥1 board card's current-actor comment carries `modelVersion` (+ effort) — `.ak-model` renders only when `cardModel(ticket)` is truthy (`components/Card.tsx:150`, `lib/ui-meta.ts:252`), and the baseline fixture never sets it, so without this the model-pill arm cannot go RED.
- **Orientation guard (monotonicity, #1590)**: in the 768–899.98px width band, the existing 2×2 rule (`app/globals.css` ~L1728) has NO orientation guard and also matches landscape cells with height ≥700 (e.g. 890×750). The new landscape 4-up must strictly WIN there — add an orientation guard (or guarantee cascade order) so 2×2 never survives at a landscape cell. AC-1(a)'s one-row assertion is the mechanical catch for this collision.

## Review

**Round-1 Decision: NEEDS-WORK** — reviewer: independent plan-review role (stateless, did NOT author this plan). Diagnosis is fully reproduced and correct; design direction is sound and DPR-robust; but two Binary-AC precision gaps were refuted by live execution and must be closed before the plan is execution-ready. Both fixes are small and specific.

### Live re-probe at daa97750 (Chromium touch context, hasTouch, real board-fixture, deep 21-card TODO) — the diagnosis MATCHES exactly

Measured `.ak-main` container width, `.ak-board` computed grid, fully-visible `.ak-col`, and horizontal overflow at each cell (my own probe, not cited from the plan):

| Cell | mainW | board | grid tracks | fully-visible cols | h-overflow | Plan claim | Verdict |
|---|---|---|---|---|---|---|---|
| 1000x750 | 1000 | grid | 4x1 | 4 | 0 | already 4-up (NOT red) | confirmed — did NOT fall for the trap |
| 904x700 | 904 | grid | 4x1 | 4 | 0 | 4-up | ok |
| **890x660** | 890 | flex | strip | **1** (col0=783px) | **2315** | RED strip | genuine red |
| **840x660** | 840 | flex | strip | **1** (739px) | 2187 | RED strip | genuine red |
| **768x650** | 768 | flex | strip | **1** (676px) | 2004 | RED strip | genuine red |
| 932x616 | 932 | grid | 4x1 | 4 | 0 | sweep 4-up | ok |
| 750x1000 | 750 | grid | 2x2 | 4 | 0 | portrait 2x2 | ok |
| 672x850 | 672 | grid | 2x2 | 4 | 0 | portrait real-device est | 2x2 already works |
| 390x844 | 390 | flex | strip | 1 | 1047 | phone hold-out | ok |
| 1440x900 | 1320 | grid | 4x1 | 4 | 0 | desktop hold-out | ok |

CSS gates verified directly (globals.css): 4-up = `@container (min-width:900px) and (max-width:1023.98px)` (L1767, width-only, no height gate); 2x2 = `@media (min-height:700px){ @container (min-width:640px) and (max-width:899.98px) }` (L1728-1729). The knife-edge is exactly as described: 890x660 misses both (890<900 kills 4-up; 660<700 kills 2x2) then falls to base `.ak-strip` phone strip. **Key measured fact: `.ak-main` has no horizontal padding — container width == viewport width at every cell below the 1320 cap (890->890, 672->672, 750->750).** This RESOLVES load-bearing assumption #3: at viewport 672 the container really is 672 (a true 32px above the 640 floor), not narrower. My adversarial cell 672x660 (portrait-width but short) correctly falls to strip, confirming the gap is genuinely 2-axis.

### DPR-envelope robustness (Rule 18) — ROBUST, not another knife-edge

Landscape CSS width = 2448/DPR in ~847 (DPR 2.89) ... ~900 (DPR 2.72); all >=768 with margin, and the new 4-up has NO height gate, so the whole plausible DPR band lands inside 768-1023 (tablet 4-up) or, at implausibly low DPR, >=1024 (desktop 4-up hold-out) — never the strip. Portrait width in ~639...679; the low end grazes the 640 floor, BUT the DPR bounds are DERIVED from the observation that portrait already rendered 2x2 (implies width >=640 by construction), and my probe confirms 672x850 already renders 2x2 on baseline. Portrait is a density-only change (D3) over an already-correct structure, so it cannot regress the tier. The fix is robust to DPR error, not tuned to one guess. This part of the plan is solid.

### BLOCKING required edits (both proven false/under-specified by execution)

**R1 — AC-2(b)(2) "zero visible model-pill elements (baseline: rendered)" is un-RED-able as written; the parenthetical is FALSE on the verification vehicle.** The model pill `.ak-model` renders only when `cardModel(ticket)` is truthy (Card.tsx:150), and `cardModel` (lib/ui-meta.ts:252) returns a model only when a comment carries `modelVersion`. The e2e `board-fixture.ts` `comments()` helper sets role/ts/agentId/artifact/verdict but **no `modelVersion`** — so `.ak-model` count is **0** on the baseline fixture at BOTH 750x1000 and 890x660 (I measured `modelRendered:0, modelVisible:false`). AC-2(b)(2) is therefore already-GREEN on baseline and cannot be captured as red evidence with the current fixture; removing the pill from the card would be an untested no-op against the suite. **Fix:** AC-2(b)(2) must require the e2e fixture to attach `modelVersion` (+ effort) to >=1 board card's current-actor comment so `.ak-model` renders on daa97750 (RED), then removal -> 0 (GREEN); add this fixture change to the executor notes. (The other four density arms ARE genuinely RED-able — verified live: pips visible/116 rendered; subject 13.5px < 14; portrait card padding-top 9px < base 11px; `.ak-col__name` 11.5px < 12.5 at globals.css:465. Those are fine.)

**R2 — AC-1(a) does not encode D1's committed one-row 4-up; a 2x2 landscape passes it.** AC-1(a) asserts only "4 `.ak-col` fully visible + no horizontal overflow." A 2x2 grid satisfies both. Proven live: at **890x750** (a cell INSIDE AC-1's own sweep, 768-1023 x 616-750), baseline already renders a 2x2 grid (colTracks=2, rowTracks=2), 4 cols fully visible, h-overflow 0 -> **AC-1(a) PASSES on a 2x2 layout** (same at 890x700, 850x720). So the AC is satisfiable by exactly the layout D1 explicitly REJECTS for landscape ("a 2x2 would waste horizontal abundance and halve column depth"), and execution-review would green-light it. The committed design property is unprotected by the mechanical contract. **Fix:** AC-1(a) must assert the landscape layout is 4 tracks in a SINGLE row at the landscape sweep cells — mirror the existing `fold8-4x3-grid-tiers` pattern (`gridTemplateColumns` -> 4 tracks AND `gridTemplateRows` -> 1 track), or the geometry equivalent (4 distinct x-bands sharing one y-band: max col-top spread < one card height). The existing spec asserts this ONLY at the already-green 1000x750 — it must be carried to the newly-fixed red cells (890x660, 840x660, 768x650, and the x616 rows).

### Non-blocking notes for the planner/executor

- AC-1 sweep height floor is 616; the DPR-plausible landscape height dips to ~610. Since 4-up is height-independent by design this does not change the tier, but consider lowering the sweep floor to ~608 so AC-3(d) dead-zone / AC-1(b) scroll are exercised at the true low end.
- Monotonicity (#1590): in the 768-899.98 width band, the NEW landscape-4-up rule and the EXISTING portrait-2x2 rule (L1728, currently NO orientation guard) will BOTH match at landscape cells with height>=700 (e.g. 890x750). The executor MUST add an orientation guard (or guarantee cascade order) so landscape-4-up strictly wins there; otherwise last-writer-wins could leave 2x2 active at a landscape cell. This is exactly why R2's one-row assertion is load-bearing — it catches such a collision. Call it out in the executor notes.
- Everything else checks out: PR #74 regression fenced (AC-3(a) specs green + AC-3(d) no dead zone + the shell-clamp-tracks-tiers executor note); hold-outs fenced and confirmed rendering correctly on baseline (390 strip, 1440 desktop 4-up); AC-4(b) operator visual approval is wired as a hard pre-merge gate (necessary-not-sufficient, interaction proof in AC-1/2/3); UI-task gate two legs planned (design POV from D1-D4 + ui-evolve verdict ACCEPT >=7.1); AC harness uses real CDP touch (`touch.ts` `Input.dispatchTouchEvent`), not computed-style-only, for all layout/interaction claims.

**Re-review scope (Round 2):** verify ONLY that R1 and R2 are closed in the AC text (and the fixture change + orientation-guard notes added). The diagnosis, DPR envelope, and the other three ACs are already validated by this round and need not be re-litigated.

### Planner fold response (Round 1 → Round 2)

- R1 folded: AC-2(b)(2) now requires the e2e fixture to attach `modelVersion` (+ effort) to ≥1 card so `.ak-model` renders RED on `daa97750`; removal → 0 GREEN (fixture requirement also added to Executor notes).
- R2 folded: AC-1(a) now asserts four column-tracks in a SINGLE row (`gridTemplateColumns` → 4 tracks ∧ `gridTemplateRows` → 1, or the 4-x-bands/1-y-band geometry equivalent) at 890×660/840×660/768×650 and every sweep cell; 890×750's baseline 2×2 added as one-row RED evidence.
- Non-blocking A folded: orientation-guard executor note added (768–899.98 band — landscape 4-up must beat the height≥700 2×2 rule at globals.css ~L1728; the one-row arm catches a collision).
- Non-blocking B folded: AC-1 sweep height floor lowered 616 → 608 (D1, AC-1, assumption #1 updated) to cover the ~610 real landscape low end.

### Round-2 Decision: PASS — plan is execution-ready

Reviewer: independent plan-review role (stateless, did NOT author this plan). Round-2 scope was narrow: verify ONLY that R1, R2, and the two non-blocking notes landed cleanly; the diagnosis, DPR envelope, design D1–D4, and the other ACs were validated in Round 1 and were not re-litigated. All four folds land clean; the two blockers are closed.

**R1 (AC-2(b)(2) model-pill arm) — CLOSED, genuinely RED-provable and correctly scoped.** Verified against the actual code, not the fold narrative:
- `.ak-model` renders iff `cardModel(ticket)` is truthy (`components/Card.tsx:150`); `cardModel` for an `in_progress` card returns `undefined` unless the **current-actor** (newest planner/executor) comment carries `modelVersion` (`lib/ui-meta.ts:253-264`). The e2e `comments()` helper (`e2e/fixtures/board-fixture.ts:15-23`) sets role/ts/agentId/artifact/verdict but **no `modelVersion`**, so baseline `.ak-model` count is 0 — R1's premise is exactly right, and the required fixture change (attach `modelVersion`+effort to ≥1 card's current-actor comment) makes the arm RED on `daa97750`, removal → 0 GREEN.
- The comment schema already permits `modelVersion?`/`effort?` as optional `LedgerComment` fields (`lib/board-schema.ts:52,54`), so the fixture change typechecks — AC-5 typecheck stays green.
- **Fixture-scoping confirmed clean for all four other density arms:** role-pips derive from `rolesSeen` = the *role set* of a card's comments (`components/Card.tsx:106,109`); adding an orthogonal `modelVersion` field cannot change the role set, so pip count is unperturbed. Subject font-size (3), padding (4), and col-head name (5) are pure CSS computed-value checks, structurally independent of fixture data. The matching fixture bullet is present in Executor notes.

**R2 (AC-1(a) one-row 4-up) — CLOSED, objectively excludes the 2×2 at the red cells.** Both encoded forms reject a 2-row layout: `gridTemplateColumns=4 ∧ gridTemplateRows=1` computes to 2×2 for a quadrant (fails); the geometry equivalent rejects a 2×2 twice over — it has only **2** distinct col x-bands (not 4) and a max col-top spread ≈ one row-height ≫ one card height. The arm is asserted at 890×660 / 840×660 / 768×650 AND every sweep cell (not only the green 1000×750), and carries a concrete RED member (890×750 baseline 2×2), so it is a genuine — not vacuous — assertion.

**Non-blocking A (orientation guard) — folded.** Executor note (§Executor notes, ~L127) requires an orientation guard / cascade-order guarantee so landscape 4-up strictly wins over the un-guarded 768–899.98 2×2 rule (`app/globals.css` ~L1728) at height≥700 cells, with AC-1(a)'s one-row arm as the mechanical catch.

**Non-blocking B (sweep floor) — folded.** AC-1 sweep floor is now `{608, 660, 750}` (D1 §L49 and AC-1 §L77 both updated to 608).

**Monotonicity checklist (#1590).** One mutual-exclusion arm in the intended diff: the new landscape-4-up rule vs the existing portrait-2×2 rule collide at 768–899.98 × height≥700 landscape cells. Stronger claim = landscape-4-up (D1 rejects 2×2 in landscape); weaker = the un-guarded 2×2. The plan prevents the weaker from silently erasing the stronger via (a) the Executor orientation-guard requirement and (b) AC-1(a)'s `gridTemplateRows=1` one-row arm as a mechanical catch — if the guard is missing and 2×2 survives at a landscape cell, the one-row arm fails there and execution-review catches it. Correctly fenced.

**Non-blocking heads-up for the executor (already fenced, no action required):** `board-fixture.ts` is shared; baseline currently renders zero `.ak-model` pills across the whole suite, so if any *other* existing spec were to assert model-pill count or card-footer contents, adding `modelVersion` could turn it red — but AC-3(a) (PR #74 specs stay green) + AC-5 (full suite exit 0) already fence this, so the red-evidence-first run will surface it if it occurs. Not a blocker.

Convergence: R1/R2 clean, notes folded — per the round-scope contract this round converges. No new adversarial counterexample was opened. The executor may start.

<!-- plan-review verdict: NEEDS-WORK (FAIL) — Round 1 — reviewer: cc-plan-review (fallback Agent-tool spawn, [route-dispatch-fallback-ok]) — 2026-08-25 -->
<!-- plan-review verdict: PASS — Round 2 (narrow: R1/R2 + non-blocking A/B fold verification) — reviewer: cc-plan-review (fallback Agent-tool spawn, [route-dispatch-fallback-ok]) — 2026-08-26 -->
plan-review: PASS (Round 2)
