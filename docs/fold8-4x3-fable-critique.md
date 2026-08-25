# Fold 8 (4:3 unfolded) — design critique + direction for `/frontend-design`

**Target device**: Samsung Galaxy Z Fold 8, unfolded inner display, 4:3 aspect (1848×2448 physical, ~1000×750 CSS landscape / ~750×1000 CSS portrait). A near-square **tablet** canvas that today's CSS classifies as a **phone**.

**Grounding**: screenshot `~/.claude/uploads/.../e5749e29-image.jpg`; code read from `app/globals.css` (`.ak-strip` L393, `.ak-col` L407, `@media (max-width: 640px)` L853, `@media (min-width: 1024px)` L1568), `components/BoardView.tsx`, `components/Card.tsx`, `components/PipelineMeter.tsx`, `components/LiveSwimlanes.tsx`, `app/page.tsx`. No code was changed.

---

## 1. What the screenshot actually shows (and why it's wrong)

The board is at 1192 tickets, 4 columns — and the unfolded Fold shows **one and a sliver**.

1. **A single TODO column eats ~88% of a 1000px-wide canvas.** `.ak-col { flex: 0 0 88vw }` was written for a 390px phone, where 88vw = a sensible 343px card. At ~1000px CSS it produces **~880px-wide ticket cards** — a reading measure of 150+ characters for 11–13px mono text. Look at the `#reconcile-primary-behind2-ffonly` card: the subject runs one enormous line, then the `1h ago` timestamp floats alone at the far right corner of a mostly-empty rectangle. Every card is ~70% dead space.
2. **"IN PROGRES…" is a clipped sliver at the right edge** — a truncated label and an empty dashed placeholder. That sliver is the *only* visual evidence that three more columns exist. REVIEW and DONE are two swipes away. On a Kanban board — whose entire reason to exist is seeing flow across states at a glance — the flow is invisible.
3. **The header double-spends the short axis.** The sticky header (session picker + LIVE pills) plus the `PipelineMeter` — four fat stat tiles (`TODO 561 / PROG 0 / REVIEW 1 / DONE 630`, 19px counts, panel borders) — consume roughly the top **17–20% of a ~750px-tall canvas**. And it's *redundant*: directly beneath it, the column head repeats "TO DO 561". The user pays the vertical cost of the same number twice, on the axis this device is shortest on. Two of the four tiles (`PROG 0`, `REVIEW 1`) are near-empty yet each still gets 25% of the row.
4. **Net information density: ~2.5 tickets visible out of 1192**, on a 7.6" QXGA+ panel that comfortably renders a small-desktop layout. The desktop 4-up grid at exactly 1024px gives ~236px columns; this canvas at ~1000px could give ~230px columns — a 24px difference — yet gets the 390px-phone experience instead.
5. **Phone affordances on a tablet**: the swipe-snap strip, the `.ak-dots` carousel pager, the bottom-sheet drawer — all one-thing-at-a-time patterns shipped to a canvas that has room for everything at once.
6. **The hinge crease lands dead-center on content.** An 88vw card straddles the fold line right through its subject text. A column-gutter layout (4-up or 2×2) naturally puts a gap near the crease; the swipe strip guarantees content sits on it.

## 2. The code-level root cause

`app/globals.css` has exactly **two layout regimes**:

- **Base (mobile-first)**: `.ak-strip` = horizontal flex, `scroll-snap-type: x mandatory`, `.ak-col { flex: 0 0 88vw }` (L393–414) + `.ak-dots` pager (L468).
- **`@media (min-width: 1024px)`** (L1568): `.ak-strip` → `grid-template-columns: repeat(4, 1fr)`, dots hidden, drawer becomes a side panel.

The `@media (max-width: 640px)` block (L853) is *not* a third regime — it only wraps the header row and stacks swimlane rows. So **everything from 641px to 1023px inherits the phone strip verbatim.** That's the entire tablet/foldable class: iPad Mini portrait, small tablets, split-screen desktop windows, and the Fold 8 unfolded in both orientations. This isn't a foldable edge case; it's a missing middle third of the responsive spectrum, and the Fold 8 is just the device that finally walked into it.

Three compounding decisions make it worse:

- **`88vw` is viewport-relative, not content-relative.** A column's useful width is bounded by card readability (~340–420px). Tying it to viewport width means the card *degrades as the screen improves*.
- **`1024` is a legacy desktop token, not a measured threshold.** Nothing about this UI needs 1024px for 4 columns; 4 × 210px + gutters ≈ 900px is already comfortable at these type sizes (11.5px column names, 12.5px subjects).
- **The header is not height-budgeted.** `.ak-header` is sticky and stacks brand row + meter unconditionally. On tall phones that's fine; on a 750px-tall landscape canvas the board gets ~600px, and each card is ~100–110px tall → **~5 cards visible per column, max**, even after fixing the columns.
- **Orientation is unhandled.** Portrait-unfolded (~750×1000) also falls in the dead zone and also gets the one-column strip — despite having room for a 2×2 grid with generous card height.

`BoardView.tsx` is largely innocent — `onStripScroll`/`scrollToCol`/`activeCol` are strip-mode-only and inert when the strip becomes a grid (scrollLeft stays 0), and the dots are already CSS-hidden in grid mode. The fix is almost entirely CSS.

## 3. Critique summary — what's WRONG for a 4:3 canvas

1. **Wrong layout class**: a serial, one-state-at-a-time phone pattern on a parallel-viewing tablet canvas. The board's core value (cross-column flow, WIP at a glance, the live glow of a card *moving* between columns — which the 0.7s lift animation was built for and which is literally invisible when the destination column is off-screen) is destroyed.
2. **Wrong axis budget**: horizontal space (abundant) is squandered on one over-wide column; vertical space (scarce at 4:3) is squandered on a redundant double-header.
3. **Wrong breakpoint model**: a two-regime phone/desktop binary with a 383px-wide dead zone, keyed to viewport width alone, blind to aspect ratio, orientation, and the container's actual width.

## 4. Direction for `/frontend-design`

### (a) Columns: all four, always — 4-up in landscape, 2×2 in portrait

**POV: never show fewer than all four columns on an unfolded Fold.** The arrangement adapts, the census doesn't.

- **Landscape unfolded (~1000×750)**: `repeat(4, 1fr)` — the existing desktop grid, promoted downward. ~230px columns at this type scale are proven (that's what 1024px desktop already renders).
- **Portrait unfolded (~750×1000)**: **2×2 grid** (`repeat(2, 1fr)` columns × 2 rows: TODO | PROG / REVIEW | DONE). ~360px columns — ideal card measure — and the tall canvas funds two stacked rows.
- **Critical enabler for 2×2**: the app shell must become a **height-constrained grid** (`100dvh`; header `auto`, board `1fr`) with **per-column `overflow-y: auto`** scrolling. With 561 tickets in TODO, page-level scroll under a 2×2 grid would push the bottom row into oblivion; independent column scroll is what makes the quadrant layout survive real data. (Give 4-up mode per-column scroll too — a 561-card column under page scroll is already broken on desktop; this is the free fix that comes with the shell change.)

### (b) Detection: container queries for tiers; media queries only as the shell fallback

**Recommendation: CSS container queries** (`container-type: inline-size` on the board wrapper), with tiers on the *container's* inline size:

- `< 640cqw` → keep today's phone swipe strip, untouched.
- `640–899cqw` → **2×2 grid** (covers portrait-unfolded ~750, iPad Mini portrait, half-screen splits).
- `≥ 900cqw` → **4-up grid** (covers landscape-unfolded ~1000; the 1024 media block's remaining desktop-only refinements — wider gutters, side-panel drawer — can stay or move to a `≥ 1024cqw` tier).

Why containers over the alternatives:
- **vs. width media queries**: foldables live in multi-window/Flex-mode; Samsung's split-screen resizes the app pane constantly. Container queries answer the only question that matters — "how wide is the space the board actually has" — and are also future-proof against a sidebar/drawer stealing width. Baseline-supported in every browser the Fold 8 ships with. (If you'd rather not touch the shell, plain `min-width: 640px`/`900px` media tiers get you 90% of the value — but containers cost the same to write and don't lie in split-screen.)
- **vs. `min-aspect-ratio`**: reject as the primary key. Aspect ratio doesn't encode *size* — a 4:3 canvas can be 500px or 1400px wide — and the column-count decision is a width-per-column question, not a shape question. Shape is already handled implicitly: portrait's narrower width lands in the 2×2 tier, landscape's in the 4-up tier. One legitimate supplementary use: a `@media (min-height: 700px)` guard on the 2×2 tier so a short-and-narrowish window degrades to the strip rather than to two crushed rows.
- **vs. `spanning` / viewport-segments foldable APIs**: skip. The unfolded inner display presents as one continuous segment; the API is a hinge-*occlusion* tool with weak support, and this layout has no content that must dodge the crease once columns have gutters. Not load-bearing — a progressive-enhancement note at most.

### (c) Reclaim the short axis: collapse the header below the desktop tier

In the sub-1024 grid tiers, the two-story header must become **one ~48px row**: session picker · a **compact inline meter** · lane pill · LIVE pill. The `PipelineMeter`'s four panel tiles are pure duplication once all four column heads (with counts) are simultaneously visible — replace them in these tiers with either (i) inline `chip` text (`TODO 561 · PROG 0 · REVIEW 1 · DONE 630`, hue-tinted, one line) or (ii) a 6px **proportional segmented bar** — an actual meter, which is the one thing the tiles never were. Keep the full tiles on phone (where column heads are off-screen, the meter is the only overview — there it earns its pixels) and optionally on desktop. Column heads become `position: sticky; top: 0` *inside their scroll containers*, replacing the sticky mega-header's job. Net: board area goes from ~600px to ~700px of a 750px canvas.

### (d) Card density: compact variant in grid tiers

Cards are already typographically dense (9–12.5px mono); the waste is padding and unclamped width, not type. In grid tiers: tighten vertical padding ~20%, clamp subjects to 2 lines (`-webkit-line-clamp`), keep the footer single-line with `gap` overflow ellipsis. Target: **~84–92px per card → 7–8 visible cards per column** in landscape (vs ~2.5 total today). Do not shrink type below the current scale — it's at the floor already. The `Card.tsx` component needs zero logic changes; this is a `.ak-card` container-query variant.

### (e) Portrait vs landscape: free, by construction

No orientation media query, no JS. Portrait-unfolded (~750cqw) → 2×2 tier; landscape-unfolded (~1000cqw) → 4-up tier. Rotating the device slides the container width across the 900cqw line and the grid re-tiles. This is the elegance test for the whole design: **if orientation handling needs its own code path, the tiers are keyed on the wrong variable.**

### (f) Non-regression contract

- **Phone (<640)**: base styles are untouched — the strip, snap, dots, 88vw column, bottom-sheet drawer all live in the un-queried base layer and no new tier reaches below 640. The 640px header-wrap block stays as-is.
- **Desktop (≥1024)**: the existing 1024 block's declarations are a superset of the 900+ tier (same `repeat(4, 1fr)`); keep it as the wide-gutter + side-drawer refinement so desktop pixels don't move.
- **JS**: `onStripScroll`/`scrollToCol` no-op in grid modes (no horizontal overflow → scrollLeft 0); `.ak-dots` gets `display: none` in every grid tier (today only ≥1024). The one real JS-adjacent check: `isAlreadyInViewport`/`scroll-margin-top` values for the #1456 swimlane reveal assume the tall sticky header — re-derive the clearance for the compact header tier.
- **Drawer**: promote the side-panel drawer (currently ≥1024) down to the ≥900 tier — a bottom sheet on a landscape tablet covers the board it's annotating; a 440px side panel over a 1000px canvas doesn't.
- **Verification**: ui-evolve screenshots at 1000×750, 750×1000, 390×844, 1440×900 — the four contract points.

### One-paragraph brief seed

> Promote the 4-up grid down to every canvas ≥900px of container width, add a 2×2 quadrant grid with per-column scrolling for 640–899px, convert the app shell to `100dvh` header/board rows so columns scroll independently, collapse the header to a single 48px row with an inline meter in both new tiers (full stat tiles remain phone-only), add a compact card variant clamped to 2-line subjects, and key all of it on container queries — leaving the sub-640 phone strip and ≥1024 desktop grid byte-for-byte unchanged.
