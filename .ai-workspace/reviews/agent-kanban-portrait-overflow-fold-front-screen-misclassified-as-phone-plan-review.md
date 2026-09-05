# Plan-review — Fold front-screen portrait overflow (mechanism re-classified as phone-tier)

**Plan reviewed:** `.ai-workspace/plans/2026-09-05-agent-kanban-fold-portrait-overflow.md`
**Base:** `origin/master` @ `0b275b0`
**Role:** plan-review (independent, adversarial; did NOT author the plan)
**Route note (visibility only):** seat declares `subprocess-openrouter`; running via Agent-tool FALLBACK is expected/sanctioned under the mode pin (openrouter forbidden). Does not affect the verdict. `[route-dispatch-fallback-ok]`

Decision: PASS

## What I verified against actual source (not the plan's narrative)

Every load-bearing premise reproduced directly from `git show origin/master:*`:

1. **Root mechanism (C) — CONFIRMED.** `app/globals.css` L815-822 `.ak-lane-id { white-space: nowrap; }` with NO `overflow`, NO `text-overflow`, NO `min-width:0`, NO flex-shrink. Its sibling `.ak-lane-subject` (L824-832) carries the full `min-width:0; overflow:hidden; text-overflow:ellipsis` truncation combo. `components/LiveSwimlanes.tsx` L48 renders `#{lane.id}` raw into that non-shrinking span. So a long slug id escapes its row — exactly as claimed.
2. **Pan mechanism (B) — CONFIRMED.** `body` (L101) has `overflow-x:hidden`; `html` (L86-90) has NONE. The clamp is body-only → the visual viewport can still pan on a touch device (the planner's measured `offsetLeft 0→198`/`0→176` is consistent with this structure; the layout viewport stays clamped, `scrollWidth` still reports the overflow, hence AC-1 RED 588-vs-390).
3. **Mid-tier lane gap (A residual) — CONFIRMED.** The ONLY `.ak-lane-*` rules are the base block (L797-855) and the `@media (max-width:640px)` stack override (L941/949). There is NO lane rule in the 640-1023 band → a long id draws under the 4-stage track there (cosmetic, not a page pan).
4. **640-1023 containment — CONFIRMED.** The OR-gated shell clamp (L1712-1739) sets `overflow:hidden` on `.ak-app`/`.ak-main`/`.ak-board` for `(900-1023.98)` OR `(640-899.98 portrait)` OR `(768-899.98 landscape)`. Every mid cell in matrix M lands in one of those arms → page overflow/pan contained → AC-1/AC-2 GREEN controls at 640+ are correct.
5. **Design-leg is structurally sound — CONFIRMED.** `components/BoardView.tsx` L463-465 renders `<LiveSwimlanes>` INSIDE `<main className="ak-main">`. So `.ak-lanes` IS a descendant of the `.ak-main` query container and CAN be `@container`-tiered on the board's inline size. The stale globals.css comment at ~L1655 (claiming `.ak-lanes` is OUTSIDE `.ak-main`) is indeed factually wrong; the plan flags it for correction.
6. **Why 3 guard rounds were blind (D) — CONFIRMED.** `e2e/fixtures/board-fixture.ts` builds live lanes as `id: \`90${i}\`` — short numeric ("900","901"). Numeric ids never overflow → the whole class was invisible to every existing fixture.
7. **Meter corroboration — CONFIRMED (with correct hedge).** `.ak-meter` stat tiles = `display:grid` at base (visible <640 AND ≥1024), `display:none` in the 640-1023 block (L1757), replaced by `.ak-meterbar` (L1761). So the operator seeing PROG/REVIEW/DONE tiles rules OUT the 640-1023 band but is symmetric between phone (<640) and desktop (≥1024). The plan does NOT over-claim: assumption #2 explicitly keeps AC-4's band arm valid and M covers both if device ground-truth is ≥640.
8. **CI has no Playwright — CONFIRMED.** `.github/workflows/ci.yml` runs typecheck + jest + commit-lint + a real `privacy` job only. So AC-10 (wire the guard INTO CI) is load-bearing: without it the guard would be shipped-but-not-installed = zero protection. A real privacy job exists, so AC-9 references a live checker.
9. **Design brief + real-touch fixture exist — CONFIRMED.** `docs/fold8-4x3-design-brief.md` present on master; `e2e/fixtures/touch.ts` drives an engine-level CDP `Input.dispatchTouchEvent` drag.

## Adversarial checks (the ones that matter for this class)

- **Corrected mechanism is RIGHT.** The ticket's 750px/`max-width:640` single-breakpoint story does not reproduce on head (post #73-#75 shell clamp contains the mid band). The real page-pan is the phone tier (390-412) via lane-id no-shrink + body-only clamp. The plan's re-classification is correct and the ticket's stale line numbers (853/763/393) do not match head. **Not a wrong-tier fix.**
- **Guard has teeth, both-ends.** Production-token-shape fixture (71/80-char ids + 105-char spaceless token), and the spec asserts those lengths on its OWN payload before measuring (a quietly shortened fixture fails loudly — oracle can vary). AC-1 (`scrollWidth<=clientWidth`) + AC-2 (visual-viewport pan) are proven RED on `0b275b0` at 390/412 with GREEN control at 750×1000; AC-10 adds a revert-only scratch-branch RED control and installs the job IN CI. This closes the numeric-fixture blind spot AND the not-in-CI gap that let it ship 3×.
- **Correct oracle UNIT.** AC-2 asserts `visualViewport.offsetLeft===0`/`pageLeft===0` — the visual-viewport unit, NOT a `scrollLeft` delta (the dead control the plan itself names in root-cause D). The named RED offsets (198@390, 176@412) are visual-viewport values, so AC-7's both-ends run structurally forces the correct unit.
- **Every AC is BINARY.** AC-1..AC-10 each reduce to a command/geometry/file-presence assertion (scrollWidth compare, bounding-box geometry, tier display/count, exit codes, marker fields, CI job green/red). No prose-judgment AC. The irreducibly-subjective piece (is the design actually good) is correctly delegated to the ui-evolve vision judge in AC-8, not smuggled into a binary AC.
- **UI 3-leg gate coherent.** Design leg extends `docs/fold8-4x3-design-brief.md`'s container-query POV (tier on board inline-size, not viewport width); AC-8 requires a fresh ui-evolve ACCEPT + score with no regression vs the paging round's 7.5/10; AC-2 doubles as the real-interaction leg. Board column tiers are explicitly LOCKED (scope boundary) and AC-6 holds the full existing suite + landscape lock green.
- **Privacy (PUBLIC repo).** AC-9 mandates the CI privacy job green + no home-path/blob-host token; fixture id lengths are carried as NUMBERS and needles are runtime-built synthetic (no real id string, no employer-brand token). I scanned the plan file itself (`command grep -nE`, wrapper-immune): home-path rc=1 clean, blob-host rc=1 clean, positive control (a synthetic home-path-shaped fixture string, redacted here — this repo's own CI privacy gate hard-fails on that shape in ANY tracked file) matched (clean result is real, not a false-absence).

## Monotonicity checklist (#1590)

- **Root clamp (stronger: html-level containment) vs body clamp (weaker):** consonant, same direction (no horizontal pan). Root is a superset; body cannot erase it. AC-3 proves root containment independently of the id fix (injected 600px element). Vertical scroll is the one thing a root `overflow-x` could wrongly erase — explicitly guarded by AC-3's vertical-reachability arm + AC-6's fold8-scroll-reachability suite. OK.
- **lane-id truncation (stronger: add overflow:hidden+ellipsis+min-width:0) vs existing nowrap (weaker):** additive on ONE element (the standard truncation combo, identical to `.ak-lane-subject`). No last-writer conflict — nowrap alone cannot un-clip an element that also has overflow:hidden. OK.
- **New mid-tier lane @container rule (640-1023) vs the max-width:640 stack:** disjoint ranges except the exact 640px boundary (both fire; source order decides). AC-5's 640×1000 GREEN control (stacked) catches an accidental un-stack at the boundary. OK.

## Named-risk note carried to execution-review (NOT a blocker)

**NR: interaction-marker vocabulary vs the real assertion unit.** AC-2's interaction-test marker declares `asserts=scroll-delta` because the `ui-task-gate.sh` vocabulary has no "visual-viewport-pan" token — that field satisfies the *mechanical* gate. But a literal `scrollLeft`-delta implementation is the DEAD control this entire plan exists to kill (root-cause D). The marker token alone cannot distinguish the two. Execution-review MUST read the actual spec and confirm it asserts `window.visualViewport.offsetLeft/pageLeft === 0` under a REAL horizontal CDP touch drag, reproducing the named RED offsets (198@390, 176@412) on `0b275b0` — NOT a `scrollLeft` delta (which stays 0 and would ship a toothless guard). Registered durably (named-risk-notes) so any execution-review vantage discovers it.

## Non-blocking notes for the executor

1. `e2e/fixtures/touch.ts`'s `touchDragAt` is currently VERTICAL-only (moves `y`, `x` fixed). AC-2 needs a HORIZONTAL drag — extend the helper (or add a sibling) to sweep `x` by `dx`; do not assume a horizontal helper already exists.
2. At the exact 640px boundary the `max-width:640` (inclusive) stack rule and any new `min-width:640` mid-tier rule both fire — keep the new lanes tier keyed so 640 stays stacked (AC-5's 640×1000 control is the guard).
3. AC-10 installs the guard job in CI but making it a REQUIRED status check is branch-protection (repo setting, operator-owned) — the plan correctly defers this; note that until then a RED guard job does not itself block a merge (red CI ≠ merge gate).
4. Reviewer/executor artifact paths must be worktree-absolute so they ship with the PR (#861) — this review is written to the repo-relative reviews path per the dispatch contract.

## Verdict

The mechanism correction is right, verified at source. The Binary AC is genuinely binary and both-ends (RED corpus + GREEN controls + revert-branch control + fixture-length self-assertion). The guard's blind spots (numeric fixture, wrong unit, not-in-CI) are each closed. Design leg is coherent with the container-query brief and does not regress the locked 640-1023 tiers. One durable named-risk note carried to execution-review (assertion unit), plus mechanics notes. No blocking findings.

Decision: PASS
