# kanban-board-chrome-pinning — design brief

**Task:** kanban-board-chrome-pinning
**Author:** executor (cc-executor)
**Date:** 2026-09-18
**Plan:** ai-brain `.ai-workspace/plans/2026-09-17-kanban-board-chrome-pinning.md`

## POV — what these two surfaces ARE, in the telemetry-console idiom

`docs/design-direction.md` names the board a **black-box telemetry console**: calm, dark, precise,
glanceable, a flight-recorder status deck, not a Trello clone. That doc's own §"Layout" already
specifies the intent this task restores: a **"Sticky console header (top)"** carrying the session
picker, the LIVE badge, and "a 4-segment pipeline meter... the at-a-glance whole-pipeline state EVEN
WHILE SCROLLED INTO ONE COLUMN." That phrase is the whole POV for the top strip — it is not a page
banner that happens to stay put, it is the **instrument panel** of the console, and an instrument panel
that scrolls away the moment you look at the data is a broken instrument. The column heading joins that
panel for the same reason: "which column am I reading" is as load-bearing as "what's the pipeline
state," so it belongs in the SAME non-scrolling band, directly under the meter, with zero list content
between them — one flat strip, not two floating labels that happen to be near each other.

The bottom bar is a different instrument: the **bookkeeping drawer** — closed-book tickets (parked,
deferred, done-and-filed) that the operator does not need mid-glance but must always be one tap from
reaching. In a telemetry console idiom this reads as a **pull-tab tray riveted to the bottom edge of the
housing**, not a footer that happens to be at the end of a long scroll. The existing folding-phone fix
(#2499) already gave it the right physical form — a bottom sheet with a grabber pip, `position: fixed`,
riding above every list — this task's only job is making that same tray reachable on EVERY chassis size
(desktop, the narrow landscape gap), not inventing a second metaphor.

## Why the counts compact the way they do on a 344-390px width

Pinning the top strip turns its height into a **permanent tax on every pixel of the phone screen** —
before this task, a tall header only cost you scroll distance once; now it is deducted from the visible
list on every frame, forever. The full 4-tile `.ak-meter` (each tile: label + a 19px tabular-nums count,
padded, bordered, in its own card) is right for a page you glance at once and then scroll past — wrong
for chrome that is ALWAYS on screen. This task keeps the SAME four stat tiles (never swaps to the grid
tier's proportional bar — an existing, ALREADY-GREEN e2e assertion pins `.ak-meter` visible at 390px,
and a swap would silently erase that signal, not just restyle it) but tightens their own footprint:
smaller vertical margin, tighter tile padding, a slightly smaller count digit. The four numbers stay
exactly as legible and exactly as present — the same information, spending less permanent rent.

## How the bottom bar reads as a tray, not a footer

Three things carry that read, all pre-existing (#2499) and unchanged here: the **grabber pip** (a small
centered bar, the universal "drag me / tap me to expand" affordance), the **rounded top corners only**
(a tray sits IN the housing, a footer spans it edge to edge with square corners), and the **drop shadow
cast upward** (`0 -8px 20px -4px rgba(0,0,0,.45)` — light falling on something that sits proud of the
surface below it, not flush with it). Extending the SAME rule to desktop and the narrow landscape gap
(rather than inventing a wider desktop-specific treatment) keeps the tray metaphor coherent across every
chassis size — the only new geometry is the horizontal inset, mirrored off `.ak-app`'s own centering math
so the tray's edges line up with the 4-up column grid above it instead of spanning the full (often much
wider) browser chrome.

## The 200px budget

At rest, a 390-844 phone screen has 844px to spend. Before this task the (unpinned) chrome only cost
scroll distance, never screen real estate. Pinning both ends means the top strip + bottom tray now
permanently occupy real vertical space on every frame — the plan's own measured HEAD reference is 241px
of un-pinned chrome at that cell; the budget caps the PINNED total at 200px so the list still reads as a
list (≥4 full cards visible at rest), not a letterbox. The grid tiers already prove the design system can
hit an even tighter number (130px, collapsed one-row header) — this task borrows that discipline for the
phone tier's stat tiles rather than inventing a new compact vocabulary.

## Safe-area / notch

`env(safe-area-inset-bottom)` is not exercised by this brief's screenshots (headless Chromium reports 0
regardless of what's requested) — this is explicitly a post-merge, real-device observation (NR-4,
deferred to the VEI outcome-evidence step), not something the pixel evidence here can prove or disprove.
Judgment call for a future iteration if the tray is ever observed sitting under a home-indicator bar on a
notched phone: this brief's tray already sits `bottom: 0` with no inset compensation, which is the
correct starting point (most phones show it fine) but not a guarantee.

## What stays untouched (X5 coherence)

The `.ak-lanes` `scroll-margin-top` values (104/148/48px) encode the header's height under the OLD
(broken) sticky model — since the header's OWN rendered height is unchanged by this fix (only whether it
actually stays stuck), those values remain correct and are left alone. The Live Swimlanes panel keeps
scrolling away as ordinary list content (never becomes part of either pinned band) — it is operational
detail, not always-on instrument state, and the design brief for #1456 already made that call.

## Contracts

Two data attributes make the pinning geometry mechanism-agnostic for the e2e oracle and for a future
reviewer grepping the diff: `data-ak-chrome="top"` on the element wrapping the session picker + status
pills + pipeline meter (today `header.ak-header`), and `data-ak-chrome="bottom"` on the pinned tray root
(today the `<Shelf>` component's `<details className="ak-shelf">`). Exactly one element carries each.

## Rubric for the ui-evolve pass

Score each 1-5, weight equally, ACCEPT at a mean >= 3.5 with no dimension below 2.5:

1. **Instrument-panel legibility (top).** At a glance, mid-scroll, can you read the pipeline state and
   which column you're in without the eye hunting for it? Does it read as ONE panel, not two floating
   labels?
2. **Tray affordance (bottom).** Does the pinned bar read as a pull-tab tray (grabber pip, rounded top
   corners, upward shadow) rather than a plain footer strip glued to the edge?
3. **Budget discipline.** Does the pinned chrome feel like "compact instrument," not "letterboxed list"?
   Are at least 4 cards comfortably readable below the fold at rest on a standard phone height?
4. **Cross-chassis coherence.** Do desktop and the narrow landscape cell read as the SAME console as
   phone — same tray, same panel — rather than a visibly different, bolted-on treatment?
5. **No visual regression.** Drawer/scrim layering, Live Swimlanes panel, card density, and the
   telemetry-console palette/type system are all unchanged from HEAD.

## Screens required (leg 2 evidence)

390x844 at rest; 390x844 mid-scroll (cards passing under the top strip); 390x660 at rest; 390x844 shelf
open; 1440x900 at rest; 1440x900 mid-scroll; 768x1024 at rest (grid-tier regression frame) — captured
from the production server (`next build && next start`), per the #2499 verdict's dev-tools-badge lesson.
