# Plan — #1468 Verdict-Aware Stage Bar

**Repo:** agent-kanban (PUBLIC) · **Task:** turn the drawer's 4-pill stage bar (and the swimlane track) from a role-presence *progress bar* into a verdict-aware *control-flow gauge*. **Authoritative design POV:** `.ai-workspace/design/1468-stage-bar-verdict-aware-brief.md` (states, tokens, rubric — do not re-derive; build to it). **Ledger tag:** `3ROLE_TASK:1468`.

## ELI5

Imagine four lights in a row that show how a task moves through four helpers: PLANNER, PLAN-REVIEW, EXECUTOR, EXEC-REVIEW. Today a light turns "done" the moment a helper says *anything* — even if the helper said "NO, this is wrong, go back and redo it." So when a review says FAIL (which really means "go back to the planner"), the bar happily lights up the NEXT helper (EXECUTOR) as if everything moved forward. That is a little lie: the board looks prettier than reality.

The fix: each light now shows two facts — *did this helper act?* AND *for reviewers, did they say pass or fail?* When a review fails, the glowing "working now" light jumps **back** to the helper who has to redo the work (with a little `↩` return arrow), the failed review light turns **red** with an `✕`, a small `◄` back-arrow sits between them, and every light after the failure goes **grey** (not "done", not "next"). When everything passes, no light glows and a small `✓ DONE` tag appears — so "finished" stops looking like "executor still running." We make the drawer bar and the little swimlane track use the **same** brain so the two stay consistent, and we reuse the board's existing fail-detector and color helpers instead of inventing new ones.

## Execution model

**subagent (`/delegate`).** Rationale: this is a briefable, single coherent write surface (6 files: `lib/ui-meta.ts` + new selector, `lib/lanes.ts`, `components/Drawer.tsx`, `components/LiveSwimlanes.tsx`, `app/globals.css`, new tests) with the design fully pinned by the brief — above the trivial-skip threshold (3+ files, architectural decision, >10 LOC) so it must NOT be done inline. One executor subagent builds from this plan; a stateless execution-reviewer + ui-evolve (leg 2) close it. Not `parallel` — the surfaces are tightly coupled through the one shared selector (splitting them would fork the pointer logic, the exact anti-goal). Not `lfah` as the sole knob even though a red-first test exists, because the visual/CSS half has no test oracle (Rule 19) — hence knob-B = `both`.

## The bug (precisely)

`components/Drawer.tsx` `PipelineProgress` (L402–432) derives state from role *presence* only: `rolesSeen` → `nextPending` (first unseen) → `doneCount`. A `verdict:"FAIL"` plan-review comment still lands in `rolesSeen`, so plan-review counts DONE, `nextPending` = executor, and the executor pill glows "up next" — even though a fail bounced control **back to planner**. The identical blindness lives in `lib/lanes.ts` `currentStageIndex` (highest-index role seen), which drives `components/LiveSwimlanes.tsx`'s single lit stage. **Both surfaces are in scope** — fix in lockstep, or we replace one lie with two.

## cairn / prior-lessons

`cairn:` hits grounding this plan (quoted, provenance-tagged, home paths omitted per PUBLIC-repo privacy):
- *"When a loop scores two very different designs identically, the verdict system is [broken]."* (T1, 2026-06-17) — the exact failure class: a FAIL scoring identical to a PASS means the gauge is verdict-blind.
- *"Board REVIEW column = review running NOW, so a PASS resolution hops the card back…"* (T1, 2026-07-02, this session) — the same verdict-vs-presence confusion; sibling of the #1403/#1410/#1449 "board prettier than reality" class.
- *"Surface a DERIVED status's REASON at the same glance."* (T1, 2026-06-21) — the design principle: encode *why* (verdict), not just *that* (reached).
- *"Good UI taste is a band, not monotonic restraint: too-busy and too-subtle both score [low]."* (T1, 2026-06-18) — guards the §8 rubric (leg 2): don't over- or under-decorate the loopback cue.

## Reuse enablers (wiring, not new logic — brief §2)

1. Export `WORK_PIPELINE_ROLES` from `lib/ui-meta.ts` (currently module-private, L111) — 1 line. Names the correct work role to bounce the pointer onto; reuses the exact set `phaseLine`/`cardModel` already use.
2. Add a per-review-role latest-verdict lookup (e.g. `latestVerdictForRole(ticket, "plan-review")`) using the SAME last-match scan as `latestReviewVerdict` (L118). Keep `latestReviewVerdict` intact (`phase.test.ts` depends on it) — reimplement it in terms of the new helper OR add alongside. Classify with the SAME `isFailClassVerdict`, tint with the SAME `verdictHue`. No new fail-class regex.

## Architecture (intent, not how)

One **pure selector** in `lib/` (extend `lib/ui-meta.ts` or a new `lib/stage-bar.ts`) is the single source of the control-flow state, consumed by BOTH the drawer bar and `lib/lanes.ts`. It resolves the brief §3 pointer state machine and returns, per pipeline role: `reached`, `verdict?`, and a `look` ∈ {done, pass, failed, current, reworking, pending}; plus container facts: the single `pointer` role (or `null` when terminal), a `terminal` flag, the loopback gap (which adjacent pair carries `◄`), and an honesty `ariaLabel`. Built entirely on `isFailClassVerdict` (bounce test) + `verdictHue` (tint) + the two reuse enablers. `lib/lanes.ts` derives `currentStageIndex` (and a `reworking`/`failedStage` companion) from the same selector, so the lane track and drawer bar stay in agreement (brief §6). `PipelineProgress` becomes a thin renderer over the selector; **export it** (or a wrapper) so the both-ends test can render + inspect it, mirroring `LiveSwimlanes`. Per-pill look → CSS classes in `app/globals.css` reusing existing tokens (`--err` fail, `verdictHue`/role hues for done/pass, the existing current-glow idiom, `--fg-meta` labels — not `--fg-faint`). Loopback `◄` is one absolutely-positioned element in the existing 6px gap (no added layout width, so the row stays within the viewport).

### Binary AC

Each AC is checkable from *outside the diff* (a command's exit code, a grep, rendered-markup tokens, or a verdict file). `<selector>` / `<regr>` = the executor-named new test files.

1. **Reuse enablers present + no forked vocabulary.** `grep -q 'export const WORK_PIPELINE_ROLES' lib/ui-meta.ts` succeeds; a per-review-role latest-verdict function is exported (grep). The fail-class regex stays single: a grep for the regex literal `BLOCK|FAIL|REJECT` across `lib/` + `components/` counts exactly 1 match (the existing `FAIL_CLASS_RE`). The selector references `isFailClassVerdict` and `verdictHue` (grep both).
2. **Single shared selector.** Both `components/Drawer.tsx` AND `lib/lanes.ts` import the same selector symbol (grep the import in each) — no duplicated pointer logic.
3. **Selector states (unit test, `npm test <selector>` exit 0)** — one assertion per brief state:
   a. *clean-PASS forward:* plan-review reached + verdict `APPROVE` → plan-review `look=pass` and its fill = `verdictHue("APPROVE")` = `var(--done)`; planner `look=done`; executor `look=current`; exec-review `look=pending`; `pointer=executor`; `terminal=false`.
   b. *caveated-PASS:* plan-review verdict `APPROVE-WITH-NOTES` → fill = `verdictHue(...)` = `var(--review)` (amber); `pointer=executor` (non-fail ⇒ no bounce).
   c. *FAIL-loopback (plan side), the KEY state:* plan-review verdict `BLOCK` (or `FAIL`) → plan-review `look=failed`; `pointer=planner` (`look=reworking`); executor `look=pending` **even when an executor comment is present**; exec-review `look=pending`; loopback gap = planner↔plan-review; `terminal=false`.
   d. *FAIL-loopback (exec side):* exec-review verdict `FAIL` → exec-review `look=failed`; `pointer=executor` (`reworking`); planner `look=done`; plan-review `look=pass`.
   e. *rework-then-pass self-correct:* plan-review has an earlier `FAIL` then a later `APPROVE` (latest wins) → `pointer=executor`, plan-review `look=pass` (proves "latest verdict per role", not a sticky scar).
   f. *terminal all-PASS:* exec-review reached + non-fail verdict → `terminal=true`; `pointer=null`; every role `look ∈ {done,pass}`; no role's `look` is `current` or `reworking`.
4. **Drawer render + aria honesty (render test via `renderToStaticMarkup`, `npm test` exit 0).** On the plan-review-FAIL fixture: the plan-review pill carries the failed modifier; the same active/glow modifier that marks the single active pill appears on the PLANNER pill and NOT on the EXECUTOR pill; the container `aria-label` does not contain `next: EXECUTOR` (nor announce any downstream role as done/next) and does describe the bounce (e.g. contains `re-working` and `PLAN-REVIEW`). On the terminal fixture: no pill carries the active/glow modifier and the bar row shows the `✓ DONE` cap. On a no-fail forward fixture: executor carries the active/glow modifier, plan-review carries the pass modifier, and no pill carries the failed/reworking modifier (happy path additive-only).
5. **Swimlane parity (`npm test __tests__/lanes.test.ts __tests__/live-swimlanes.test.ts` exit 0).** On a plan-review-FAIL lane fixture the lit stage returns to the work role (planner) and a companion marks plan-review as failed; on a no-fail fixture `currentStageIndex` is unchanged from today (the existing lanes.test.ts AC#3 stays green). `LiveSwimlanes` rendered on the FAIL lane: the EXECUTOR stage is NOT `ak-lane-stage--live`, the PLANNER stage IS live, the plan-review stage is `--err`-tinted.
6. **Both-ends regression guard (primary gate) — `npm test <regr>` exit 0, red-first demonstrated.** A dedicated test encodes brief §8's four guards: (1) plan-review-FAIL fixture → executor pill NOT active/glow, active glow on PLANNER, executor grey/not-reached; (2) terminal all-PASS fixture → no active glow on any pill; (3) no-failure forward fixture → renders equivalent to pre-change (additive-only); (4) FAIL fixture container `aria-label` carries no `next: EXECUTOR` and no downstream-done-or-next announcement. **Red-first evidence required:** run this test against the pre-change `PipelineProgress`/`currentStageIndex` (stash the source fix), record the failing assertion (executor-pill / aria) in the PR or the plan's `## Review`; it passes only after the fix lands.
7. **Typecheck + full suite green, no contract regression.** `npm run typecheck` exit 0 AND `npm test` exit 0 — the existing tests (`phase.test.ts`, `ui-meta-model.test.ts`, `lanes.test.ts`, `live-swimlanes.test.ts`, `monotonic-flow.test.ts`, …) stay green, confirming `phaseLine`/`latestReviewVerdict`/`shippingAfterPass` behavior is preserved.
8. **UI-task gate (leg 2) — `ui_evolve_verdict` on file.** ui-evolve runs on REAL 390px-phone AND desktop screenshots of the built stage bar against the brief fixtures (clean-PASS / caveated-PASS / FAIL-loopback / terminal) and leaves a verdict file containing `verdict: ACCEPT` + a rubric score with total ≥ 16/20 AND no single axis < 3 (brief §8 R1–R5). The FAIL-fixture screenshot shows plan-review red+`✕`, executor+exec-review grey, glow only on `↩ PLANNER`; the no-fail screenshot is visually equivalent to today (R5 non-regression). `design_brief` already on file (leg 1 done).

## Ship path (UI-task gate — TWO legs)

This is a user-facing visual change ⇒ the UI-task gate applies. Leg 1 (**frontend-design**) is done — the brief is the design POV. Leg 2 (**ui-evolve**, AC8) runs post-implementation and is a hard gate for close. **Knob A (executor placement):** `delegate` (see ## Execution model). **Knob B (evaluator):** `both` — the jest suite incl. the red-first regression test is the test-oracle, AND execution-review + ui-evolve cover the visual quality the tests are blind to (Rule 19: tests can pass on wrong pixels). Standard `/ship` for the PR.

## Files (repo-relative)

- `lib/ui-meta.ts` — export `WORK_PIPELINE_ROLES`; add per-review-role latest-verdict helper; (optionally) house the pure selector.
- `lib/stage-bar.ts` *(new, optional)* — the pure control-flow selector, if not folded into `ui-meta.ts`.
- `lib/lanes.ts` — make `currentStageIndex` verdict-aware via the shared selector + a `reworking`/`failedStage` companion on `Lane`.
- `components/Drawer.tsx` — `PipelineProgress` renders from the selector; export it (or a wrapper) for test.
- `components/LiveSwimlanes.tsx` — render failed/reworking stage states from the lane companion.
- `app/globals.css` — `--failed` / `--reworking` / `.ak-pipeline--done` cap / loopback `◄` classes, reusing existing tokens.
- `__tests__/<selector>.test.ts`, `__tests__/<regr>.test.ts` *(new)* — AC3/AC4/AC6; extend `__tests__/lanes.test.ts` + `__tests__/live-swimlanes.test.ts` for AC5.

## Deferred-follow-ups:

- Optional curved CSS/SVG arc loopback connector (brief §5 enhancement over the flat `◄`) — DEFERRED; the flat `◄` glyph is the v1 requirement. → file a task only if ui-evolve (leg 2, AC8) scores the flat glyph low on axis R2 at 390px.
- Selector-file placement (`lib/stage-bar.ts` vs folding into `lib/ui-meta.ts`) — executor's implementation call; not load-bearing. → none.

## Out of scope

Board/export schema (`LedgerComment.verdict` already exists), the sync pipeline, card pips, non-stage-bar drawer UI. No new verdict tokens; no fail-class regex fork.

## Review

**Reviewer:** stateless plan-reviewer (`3ROLE_TASK:1468 ROLE:plan-review`), independent — did not author this plan. Verified every load-bearing claim against source, not just prose.

**cairn:** ran `cairn-find "verdict"` + `"board"`. Grounding hit — the plan's cited *"When a loop scores two very different designs identically, the verdict system is [broken]"* (T1 2026-06-17) is real and on-point: a FAIL scoring identical to a PASS is the exact verdict-blind failure class this plan fixes.

**Source cross-check (all confirmed against the live tree):**
- `FAIL_CLASS_RE = /BLOCK|FAIL|REJECT/i` exists once in `lib/ui-meta.ts`; a grep for the literal across `lib/` + `components/` returns exactly 1 — AC1's grep-count-1 is satisfiable *today*, so the "no forked vocabulary" AC is genuinely binary.
- `WORK_PIPELINE_ROLES` is module-private at `lib/ui-meta.ts` (no `export`) — AC1's `export const WORK_PIPELINE_ROLES` grep is a real, checkable delta, not a no-op.
- `isFailClassVerdict`, `verdictHue`, `latestReviewVerdict` all exist as the plan describes; `verdictHue("APPROVE") → var(--done)` and `verdictHue("APPROVE-WITH-NOTES") → var(--review)` (the `/NOTES/` branch fires before `/APPROVE/`) — AC3a/AC3b bake the CORRECT token values.
- `PipelineProgress` (`components/Drawer.tsx`) is currently unexported and no existing test imports it — the plan's "export it (or a wrapper) for the render test" is necessary and correctly flagged (AC4 could not otherwise run).
- `currentStageIndex` (`lib/lanes.ts`) is verdict-blind highest-index-reached; the existing `__tests__/lanes.test.ts` AC#3 fixtures carry NO verdicts, so the verdict-aware selector returns identical indices on them — the AC5 non-regression claim ("lanes.test.ts AC#3 stays green") is sound, not wishful.
- Current aria-label literally emits `next: EXECUTOR` (via `roleLabel("executor") = "EXECUTOR"`) on a plan-review-FAIL-no-executor fixture — so AC4/AC6's "aria must NOT contain `next: EXECUTOR`" is genuinely red-first.

**Verify checklist:**
1. **Binary + outside-diff ACs** — HOLDS. Every AC resolves to a grep, an `npm test` exit code, `renderToStaticMarkup` token inspection, or a verdict file. None require reading the implementation.
2. **Red-first** — HOLDS (with a strengthening note, below). AC6 mandates running the regression against the stashed pre-change source and recording the failing assertion; the "active glow on PLANNER" + "executor grey/not-reached" sub-assertions are genuinely red on today's code, and AC3c pins the stray-executor-comment case at the selector level (`executor look=pending even when an executor comment is present`).
3. **Reuse discipline** — HOLDS. AC1 asserts the `BLOCK|FAIL|REJECT` literal count stays exactly 1 and that the selector references `isFailClassVerdict` + `verdictHue`. No regex fork.
4. **Single-selector architecture** — HOLDS (adequately). AC2 greps that BOTH `components/Drawer.tsx` and `lib/lanes.ts` import the same selector symbol; AC4 (drawer) and AC5 (lanes) pin the SAME plan-review-FAIL outcome (executor not-lit, glow/lit-stage returns to planner) on both surfaces, so they cannot silently contradict. `PipelineProgress` export is noted. See recommendation R2 for an optional single-equality tightening.
5. **Happy-path non-regression** — HOLDS. AC5 keeps `lanes.test.ts` AC#3 green, AC4 adds a no-fail forward fixture rendering additive-only, AC7 runs the full suite.
6. **UI-task-gate leg** — HOLDS. AC8 requires a `ui_evolve_verdict` file with `verdict: ACCEPT` + total ≥16/20 AND no axis <3, on REAL 390px + desktop screenshots. Leg 1 (design brief) already on file.
7. **Scope** — HOLDS. The Files list is agent-kanban-only (repo-relative `lib/`, `components/`, `app/`, `__tests__/`); the Scope section excludes board/export schema; NO ai-brain edit — the concurrent lane owning ai-brain model/effort machinery is not touched.

**Recommendations (non-blocking — apply during execution; the mandated "record the failing assertion vs pre-change" step will surface any that are missed):**
- **R1 (strengthen red-first faithfulness):** the AC4/AC6 render-level FAIL fixture should EXPLICITLY include a stray executor comment (mirroring AC3c), so the render-level `executor grey/not-reached` force-grey path is itself exercised red-first — that is the exact operator-caught shape. Without the stray comment the render fixture still passes red via "glow on PLANNER", but pinning the stray comment reproduces the caught bug end-to-end at the render surface.
- **R2 (optional):** consider one explicit cross-surface agreement assertion (drawer pointer role === lane reworking stage on the same fail fixture) to make "one selector, two surfaces can't contradict" a single check rather than paired AC4+AC5. The paired ACs already bracket it, so this is polish, not a gap.

The plan is well-grounded, its ACs are binary and outside-the-diff, reuse discipline is grep-enforced, red-first is mandated, the UI gate is present, and scope is clean. The two recommendations are refinements, not defects.

Decision: PASS
