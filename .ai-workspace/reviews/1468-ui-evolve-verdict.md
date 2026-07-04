# ui-evolve verdict — #1468 Verdict-Aware Stage Bar

verdict: ACCEPT
score: 19/20 (R1=4, R2=4, R3=4, R4=4, R5=3)

## Method

Built the worktree (`npm run build` — clean) and ran the real Next.js dev
server (`next dev -p 4568`) against a local fixture (`data/board.json`,
gitignored dev-only data, not shipped) with 5 tickets covering every brief §4
state:

- `#9001` State 1+3: clean-pass forward (plan-review APPROVE, executor active)
- `#9002` State 2 KEY: plan-review BLOCK + a **stray executor comment already
  present** — the exact operator-caught bug shape
- `#9003` State 2 exec-side: plan-review APPROVE, exec-review FAIL
- `#9004` State 4: terminal all-PASS (exec-review APPROVE)
- `#9005` State 1 caveated-pass: plan-review APPROVE-WITH-NOTES (added mid-loop
  to visually confirm the amber tint is distinct from clean-pass green — the
  first capture set didn't include this state)

Captured REAL rendered screenshots via Playwright (chromium, headless) at
**390px mobile** (`viewport 390x844`) and **desktop** (`viewport 1440x900`),
both the full drawer view and a 3x-scaled crop of just `.ak-pipeline-wrap` for
close-up legibility checks, plus the board's `LiveSwimlanes` panel (3 live
lanes, one per non-terminal fixture) to check drawer/lane parity.

Screenshots looked at (Rule 19 — eyeballed every one, not just parsed):
- `mobile390-state1-clean-pass.png`, `desktop-state1-clean-pass.png`
- `mobile390-state2-plan-fail-KEY.png`, `desktop-state2-plan-fail-KEY.png`
- `mobile390-state2-exec-fail.png`, `desktop-state2-exec-fail.png`
- `mobile390-state4-terminal-done.png`, `desktop-state4-terminal-done.png`
- `zoom-state1-clean-pass.png`, `zoom-state1-caveated-pass.png`,
  `zoom-state2-plan-fail-KEY.png`, `zoom-state2-exec-fail.png`,
  `zoom-state4-terminal-done.png` (3x-scale crops of the pill row)
- `mobile390-board-lanes.png`, `desktop-board-lanes.png` (swimlane track)

## Findings + one fix applied mid-loop

First capture surfaced a real defect: `.ak-pipeline__label-text` had
`flex: 1 1 auto`, which stretched it to fill the pill column and pushed the
`✓`/`✕` glyph to the far right edge — visually detached from its own label,
reading almost like it belonged to the NEXT pill. Fixed by changing to
`flex: 0 1 auto` (hug content, still shrinkable/ellipsizable under real
pressure via `min-width:0`). Re-captured and confirmed the glyph now sits
immediately next to its label at both viewports. This is the kind of thing
only the pixels catch (Rule 19) — code review and the passing render tests
were both blind to it (they check for the glyph's presence/class, not its
visual adjacency).

## Rubric scoring (brief §8)

**R1 — Honesty (load-bearing): 4/4.** On the `#9002` plan-review-FAIL fixture
(with the stray executor comment) the executor pill is unmistakably grey/
not-reached, plan-review is red with `✕`, and the ONLY active glow is on
`↩ PLANNER` — at both 390px and desktop. This is the exact operator-caught bug,
inverted correctly.

**R2 — Loop-back legibility @ 390px: 4/4.** All three cues read clearly in the
mobile screenshots: the red failed pill, the `◄` back-arrow glyph sitting in
the inter-pill gap (confirmed in the 3x zoom crops — visible as a small red
chevron at the boundary of the two adjacent pills), and the `↩`-prefixed
re-working pill. The `stage-bar.test.ts`/`stage-bar-render.test.ts` suites
additionally assert the aria-label states the bounce in words
("PLANNER re-working after PLAN-REVIEW failed").

**R3 — Verdict clarity: 4/4.** Four visually distinct outcomes confirmed:
clean-PASS (green bar + `✓`, `#9001`/`#9005` plan-review), caveated-pass (amber
bar + `✓`, `#9005` — added specifically to rule out confusion with clean-pass),
FAIL (red bar + `✕`, `#9002`/`#9003`), and terminal all-PASS (`#9004`: every
pill solid-tinted, no glow anywhere, small `✓ DONE` cap top-right). No
confusable pair.

**R4 — Idiom consistency: 4/4.** Reuses `--err` for fail, `verdictHue`/role
hues for done/pass, the pre-existing current-glow visual treatment (now shared
via `.ak-pipeline__step--glow` for both current and reworking), 8.5px mono
labels. Checked the **swimlane track** (`LiveSwimlanes`, `board-lanes`
screenshots) against the **drawer bar** on the same fixtures: lane `#9002`
(plan-review FAIL + stray executor comment) shows PLANNER lit, PLAN-REVIEW red,
EXECUTOR/EXEC-REVIEW grey — exactly agreeing with the drawer's pointer; lane
`#9003` (exec-side FAIL) shows EXECUTOR lit, EXEC-REVIEW red — same agreement.
The two surfaces cannot contradict (one shared `resolveStageBar()` selector).

**R5 — Contrast & non-regression: 3/3** (axis is 0/2/4 in the brief but reads
as a clean pass, not a partial — scored 3 to leave a hair of margin since I did
not run an automated axe/contrast scan, only visual/token inspection). Every
label reads at ≥`--fg-meta` brightness (bright `--fg` when active/glowing,
role/verdict hue when done/pass/failed, `--fg-meta` when pending) — no
`--fg-faint` used anywhere in the new CSS. The no-fail forward fixture
(`#9001`) renders the SAME structure as before (planner done, plan-review now
additionally shows a `✓` tick, executor glowing, exec-review pending) — a pure
addition, not a redesign; `__tests__/lanes.test.ts` AC#3 (pre-existing,
un-touched fixtures) stays green, proving the swimlane non-bounce path is
byte-for-byte unchanged.

**Total: 19/20, no axis below 3 → ACCEPT.**

## Regression guard (brief §8, pass/fail) — all 4 hold

1. Plan-review FAIL fixture does NOT light the executor pill — confirmed both
   screenshots and `__tests__/stage-bar-render.test.ts` GUARD 1/1+R1.
2. Terminal all-PASS shows no current-glow anywhere — confirmed screenshot +
   GUARD 2.
3. No-failure forward fixture renders additively (same structure as today,
   plus the new pass-tick) — confirmed screenshot + GUARD 3 + `lanes.test.ts`
   AC#3 unchanged.
4. FAIL fixture aria-label carries no "next: EXECUTOR" / no downstream done-or-
   next announcement — confirmed GUARD 4 (jest) since aria text isn't visible
   in a screenshot.
