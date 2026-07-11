# ui-evolve verdict — #1516 research-seat card chip

**verdict: ACCEPT**

- **Total: 19 / 20** (threshold: ≥16/20 AND no axis <3 — cleared)
- Scored against the design brief's §5 rubric (`.ai-workspace/design/1516-research-chip-brief.md`), from REAL Playwright screenshots (Node `playwright-core` 1.61.1, headless Chromium) of the app running locally (`npm run dev`, `http://localhost:3000`) against a fixture at `data/board.json` (gitignored local-dev override) carrying three deliberately chosen cards: `#301` (EPIC tag + full 4-pip pipeline + an OPEN research chip — the crowded stress case), `#302` (research-only ticket, CLOSED research row), `#303` (no research comment at all — the graceful-absence baseline).

## Per-axis scores (0–4 each)

| # | Axis | Score | Evidence |
|---|---|---|---|
| R1 | Legibility @ phone (390px) | **4** | `screens-1516/mobile-board-t0.png` — on `#301` (the crowded card: `EPIC` tag + `RESEARCH` chip + 4-pip pipeline dots, all on one card) every element renders crisp at mono scale with no clipping or overlap; `#302`'s standalone `RESEARCH` chip and `#303`'s chip-less baseline are equally legible. |
| R2 | Honesty — open vs closed distinguishable *(load-bearing)* | **4** | Directly measured via `getComputedStyle` (not a guessed still-frame diff): `#301`'s open chip (`ak-tag--research-open`, `animationName: "ak-research-pulse"`) genuinely oscillates opacity across 8 samples at 300ms spacing — `0.698 → 0.918 → 1.000 → 0.923 → 0.711 → 0.531 → 0.510 → 0.649` — while `#302`'s closed chip holds fixed at `opacity: 1, animationName: "none"` for every sample. The two states are unambiguous, live-verified, not merely visually plausible. |
| R3 | Non-crowding of the top row | **4** | `screens-1516/desktop-board.png` + `mobile-board-t0.png`: `#<id>` stays left on all three cards; on `#301` the `EPIC` tag sits below the top row (subject-tag idiom, untouched by this change) while `RESEARCH` + the 4 pips share the right-aligned `.ak-card__top-right` group with visible gap, never touching. `#303` (no research) shows the exact pre-#1516 two-child top-row layout — pips alone, right-aligned, no stray spacing from the new wrapper. |
| R4 | Idiom consistency | **4** | The `RESEARCH` chip is visually the same pill shape/radius/font as the board's existing tag family (compare to the `EPIC` tag on `#301` in the same screenshot — same corner radius, same mono type, same padding rhythm), in a clearly-distinct violet hue that reads as "a new tag flavor," not a foreign element. |
| R5 | Contrast & graceful absence | **3** | Contrast is the plan-pinned, MEASURED token (`--research` #b98ef2 on `--panel` #10161c = 7.12:1 via the actual WCAG relative-luminance formula, comfortably clearing AA's 4.5:1) — not guessed. Docked one point, not zero: `#303`'s absence render was verified by inspection (no empty chip, no dangling separator, pips alone) but I did not capture a byte-for-byte pre-#1516 baseline screenshot of the identical fixture to diff against — the "pixel-equivalent to before" claim rests on code-level reasoning (the wrapper is a no-op when `hasResearch` is false) plus visual inspection, not a mechanical pixel diff. |

## Regression guard (pass/fail, not scored) — **PASS**

- **Research-less card unchanged**: `#303` (`screens-1516/mobile-board-t0.png` / `desktop-board.png`) shows only the pips span, right-aligned, no empty `.ak-tag--research`, no stray `.ak-card__top-right` spacing artifact.
- **Pipeline pips unaffected by chip presence**: `#301` (research present, 4 dots) vs `#303` (research absent, 1 dot) render the identical pip shape/size — chip presence changes nothing about the pips.
- **`prefers-reduced-motion: reduce` disables the pulse**: verified by CSS inspection (`app/globals.css`, `.ak-tag--research-open` block) — the `@media (prefers-reduced-motion: reduce)` override sets `animation: none`, mirroring the existing `ak-pulse`/`ak-working-pulse` reduced-motion overrides already on this board. Not re-verified via a second Playwright pass with `prefers-reduced-motion` emulated (see "Not verified" below).

## Screenshots (this run)

- `.ai-workspace/design/screens-1516/desktop-board.png` — 1280×900, all three fixture cards.
- `.ai-workspace/design/screens-1516/mobile-board-t0.png`, `mobile-board-t1.png` — 390×844, the IN PROGRESS lane (all 3 fixture cards), 1.1s apart.

## Not independently re-verified in this pass

- `prefers-reduced-motion: reduce` was confirmed by reading the CSS rule, not by an emulated-media Playwright screenshot — the rule mirrors an existing, already-shipped board idiom (same media query shape as `ak-pulse`), so this is a low-risk gap, disclosed rather than silently assumed.

## Method note

The standalone `ui-evolve` repo (`~/coding_projects/ui-evolve`) runs a generic, whole-page closed-improvement loop intended for iterating a full page design to a satisfaction bar — out of scope for a single additive card chip. This verdict applies the same discipline the skill embodies (real screenshots, a fixed rubric, an explicit ACCEPT/REVERT gate, a regression guard, and — beyond the #1465 precedent — a live `getComputedStyle` measurement rather than a guessed visual diff for the load-bearing R2 axis) directly against the task's own design-brief rubric (§5), matching plan AC's UI-task gate requirement.
