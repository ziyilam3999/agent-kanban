# Fold 8 (4:3 unfolded) — frontend-design brief

**Status:** design_brief (UI-task gate leg 1). Seeds implementation. Pairs with `fold8-4x3-fable-critique.md` (diagnosis) and the ui-evolve verdict (leg 2, produced against the built screens).

**Target:** Samsung Galaxy Z Fold 8, unfolded inner display = **4:3** (1848×2448 physical, ~**1000×750** CSS landscape / ~**750×1000** CSS portrait). A near-square tablet canvas the current CSS misclassifies as a phone.

---

## 1. Design POV (the one thing to remember)

The app's identity is a **black-box telemetry console** — a flight recorder. A flight recorder's whole virtue is that **every gauge is visible at once**; you never swipe one dial into view while the others go dark. The current build violates its own metaphor on the Fold: it shows one column and swipes the rest off-screen.

**POV: on an unfolded Fold, the entire recorder is always on-screen. All four states, always. The arrangement adapts to the canvas; the census never shrinks.** Landscape = a 4-gauge strip; portrait = a **quadrant readout** (2×2). Nothing new is invented visually — same phosphor, same mono, same dotted-grid atmosphere — the layout just stops pretending a tablet is a phone.

This is a *restraint* brief, not a reskin: the console aesthetic is already distinctive and correct. The bold move is **structural**, not decorative — reclaiming the wasted canvas and killing the redundant header, executed with precision inside the existing visual language.

## 2. Layout system — container-query tiers

Key everything on **container queries** (`container-type: inline-size` on the board wrapper), not viewport width — foldables live in split-screen/Flex-mode where viewport width lies, and the board's real question is "how wide is *my* space," not "how big is the device."

| Tier (container inline-size) | Layout | Covers | Columns |
|---|---|---|---|
| `< 640cqw` | **Phone strip** (unchanged) | phones, narrow splits | 88vw snap-scroll, 1-at-a-time |
| `640–899cqw` + `min-height: 700px` | **Quadrant 2×2** | portrait-unfolded ~750, iPad Mini portrait, half-screen | TODO · PROG / REVIEW · DONE, ~360px each |
| `≥ 900cqw` | **4-up grid** | landscape-unfolded ~1000, desktop | `repeat(4, 1fr)`, ~230px each |

- The `≥1024px` desktop refinements (wide gutters, side-drawer) stay as a `≥1024cqw` super-tier — desktop pixels do not move.
- Portrait↔landscape handling is **free by construction**: rotating the Fold slides the container width across the 900cqw line and the grid re-tiles. No orientation media query, no JS. *Elegance test: if orientation needs its own code path, the tier is keyed on the wrong variable.*

## 3. App shell — `100dvh` grid + per-column scroll (the critical enabler)

The 2×2 tier is impossible without this. Convert the shell to a height-constrained grid:

```
.ak-app { height: 100dvh; display: grid; grid-template-rows: auto 1fr; }
.ak-board { min-height: 0; }                 /* lets the 1fr row actually clip */
.ak-col  { overflow-y: auto; min-height: 0; } /* each column scrolls independently */
```

With 561 tickets in TODO, page-level scroll under a 2×2 grid would bury the bottom row. Independent per-column scroll is what makes the quadrant survive real data. Give 4-up per-column scroll too — a 561-card column under page scroll is already broken; this is the free fix. Column heads become `position: sticky; top: 0` **inside** their scroll containers.

## 4. Reclaim the short axis — collapse the header

At 4:3 the scarce axis is vertical (~750px). Below the desktop tier, the two-story header (brand row + 4 fat `PipelineMeter` tiles, `--header-h: 104px`) collapses to **one ~48px row**:

`session-picker · segmented-meter · LANE pill · LIVE pill`

Replace the four stat tiles — which merely duplicate the column-head counts once all four heads are visible — with a **6px proportional segmented bar**: one continuous bar split into TODO/PROG/REVIEW/DONE widths, hue-tinted (`--todo/--prog/--review/--done`). This is an *actual meter* (the thing the tiles never were) and costs ~6px instead of ~90px. Keep the full tiles on **phone only** (where column heads are off-screen, so the meter is the sole overview — there it earns its pixels). Net board area: ~600px → ~700px of 750.

## 5. Card density — compact grid variant

Cards are already typographically dense (9–12.5px mono); the waste is **padding + unclamped width**, not type. A `.ak-card` container-query variant in grid tiers:
- vertical padding −~20%
- subject clamped to **2 lines** (`-webkit-line-clamp: 2`)
- footer single-line, `gap` overflow → ellipsis
- **do not** shrink type — it's at the floor.

Target **~84–92px/card → 7–8 visible per column** (vs ~2.5 total tickets visible today). `Card.tsx` needs zero logic changes — pure CSS variant.

## 6. Tokens — reuse, invent nothing

All existing: `--ink #0a0e12`, `--panel #10161c`, `--line #1f2a33`, `--fg #d7e0e6`, `--fg-meta #93a0ac`, phosphor `--live #3ef2b0`, column hues `--todo/--prog/--review/--done`, `--font-mono`. Atmosphere layers (dotted grid + vignette + grain) unchanged. The segmented meter uses the four column hues at ~70% mix on `--panel`.

## 7. Non-regression contract

- **Phone (<640):** base layer untouched — strip, snap, `.ak-dots` pager, 88vw column, bottom-sheet drawer. No new tier reaches below 640cqw. The 640px header-wrap block stays.
- **Desktop (≥1024):** existing block is a superset of the 900+ tier (same `repeat(4,1fr)`); kept as the wide-gutter + side-drawer refinement.
- **JS:** `onStripScroll`/`scrollToCol` no-op in grid modes (no horizontal overflow); `.ak-dots` → `display:none` in every grid tier. Re-derive the `#1456` swimlane-reveal `scroll-margin-top` for the compact-header tier (it assumes the tall header).
- **Drawer:** promote side-panel drawer down to ≥900cqw — a bottom sheet on a landscape tablet covers the board it annotates.

## 8. Verification (ui-evolve leg — 4 contract points)

Real screenshots at: **1000×750** (landscape 4-up), **750×1000** (portrait 2×2), **390×844** (phone strip — must be byte-identical), **1440×900** (desktop — must not move). Require `verdict: ACCEPT` + rubric score, no regression on the two contract-preservation points.

## 9. Implementation map (≈ CSS-only)

| File | Change |
|---|---|
| `app/globals.css` | new `@container` tiers (2×2, 4-up promotion), `100dvh` shell grid, per-column scroll, sticky in-column heads, compact `.ak-card` variant, segmented-meter styles, `.ak-dots` hide in grid tiers |
| `components/PipelineMeter.tsx` | render segmented-bar variant below desktop tier (or a CSS-swapped twin); full tiles phone-only |
| `app/page.tsx` / shell | wrap board in a `container-type: inline-size` element; shell `height:100dvh` grid rows |
| `Card.tsx` | none (CSS variant only) |
| `BoardView.tsx` | none required; verify strip handlers inert in grid |

**One-line seed:** promote the 4-up grid to every container ≥900cqw, add a per-column-scrolling 2×2 quadrant for 640–899cqw, convert the shell to a `100dvh` header/board grid, collapse the header to one 48px row with a segmented meter, add a 2-line-clamped compact card — all container-queried, leaving phone `<640` and desktop `≥1024` byte-for-byte unchanged.
