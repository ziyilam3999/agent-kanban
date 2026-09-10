# Design Brief — board-noise triage S1: the collapsed Noise Shelf

- **Ticket:** `board-noise-s1-display` (S1 of the board-noise triage design, `.ai-workspace/designs/2026-09-06-board-noise-ticket-triage-display-and-closing.md` §4 D1-D6, ai-brain-side plan-review PASS r2).
- **Surface:** the four-column board (`BoardColumn`/`BoardView`) + the header status row + the ticket `Card`/`Drawer`.
- **Direction (chosen):** **A collapsed shelf strip, closed by default, below the column board** — never a 5th column, never a toggle-to-hide filter on the existing four.

## The problem (why this design exists)

The board's four columns are supposed to answer one question — "what real work is in flight?" — but today they also carry chores ("sweep this folder"), parked ideas, and epics sequenced behind other work. On the real board that's roughly 165 of 625 open cards: a quarter of every column is noise a viewer has to mentally filter out before the real signal is legible. The fixture used for this build reproduces the shape at small scale: 20 tickets, only 5 of them real work — TODO would show 17 cards today, 4 once this ships.

## Why "a shelf, collapsed" over the two obvious alternatives

`/frontend-design` considered three shapes for "where does the noise go":

1. **A 5th column ("Shelf")** — rejected. It reads as a peer to TODO/IN PROGRESS/IN REVIEW/DONE, implying noise is a pipeline stage. It isn't — bookkeeping/parked/deferred tickets never move through the 4-role chain, and giving them a column visually promotes them to the same status as real work, which is the exact confusion this design exists to remove.
2. **A hide/show filter toggle on the SAME four columns** — rejected (also rejected at the design-doc level, §2: "a render-time filter alone... hides, it never retires"). A toggle is a *view mode*, easy to leave in the wrong state, and it doesn't give the noise its own legible home — it just make it disappear, which trains a viewer to forget it exists rather than to periodically sweep it.
3. **A collapsed `<details>` strip below the columns, grouped by kind** (CHOSEN) — the columns stay exactly what they've always been (a pipeline), and the noise gets a dedicated, honestly-labeled home that is one tap away, never zero-cost-invisible. `<details>`/`<summary>` is also the correct semantic element for "collapsed by default, disclosed on demand" — free keyboard/AT support, no custom ARIA state machine to get wrong.

## The population split — one predicate, three surfaces

Every consumer shares the SAME resolved-kind read (`lib/ticket-kind.ts`'s `resolveTicketKind`, mirroring ai-brain's `docs/task-kind-contract.md` §3.2 steps 1-3, cross-checked against the shared S0 fixture):

- **The four columns** (`BoardColumn` via `BoardView`'s `grouped`) — `kind == "work"` ONLY, INCLUDING Done (an auto-retired chore must never re-flood Done the moment it closes).
- **The header stat tiles** (`PipelineMeter`) — fed the SAME work-filtered array as the columns (`workVisible`), not the raw `visible` list, so the tiles and the columns can never quote two different numbers for "how much work is in TODO" (a visible seam I caught and closed during the desktop-open screenshot review — the tiles were still counting all 20 tickets while the columns already counted 5).
- **The shelf** (`Shelf.tsx`) — everything else, OPEN only (a completed chore isn't noise anymore, it's just done), grouped into three labeled buckets: Bookkeeping / Parked / Deferred.

## Shelf anatomy

- One `<details class="ak-shelf">`, full-width, directly below the column strip's page-dot row — never inside `.ak-strip` (it must never widen the horizontal-scroll strip above it; this is the plan's own mobile constraint).
- **Summary** (always visible, even closed): `Bookkeeping N · Parked N · Deferred N` in the shelf's own neutral steel-grey (`--shelf`, distinct from every column hue AND every role hue already in the palette — it must never be mistaken for a pipeline stage or a role chip). A CSS-only `▸`/rotated-`▸` caret gives the open/closed affordance without any JS beyond the native `<details>` toggle.
- **Body** (rendered — genuinely absent from layout, not just visually hidden — while closed; verified empirically, see the CSS note below): one labeled group per non-empty kind, each holding the SAME `Card` tiles the columns use, wrapped in the same `.ak-cardbtn` button contract (tap opens the drawer — a shelf ticket is one tap from full detail, never a dead end).
- **Header pill** (`N ACTIVE · M ON SHELF`, next to the existing `N LANES LIVE` pill): the population-level rollup, unconditional (not gated on session liveness like the lanes pill — a shelf population is meaningful for an idle session too).

## A real CSS trap this brief documents so it isn't rediscovered

The obvious `.ak-shelf__body { display: flex; ... }` does NOT get suppressed by the browser while the `<details>` is closed on this Chromium build — `getComputedStyle` reports `display: block` and `scrollHeight` reads the full rendered height even with no `[open]` attribute present. The fix is an EXPLICIT `display: none` on `.ak-shelf__body`, overridden only under `.ak-shelf[open] > .ak-shelf__body`. This is load-bearing for AC-1.5 (a real tap must take `scrollHeight` genuinely 0 → >0) — relying on native `<details>` collapse behavior alone silently fails that assertion.

## Per-kind identity on the card itself (D5)

A non-work ticket carries a small top-right kind chip (`CHORE` / `PARKED` / `DEFERRED`, own `--shelf` hue family — the same `.ak-tag` shape the research/ship-tail chips already use, so it reads as "one more seat/kind marker," not a new visual language) plus, for a bookkeeping ticket the sweep has already touched, a `DUE`/`UNCHECKED`/`HELD` footer badge. Opening the drawer surfaces the full kind metadata (`kind`, `bookkeeping.type`/`.state`, `parked_under`, `blocked_reason`, `disposition`) as a quiet 2-column table — additive, renders nothing for a plain work ticket.

## Telemetry-console tokens (reuse, do not invent)

Same deep-space console the rest of the board already speaks: `--panel`/`--line` for the shelf's own bordered strip, `--font-mono` + wide letter-spacing for the summary/pill/labels, `--shelf` (`#8d99a6`, WCAG ~5.9:1 on `--panel`) as the one new hue — chosen specifically NEUTRAL (steel-grey, not a saturated accent) so "this is administrative noise, not a live signal" reads at a glance next to the mint `--live` lane counter.

## Mobile handling

The shelf is a full-width block, same as the column strip's own mobile-first single-column stacking — it never introduces horizontal scroll of its own and never widens `.ak-strip`. Verified at 390×844 (AC-1.5's own viewport): summary + grouped cards read cleanly stacked, no clipped text, no overflow.

## Out of scope (deferred, not built here)

- The "retired N (24h)" completed-non-work count the parent design's §4 D2 mentions — omitted from this build (not in S1's Binary AC; a real completed-ticket count depends on live `updatedAt` timing that would make the fixture-driven e2e non-deterministic). Tracked as a documented gap in the PR, not silently dropped.
- The sweep-driven `bookkeeping.state` badge shows only when the field is present — this build never WRITES that field (that's ai-brain's S2 sweep); it only renders it.

design_pov: A collapsed, closed-by-default shelf strip below the column board — never a 5th column, never a hide toggle — grouped by kind, sharing the exact Card/Drawer components the real-work columns use, in the board's own neutral --shelf hue so noise reads as administrative, not live.
