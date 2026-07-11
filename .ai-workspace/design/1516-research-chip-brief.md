# Design Brief — #1516 Research-Seat Card Chip

**Repo:** agent-kanban (PUBLIC) · **Phase:** frontend-design (leg 1 of the UI-task gate) · **Grounded by:** the `frontend-design` skill + a verified read of `components/Card.tsx`, `lib/ui-meta.ts` (`ROLE_COLOR`/`ROLE_LABEL`), `lib/active.ts` (`chainInFlight`'s new research branch), `app/globals.css` (`.ak-tag`, `.ak-tag--epic`, `ak-pulse`/`ak-working-pulse` keyframes).

This brief is the **design POV** the executor built to and that `ui-evolve` (leg 2) scores against §RUBRIC.

---

## 0. One-paragraph POV

A research-seat spawn is currently invisible on the card while it runs — the exact bug #1516 fixes on the data side. The chip's whole job is to make that state visible **without lying about what it is**: research is explicitly NOT one of the four pipeline roles (`PIPELINE_ROLES` stays exactly four), so the chip must never look like a fifth pipeline pip. It gets its **own hue** (`--research`, a violet distinct from every existing role/epic/status hue on the board), its **own shape family** (reuses `.ak-tag`'s proven pill — the same shape the board already uses for `.ak-tag--epic`, so it reads as "a tag," not "a stage"), and its **own motion state**: a faint opacity-only pulse while open (in-flight, no `closedAt`), static once closed. The pulse is a NEW keyframe (`ak-research-pulse`) rather than reusing `ak-pulse`/`ak-working-pulse` — both of those carry a `scale()` transform tuned for round dots/left-rail bars, which would read as jitter on a text pill; a dedicated opacity-only animation stays calm at pill scale and respects `prefers-reduced-motion`.

---

## 1. Where it lives — layout constraint

`.ak-card__top` uses `justify-content: space-between` and assumes exactly **two** children (`#<id>` and the pips span) — adding the chip as a bare third child would float the pips into the middle instead of staying right-aligned. The chip is nested inside a new `.ak-card__top-right` flex wrapper alongside the existing pips span, so `.ak-card__top` still sees exactly two top-level children and its layout contract is undisturbed.

---

## 2. Token vocabulary (new + reused)

| Token | Value | Why |
|---|---|---|
| `--research` (new) | `#b98ef2` | Measured 7.12:1 contrast against `--panel` (#10161c) via the actual WCAG relative-luminance formula (exceeds AA's 4.5:1 with headroom) — not guessed. Distinct violet, unused by any existing role/epic/status hue. |
| `.ak-tag--research` (new) | `color-mix(in srgb, var(--research) 80%, #eee)` text / `40%` border / `10%` background | Same `color-mix` recipe `.ak-tag--epic` already uses at its own hue — idiom-consistent, not reinvented. |
| `.ak-tag--research-open` (new) | `animation: ak-research-pulse 2.2s ease-in-out infinite` (opacity 1↔0.5), `@media (prefers-reduced-motion: reduce)` → animation off | Distinguishes in-flight from done without a new color (color alone doesn't carry the state at a glance; motion does, briefly). |

No existing token is modified. `PIPELINE_ROLES` is untouched (stays 4); `ROLE_COLOR`/`ROLE_LABEL` gain an additive `research` key.

---

## 3. State table

| # | State | Chip text | Hue | Motion | Title/aria |
|---|---|---|---|---|---|
| 1 | No research comment on the ticket | (chip absent entirely) | — | — | — |
| 2 | ≥1 research comment, **none** carry `closedAt` (open/in-flight) | `RESEARCH` | `--research` violet | opacity pulse (`ak-research-pulse`) | `"RESEARCH — in flight"` |
| 3 | ≥1 research comment, **all** carry `closedAt` (closed) | `RESEARCH` | `--research` violet (static) | none | `"RESEARCH — done"` |

Absence (state 1) is the graceful-missing-data case — no empty pill, no dangling separator, byte-identical to the pre-#1516 card for any ticket without a research row.

---

## 4. Idiom consistency

- Shape: `.ak-tag` pill (5px radius, `--font-mono`, existing padding) — the SAME shape as `.ak-tag--epic`, not a new component.
- Placement: right side of the card top row, alongside the existing role pips — both are "at-a-glance status" chips, so they share the same visual neighborhood.
- Motion: opacity-only, 2.2s ease-in-out, matches the board's existing "still working" pulse *cadence* (`ak-pulse` is 2s, `ak-working-pulse` 1.7s) without borrowing their `scale()` transform, which is tuned for a different element geometry (round dot / left-rail bar, not a text pill).

---

## 5. §RUBRIC — `ui-evolve` scores REAL 390px phone + desktop screenshots

Five axes, each **0–4**. **ACCEPT: total ≥ 16/20 AND no single axis < 3.** Score from captured pixels against fixtures, not from code.

| # | Axis | 0 | 2 | 4 |
|---|---|---|---|---|
| **R1** | **Legibility @ phone (390px)** | chip text illegible or clipped | legible but cramped against the pips | chip renders crisp at mono-9px scale, does not crowd or clip the existing pips span, on both a clean card and a card with epic+pips+research together |
| **R2** | **Honesty — open vs closed distinguishable** *(load-bearing)* | open and closed research states look identical | pulse present but too subtle to notice in a still frame comparison | an open-research fixture and a closed-research fixture are visually distinguishable in a single still screenshot (opacity delta captured mid-cycle), and neither is confusable with "no research at all" |
| **R3** | **Non-crowding of the top row** | chip breaks `.ak-card__top`'s right alignment or pushes the pips off-row | pips still right-aligned but visually cramped/touching | `#<id>` stays left, pips + research chip stay right-aligned as one group, matching the pre-#1516 two-child layout exactly when research is absent |
| **R4** | **Idiom consistency** | new shape/font/radius foreign to the board's tag system | close but a visible mismatch (wrong radius, wrong font, wrong hue family) | chip is visually indistinguishable in SHAPE from `.ak-tag--epic` (same pill), uses `--font-mono`, and its violet hue is clearly a new-but-related member of the board's existing tag-hue family |
| **R5** | **Contrast & graceful absence** | chip text fails AA, or an absent-research card shows any artifact (empty tag, stray separator) | contrast borderline, or absence is clean but the wrapper adds unwanted spacing | chip text clears WCAG AA (measured, not guessed) and a research-less card is pixel-equivalent to the pre-#1516 render |

**Regression guard (pass/fail, NOT scored — must all pass):**
1. A research-less ticket's card top row is unchanged from the pre-#1516 baseline (no stray wrapper spacing, no empty chip).
2. The four-role pipeline pips are unaffected in shape/position whether or not a research chip is present.
3. `prefers-reduced-motion: reduce` disables the pulse (no motion-sickness regression).

---

## 6. Summary for ui-evolve

Score the chip exactly as built: a violet `.ak-tag`-shaped pill, right-aligned alongside the pips inside the new `.ak-card__top-right` wrapper, pulsing (opacity only) while any research comment on the ticket lacks `closedAt`, static once all are closed, and entirely absent when the ticket carries no research comment at all.
