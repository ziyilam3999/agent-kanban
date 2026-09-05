# Plan: Fold front screen pans the whole console sideways — long lane IDs overflow the phone tier and the page clamp is body-only

**Task**: `agent-kanban-portrait-overflow-fold-front-screen-misclassified-as-phone`
**Repo**: agent-kanban (PUBLIC) — base `origin/master` @ `0b275b0`
**Role**: planner (root-cause ritual: Understand → Save → Fix plan → Bake). Not implemented here; reviewed by an independent plan-review.
**cairn:** `[T2] hive-mind-persist/session-notes/2026-06-10-727980432.md:9 — "When a flex-wrap tile grid has a fixed-height container with overflow:hidden, cap the tile count to what fit…"` (query `overflow` → that one relevant hit; `foldable` / `viewport` / `breakpoint` / `horizontal` → no hits within a 50 s bound; the primary clone's cairn persist root is absent (sparse checkout), so a worktree copy of the store was searched).
**project-index:** `.ai-workspace/PROJECT-INDEX.md` (skeleton 2026-08-28) lists `docs/fold8-4x3-design-brief.md`, `docs/fold8-4x3-fable-critique.md` and the three fold8 plans as CURRENT — all read.
**Design leg (UI gate leg 1):** `docs/fold8-4x3-design-brief.md` (+ `docs/fold8-4x3-fable-critique.md`): tiers keyed on the board's own inline size, never viewport width. This plan extends that POV to the Live Swimlanes panel and adds the root-level "the page can never pan sideways" contract.

## ELI5
The board has a "live lanes" panel listing the tickets being worked on right now, each with its ticket ID. IDs used to be short numbers; now they are long names (up to 80 letters). The lane ID is told "never wrap, never shrink", so on a phone-width screen — which is what the Fold's front screen is — a long name pokes about 200 px past the right edge. The page's safety net ("no sideways scrolling") sits only on `body`; on phones the browser still lets a finger drag the whole page sideways over that spill, so the header pills and the meter slide off-screen. The middle sizes (the 640-1023 px tiers built in PRs #73-#75) do not scroll — the app shell clips them — but there the long ID draws underneath the stage track, which looks broken. Tests never caught any of this because the test board uses IDs like "900". The fix: let the ID shrink the way the subject already does, tier the lanes panel on the board's width, put the sideways-scroll safety net at the document root, make the test board look like the real one so the guard has teeth, and run that guard in CI.

## Root cause (Understand)
Verified against head `0b275b0` with a headless Playwright probe (mobile emulation, DPR 2.6, real CDP touch), not from the bug-report prose. The brief's cited CSS line numbers (853 / 763 / 393) match the pre-#73 file; on head those rules sit at 914 / 824 / 424 and container-query tiers plus a shell clamp already exist.

Candidates considered, with evidence:
- **(A) "The single 640 px breakpoint misclassifies the ~750 px near-square canvas as a phone, desktop lane rows overflow, the page scrolls."** Ruled out as the cause of the pan on head. At 640×1000, 672×850, 750×832, 750×1000, 832×750, 899×1000, 900×1000, 1000×750, 1023×1000 and 980×2000: page overflow = 0 px and `visualViewport.offsetLeft` stays 0 after a real horizontal touch drag on the lanes area — the #73-#75 shell clamp (`.ak-app`/`.ak-main` overflow hidden in those tiers) contains the panel. Residual real defect in that band: the lanes panel has no mid-tier rule (only the `max-width:640px` stack), so a 71-char ID draws underneath the 4-stage track (750×832 render: ID text runs under the PLANNER pill). Cosmetic, not a scroll.
- **(B) "Overflow is not contained at the html level."** Contributing — this is the pan mechanism. With `body{overflow-x:hidden}` only: at 390×844 with long IDs `scrollingElement.scrollWidth` = 588 vs `clientWidth` = 390; `window.scrollX` stays 0 (layout viewport clamped) but a real horizontal touch drag — or a wheel — pans the VISUAL viewport by exactly the overflow: `visualViewport.offsetLeft 0 → 198` (412×915: `0 → 176`). The post-drag screenshot shows the header pills and the TODO/PROG meter tiles pushed off the left edge — the operator's picture. Injecting an html-level clamp brings overflow and pan to 0 with the long ID still present.
- **(C) "A non-truncating lane token generates the overflow."** Root — the source. `.ak-lane-id` is nowrap with no shrink/clip (the sibling `.ak-lane-subject` has min-width:0 + ellipsis). Real board snapshot of 2026-08-28 (numbers only): 1361 tickets, in_progress IDs up to 71 chars, longest ID 80, 120 IDs over 40 chars, 225 non-numeric, longest spaceless subject token 105. A 71-char ID renders ~545 px wide and escapes its row at any canvas under ~560 CSS px — the phone tier, i.e. the Fold's FRONT (cover) screen (~390-412 CSS px). Corroboration: the operator saw the PROG/REVIEW/DONE stat tiles, which are visible only below 640 or at/above 1024 (the 640-1023 band swaps them for the 6 px bar). With numeric IDs (the fixture's "900") overflow is 0 at every cell — the class was invisible to every existing guard.
- **(D) Why three rounds of guards were blind.** Fixture token shape (numeric IDs) ≠ production (slug IDs); the interaction checks read `scrollLeft` deltas, which stay 0 under a visual-viewport pan — the wrong unit; and CI runs only `typecheck` + jest, so no Playwright guard runs on a PR at all. The Rule-19 eyeball (post-drag screenshot) exposed what the metric denied.

Conclusion: root = (C); (B) turns it into a page pan on a phone; (A)'s residual (un-tiered lanes panel) is folded in because it is the same element failing the same way in the near-square band; (D) is why it shipped three times.

## Intent (what & why — never how)
**What**
1. No lane ID up to the real board's 80 chars can draw outside its lane row at any canvas width ≥ 360 px.
2. The page can never be panned or scrolled horizontally, even if some future element overflows: containment is a document-root invariant, not only a `body` property. Vertical page scroll on the phone tier is unchanged.
3. The Live Swimlanes panel adapts by the board's own inline size (the design brief's container-query POV): in the 640-1023 band the ID/subject never overlap the stage track; below that it stacks as today.
4. The shared test board can carry production token shape (71- and 80-char in_progress IDs, a 105-char spaceless subject token) so overflow guards have power.
5. A mechanical guard spec asserts zero page-level overflow and zero visual-viewport pan across a phone / near-square / desktop matrix — RED on head, GREEN after — and runs on every PR in CI, not only on a developer's machine.

**Why**: the operator's Fold front screen slides the whole console sideways; the board's own doctrine (the telemetry-console "no horizontal overflow" rule cited throughout `app/globals.css`) says this must never happen; and PRs #73-#75 proved that a guard whose fixture cannot produce the failure — or that never runs in CI — protects nothing.

## Design commitments (frontend-design POV, extends the fold8-4x3 brief)
- Flight-recorder identity untouched: phosphor on ink, mono telemetry, hue rails; no new chrome.
- A lane's ID is an address, not a sentence: it truncates with an ellipsis exactly like the subject; the full ID remains available (card, drawer, hover title). The lit stage is the signal.
- The lanes panel is part of the board, so it tiers on the board's container width like the columns do — no orientation code path, no viewport rule for an element that lives inside the query container. (BoardView renders `.ak-lanes` inside `<main class="ak-main">`; the stale globals.css comment near L1655 claiming otherwise is wrong and should be corrected in the same change.)
- Horizontal containment is a root-level invariant.
- Rejected: JS-side ID abbreviation (hides data, adds logic); `overflow-wrap:anywhere` on the ID (a 71-char slug becomes three lines per lane — census loss); widening the lane head for long IDs (pushes the track off the row).

## Scope boundary
In scope: the lanes panel, root-level containment, the shared fixture, the new guard spec, its CI wiring, and the evidence files. Unchanged: the board column tiers (phone strip, portrait 2-up paging, landscape/desktop 4-up are LOCKED per `.ai-workspace/plans/2026-08-26-fold8-portrait-2col-paging.md`), card layout, data/schema, the 640 px header-wrap rule.

### Binary AC
**Production-shaped board** (input to AC-1..AC-5): ≥ 2 live lanes whose in_progress ticket IDs are 71 and 80 chars, plus a card subject containing a 105-char spaceless token. The spec asserts those lengths on its own payload before measuring, so a quietly shortened fixture fails loudly (the oracle must be able to vary).
**Matrix M** = {390×844, 412×915, 640×1000, 672×850, 750×832, 750×1000, 832×750, 900×1000, 1024×800, 1200×800}; cells under 1024 wide run with `hasTouch`, `isMobile`, DPR 2.6.

- **AC-1 — Zero page-level horizontal overflow.** At every cell in M with the production-shaped board: `document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth`. RED on `0b275b0` at 390×844 (588 vs 390) and 412×915 (588 vs 412); GREEN at every other cell (controls that must stay green).
- **AC-2 — Real interaction: the page cannot be panned (UI-gate leg 3).** At 390×844, 412×915 and 750×1000: after a real CDP horizontal touch drag across the lanes panel (|dx| ≥ 50 % of the width) and, separately, after a horizontal wheel over it, `window.visualViewport.offsetLeft === 0`, `window.visualViewport.pageLeft === 0`, and the "N LANES LIVE" pill's bounding box lies within [0, innerWidth]. RED on `0b275b0` at 390 (offsetLeft 198) and 412 (176); 750×1000 is a green control. Marker file `.ai-workspace/reviews/agent-kanban-fold-portrait-overflow-interaction-test.md` carrying the gate's structured fields: `interaction-test:` header, `asserts=scroll-delta`, `viewport=390x844 touch=true`, `red-on-prefix=<the new spec run against 0b275b0>`, `result=PASS`.
- **AC-3 — Root-level containment, independent of the ID fix.** At 390×844 and 750×1000, with a test-injected 600 px-wide non-shrinkable element appended inside `.ak-lanes` (a stand-in for any future overflow generator), a horizontal touch drag still leaves `visualViewport.offsetLeft === 0`. RED on `0b275b0` at 390 (the body-only clamp pans); 750×1000 is a green control. Vertical reachability at 390×844 stays green (a below-fold card is still reached by a real swipe — the existing reachability check).
- **AC-4 — Lane ID stays inside its row and never overlaps the track.** At every cell in M: each `.ak-lane-id` bounding box has `right <= its .ak-lane-row box right + 1` AND intersects no `.ak-lane-track` box. RED on `0b275b0` at 390/412 (ID right 539 vs row right 369) and at 672×850, 750×832, 750×1000, 832×750, 900×1000, 1024×800, 1200×800 (ID drawn under the track); 640×1000 is a green control (stacked).
- **AC-5 — Tier selection unchanged with the production-shaped board.** 390×844 → phone strip (`.ak-board` display flex, exactly 1 fully visible column, lanes stacked, `.ak-meter` visible); 750×1000 → portrait 2-up paged tier (the paging plan's AC-1 assertions pass with THIS board); 1200×800 → 4-up grid (`.ak-board` display grid, 4 columns fully visible, `.ak-dots` hidden). Control: green today, must stay green.
- **AC-6 — No regression.** Full existing Playwright suite green (fold8-portrait-2col-paging, fold8-4x3-grid-tiers, fold8-scroll-reachability, fold8-uiux-redesign, live-swimlanes, lane-reveal, drawer-*); `npm run typecheck` and `npm test` exit 0; the numeric-ID board at 390×844 and 1440×900 stays green (hold-out: the guard must not fire on short IDs); the locked landscape 4-up assertions unchanged.
- **AC-7 — Both-ends evidence on file.** `.ai-workspace/reviews/agent-kanban-fold-portrait-overflow-red-evidence.md` records the new spec run against pre-fix `0b275b0` with each RED arm named (AC-1/2/3/4 cells and numbers) and the all-green run at PR head.
- **AC-8 — UI 3-leg gate artifacts.** (a) design_brief = `docs/fold8-4x3-design-brief.md` plus this plan's Design commitments; (b) a FRESH ui-evolve verdict file with `verdict: ACCEPT` and a rubric score, judged on real renders at 390×844 and 412×915 (≥ 2 lanes with long IDs, captured after a horizontal drag), 750×1000 (both pages) and 1440×900 — no regression against the paging round's 7.5/10 on the portrait shots; (c) the AC-2 interaction marker. The task completion cites all three paths.
- **AC-9 — Public-repo privacy.** CI privacy job green; no home-path or blob-host token in any new or changed file.
- **AC-10 — The guard runs in CI (the Bake is not opt-in).** The PR's CI run includes a job that executes the new guard spec headless (chromium only, `PW_WEB_SERVER=1`, the production-shaped board) and that job is green on the PR head; on a scratch branch that reverts only the fix, the same job is red. Cost bound: one project, one spec, ≤ 3 min. Making the job a required status check is a branch-protection (repo setting) decision — see Deferred follow-ups.

## Rule-17 both-ends oracle
RED corpus on `0b275b0` with the production-shaped board: AC-1 @ 390/412; AC-2 @ 390/412; AC-3 @ 390; AC-4 @ 390/412/672/750(×2)/832/900/1024/1200; AC-10's revert-branch run. GREEN controls that must not move: AC-1 @ 640..1200; AC-2/AC-3 @ 750×1000; AC-5; numeric-ID hold-outs; the landscape lock. The executor runs the new spec once against `0b275b0` (expect exactly the RED members above) and once at PR head (expect all green), and files AC-7.

## Load-bearing assumptions (honest)
1. The visual-viewport pan measured in mobile-emulated headless Chromium is the same class as the pan in the operator's screenshot. The fix does not depend on engine parity: both stop once the page has no horizontal overflow. The html-level containment result (pan 0 with overflow still present) was measured in Chromium only — AC-3 is the guard, the operator's device the confirmation.
2. The operator's front screen is in the phone tier (< 640 CSS px). If device ground truth shows ≥ 640, AC-4's band arm is the operative fix and AC-1..3 remain valid — M covers both.
3. Real-device confirmation is the operator's (the ui-evolve renders are Chromium).
4. CI can install Playwright's chromium within the repo's minute budget (the workflow was just trimmed to ubuntu-only to save minutes; AC-10's cost bound keeps the addition proportionate).

## Deferred follow-ups:
- Make the AC-10 CI job a REQUIRED status check (branch protection is a repo setting, operator-owned) — DEFERRED to the operator; → file when the job has run green on ≥ 1 merged PR.
- Automated real-device (Samsung browser) pan check — none; the operator's device confirmation is the last leg and no device farm is in scope.
- Long-token audit of the card and drawer surfaces (a 105-char spaceless subject token) beyond what AC-1 already measures at every cell — → file a task only if AC-1 ever fails outside the lanes panel.
- Ai-brain-side mechanical check that overflow-guard fixtures carry a production-length token — → file when a second repo hits the same class (one sighting so far; the cairn stone placed 2026-09-05 is the first record).

## Executor notes (mechanics allowed here — the AC matrix is the contract)
- The planner's scratch probe specs (`_probe.e2e.spec.ts`, `_probe2.e2e.spec.ts`, paths in the planner's report; never committed) hold reusable measurement helpers: `visualViewport` readout, a leaf-most overflowing-element lister, the real-touch drag from `e2e/fixtures/touch.ts`. A post-drag `page.screenshot()` captures the visual viewport and doubles as eyeball evidence.
- `.ak-lane-subject` already carries the shrink+ellipsis pattern; `.ak-lanes` is inside `.ak-main` (container-queryable) with the same 640 / 900 boundaries the board tiers use.
- Extend `e2e/fixtures/board-fixture.ts` with an opt-in production-shaped option; existing callers stay byte-for-byte unaffected.
- The board tiers are locked — the change surface is the lanes panel, root containment, the fixture, the new spec, the CI job and the evidence files.

## Execution model
Knob A = `delegate` (one worktree, one coherent surface). Knob B = `both`: the new spec is the test oracle for AC-1..AC-7 and AC-10; independent execution-review plus the ui-evolve vision judge carry AC-8.

## Critical files (informative, not prescriptive)
`app/globals.css`; `e2e/fixtures/board-fixture.ts`; new `e2e/fold-front-screen-overflow.e2e.spec.ts`; `.github/workflows/ci.yml`; `.ai-workspace/reviews/agent-kanban-fold-portrait-overflow-{red-evidence,interaction-test}.md`; `.ai-workspace/design/screens-agent-kanban-fold-portrait-overflow/`; the ui-evolve verdict file.

## Review

Decision: PASS

Independent, adversarial plan-review (did NOT author this plan). Full write-up:
`.ai-workspace/reviews/agent-kanban-portrait-overflow-fold-front-screen-misclassified-as-phone-plan-review.md`.

Every load-bearing premise reproduced directly from `origin/master` @ `0b275b0` source (not the plan's narrative):
- Root mechanism (C) CONFIRMED: `app/globals.css` L815-822 `.ak-lane-id { white-space:nowrap }` with no overflow/ellipsis/min-width/shrink; sibling `.ak-lane-subject` (L824-832) has the full truncation combo; `LiveSwimlanes.tsx` L48 renders `#{lane.id}` raw.
- Pan mechanism (B) CONFIRMED: `body` L101 `overflow-x:hidden`, `html` L86-90 none → body-only clamp (visual viewport pans).
- Mid-tier gap (A) CONFIRMED: only base + `max-width:640` lane rules exist; no 640-1023 lane rule.
- 640-1023 containment CONFIRMED: shell clamp L1712-1739 sets `overflow:hidden` on ak-app/main/board → mid cells contained (correct GREEN controls).
- Design leg sound: `BoardView.tsx` L463-465 renders `.ak-lanes` INSIDE `<main class="ak-main">` → container-queryable; the ~L1655 comment is stale, correctly flagged.
- Blind-guard cause (D) CONFIRMED: `board-fixture.ts` builds lanes `id:\`90${i}\`` (numeric); CI (`ci.yml`) has NO Playwright (typecheck+jest+privacy only).
- Meter corroboration CONFIRMED with correct hedge: `.ak-meter` visible <640 AND ≥1024, hidden 640-1023 (symmetric — plan does not over-claim, assumption #2 keeps band arm valid).

Adversarial verdict: mechanism re-classification is right (not a wrong-tier fix); guard has teeth both-ends (production 71/80-char id shape + 105-char token, self-asserts payload lengths, RED@390/412 + GREEN@750×1000 + revert-branch RED control, installed IN CI); AC-2 uses the visual-viewport unit not scrollLeft (dead control); all AC-1..AC-10 are binary; UI 3-leg gate coherent with the container-query brief; locked 640-1023 tiers not regressed; privacy scan of this plan clean (`command grep`, home-path/blob-host rc=1, positive control matched).

Monotonicity: root clamp vs body clamp consonant (root is superset; vertical-scroll erasure guarded by AC-3 + AC-6); lane-id truncation additive on one element; 640px boundary double-fire guarded by AC-5's 640×1000 stacked control.

Named-risk note carried DURABLY to execution-review (registered via named-risk-notes): AC-2's marker `asserts=scroll-delta` is gate-vocabulary only — the ACTUAL assertion must be `visualViewport.offsetLeft/pageLeft===0` under a real horizontal CDP touch drag reproducing RED offsets 198@390/176@412, NOT a scrollLeft delta. Execution-review must read the spec to confirm the unit. Non-blocking executor notes: touch.ts is vertical-only (extend to horizontal); 640px boundary keying; AC-10 job is not a required status check until branch protection (operator-deferred).

No blocking findings.

Decision: PASS
