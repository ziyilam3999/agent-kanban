# agent-kanban — design direction

**Concept: BLACK-BOX TELEMETRY CONSOLE.** Not a Trello clone. The board reads like the status deck of
an observatory / flight-recorder: calm, dark, precise, glanceable. The operator glances at their phone
and instantly reads "where is every job in the pipeline, and what just moved." Every ticket is a
flight-recorder for one job; the drawer is its black-box log.

Aesthetic axis: **industrial / utilitarian × retro-futuristic telemetry.** Monospace-led, grid texture,
one vivid phosphor signal color against deep-space ink. Restraint over decoration — calm, not busy.

## Type system
- **Display / labels / IDs / timestamps / counts → `Martian Mono`** (technical, grid-like, telemetry). Use
  for column headers, ticket IDs (`#203`), role labels, the pipeline meter, relative times.
- **Body / ticket subjects + descriptions → `Hanken Grotesk`** (refined humanist sans, reads clean at
  small sizes). Subjects are the one place we drop mono for legibility.
- Load via `next/font/google`. NEVER Inter/Roboto/Arial/system. No Space Grotesk, no Geist.

## Color & theme (dark by default, CSS variables)
- `--ink: #0a0e12` (deep-space base) · `--panel: #10161c` · `--panel-2: #161e26` · `--line: #1f2a33`.
- Text: `--fg: #d7e0e6` · `--fg-dim: #7c8a96` · `--fg-faint: #4a5762`.
- **Signal accent (LIVE / phosphor): `--live: #3ef2b0`** (one vivid green-cyan; the only glow in the UI).
- Column hues (used ONLY as a thin status rail + count tint, never full-column fills — keeps it calm):
  - To Do `--todo: #5b6b78` (slate) · In Progress `--prog: #34c6e2` (cyan) · In Review `--review: #f2b03e`
    (amber) · Done `--done: #4f9e7a` (muted landed-green).
- Atmosphere: faint dotted-grid background + a subtle grain/noise overlay + a soft vignette. No purple
  gradients. The only glow is the phosphor LIVE accent.

## Layout — phone-first (vertical phone is the primary surface)
- **Sticky console header (top):**
  - Left: **session picker** (dropdown; label = "active just now · 6 tickets"; UUID hidden).
  - Right: **LIVE badge** — a pulsing `--live` dot + `LIVE` (mono) when the shown session is live.
  - Full-width under it: a **4-segment pipeline meter** — `TODO 17 · PROG 3 · REVIEW 0 · DONE 37` as a
    segmented telemetry readout, each segment tinted its column hue. This is the at-a-glance whole-pipeline
    state even while scrolled into one column.
- **Columns = horizontal snap-scroll strip.** Each column ≈ 88vw wide (a peek of the next column shows
  there's more), `scroll-snap-type: x mandatory`. A small dot indicator (4 dots) shows which column you're
  in. Cards stack vertically inside a column. (Do NOT cram 4 columns side-by-side on a phone.)
  - Desktop (≥1024px): the 4 columns sit side-by-side full-width (progressive enhancement).
- Column header: hue rail + `Martian Mono` name + count.

## Card — telemetry tile
- Thin **left status rail** in the column hue.
- Top row: `#203` (mono) · **role-progress pips** = 4 tiny pips (planner / plan-review / executor /
  exec-review) that FILL as each role appears in the ledger — glanceable "how far down the pipeline."
- Subject: `Hanken Grotesk`, 2-line clamp.
- Footer: a red **blocked pill** (`⛔ blocked by #201`) only when `blockedBy` is non-empty; relative
  updated-time (mono, dim) on the right.
- Compact, dense, calm. No drop shadows except a hairline border + the rail.

## "LIVE" + "a card just moved" (alive, not noisy)
- LIVE = the pulsing phosphor dot in the header (slow ~2s pulse). That's the only persistent motion.
- The board polls every 1–2s. When a poll shows a card **changed column**, ONLY that card animates:
  a layout/FLIP slide into its new column position + a brief `--live` glow ring that fades in ~600ms,
  and its newly-completed role pip fills. Everything else stays still. New cards fade+rise in. Use the
  **Motion** library (`motion/react`) `layout` animations. Respect `prefers-reduced-motion`: no slide/
  glow — just an instant state swap + a 1-frame highlight.

## Drawer — the black-box log (tap a card)
- **Bottom sheet** that slides up (mobile); side panel on desktop. Dim scrim behind.
- Header: `#203` · subject · current-column chip (hue).
- Body: a **vertical telemetry timeline** on a left rail. Each role event = a node (color-coded by role)
  with: role label (mono caps) · timestamp (mono) · the artifact as a monospace **log line**
  (`▸ 203-plan-review.md`). A connector line joins nodes oldest→newest. Reads like a black-box recorder
  dump for that one ticket. An inline-skip shows a muted `— skipped: <reason>` node.
- Close: swipe-down / tap scrim / X. Reduced-motion: fade, no slide.

## Non-negotiables
- Mobile-first; everything must read at a glance on a vertical phone.
- Renders from `data/board.sample.json` in dev/CI (synthetic) and the live `board.json` snapshot in prod.
  Conforms to `lib/board-schema.ts` exactly.
- Zero layout shift (CLS 0); transform/opacity-only motion; accessible (focus states, aria on the drawer,
  contrast ≥ 4.5 for body text).
