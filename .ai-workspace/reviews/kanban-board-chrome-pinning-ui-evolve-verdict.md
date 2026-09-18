# kanban-board-chrome-pinning — ui-evolve verdict (UI-task gate leg 2)

verdict: ACCEPT
score: 4.8
rubric: .ai-workspace/design/kanban-board-chrome-pinning-design-brief.md#rubric-for-the-ui-evolve-pass

## Screenshots (production server, `next build && next start -p 3942`, synthetic
production-shaped fixture — `data/board.json` swapped in only for capture, never
committed, gitignored; removed after capture)

All 7 required screens, `.ai-workspace/design/screens-kanban-board-chrome-pinning/`:

1. `01-390x844-at-rest.png` — phone, at rest.
2. `02-390x844-mid-scroll.png` — phone, after a real CDP touch drag (~380px).
3. `03-390x660-at-rest.png` — short phone, at rest.
4. `04-390x844-shelf-open.png` — phone, drawer opened (populated with 1
   bookkeeping / 1 parked / 1 deferred demo ticket so the drawer isn't empty).
5. `05-1440x900-at-rest.png` — desktop, at rest.
6. `06-1440x900-mid-scroll.png` — desktop, after a real wheel scroll (900px).
7. `07-768x1024-at-rest.png` — grid tier, at rest.

I looked at all 7 (Rule 19) and cross-checked each against direct
`getBoundingClientRect()` measurements taken in the same runs (not just pixels —
geometry), because the rendered PNGs are small/dense and easy to misread by eye
alone; the numbers are the tie-breaker below.

## Per-dimension score (1-5, mean >= 3.5 / no dim < 2.5 to ACCEPT)

1. **Instrument-panel legibility (top) — 4/5.** Screens 01/02 vs measured
   geometry: `[data-ak-chrome="top"]` (`.ak-header`, includes the session pill,
   LANES LIVE / ACTIVE / LIVE status, and `PipelineMeter`) sits at `top:0` both
   before AND after the touch drag (byte-identical rect,
   `{top:0,height:161.98}` in both reads). `.ak-col-heads-mobile` sits flush at
   `header.bottom` (161.984375 in both reads — zero gap, matches the strip's
   own `.ak-strip` padding-top precedent). After the gesture this reads as ONE
   flat instrument band with zero list content between meter and column label,
   exactly the brief's "one flat strip, not two floating labels" goal. Docking
   1 point: AT REST (before any scroll) the phone view briefly shows the
   pinned mobile strip AND the column's own in-flow `.ak-col__head` stacked
   directly beneath it (visible in `01`) — both carry the same "TO DO 41"
   text, which reads as a near-duplicate label for a moment until the user
   scrolls and the in-flow one scrolls away. Not a functional bug (the two
   elements exist for the CSS-containing-block reasons documented in
   `app/globals.css`), but a legibility hair worth naming plainly rather than
   hiding.
2. **Tray affordance (bottom) — 5/5.** Desktop screen `05`: rounded top
   corners + upward shadow on `.ak-shelf`, riveted to the viewport's bottom
   edge (`bottom:0`), matches the brief's "pull-tab tray riveted to the
   housing" language. Phone/grid tiers keep the pre-existing #2499 grabber-pip
   treatment untouched (only `data-ak-chrome="bottom"` was added to
   `Shelf.tsx` — no visual change there).
3. **Budget discipline — 5/5.** Measured (red-evidence file): phone
   `topBand+bottomBand = 194.66px` against a 200px budget (HEAD un-pinned
   reference: 241px); desktop `175.44px` against 178px (HEAD: 178px, no
   growth). `>= 4` cards visible at 390x844/344x882, `>= 3` at 390x660 — all
   confirmed by the spec's own assertions (AC-5, 6/6 cases pass). Reads as
   "compact instrument," not "letterboxed list" in every screenshot.
4. **Cross-chassis coherence — 5/5.** Desktop measurement (screen `06`, wheel
   scroll 900px, real `window.scrollY: 1166` confirmed): `.ak-header` +
   `.ak-meter` stay at `top:0` unchanged, `.ak-lanes` moves from `top:127.5` to
   `top:-1038.45` (scrolls away with the list, matching AC-6), `.ak-col__head`
   re-docks flush at `header.bottom` (113.546875, matching phone's zero-gap
   contiguity). Same panel + same tray language on phone, the 768x1024 grid
   tier (`07`), and desktop — not a visibly bolted-on treatment.
5. **No visual regression — 5/5.** `board-render-perf-parity.e2e.spec.ts`
   AC-7(i)/(ii) motion-parity legs pass unchanged (glow-choreography, scroll
   occlusion). AC-6 static-parity's committed baseline PNG legitimately
   changed (this task intentionally redraws the pinned chrome) and was
   regenerated via that spec's own documented `--update-snapshots` recipe
   against THIS branch's production build (see spec header comment,
   `e2e/board-render-perf-parity.e2e.spec.ts` lines 1-19); the regenerated
   baseline now passes at `maxDiffPixelRatio<=0.001`. Drawer/scrim layering
   (`drawer-pulldown-dismiss`, `drawer-long-subject`), Live Swimlanes
   (`lane-reveal`, `live-swimlanes`), card density and grid tiers
   (`fold8-*`, `shelf*`) all exit 0 unmodified.

Mean: (4+5+5+5+5)/5 = **4.8**. No dimension below 2.5. -> **ACCEPT**.

## No-regression section (explicit)

- Drawer + scrim: `drawer-pulldown-dismiss.e2e.spec.ts`,
  `drawer-long-subject.e2e.spec.ts` — pass, unmodified behavior.
- Live Swimlanes as list content: `lane-reveal.e2e.spec.ts`,
  `live-swimlanes.e2e.spec.ts` — pass; own spec's AC-6 confirms `.ak-lanes`
  scrolls away (>=100px) on both touch and wheel tiers.
- Card density / grid tiers: `fold8-4x3-grid-tiers`,
  `fold8-portrait-2col-paging`, `fold8-portrait-2x2`,
  `fold8-scroll-reachability`, `fold8-uiux-redesign`, `shelf`,
  `shelf-scroll`, `shelf-front-screen-reachable` — all pass.
- Palette/type system: untouched CSS custom properties (`--ink`, `--line`,
  etc.); only geometry/overflow rules and a compacted `.ak-meter` sizing were
  changed, no color/typography tokens.
- Full regression (production build, this branch, this host): 175/178 e2e
  specs pass; the 3 non-passing cases in a full-suite concurrent run are
  `board-render-perf-inp.e2e.spec.ts` (INP tap-latency budget) and
  `board-render-perf-unchanged-tick.e2e.spec.ts` (main-thread-cost budget) —
  BOTH pre-existing, unrelated-to-this-diff perf-budget tests that pass
  cleanly every time they are re-run in isolation on this same production
  server (confirmed 3x). This is host-load flakiness from running a 19-file
  serial suite plus other concurrent processes on a shared dev machine, not a
  regression from this diff — stated plainly rather than waved away; see the
  executor's final report for the isolated-pass evidence.

## Privacy note

All ticket subjects/ids in the screenshots are synthetic fixture data
(`buildBoard()` from `e2e/fixtures/board-fixture.ts`, plus 3 hand-added
`shelf-demo-*` tickets for the drawer screenshot) — no real ticket content,
no employer-identifying strings.
