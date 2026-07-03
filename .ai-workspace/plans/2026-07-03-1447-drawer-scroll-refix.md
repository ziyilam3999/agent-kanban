# Plan 1447 (CYCLE 2 — REFIX) — Drawer touch-scroll still broken on real iPhone

`3ROLE_TASK:1447 ROLE:planner` · repo `agent-kanban` (public, deployed Next.js/Vercel) · branch `master` · session `ee426cae-9054-4680-91ab-5397aa6f573a`

> **OPERATOR FINAL DECISION (2026-07-03) — Option B: KEEP the swipe gesture, ship `transform: translateZ(0)` ALONE.** This is a single-variable experiment. Ship ONLY the iOS scroll-layer hint; change NOTHING about Motion `drag` / swipe-to-dismiss / the grip. Rationale (operator's call, supersedes the planner's original recommendation to drop drag): keep the diagnosis clean — if the one CSS line fixes iOS, we learn the cause is a compositing-layer starvation, NOT the drag gesture; if it does not, cycle 3 removes drag with that hypothesis now isolated. This inverts the earlier draft that removed drag.

cairn: HIT (T1 2026-07-03 + memory feedback `feedback_bounded_flex_column_scroll_child_needs_min_height_zero`) — the CYCLE-1 lesson recommended the `dragListener={false}` grip-drag recipe that SHIPPED (f760c2c) and STILL failed on the operator's real iPhone. This cycle does NOT re-litigate that recipe's role: it holds the drag config constant and changes ONE variable (an iOS compositing-layer hint on the scroll body). The cairn amendment is therefore CONDITIONAL — it is written only after the real-device result tells us whether the layer hint alone was the fix (see Post-close learning + Deferred-follow-ups). (Other cairn `drawer`/`scroll` hits are content-pipeline video-clip noise — unrelated.)

## ELI5

You tap a ticket and a panel slides up from the bottom on your phone. If the ticket is long, you still can't drag your finger to scroll down and read the rest. Last time we thought we fixed it, and it worked on our test computer — but the real iPhone still won't scroll. Test computers (Chrome) scroll it fine, which is exactly why our last test lied to us and said "all good."

This time we change exactly ONE tiny thing and nothing else: we add a single line of CSS to the scroll area that tells the iPhone "give this box its own dedicated scrolling layer." That's a well-known iPhone trick for exactly this kind of stuck-scroll. We keep the swipe-to-close gesture and everything else exactly as it is — because if we changed two things at once and it started working, we wouldn't know which one did it. One change, one clean answer.

We also replace the test-that-lied with an honest one: a real finger-swipe in a real Chrome, PLUS the one check that actually matters — YOU, on your real iPhone. No test computer here can be an iPhone, so your device is the final judge.

## Measured evidence recap (already diagnosed — see `.ai-workspace/_diag/1447-rediagnosis.md`, do NOT re-derive)

- Operator tested the ACTUAL shipped fix (branch tip carried `dragListener={false}` + `min-height:0`, merged f760c2c). Real iPhone: "still not able to scroll." This is a shipped-broken UI fix; the jsdom CSS-string test gave false confidence.
- Layout is CORRECT: `.ak-drawer__body` overflows (scrollHeight 4398 vs clientHeight 485), `overflow-y:auto` / `min-height:0` / `flex-grow:1` all present and resolved to concrete heights.
- `touch-action` = `auto` on the body AND every ancestor (aside / .ak-app / body / html). NOT a touch-action block.
- JS scroll WORKS (`scrollTop` 0 → 3913). Chromium mobile + TRUSTED CDP touch swipe scrolls perfectly (0 → 547, 9 touchmove events, 0 prevented).
- Source has NO touchmove/wheel/onTouch handlers; the only `preventDefault()` calls are in the KEYBOARD handler (Escape/Tab focus-trap).
- RULED OUT: touch-action, missing min-height, overflow not engaging, app-level touchmove preventDefault, stale deploy, desktop/chromium (both scroll fine).
- CANNOT reproduce iOS-only failure locally: no iOS runtime (`xcrun simctl list` empty), Playwright-WebKit has no trusted-touch-swipe API (CDP is chromium-only). **The operator's phone is the only iOS oracle.**

## Root cause

**No single cause is CONFIRMED — there are two co-equal suspects, and this cycle holds ONE constant while testing the other.** All measurable layout / touch-action / handler evidence is clean (see recap), so the failure is an iOS-WebKit-only runtime behavior that no local engine here can reproduce. We do NOT assert "the drag gesture is the primary cause" — that was an over-attribution in the earlier draft and is retracted.

**Leading hypothesis being tested this cycle (compositing-layer starvation).** On iOS Safari, an inner `overflow:auto` region can fail to be promoted to its own touch-scroll (compositing) layer when an ANCESTOR already owns a compositing context — here `<motion.aside className="ak-drawer">` runs an entrance/exit spring on `transform` (`initial/animate/exit` on `y`), which creates and holds a transform/compositing context on the scroll ancestor for the life of the sheet. When the ancestor owns the layer, iOS may route the vertical pan to the ancestor and never hand a scroll layer to the inner body. The canonical fix is to force the inner region onto its OWN layer with `transform: translateZ(0)` on `.ak-drawer__body`. This addresses the failure INDEPENDENTLY of any gesture, which is exactly why it is the single variable to change first.

**Co-equal UNPROVEN suspect, deliberately HELD CONSTANT (Motion `drag` on the ancestor).** Framer Motion `drag="y"` on the same `<motion.aside>` binds a `pointerdown` listener + gesture recognizer to the scroll ancestor; on iOS WebKit a drag recognizer CAN claim the vertical pan before the inner overflow engages. This is a real, plausible cause — but it is UNCONFIRMED, and per the operator's Option-B call it is NOT changed this cycle. Keeping it fixed means: if `translateZ(0)` alone fixes iOS, the cause was compositing-layer starvation and the gesture is exonerated; if it does NOT, cycle 3 removes drag with this hypothesis now cleanly isolated (Appendix A holds that ready-to-execute fallback).

Chromium's runtime touch handling reproduces NEITHER failure mode (it scrolls in every configuration measured), which is exactly why the cycle-1 chromium/jsdom evidence was falsely green and why chromium cannot be the oracle for this fix.

## Approach (single-variable — operator Option B; executor: do NOT re-decide or re-expand scope)

- **Change exactly ONE production line:** add `transform: translateZ(0)` to `.ak-drawer__body` in `app/globals.css`. Nothing else in the runtime behavior changes.
- **`components/Drawer.tsx` is NOT touched this cycle.** Motion `drag`, `useDragControls`, `dragListener={false}`, `onDragEnd`, the grip's `onPointerDown`, the entrance/exit spring — ALL stay exactly as shipped. (A `git diff origin/master -- components/Drawer.tsx` MUST be empty — AC1.)
- **`.ak-drawer__grip` CSS is NOT touched** (keeps `touch-action:none` + `cursor:grab` — the grip remains the drag origin).
- The rest of the work is the RIGOR APPARATUS (honest tests + real-device oracle), not behavior change: rewrite the false-green jest test into an honest recipe-present tripwire, promote the working chromium e2e into a permanent asserting guard, and gate close on the operator's real-device confirmation.

## Execution model

**subagent** (`/delegate`, knob-A = `delegate`; knob-B = `both` — the jest source-contract + chromium e2e are the test-oracles, plus a stateless `execution-review`). Rationale: briefable single coherent surface (ONE CSS line + 2 test files), no live-session coupling, deterministic gates. NOT trivial-skip (adds/rewrites tests + a UI-touching CSS change + the mandatory operator-device gate). Full 3-role chain (planner → plan-review → executor → execution-review); execution-review is NEVER inline-skippable. Executor works in a FRESH git worktree off `origin/master` (Rule 12 — no exception).

## Exact file-by-file changes

### A. `components/Drawer.tsx` — NO CHANGE

Do NOT edit `components/Drawer.tsx` at all this cycle. Motion `drag="y"`, `dragControls`, `dragListener={false}`, `dragConstraints`, `dragElastic`, `onDragEnd`, `useDragControls`, the grip's `onPointerDown`, and the entrance/exit spring all stay exactly as merged in f760c2c. The single-variable experiment REQUIRES this file be byte-identical to `origin/master` (AC1 asserts `git diff origin/master -- components/Drawer.tsx` is empty).

### B. `app/globals.css` — ONE line only (iOS scroll-layer hardening)

1. **`.ak-drawer__body` (~line 1026)** — KEEP every existing declaration (`flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: …`) and ADD one line:
   ```css
   transform: translateZ(0); /* iOS: force the overflow region onto its own touch-scroll/compositing layer (single-variable fix — #1447 cycle 2) */
   ```
   Do NOT change `flex-basis` and do NOT add an explicit `height` to `.ak-drawer` (both regress short sheets — see below). This is the ONLY production change in the cycle.
2. **`.ak-drawer__grip` (~line 947)** — UNCHANGED. It keeps `touch-action: none;` and `cursor: grab;` (the grip is still the drag origin; the swipe gesture is preserved per Option B).
3. **Desktop media query (~line 1245)** — UNCHANGED: `.ak-drawer` stays the side panel (`left:auto; right:0; top:0; bottom:0; width:min(440px,92vw); max-height:100dvh`) and `.ak-drawer__grip { display:none }`. (`translateZ(0)` on the body is harmless on desktop wheel-scroll.)

Rejected alternatives (do NOT substitute): switching `.ak-drawer__body` to `flex: 1 1 0`, or forcing `.ak-drawer { height: 86dvh }`, both REGRESS short-content sheets (in an auto/`max-height`-capped flex column, `flex-basis:0` + `min-height:0` collapses the body to ~0 for short content; an explicit `height` makes every short sheet a full-height empty box). `translateZ(0)` is the zero-regression, one-line, revertible hardening.

### C. `__tests__/drawer-scroll-contract.test.ts` — REPLACE the false-green guard with a RECIPE-PRESENT tripwire

The old file asserts `dragListener={false}` and `useDragControls` are PRESENT as its "fix proof" — that was the false-green. Rewrite it as an honest SOURCE-CONTRACT that guards THIS cycle's actual change (the CSS recipe is present), NOT the drag config. It runs in CI (`npm test`).
- **Header comment (mandatory honesty):** state this is a source-contract, jsdom cannot prove runtime scroll, the runtime proof is `e2e/drawer-scroll.e2e.spec.ts` + the MANUAL operator-real-device step, and a chromium-green e2e does NOT prove iOS.
- **`.ak-drawer__body` block (the cycle-2 recipe — assert PRESENT):** assert present — `overflow-y:auto`, `min-height:0`, a growing flex (`flex:<n>` or `flex-grow:<n>` with n≥1), `overscroll-behavior:contain`, `-webkit-overflow-scrolling:touch`, AND `transform:translateZ(0)`. The `translateZ(0)` assertion is the tripwire that goes RED if anyone removes this cycle's fix.
- **Do NOT assert anything about drag props** — not present, not absent. This cycle deliberately does not touch the drag config, so the test must be SILENT on it (asserting drag-absent would contradict Option B; asserting drag-present would re-enshrine the false-green framing). The test's job is: the scroll recipe (incl. `translateZ(0)`) is intact.
- Reads via `readFileSync(join(__dirname, "..", …))` — NO absolute/home-path literals (CI privacy gate + portability). Reuse the existing `ruleBlock()` helper.

### D. `e2e/drawer-scroll.e2e.spec.ts` — NEW permanent guard (rename + promote the diag; DELETE `e2e/drawer-scroll-diag.e2e.spec.ts`)

Evolve `e2e/drawer-scroll-diag.e2e.spec.ts` into a permanent, ASSERTING guard, then remove the diag file (new-file + `mv` the diag to quarantine per Rule 14). Keep the working machinery (60-paragraph long-ticket fixture via `page.route("**/api/board")` + `visibilitychange`; open `.ak-cardbtn`; the touchmove-prevented instrument; the trusted CDP `Input.dispatchTouchEvent` swipe on a mobile+hasTouch context). Changes:
- Replace the "DIAGNOSTIC (temporary)" header with a permanent-guard header documenting: (i) proves the scroll MECHANISM under trusted touch in CHROMIUM; (ii) does NOT prove iOS Safari (no local iOS engine; CDP is chromium-only; WebKit forbids `new Touch()`); (iii) iOS is the manual operator-real-device step; (iv) goes RED if the flex/overflow scroll recipe is broken so the body no longer scrolls under trusted touch.
- Replace the `console.log` + `expect(true).toBe(true)` with HARD assertions:
  - **Precondition** — body overflows: `const { scrollHeight, clientHeight } = …; expect(scrollHeight).toBeGreaterThan(clientHeight)`.
  - **Scroll moved** — `expect(after - before).toBeGreaterThan(100)` (scrollTop advanced > 100px under the trusted swipe).
  - **No touch blocking** — `expect(tm.prevented).toBe(0)`.
- **Screenshot (Rule-19 evidence):** after the swipe assertions, JS-scroll to the end (`el.scrollTop = el.scrollHeight`) and screenshot the scrolled-to-bottom body to the gitignored Playwright artifacts dir at the STABLE path `test-results/1447-drawer-scrolled-bottom.png`. Add `test-results/` to `.gitignore` if not already ignored. The executor then COPIES that PNG to the committed evidence path `.ai-workspace/reviews/1447-drawer-scrolled-bottom.png` (the eyeball frame that ships with the review). This is the chromium eyeball frame.
- Runs under the existing chromium project: `PW_WEB_SERVER=1 npx playwright test drawer-scroll` (boots `BOARD_BLOB_URL= next dev -p 3939`). Uses synthetic fixture data only (no real board, no network, no `~/.claude`).

## Both-ends guard — spec and RED/GREEN demonstration

Two guards, honest split — and an explicit statement of what neither can prove:
- **Behavioral (chromium e2e, section D)** — the runtime proof that the scroll MECHANISM works under trusted touch, and the tripwire for a broken flex/overflow scroll recipe.
- **Structural (jest source-contract, section C)** — the tripwire specific to THIS cycle's change: `.ak-drawer__body` carries the full scroll recipe INCLUDING `transform:translateZ(0)`. Runs in CI.

**RED demonstration the executor MUST paste into the evidence file (a guard never seen RED is not trusted):**
1. **e2e RED (break the scroll recipe):** temporarily remove `min-height: 0` AND `overflow-y: auto` from `.ak-drawer__body` → run `PW_WEB_SERVER=1 npx playwright test drawer-scroll` → it FAILS (the body no longer overflows/scrolls, so `scrollHeight > clientHeight` and/or the `scrollTop` advance assertion fails). Restore both → GREEN. (This proves the e2e actually detects a broken scroll region.)
2. **jest RED (remove this cycle's fix):** temporarily delete the `transform: translateZ(0)` line from `.ak-drawer__body` → `npx jest drawer-scroll-contract` → the `translateZ(0)` recipe-present assertion FAILS. Restore → GREEN. (This proves the jest tripwire actually guards the cycle-2 change.)

**CRUCIAL HONEST CAVEAT (state it in the plan, both test headers, and the evidence):** neither guard can go RED on the ABSENCE of `translateZ(0)` at the BEHAVIORAL level in chromium — chromium scrolls fine WITH or WITHOUT the `translateZ(0)` hint (it scrolled fine even on the cycle-1 shipped-broken state). So **there is NO chromium behavioral both-ends for the actual fix** — the e2e proves the scroll mechanism and catches a broken recipe, but it CANNOT distinguish "translateZ present" from "translateZ absent," because the failure it targets is iOS-only and chromium does not reproduce it. The jest tripwire proves the fix line is PRESENT in source (a structural, not behavioral, guarantee). The ONLY oracle that can prove the fix actually WORKS is the operator's real iPhone (AC14 / CG5). Chromium-green ≠ iOS-works — this is the exact trap that made cycle 1 falsely green, sharpened here: under a single-variable CSS-only change, chromium is structurally incapable of a behavioral RED on the variable.

## Binary acceptance criteria (each independently checkable)

- **AC1** (drag/swipe PRESERVED — Drawer untouched): `git diff origin/master -- components/Drawer.tsx` prints NOTHING (the component is byte-identical to master; Motion `drag`, `dragListener={false}`, `onDragEnd`, `useDragControls`, and the grip's `onPointerDown` all remain). This is the single-variable guarantee.
- **AC2** (grip CSS PRESERVED): `.ak-drawer__grip` in `app/globals.css` still declares `touch-action:none` and `cursor:grab` (the grip is still the drag origin; the swipe gesture is intact).
- **AC3** (CSS scroll recipe intact + hardened): the `.ak-drawer__body` block in `app/globals.css` declares ALL of `overflow-y:auto`, `min-height:0`, a growing flex (grow ≥ 1), `overscroll-behavior:contain`, `-webkit-overflow-scrolling:touch`, AND the newly-added `transform:translateZ(0)`.
- **AC4** (production diff is exactly one line): `git diff origin/master -- app/globals.css` shows a SINGLE added line (`transform: translateZ(0);` plus its comment) inside `.ak-drawer__body` and no other production-CSS change. (`git diff --stat origin/master -- app components` shows only `app/globals.css` touched, +1 line.)
- **AC5** (desktop panel unchanged): the desktop media query still sets `.ak-drawer { left:auto; right:0; top:0; bottom:0; width:min(440px,92vw) }` and `.ak-drawer__grip { display:none }`.
- **AC6** (false-green test replaced with recipe-present tripwire): `__tests__/drawer-scroll-contract.test.ts` no longer asserts `dragListener={false}`/`useDragControls` present; it asserts the `.ak-drawer__body` CSS recipe PRESENT (incl. `translateZ(0)`) and makes NO assertion about drag props. `npx jest drawer-scroll-contract` exits 0.
- **AC7** (permanent e2e guard green): `e2e/drawer-scroll.e2e.spec.ts` exists and `PW_WEB_SERVER=1 npx playwright test drawer-scroll` exits 0, asserting body overflows, `scrollTop` advances > 100px under a trusted CDP touch swipe, and 0 touchmove `defaultPrevented`.
- **AC8** (diag removed): `e2e/drawer-scroll-diag.e2e.spec.ts` no longer exists.
- **AC9** (both-ends RED proof): the evidence file contains a real pasted RED run of BOTH guards — the e2e RED via stripping `min-height:0`+`overflow-y:auto`, and the jest RED via stripping `translateZ(0)` — each followed by the GREEN run after restore.
- **AC10** (chromium scrolled-to-bottom screenshot): the e2e produces `test-results/1447-drawer-scrolled-bottom.png`, copied to `.ai-workspace/reviews/1447-drawer-scrolled-bottom.png` (Rule-19 chromium eyeball frame).
- **AC11** (full jest suite green): `npm test` exits 0.
- **AC12** (typecheck clean): `npx tsc --noEmit` exits 0.
- **AC13** (privacy — public repo): no home-path literals, secrets, tokens, or employer-brand mentions in ANY committed file (`app/globals.css`, `__tests__/…`, `e2e/…`); tests read source via `join(__dirname, "..")` only; fixtures synthetic. (`git grep -nE '/Users/|/home/' -- app __tests__ e2e` prints nothing.)
- **AC14** (operator real-device — MANDATORY, non-machine, FINAL GATE): the operator loads the deployed/preview build on their real iPhone (iOS Safari), opens a long ticket (≥ ~30 timeline nodes), and confirms a finger-drag on the body scrolls all the way to the bottom, AND that the swipe-down-on-grip dismiss + ✕ / scrim-tap / Escape all still work, AND that the ticket text/timeline still renders CRISPLY (no blurriness) — `transform: translateZ(0)` promotes the body to its own GPU layer and CAN soften/blur text on a promoted layer at some retina DPRs, and the real device is the ONLY place that surfaces. **#1447 cannot be marked done until the operator confirms this.** No local test can substitute (no iOS engine here). This is the single-variable verdict: if it scrolls, `translateZ(0)` alone was the fix; if not, cycle 3 executes Appendix A (remove drag).

## UI-task gate (CLAUDE.md, fires on execution-review `TaskUpdate→completed` — touches `.css`)

This is a scroll-MECHANICS fix (one CSS line), not a visual redesign, and it changes nothing a user *intends* to look at (no layout, no color, no component structure — swipe/grip/dismiss all unchanged); the one cosmetic risk it introduces (promoted-layer text softening) is verified on the operator's real device per AC14. Satisfy the fail-closed `hooks/ui-task-gate.sh` by EITHER:
- (a) leave a `ui_evolve_verdict` file (the chromium scrolled-to-bottom screenshot from AC10, plus a desktop wheel-scrolled screenshot, vision-judged `verdict: ACCEPT` + a rubric score) and a short `design_brief`/`design_pov` noting "no visual change; single CSS compositing hint added to the scroll body; swipe/grip/dismiss unchanged"; OR
- (b) a SPECIFIC `metadata.ui_gate_skip` (≥20 chars), e.g. `"single-variable functional scroll fix — one CSS line (transform: translateZ(0)) on the drawer body for iOS scroll-layer promotion; zero visual change; swipe/grip/dismiss unchanged; proven by chromium trusted-touch e2e + operator real-device scroll"`.
Do not mark complete without one of these (the gate blocks fail-closed).

## Risks

1. **Cannot verify iOS locally → the operator's real iPhone is the FINAL oracle (AC14).** Chromium-green ≠ iOS-works — this is the exact reason cycle 1 passed CI but shipped broken, and it is SHARPER here: under a CSS-only single-variable change, chromium cannot produce a behavioral RED on the variable at all (it scrolls with or without `translateZ(0)`). Do not treat green automation as "done."
2. **Single-variable may not be enough (the accepted tradeoff).** If `translateZ(0)` alone does NOT fix iOS, we spend one extra real-device round-trip — but we END that round-trip KNOWING the layer hint is insufficient, with the drag-removal hypothesis cleanly isolated for cycle 3 (Appendix A). The operator chose this diagnostic clarity over shipping both changes at once. If BOTH the layer hint (cycle 2) and drag-removal (cycle 3) fail on the real device, cycle 4 must use a real iOS engine (BrowserStack / a physical device with Safari Web Inspector remote debugging) — there is no local shortcut.
3. **`translateZ(0)` creates a stacking context + containing block on `.ak-drawer__body`.** The body has no `position:fixed` descendants, so no escape/clipping regression; it is an established scroll-hardening. Revertible in one line (Rollback).
4. **The e2e does not run in CI** (CI runs jest + typecheck only; the existing `live-swimlanes` e2e is also local). The always-on CI regression tripwire is therefore the jest recipe-present source-contract (`translateZ(0)` present). Recommended follow-up (Deferred): add a Playwright CI job so the e2e runs on every PR. Out of scope for this cycle unless the operator opts in.
5. **Motion pinned 12.40.0.** This cycle does not touch Motion at all — no version risk.

## Rollback

Revert the single squash-merge commit (or `git revert <sha>`). No data migration, no schema, no env change — the production diff is ONE CSS line (`transform: translateZ(0);` on `.ak-drawer__body`) plus the test-rigor changes. Reverting restores f760c2c behavior (broken-on-iOS, but no worse than today). To revert ONLY the production fix while keeping the honest tests, delete the one `transform: translateZ(0);` line from `.ak-drawer__body`.

## Deferred-follow-ups:

- **Remove Motion `drag` from the scroll ancestor** (the cycle-3 fallback; ready-to-execute spec in Appendix A) — DEFERRED, CONDITIONAL. → file a task ONLY IF AC14 fails (operator real-device still can't scroll with `translateZ(0)`). At that point the compositing-layer hypothesis is disproven and drag-removal becomes the next single variable. Do NOT execute pre-emptively — that would break the single-variable experiment the operator chose.
- **Wire the e2e into CI** (new Playwright job so `drawer-scroll.e2e.spec.ts` runs on every PR) — DEFERRED. → file a task if the operator opts in (Risk 4). The jest recipe-present source-contract is the CI tripwire in the meantime; this is a durability upgrade, not a correctness blocker.
- **Cairn amendment of `feedback_bounded_flex_column_scroll_child_needs_min_height_zero`** — DEFERRED to close, and CONDITIONAL on the real-device result (see Post-close learning). Do NOT amend the cairn until AC14/CG5 tells us whether `translateZ(0)` alone was the fix; amending on an unconfirmed hypothesis would repeat cycle 1's over-confidence.

## Files touched

- `app/globals.css` (edit B1 — ONE added line: `transform: translateZ(0)` on `.ak-drawer__body`; B2/B3 explicitly UNCHANGED)
- `__tests__/drawer-scroll-contract.test.ts` (rewritten — section C, recipe-present tripwire)
- `e2e/drawer-scroll.e2e.spec.ts` (new permanent guard — section D)
- `e2e/drawer-scroll-diag.e2e.spec.ts` (removed)
- `.gitignore` (add `test-results/` if not already ignored — Playwright artifacts dir)
- `.ai-workspace/reviews/1447-refix-execution-evidence.md` (new evidence artifact — not shipped code)
- `.ai-workspace/reviews/1447-drawer-scrolled-bottom.png` (e2e screenshot — evidence)
- **NOT touched:** `components/Drawer.tsx` (single-variable — must be byte-identical to master; AC1).

## Post-close learning (root-cause-ritual at close — flagged for the orchestrator; CONDITIONAL on AC14/CG5)

The cairn amendment is written ONLY after the operator's real-device result (AC14 / CG5), and its content DEPENDS on that result:
- **If AC14 PASSES** (scrolls with `translateZ(0)` alone): AMEND cairn `feedback_bounded_flex_column_scroll_child_needs_min_height_zero` with the confirmed cause — on real iOS Safari, an inner `overflow:auto` region under an ancestor that owns a transform/compositing context (here the entrance/exit spring on `.ak-drawer`) can be starved of its own touch-scroll layer; `transform: translateZ(0)` on the inner region fixes it. Note that the `dragListener={false}` drag config was EXONERATED (held constant, scroll still fixed). Add the meta-lesson: a chromium/jsdom test is BLIND to this iOS-only failure — a touch-scroll fix needs a real-device oracle, not a chromium-green as proof of done.
- **If AC14 FAILS** (still can't scroll): do NOT amend with a false conclusion. Record that `translateZ(0)` alone was INSUFFICIENT, keep the drag-suspect OPEN, and file the cycle-3 drag-removal task (Appendix A). The only durable lesson so far is the meta-lesson: chromium-green never proves an iOS-only touch behavior; only the real device does.

## Executor process (Rule 12 worktree; orchestrator ships)

1. **Fresh worktree off origin/master:** `git -C ~/coding_projects/agent-kanban fetch origin && git -C ~/coding_projects/agent-kanban worktree add .claude/worktrees/1447-drawer-scroll-refix -b 1447-drawer-scroll-refix origin/master`. Do ALL edits + tests in that worktree — never in the primary clone's tree.
2. **Do NOT push / open a PR** — the orchestrator owns shipping. The executor's job ends at green gates + evidence + ledger row.
3. **Gates green (in the worktree):** `npx tsc --noEmit` exits 0; `npm test` exits 0; `npx jest drawer-scroll-contract` exits 0; `PW_WEB_SERVER=1 npx playwright test drawer-scroll` exits 0 (run `npx playwright install chromium` first if the browser is missing). Also confirm AC1 (`git diff origin/master -- components/Drawer.tsx` empty) and AC4 (`git diff origin/master -- app/globals.css` = one added line).
4. **Both-ends RED proof (AC9):** perform the two RED demos in the spec above (e2e RED = strip `min-height:0`+`overflow-y:auto`; jest RED = strip `translateZ(0)`); paste the FAILING output of each then the GREEN restore into the evidence file. Also paste the honest caveat: chromium cannot RED on `translateZ(0)` absence — the operator device is the only fix-oracle.
5. **Screenshot copy:** copy `test-results/1447-drawer-scrolled-bottom.png` → `.ai-workspace/reviews/1447-drawer-scrolled-bottom.png` (committed evidence).
6. **UI-task-gate handling:** leave the verdict+brief OR the specific `metadata.ui_gate_skip` per the UI-task-gate section.
7. **Evidence + ledger:** write evidence to the stable primary-clone path `~/coding_projects/agent-kanban/.ai-workspace/reviews/1447-refix-execution-evidence.md` (NOT a transient worktree path); self-append the executor ledger row: `node ~/coding_projects/ai-brain/hooks/3role-ledger.mjs append --session ee426cae-9054-4680-91ab-5397aa6f573a --task 1447 --role executor --artifact ~/coding_projects/agent-kanban/.ai-workspace/reviews/1447-refix-execution-evidence.md`.
8. **Commit trailer:** every commit ends with `Claude-Session: https://claude.ai/code/session_019caZDRt3exJgSqYHCBoubT`.

## Close gate (a green `npm test` alone MUST NOT close #1447)

Close only when ALL are in the evidence artifact:
- **CG1:** `npx tsc --noEmit` + `npm test` + `npx jest drawer-scroll-contract` + `PW_WEB_SERVER=1 npx playwright test drawer-scroll` all green (pasted), plus AC1 (Drawer.tsx unchanged) + AC4 (one-line CSS diff) confirmed.
- **CG2:** the AC9 both-ends RED runs (e2e RED via stripped scroll recipe, jest RED via stripped `translateZ(0)`, then GREEN) + the honest "chromium can't RED on translateZ absence" caveat.
- **CG3:** the AC10 chromium scrolled-to-bottom screenshot, copied to `.ai-workspace/reviews/`.
- **CG4:** the UI-task-gate satisfied (verdict+brief OR specific skip).
- **CG5:** **AC14 operator real-device confirmation** — the human iOS oracle, and the single-variable verdict. Missing CG5 = NOT done, regardless of green automation. (This is the gate cycle 1 skipped.) The cairn amendment (Post-close learning) is written from THIS result, not before it.

## Review

**Decision: PASS** (plan-review v2, 2026-07-03) — `3ROLE_TASK:1447 ROLE:plan-review`.
Full review: `.ai-workspace/reviews/1447-refix-plan-review.md`.

All three v1 MAJOR findings resolved: (1) root cause no longer over-attributes to `drag` — it retracts
the over-attribution and leads with the compositing-layer-starvation hypothesis, holding drag constant;
(2) the operator settled Option B (translateZ-alone, keep the gesture) — the single-variable path v1
asked to surface; (3) the cairn amendment is now conditioned on the AC14/CG5 real-device verdict. The
RED-demo reframe is honest (e2e RED = strip the scroll recipe; jest RED = strip `translateZ(0)`) and
makes NO false claim that chromium proves the iOS fix — it states outright there is no chromium
behavioral both-ends for the variable and the real iPhone is the only fix-oracle. `translateZ(0)`
re-verified containing-block-safe (no `position:fixed`/`sticky` descendants of `.ak-drawer__body`).

Two MINOR fix-on-execution items (no re-review): (a) L95 cites "AC13" for the operator real-device
oracle — should be **AC14** (AC13 is the privacy grep); (b) AC14 should also ask the operator to confirm
text still renders crisply — `translateZ(0)` can soften promoted-layer text at some retina DPRs.

## Appendix A — cycle-3 fallback: remove Motion `drag` from the scroll ancestor (ONLY if AC14 fails)

**This is NOT part of cycle 2.** Execute it as a SEPARATE cycle-3 task ONLY IF the operator's real-device test (AC14) still shows no scroll with `translateZ(0)` alone — i.e. the compositing-layer hypothesis is disproven and the held-constant drag suspect becomes the next single variable. Spec (ready to execute):
- In `components/Drawer.tsx`: drop `useDragControls` + `type PanInfo` imports; delete `const controls = useDragControls();` and the `onDragEnd` function; remove `drag`, `dragControls`, `dragListener`, `dragConstraints`, `dragElastic`, `onDragEnd` from `<motion.aside>` (KEEP `ref`, `className`, `role`, `aria-modal`, `aria-label`, and the entrance/exit spring `initial`/`animate`/`exit`/`transition` with their `reduce ? … : …` branches). Remove the grip's `onPointerDown` (grip becomes decorative), OR re-add a lightweight NATIVE pointer swipe on the GRIP ONLY (never the body subtree) if the operator wants swipe-dismiss kept:
  ```tsx
  <span
    className="ak-drawer__grip"
    aria-hidden
    onPointerDown={(e) => { dragStartY.current = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
    onPointerUp={(e) => { if (dragStartY.current != null && e.clientY - dragStartY.current > 90) onClose(); dragStartY.current = null; }}
  />
  ```
  (with `const dragStartY = useRef<number | null>(null)`).
- In `app/globals.css`: if the grip is made fully decorative, remove `touch-action:none` + `cursor:grab` from `.ak-drawer__grip`; if the native grip-swipe is kept, leave them.
- Update the section-C jest test for cycle 3: keep the recipe-present assertions AND (only in cycle 3) add a `.ak-drawer` drag-absent tripwire (`Drawer.tsx` matches none of `drag=`/`dragControls`/`dragListener`/`dragConstraints`/`dragElastic`/`onDragEnd`/`useDragControls`, allowing the grip's native `onPointerDown`/`onPointerUp`).
- Keep AC14 (operator real-device) as the cycle-3 oracle too — grip-swipe and drag-removal remain unverifiable locally.
