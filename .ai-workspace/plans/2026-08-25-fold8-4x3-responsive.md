# Fold 8 (4:3 unfolded) responsive board — Plan-First plan

- **Task**: `agent-kanban-fold8-4x3` (3-role model; this file is the planner artifact)
- **Date**: 2026-08-25 | **Repo**: agent-kanban @ origin/master `b4e6d476071d51f1cd1e44e1e7486a07a5d7b2fb`
- **Spec (already decided — do NOT redesign)**: `docs/fold8-4x3-design-brief.md` (design brief) + `docs/fold8-4x3-fable-critique.md` (diagnosis). **Both files are untracked in the primary working tree and absent on origin/master** — see Executor notes: they must be copied into the executor's worktree and committed with this work.
- cairn: `[T2] ai-brain/hive-mind-persist/session-notes/2026-06-14-1470062246.md:9 — "A dashboard CSS grid using \`repeat(6, 1fr)\` with no responsive breakpoi[nts]…"` (queries: "container query", "responsive", "foldable"; "foldable" also matched this lane's own session-state card `session-state-20260825-2174-…:14 "LANE 2 … agent-kanban … Samsu[ng]"`). Project index (`.ai-workspace/PROJECT-INDEX.md`, 2026-08-20) read: no prior responsive-layout plan exists; `components/` holds only 4 files (BoardView/Card/Drawer/LiveSwimlanes + PipelineMeter).

## Execution model

**Subagent (delegate)** — a single executor role subagent in an isolated worktree branched from `origin/master` (Rule 12), per the 3-role chain this task is already running (planner → plan-review → executor → execution-review). Rationale: the change spans 3+ files (`app/globals.css`, `components/PipelineMeter.tsx`, shell wiring in `app/page.tsx`/`components/BoardView.tsx`, plus two committed docs) and carries layout-architecture decisions (container-query tiers, shell scroll model), so it is well above the trivial-skip threshold and squarely delegate-shaped: one coherent write surface, a self-contained brief (this plan + the two design docs), and binary AC checkable by the executor's own gate run. Not phased — it ships as one PR; not inline — nothing here is coupled to live session state.

## ELI5

The board is a live dashboard with four columns (TO DO / IN PROGRESS / REVIEW / DONE). On a Samsung Galaxy Z Fold 8 opened flat, the screen is almost square — about 1000×750 points sideways, 750×1000 upright. That is a small tablet. But the app's stylesheet only knows two worlds: "phone" (one giant swipeable column at a time) and "desktop, 1024px or wider" (all four columns). The unfolded Fold lands in the gap between them, so a tablet-sized screen gets the phone treatment: one huge mostly-empty column, the other three swiped off-screen, and a tall two-story header eating the short axis.

The fix (per the already-approved design brief): teach the board to ask "how wide is MY box?" (a CSS container query) instead of "how wide is the whole window?", and add the missing middle: at ~1000 wide show all 4 columns side by side; at ~750 wide show them as a 2×2 quadrant; each column scrolls by itself inside a screen-height shell so nothing gets buried; the fat 4-tile header shrinks to one thin ≤48px row with a slim proportional color bar; cards get a slightly tighter 2-line variant. Phones and desktops keep exactly what they have today.

## Intent (what + why — never how)

**What**: the board renders all four columns simultaneously on any near-square/tablet canvas (container width ≥ 640px), with independent per-column scrolling, a collapsed one-row header, and denser cards — while the sub-640 phone strip and the ≥1024 desktop layout remain unchanged.

**Why**: a kanban board's whole value is cross-column flow at a glance; the current 641–1023px "missing middle" gives tablets the one-column phone strip (~2.5 tickets visible out of ~1200), violating the app's own telemetry-console identity. The Fold 8 unfolded (both orientations) lives squarely in that gap.

## Design summary (from the brief — the brief is authoritative on any conflict)

- **Container-query tiers**, keyed on the board wrapper's inline size (`container-type: inline-size`), NOT viewport width (foldables live in split-screen where viewport width lies):
  - `< 640cqw` → phone strip, **byte-for-byte unchanged** (88vw snap columns, `.ak-dots` pager).
  - `640–899cqw` (+ a `min-height: 700px` guard) → **2×2 quadrant** (TODO·PROG / REVIEW·DONE), ~360px columns.
  - `≥ 900cqw` → **4-up grid** (`repeat(4, 1fr)`), ~230px columns; the existing `≥1024px` desktop refinements (wide gutters, side drawer) remain as the super-tier — desktop pixels do not move.
  - Portrait↔landscape is free by construction: rotating slides container width across 900 and the grid re-tiles. No orientation query, no JS.
- **`100dvh` shell + per-column scroll** (the 2×2 enabler): shell = height-constrained grid (header `auto` / board `1fr`, `min-height: 0`), each `.ak-col` `overflow-y: auto`, column heads sticky inside their own scroll containers. Applies in grid tiers; phone page-scroll behavior is untouched.
- **Collapsed header** in both grid tiers: one ≤48px row (session picker · segmented meter · LANE pill · LIVE pill). The 4 fat `PipelineMeter` stat tiles are replaced by a **~6px proportional segmented bar** (one bar split into TODO/PROG/REVIEW/DONE widths, hue-tinted). Full tiles stay **phone-only**, where column heads are off-screen and the meter is the sole overview.
- **Compact card variant** in grid tiers: ~20% less vertical padding, subject clamped to 2 lines, single-line footer — type sizes untouched (already at the floor). `Card.tsx` needs zero logic changes.
- **Tokens**: reuse existing `:root` tokens only (`--ink --panel --line --fg --fg-meta --live --todo --prog --review --done --font-mono`); the segmented bar uses the four column hues at ~70% mix on `--panel`. No new colors, no new fonts.
- **JS**: `onStripScroll`/`scrollToCol` are inert in grid modes (no horizontal overflow); `.ak-dots` hidden in every grid tier; the `#1456` swimlane-reveal clearance (`scroll-margin-top`, globals.css ~L709/L878, assumes the tall header) is re-derived for the compact-header tiers.
- **Drawer**: side-panel drawer promoted down to the ≥900cqw tier (a bottom sheet on a landscape tablet covers the board it annotates); phone keeps the bottom sheet.

### Observable DOM contract (pinned so the AC probes are outside-the-diff checkable)

1. The grid/strip element that is the **direct parent of the four `.ak-col` sections** carries class **`ak-board`** in the rendered DOM at every tier (it may keep `ak-strip` alongside). All AC probes target `.ak-board`.
2. The proportional segmented meter element carries class **`ak-meterbar`** with exactly **4 children `.ak-meterbar__seg`** (internal markup otherwise free).
3. The full stat tiles keep their existing classes (`.ak-meter`, `.ak-meter__seg`).

## Files / critical paths (the brief's implementation map)

| File | Change |
|---|---|
| `app/globals.css` | new `@container` tiers (2×2 + 4-up promotion), `100dvh` shell grid, per-column scroll + sticky in-column heads, compact `.ak-card` variant, segmented-meter styles, `.ak-dots` hidden in grid tiers, re-derived `#1456` scroll clearance (~L393-414 `.ak-strip`/`.ak-col`, ~L853 640px block, ~L1568 1024px block, ~L7-61 tokens, ~L158-292 shell/header/meter) |
| `components/PipelineMeter.tsx` | render the segmented-bar variant below the desktop tier (or a CSS-swapped twin); full tiles phone-only |
| `app/page.tsx` / shell (`components/BoardView.tsx` render tree) | board wrapped in a `container-type: inline-size` element; shell rows `auto 1fr`; `ak-board` class per DOM contract |
| `components/Card.tsx` | none (pure CSS variant) |
| `components/BoardView.tsx` | none required beyond the wrapper/class; verify strip handlers inert in grid |
| `docs/fold8-4x3-design-brief.md`, `docs/fold8-4x3-fable-critique.md` | **committed verbatim** (copied from the primary tree — see Executor notes) |

## Load-bearing assumptions (Rule 18 — smoke before trusting)

- **(a) Container queries are Baseline-supported on the Fold 8 browser.** `container-type`/`@container` are Baseline (Chromium 105+, 2023); the Fold 8 ships Chrome/Samsung Internet well past that. Still an assumption until exercised: the smoke MUST render the **built** board in a real browser engine and observe the tier actually switching (AC-0). If the engine reports no support, the whole design keys on a dead feature — stop and re-plan, don't polyfill silently.
- **(b) THE TRAP — a height condition needs a height-capable subject.** The 2×2 tier carries a `min-height: 700px` guard. A naive `container-type: inline-size` wrapper only containerizes the INLINE axis, so a `@container (min-height: …)` condition against it **NEVER matches** — the 2×2 tier silently never activates and portrait-unfolded stays a phone strip (the exact bug this task fixes, reintroduced invisibly). Either the guard is expressed against a subject that has a definite height — `container-type: size` works only because the `100dvh` shell's `1fr` row gives the wrapper a definite height — or the height guard is a viewport `@media (min-height: 700px)` and-ed with the width container query (the critique's sanctioned supplementary use). AC-2 is the outside-the-diff detector: if the guard is mis-keyed, 750×1000 never shows 2 tracks and AC-2 FAILS.
- **(c) The shell clamp and the tier key are two different query subjects that must flip together.** The `100dvh` shell clamp styles the shell/container element itself, which a `@container` rule cannot target (an element can't query its own container), so its activation is necessarily keyed on something else (e.g. viewport width). That coincides with the container tiers ONLY because the board wrapper spans the full shell width today (no sidebar steals width). If they ever disagree (odd split-screen pane), a grid tier could render without its height-constrained shell or vice-versa. AC-2/AC-6 probe at real viewports and catch a mismatch at the contract points.

**Gate**: this plan's value is gated on a ui-evolve smoke rendering the BUILT board at 1000×750 and 750×1000 (AC-0/AC-8) — designed behavior on a wrong premise is a correctly-implemented broken thing.

## Binary AC

All ACs are checked from OUTSIDE the diff: a computed style, a rendered-DOM fact, or a screenshot at a named viewport — never "the code says X". Vehicle: the built app (`npm run build && npm start`, or the dev server) driven by a real browser engine (Playwright/CDP per the webapp-testing toolkit) at the named viewport sizes, with board data giving the TODO column ≥ 20 cards (the checked-in `data/board.json` snapshot qualifies; any fixture is fine if its counts are stated). Each probe is a script whose exit code is the check. Tolerances: lengths ±2px unless stated.

- **AC-0 (Rule 18 assumption smoke — run FIRST).** In the smoke browser against the built board: `CSS.supports('container-type: inline-size')` returns `true`, AND the same session shows `.ak-board` with 4 column tracks at viewport 1000×750 and 2 column tracks at 750×1000 (the tier demonstrably switches). FAIL ⇒ stop, re-plan (assumption (a)/(b) broken).
- **AC-1 (landscape 4-up).** Viewport **1000×750**: `getComputedStyle(.ak-board).gridTemplateColumns` resolves to exactly **4** track widths in ONE row (`grid-template-rows` resolves to a single track); all four `.ak-col` bounding boxes are simultaneously fully inside the viewport horizontally; NO horizontal board overflow: `.ak-board.scrollWidth <= .ak-board.clientWidth` and `document.documentElement.scrollWidth <= window.innerWidth`.
- **AC-2 (portrait 2×2 + independent column scroll).** Viewport **750×1000**: `.ak-board` computes to a **2×2 grid** (`grid-template-columns` = 2 tracks AND `grid-template-rows` = 2 tracks); the TODO `.ak-col` has computed `overflow-y` ∈ {`auto`,`scroll`} with `scrollHeight > clientHeight`, and programmatically scrolling it changes ONLY its own `scrollTop` (siblings' `scrollTop` and `window.scrollY` unchanged); the page does not scroll: `document.documentElement.scrollHeight <= window.innerHeight + 1`.
- **AC-3 (collapsed header, both grid tiers).** At BOTH 1000×750 and 750×1000: `.ak-header` bounding-box height **≤ 48px**; **zero** visible `.ak-meter__seg` stat tiles (absent from DOM, or every instance has a zero-size bounding box); the segmented bar IS present: exactly one visible `.ak-meterbar` with 4 `.ak-meterbar__seg` children whose rendered widths are ordered consistently with the column counts (a column with a strictly larger count never has a strictly narrower segment).
- **AC-4 (phone NON-REGRESSION).** Viewport **390×844**: `.ak-board` computed `display` is `flex` (not grid) with `overflow-x` scrollable and `scroll-snap-type` containing `x mandatory` (snap-strip preserved); `.ak-dots` pager present and visible (bounding-box height > 0, 4 dot children); first `.ak-col` rendered width ≈ 88vw = **343.2px ±2px**; page-level vertical scroll still works (`document.documentElement.scrollHeight > window.innerHeight` with the seeded data); clicking a card yields the bottom-sheet drawer (`.ak-drawer` bounding box anchored to the bottom edge, spanning ~full viewport width).
- **AC-5 (desktop NON-REGRESSION).** Viewport **1440×900**: `.ak-board` computes to 4 column tracks; `.ak-dots` hidden; clicking a card yields the side-panel drawer: `.ak-drawer` bounding box with right edge at the viewport's right edge, width **440px ±2px**, top ≈ 0 and bottom ≈ viewport bottom; the ui-evolve leg (AC-8) confirms no visual regression on its 1440×900 screenshot.
- **AC-6 (100dvh shell, grid tiers don't page-scroll).** At BOTH 1000×750 and 750×1000: the shell element (`.ak-app`) computes `display: grid` with `grid-template-rows` resolving to exactly two tracks — first ≈ the rendered `.ak-header` height, second = the remainder — and the shell's rendered height = `window.innerHeight` ±2px; `document.documentElement.scrollHeight <= window.innerHeight + 1` (page-scroll happens only INSIDE columns).
- **AC-7 (grid-tier drawer + swimlane clearance).** Viewport 1000×750 with a ticket open: `.ak-drawer` is the SIDE panel (same geometry checks as AC-5), not a bottom sheet. At both grid tiers: computed `scroll-margin-top` of `.ak-lanes` ≥ the rendered `.ak-header` height (the re-derived #1456 clearance holds for the compact header).
- **AC-8 (UI-task gate artifacts — files present with verdict).** `docs/fold8-4x3-design-brief.md` exists ON THE BRANCH (design_brief leg), and a ui-evolve verdict file exists under `.ai-workspace/reviews/` containing a `verdict: ACCEPT` line + a rubric score, produced from REAL screenshots of the built board at all four named viewports (1000×750, 750×1000, 390×844, 1440×900), with no regression on the two contract-preservation points (390×844, 1440×900).
- **AC-9 (repo checks stay green).** The repo's standard checks pass on the branch: `npm test` (jest) and `npm run build` exit 0 — the change is ~CSS-only and must not break any existing lane/board test.

**AC count: 10** (AC-0 … AC-9).

## Alternatives considered + rejected (from the critique — recorded, not reopened)

- **Width media queries as the tier key**: rejected — foldables live in split-screen/Flex-mode where viewport width lies about the board's actual space; container queries answer "how wide is MY box" and cost the same to write.
- **`min-aspect-ratio` as the primary key**: rejected — aspect ratio doesn't encode size (a 4:3 canvas can be 500px or 1400px wide); column count is a width-per-column question. Shape falls out implicitly (portrait width → 2×2 tier, landscape → 4-up). Height enters only as the `min-height: 700px` guard on the 2×2 tier.
- **`spanning` / viewport-segments foldable APIs**: rejected as load-bearing — the unfolded inner display presents as one continuous segment; those are hinge-occlusion tools with weak support, and a column-gutter layout has nothing that must dodge the crease. Progressive-enhancement note at most.

## Deferred-follow-ups:

- **Hinge/viewport-segments progressive enhancement** (crease-dodging via foldable APIs) — DEFERRED, not load-bearing (column gutters already avoid content-on-crease). → none; file a ticket only if a real-device crease-occlusion report arrives.
- **Physical-device (real Fold 8) smoke** — the AC suite proves the layout in desktop-class Chromium at Fold-CSS viewports; an on-device pass is a proxy gap. → file-when-triggered: file a ticket if any on-device report contradicts the Chromium result.
- **Column virtualization for 500+ card columns** (render cost, not layout) — OUT of scope for this CSS-only task. → file a ticket if per-column scroll shows jank in the ui-evolve capture.

## Executor notes (mechanics the worktree MUST get right)

1. **Copy the two design docs before anything else.** `docs/fold8-4x3-design-brief.md` and `docs/fold8-4x3-fable-critique.md` exist ONLY in the primary working tree's `docs/` dir (untracked locally, absent on origin/master). A fresh worktree branched from origin/master will NOT contain them. Copy both verbatim into the worktree and commit them with this work (AC-8 depends on the brief being on the branch).
2. **Branch naming (#2462)**: the worktree branch MUST start with the task id as the leading token: `agent-kanban-fold8-4x3-<slug>`. Note the task id is non-numeric, so the numeric-anchored ledger merge gate SKIPS for this branch — before merge, run `node <ai-brain-repo>/hooks/3role-ledger.mjs check --task agent-kanban-fold8-4x3` manually; it is the only enforcement.
3. **Phone/desktop are contract points, not suggestions**: no new rule may reach below 640 container width; the ≥1024 media block's declarations stay (it is a superset of the ≥900 tier).
4. **Do not invent tokens/colors/fonts** — reuse `:root` tokens only (brief §6).
5. The AC probes above are the executor's `/delegate gate` content; run them against the branch build before push.

*(Plan-review: append your `## Review` section below — the planner has deliberately not written one.)*

## Review

**Decision: PASS** — 0 blockers. Reviewer: plan-review seat (Agent-tool fallback path, `model:opus`), task `agent-kanban-fold8-4x3`. Adversarial, cold (did not author). Every load-bearing claim was checked against the code with my own oracle; all passed.

### Oracle verification (what I re-ran, not trusted from prose)
- **Tracking state — CONFIRMED.** `git ls-files --error-unmatch` + `git cat-file -e origin/master:<path>`: `docs/fold8-4x3-design-brief.md` and `docs/fold8-4x3-fable-critique.md` are UNTRACKED in the primary tree AND absent on `origin/master`; `app/globals.css` + the four `.tsx` are tracked and on `origin/master`. The plan's assertion and Executor-note 1 (copy+commit both docs; AC-8 gates the brief being on-branch) are correct and load-bearing — a fresh `origin/master` worktree will not contain them.
- **CSS line citations — CONFIRMED.** `.ak-strip` L393, `.ak-col` L407 (`flex:0 0 88vw`), `.ak-dots` L468, `@media (max-width:640px)` L853 (only wraps the header row + stacks swimlanes — NOT a layout regime, matching the critique), `@media (min-width:1024px)` L1568 (`.ak-strip`→`grid-template-columns:repeat(4,1fr)`, dots hidden, drawer→side panel), `--header-h:104px` L57, `#1456` `scroll-margin-top:104px` L709 / `148px` L878. All match.
- **DOM-contract class provenance — CONFIRMED.** `.ak-app` is the shell (`BoardView.tsx:287`); `.ak-strip` is today's direct col-parent (`BoardView.tsx:328`); `.ak-meter`/`.ak-meter__seg` are the full tiles (`PipelineMeter.tsx`, CSS L260/L267). `.ak-board` and `.ak-meterbar` do **not** exist anywhere yet (grep empty) — so the AC probes' dependence on the executor adding those classes is an honest, disclosed contract, not a false premise.
- **Drawer geometry — CONFIRMED `position:fixed` overlay** (`.ak-drawer` L1146-1151, side-panel variant L1585-1595). This is decisive for assumption (c): the drawer never steals in-flow width, so the board is full-bleed and container inline-size ≈ viewport width in every shipping configuration.
- **cairn — CONFIRMED accurate.** The plan's cited T2 hit (`2026-06-14-1470062246.md:9` — "dashboard CSS grid using repeat(6,1fr) with no responsive breakpoints") reproduces; no prior foldable/container-query design lesson exists beyond it and this lane's own session-state card. The `cairn:` line is honest.

### Scrutiny findings
1. **ACs binary + outside-the-diff — YES.** AC-0…AC-9 are all computed-style / rendered-DOM-geometry / screenshot-at-named-viewport / file-presence checks. None secretly reads the implementation. The pinned "Observable DOM contract" (`.ak-board`, `.ak-meterbar` + 4 `.ak-meterbar__seg`) is exactly what keeps the probes implementation-agnostic — strong AC hygiene.
2. **The `inline-size` vs `size` TRAP (assumption b) — called out AND has a real detector.** AC-2 at **750×1000** is the catch: if the `min-height:700px` guard is keyed against an `inline-size`-only container it never matches, the 2×2 tier silently never activates, and 750×1000 renders a phone strip → AC-2 (expects 2 col-tracks × 2 row-tracks, independent col scroll) FAILS. Confirmed sound.
3. **Assumption (c) coupling — real fragility, HONESTLY disclosed, safe in the shipping config, but the plan's AC claim is OVERSTATED (see Note A).**
4. **Non-regression (AC-4 phone / AC-5 desktop) — adequate for the dominant leak mode.** A `max-width`-bounded tier that reaches below 640 manifests at 390 (AC-4 sees `grid` not `flex` → FAIL); a `min-width` tier that reaches up manifests at 1440 (AC-5). AC-4(page scrolls) + AC-6(grid-tier shell clamped to innerHeight) also jointly force the executor to gate the `100dvh` shell on a viewport condition — apply it globally and AC-4 fails, omit it and AC-6 fails.
5. **AC-0 is a real fail-closed Rule-18 gate** (executable, binary, "FAIL ⇒ stop, re-plan"), with the honestly-disclosed proxy limitation in Note D.

### Non-blocking notes for the executor (carry to execution-review)
- **Note A (assumption-c overclaim — soften the wording; verify the precondition).** The plan says "AC-2/AC-6 probe at real viewports and catch a mismatch." That is true ONLY in the full-bleed config, which is the only config the harness exercises (at 1000×750 and 750×1000 the viewport-keyed shell clamp and the container-keyed tiers are *guaranteed to agree* because container width ≈ viewport width). They do NOT catch a divergence where an in-app width-stealer makes container < viewport (tier drops while the shell stays clamped, or vice-versa → the buried-row bug returns). This is **safe today only because the drawer is `position:fixed` overlay and the board is full-bleed** — that is the load-bearing precondition. Execution-review: confirm no in-flow sidebar / width-stealing drawer was introduced, and that the shell clamp's viewport gate and the tier's container threshold share the same numeric boundary. Registered as a durable named-risk note.
- **Note B (`container-type:size` collapse).** If the min-height guard is implemented via `container-type:size` (assumption b's first option), the board wrapper MUST receive a definite height from the shell `1fr` row, or size-containment collapses the board to 0 height. The plan warns about "min-height never matches" but not about the 0-height collapse. The AC set still catches it (AC-1 cols-in-viewport, AC-2 col `scrollHeight>clientHeight`, AC-8 real screenshots) — carry as a watch item, not a gap.
- **Note C (`.ak-app` padding + max-width).** `.ak-app` carries `max-width:1320px; margin:0 auto; padding-bottom:40px` (L158-161) under `box-sizing:border-box`. When converting to the `height:100dvh` grid, neutralize `padding-bottom` in the grid tiers so the `1fr` board row is not silently shortened by 40px; the shell height still equals innerHeight (border-box) so AC-6 passes either way, but the visible board loses 40px if left in.
- **Note D (AC-0 proxy honesty).** `CSS.supports('container-type:inline-size')` returns `true` unconditionally in desktop Chromium, so that clause is a tautology in the smoke environment and structurally cannot detect Fold-browser non-support (assumption a is about the Fold browser, which AC-0 does not run on). AC-0's real teeth are the tier-switch half. The plan already accounts for this as a tracked, file-when-triggered physical-device item (its own accounting section) — acceptable given container queries are Baseline-2023 and Samsung Internet/Chrome-Android are well past Chromium 105.
- **Note E (untested tier boundaries).** No AC probes exactly 639/640 or 899/900 container width, so a one-pixel off-by-one at a tier edge (`min-width:640` vs `641`, or a `≥900` / `≥640` overlap resolved only by source order) is not caught by any AC or by ui-evolve. Cosmetic; ensure the 2×2 tier is `(min-width:640px) and (max-width:899px)`-bounded and the 4-up starts at 900 with source order letting desktop ≥1024 win.

### Monotonicity check (#1590)
The only last-writer-wins surface is the CSS cascade: base phone strip → `@container` grid tiers (≥640 2×2, ≥900 4-up) → `@media (min-width:1024px)` desktop super-tier. The plan claims the ≥1024 block is a *superset* of the ≥900 tier (both `repeat(4,1fr)`) so neither erases the other's column count; the stronger "desktop pixels don't move" claim is guarded by AC-5 + AC-8. No arm erases a stronger arm — the weaker ≥900 tier cannot override desktop refinements provided the ≥1024 media block stays after the `@container` block in source order (execution-review confirms order). No monotonicity violation in the plan.

*No employer-brand token observed in the plan or the two design docs (device name "Samsung Galaxy Z Fold 8" is a product, not the regulated token); this is an observation, not a formal clean-scan claim.*
