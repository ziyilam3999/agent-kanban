# 1455 — Drawer pull-down-from-top drag-to-dismiss (iOS-sheet feel), alongside grip drag

- **Task:** #1455
- **Component:** `components/Drawer.tsx` (+ `app/globals.css`, `__tests__/drawer-scroll-contract.test.ts`, new `e2e/drawer-pulldown-dismiss.e2e.spec.ts`)
- **Type:** UI feature (mobile bottom-sheet gesture) — the UI-task gate applies (frontend-design + ui-evolve).
- **Isolation:** fresh Rule-12 worktree off `origin/master` (orchestrator creates it).
- **cairn:** T1 2026-07-03, session `ee426cae` — the load-bearing trap this plan is built around:
  > "iOS touch-scroll: min-height:0 fixes wheel/desktop but Framer-Motion drag on a scroll-region ANCESTOR breaks native finger-scroll on iOS Safari EVEN with dragListener=false + touch-action:auto (chromium scrolls fine, iOS doesn't) — remove Motion drag from the scroll subtree, grip-only pointer dismiss; never gate a touch/gesture fix on a jsdom CSS-string test or chromium, verify on the real failing engine (iOS device)."

  And the root-cause correction that shipped as #1447 (line 210):
  > "Drawer 'can't scroll' was a flexbox bug not iOS touch-drag … bind/relocate the greedy sibling AND reproduce the ACTUAL failing record (the giant-title ticket), not a synthetic long-body proxy."

  Plus the contract-test caveat (line 106): "A source-level contract test that only asserts CSS declarations or prop values are present is not proof of runtime scroll/behavior — for layout/gesture" behaviour you need a real behavioural oracle. (Project-index `.ai-workspace/PROJECT-INDEX.md` present + current; critical files were read directly from source for this plan.)

---

## Execution model

**subagent (delegate) — single coherent surface, 3-role orchestrated.** Rationale: this touches ~4 files (`components/Drawer.tsx`, `__tests__/drawer-scroll-contract.test.ts`, new `e2e/drawer-pulldown-dismiss.e2e.spec.ts`, possibly `app/globals.css`) and carries an architectural decision (the scroll-vs-dismiss gate) — above the trivial-skip threshold, so it is briefable to one executor subagent in a fresh Rule-12 worktree. Not `parallel` (one tightly-coupled write surface — the Drawer component and its tests). Not `inline` (fully briefable; the plan is the contract). Knob B evaluator = **both** (Playwright behavioural oracle + stateless execution-reviewer + ui-evolve ACCEPT). Roles: planner (this) → plan-reviewer → executor → execution-reviewer, all subagents.

---

## ELI5

Right now, to close the ticket drawer on your phone you have to grab the tiny grey "grip" pill at the very top and pull it down. That is fussy — real phone apps (Apple Maps, Music) let you grab the *whole card* and pull it down to dismiss.

We are adding that: **pull down anywhere on the drawer body to close it — but only when you are already scrolled to the very top.** If you have scrolled down into the content and pull down, that just scrolls back up (it does NOT close). If you swipe up, nothing closes. The old grip-pull still works exactly as before.

The trap: last time, letting the whole sheet be a "drag" surface *ate* the finger-scroll and broke reading long tickets (#1447). So the new gesture is only allowed to start when the body is at the very top and your finger is moving down — the one moment where "scroll down" has nowhere to go anyway. Every other moment, the body scrolls like normal.

---

## Interaction spec (the contract — WHAT, not HOW)

Let `sc` = the scroll body's live `scrollTop` at the moment a downward intent is first detected in a touch gesture. Reuse the existing release threshold unchanged: dismiss iff `info.offset.y > 90 || info.velocity.y > 600` at drag end.

| Case | Condition | Behaviour |
|---|---|---|
| **A — at-top + down → dismiss** | `sc === 0` AND finger moving DOWN | Begin the dismiss drag (`controls.start`). Sheet tracks the finger with the existing rubber-band; release past threshold → `onClose`, release under → springs back. |
| **B — scrolled → scroll, no dismiss** | `sc > 0` (at gesture start) | Native scroll only. NEVER start a dismiss drag for this gesture, even if the finger later drags the content to the top. Decision is latched at gesture start. |
| **C — up → no dismiss** | finger moving UP | Native scroll only (reveal more content). Never dismiss. |

Invariants that MUST hold (these ARE the #1447 preservation — see "#1447 preservation invariants" below):

- **Grip drag is untouched.** Pressing the grip (`onPointerDown → controls.start`) still starts the dismiss drag regardless of scroll position — byte-compatible with today.
- **Reduced-motion is untouched.** When `useReducedMotion()` is true, `drag={false}` and NO drag path is wired — neither grip nor body-pull. Dismiss stays ✕ / ESC / scrim only. The new body handlers must be guarded by `!reduce` exactly as the grip's `onPointerDown` is.
- **Desktop is untouched.** On desktop the grip is `display:none` and the drawer is a side-panel; wheel/trackpad/mouse scrolling of the body must behave exactly as today. The body-pull is a mobile/touch affordance — it must not hijack desktop wheel or pointer scroll. (Contract: the body-pull is scoped so a desktop mouse/wheel scroll of the body never triggers dismiss.)
- **Latch, don't hand off mid-gesture.** The scroll-vs-dismiss decision is made once, early in the gesture, from the live `scrollTop`. No mid-drag switching between scroll and dismiss (that path is where the touch-action / native-scroll conflict re-appears).

---

## Frontend-design interaction POV (`design_pov` — this IS a UI task)

**POV: this must read as a genuine iOS sheet, not a "drag handle you must aim for."** The grip pill stays as the *visual* signal that the sheet is draggable, but the real gesture is the invisible one every iPhone user already has in their thumbs: at the top of the card, pull down to leave.

Three non-negotiable feels:

1. **One motion vocabulary, no mode-switch to think about.** At the top, down = leave. Once you are reading (scrolled), down = go back up. The user never decides "am I in scroll mode or dismiss mode" — the position decides for them, invisibly. This is why the gate is `scrollTop === 0`, not a separate drag zone.
2. **Rubber-band elasticity is the soul of it — keep `dragElastic={{ top: 0, bottom: 0.4 }}`.** The `0.4` bottom is the iOS "the sheet follows my finger but with weight" feel; `top: 0` means you can't lift the sheet above its rest (you scroll instead). Do NOT flatten this to a linear 1:1 drag — the slight resistance as you approach the dismiss point is the tactile "am I sure?" cue.
3. **The dismiss threshold must feel deliberate, not twitchy.** Reuse `offset.y > 90 || velocity.y > 600`: a small accidental nudge while reading snaps back home; a confident pull or flick lets go. An over-eager threshold that dismisses on a 20px twitch would feel broken and would eat scrolls — the threshold is a discoverability *and* safety lever. A confident flick should dismiss even before 90px of travel (that is what the velocity arm buys).

Discoverability: no new chrome, no tooltip. The grip pill is the only visual affordance; the body-pull is the expected-but-undocumented power gesture. Resting state at the top must be pixel-identical to today (grip pill + hero title + compact identity bar) — this feature adds behaviour, not decoration.

**Artifact:** the executor writes this POV up (expanded) as the `design_brief` at `.ai-workspace/design/1455-drawer-pulldown-dismiss-design.md` before/while building.

---

## #1447 preservation invariants (the hard constraint — do not re-break)

The new gesture must leave every #1447 mechanism intact. The jest `drawer-scroll-contract.test.ts` guards these; the executor MUST keep every existing assertion and add the new one below:

- `.ak-drawer__body` keeps `flex: 1 1 auto` (grow ≥ 1) + `min-height: 0` + `overflow-y: auto` + `overscroll-behavior: contain`.
- `.ak-drawer__head` keeps `flex: 0 0 auto`; subject stays relocated into the body (`ak-drawer__title` after the `.ak-drawer__body` opener; no `ak-drawer__subject`).
- `dragListener={false}` stays on the `motion.aside` (drag is never auto-attached to the whole sheet).
- **NEW invariant — no scroll-killing `touch-action` on the body.** The body must not gain `touch-action: none` / `pan-x` (or any value that disables native vertical pan). Native scroll stays the default; the pull-down is added *on top of* scroll, gated, not *instead of* it. (This is the exact mechanism from cairn line 141 — the reviewer must confirm nothing stamps a scroll-blocking touch-action on the body, from CSS or from framer-motion.)

---

## ### Binary AC

Each is checkable from OUTSIDE the diff (exit code / file presence / test pass). Evaluator = **BOTH** the Playwright test oracle AND a stateless execution-reviewer + a ui-evolve ACCEPT verdict.

**CI gate (jest — runs in `.github/workflows/ci.yml`):**
- **AC1** `npm test` exits 0, AND the new fence assertion is independently present — not merely "the suite is green". Concretely:
  - The executor renders the scroll body (`.ak-drawer__body`) with a **stable sentinel marker attribute `data-ak-pulldown`** in `components/Drawer.tsx` (inert on the DOM; it also serves as the e2e's stable body selector — see AC4–AC7). The `scrollTop`-gated body gesture path lives on that element.
  - `__tests__/drawer-scroll-contract.test.ts` gains a named guard **`A6 (pull-down wiring fence)`** that asserts `drawerSource` contains BOTH the marker token `data-ak-pulldown` AND a `scrollTop` reference (the gate) — so deleting the pull-down wiring (which removes the marker and/or the `scrollTop` gate) turns the suite RED. It must ALSO keep asserting ALL #1447 invariants above (mirrors the existing `A5`/`B*` guards).
  - Independently checkable (outside the diff): `grep -q 'data-ak-pulldown' __tests__/drawer-scroll-contract.test.ts` AND `grep -q 'data-ak-pulldown' components/Drawer.tsx` AND `grep -q "A6" __tests__/drawer-scroll-contract.test.ts` all exit 0, in addition to `npm test` exit 0.
  - Per cairn line 106 this guard is a *regression fence*, not behavioural proof — the behavioural proof is the e2e (AC4–AC7).
- **AC2** `npm run typecheck` exits 0.
- **AC3** Privacy grep clean — using the **long-form exclude pathspec** (the short form `':!__tests__/*'` is BROKEN: git eats the leading `_` as pathspec magic and aborts `fatal: Unimplemented pathspec magic '_'` / exit 128, and a naive `if git grep …; then` wrapper SWALLOWS that fatal and reads it as "clean" — a silently vacuous check; the identical broken pattern pre-exists in `.github/workflows/ci.yml` and is tracked separately under #1457, not #1455's surface). Run exactly:

  ```sh
  git grep -nIE '(/Users/|/home/|[A-Za-z]:[\\/]Users[\\/])[A-Za-z0-9._-]+/' \
    -- . ':(exclude)*.example' ':(exclude).github/workflows/ci.yml' ':(exclude)__tests__/*'
  rc=$?
  # rc==1 => no matches => CLEAN (pass). rc==0 => a home path is tracked => FAIL.
  # rc>=2 (e.g. 128 fatal / bad pathspec) => FAIL LOUD — 'can't tell' is NOT 'clean' (fail-closed).
  [ "$rc" -eq 1 ] || { echo "privacy AC3 FAIL: rc=$rc"; exit 1; }
  ```

  Verified on this repo's git (2.54.0): the long-form `':(exclude)__tests__/*'` runs and returns exit 1 (match-none = clean); the short form returns exit 128. The new e2e spec + design/review artifacts must use repo-relative / `~` paths only — no absolute home paths. No employer/internal identifiers, no personal email in any tracked file. (`__tests__/*` stays exempt: the redaction unit tests carry synthetic home-path-shaped fixtures by design.)

**Behavioural oracle (Playwright, local — new `e2e/drawer-pulldown-dismiss.e2e.spec.ts`, run via `npx playwright test`):** all three touch cases pass, each PROVING the machinery is actually exercised (not a vacuous green).

**Shared-helper mandate (closes Case-C vacuity — REQUIRED):** Cases A, B and C MUST all drive the gesture through ONE shared body-touch helper in the spec — e.g. `pullBody(page, { dy })` (a single sequence of touch `start→move…→end` events dispatched to the `[data-ak-pulldown]` body element, `dy>0` = down, `dy<0` = up). Because Case A proves that this exact helper actually FIRES the gesture (it dismisses), Cases B and C cannot silently pass on a no-op'd touch — they run byte-identical dispatch machinery that A has already proven live. Case C (up → no-dismiss) would otherwise be vacuous (a touch that no-ops also "stays visible"); sharing A's proven-fire helper transfers the non-vacuity. Cases must NOT hand-roll their own divergent touch dispatch.

- **AC4 (Case A — anchor)** With the drawer open and its body at `scrollTop === 0`, `pullBody({ dy: +downPastThreshold })` makes `.ak-drawer` detach (drawer gone → `onClose` fired). The test asserts the drawer was visible before and absent after — so a no-op helper FAILS this case. **This is the proof-of-fire that certifies the shared helper for B and C.**
- **AC5 (Case B)** With the body scrolled (`scrollTop > 0`, using a long/scrollable ticket), the SAME `pullBody({ dy: +down })` leaves `.ak-drawer` STILL visible AND the body's `scrollTop` reflects a native scroll (content moved, sheet did not dismiss).
- **AC6 (Case C)** With the body at the top, the SAME helper with `pullBody({ dy: -up })` leaves `.ak-drawer` STILL visible (no dismiss) — non-vacuous because it reuses A's proven-fire dispatch.
- **AC7 (grip still dismisses)** A grip press + downward drag past the threshold dismisses the drawer (`.ak-drawer` detaches) — the existing affordance is proven intact. (Grip drag targets `.ak-drawer__grip`, not the shared body helper.)

**#1447 regression guard (Playwright, local — existing spec, unchanged):**
- **AC8** `e2e/drawer-long-subject.e2e.spec.ts` (all 4 tests) still passes unchanged: for the pathological 3,000+/500/mega-token subjects, `body.clientHeight > head.clientHeight`, the body is scrollable to its tail, the grip is visible on mobile, and there is no horizontal page overflow. (This is the "reuse/keep the scroll regression guard" requirement — a long-subject ticket still scrolls.)

**UI-task gate artifacts (both required — named):**
- **AC9** `design_brief` present: `.ai-workspace/design/1455-drawer-pulldown-dismiss-design.md` (non-empty, expands the design POV above).
- **AC10** `ui_evolve_verdict` present: `.ai-workspace/design/1455-ui-evolve-verdict.md` with a `verdict: ACCEPT` line + a rubric score, judged on REAL mobile (390×844) + desktop (1440×900) screenshots of the built drawer, asserting no visual regression at rest (grip pill + hero title + compact bar pixel-consistent with #1447).
- **AC11** Execution-review PASS present: `.ai-workspace/reviews/1455-execution-review.md` from a stateless, independent reviewer (Decision: PASS).

**Residual-risk gate (named, non-binary):**
- **AC12 (recommended, not a blocking exit code)** Operator real-device smoke on an iOS Safari device: (a) long ticket still finger-scrolls top→bottom, (b) pull-down at top dismisses, (c) pull-down while scrolled does NOT dismiss. Per cairn line 141 a green chromium run is necessary-but-NOT-sufficient for iOS — the reviewer records this as the honest residual and recommends the device smoke before/with merge; do not let the chromium oracle alone certify iOS.

---

## Evaluator = BOTH (knob B)

- **test-oracle:** the Playwright behavioural spec (AC4–AC8) — real gestures → real dismiss / real scroll, with the false-green guard on Case A.
- **reviewer + ui-evolve:** a stateless execution-reviewer (AC11) AND a ui-evolve ACCEPT verdict with real mobile+desktop screenshots (AC10). Required UI-gate artifacts named above: `ui_evolve_verdict` = `.ai-workspace/design/1455-ui-evolve-verdict.md`; `design_brief`/`design_pov` = `.ai-workspace/design/1455-drawer-pulldown-dismiss-design.md`.

---

## Critical files

- `components/Drawer.tsx` — add the scroll-position-gated body touch handling (touchstart captures start-Y + reads the scroll body's live `scrollTop`; on a confirmed downward move with `scrollTop === 0`, call `controls.start`; otherwise let native scroll run). Reuse the existing `useDragControls` + `dragListener={false}` + `onDragEnd` (90px/600 threshold) unchanged. Guard the new path with `!reduce`. Needs a ref to the scroll body (`.ak-drawer__body`). Render that body with the stable sentinel attribute **`data-ak-pulldown`** (AC1 fence marker + e2e `pullBody` selector).
- `app/globals.css` — likely NO change to `.ak-drawer__body` (must NOT add a scroll-blocking `touch-action`). Any change here is a comment or a deliberately scroll-safe `touch-action` (e.g. explicitly preserving vertical pan) — reviewer scrutinises.
- `__tests__/drawer-scroll-contract.test.ts` — keep all #1447 guards; add the pull-down-wiring fence.
- `e2e/drawer-pulldown-dismiss.e2e.spec.ts` — NEW behavioural oracle (Cases A/B/C + grip). Cases A/B/C share ONE `pullBody(page, { dy })` helper targeting `[data-ak-pulldown]` (the sentinel body marker from AC1) — see the shared-helper mandate; Case A is the proof-of-fire anchor. Reuse `e2e/fixtures/board-fixture.ts` `buildBoard({ longSubjectTicket })` for a scrollable body (Case B needs `scrollHeight > clientHeight`). Use a touch-enabled context; repo-relative paths only.
- `e2e/fixtures/board-fixture.ts` — reuse as-is (long-subject card already yields a scrollable body); extend only if a distinct fixture is genuinely needed.
- `.ai-workspace/design/1455-*.md`, `.ai-workspace/reviews/1455-execution-review.md` — UI-gate + review artifacts.

---

## Alternatives considered

1. **Re-enable whole-sheet `drag` (drop grip-only) + cancel drag when `scrollTop > 0`.** REJECTED — this is exactly the #1447/#49 conflict: `drag` on the scroll ancestor stamps `touch-action` and, once a drag has *started*, framer-motion has already claimed the pointer, so native scroll is pre-empted before you can cancel. Gate BEFORE `controls.start` (only at-top + down), never cancel mid-drag.
2. **`onDrag` handler that reverses/cancels when scrolled.** REJECTED as primary for the same reason — the damage (touch-action stamp + pointer capture) is done at drag start, not at the reversal point; janky on real devices.
3. **Pure-CSS scroll-snap / no JS.** REJECTED — cannot express "dismiss on over-pull at the top" without JS gesture logic.
4. **A dedicated invisible drag strip at the top of the body.** REJECTED — not the iOS feel (you should be able to pull anywhere on the content when at the top); adds an invisible mode boundary and clutter.
5. **Wire the new e2e into CI.** DEFERRED (out of scope) — CI currently runs jest only; the existing `drawer-long-subject.e2e.spec.ts` is also a local-only oracle. Keeping parity: jest is the CI regression fence, Playwright is the local behavioural oracle. Wiring Playwright into CI is a separate infra ticket.

---

## Deferred-follow-ups:

- **Wire Playwright e2e into CI** — DEFERRED (Alternative 5). Not this ticket; matches the existing local-only-oracle pattern (`drawer-long-subject.e2e.spec.ts` is also CI-absent). → file a follow-up task if/when we want the touch oracle to gate CI.
- **iOS real-device certification (AC12)** — not automatable in this repo (chromium-only Playwright). Surfaced as the named residual-risk gate AC12; operator device smoke recommended at/with merge. → file an iteration ticket (VEI, ticket-at-identification) if the device smoke reveals any scroll/dismiss regression.

---

## Risks for the plan-reviewer to scrutinise (especially the gating)

- **R1 — scroll-vs-dismiss gating (THE place this re-breaks #1447).** Confirm the gate reads a LIVE `scrollTop` at gesture start and only starts the dismiss drag on a confirmed downward move at `scrollTop === 0`. If it starts too eagerly (before confirming down / before confirming top), it eats native scroll = #1447 regression class.
- **R2 — no scroll-killing `touch-action` on the body.** Confirm nothing (CSS or framer-motion) stamps `touch-action: none`/`pan-x` on `.ak-drawer__body`. cairn line 141 is the exact prior trap.
- **R3 — chromium ≠ iOS (necessary-not-sufficient).** cairn line 141 ("chromium scrolls fine, iOS doesn't") + line 151 (synthetic Touch may not reproduce iOS). The reviewer must weigh whether the oracle faithfully exercises the gesture (real trusted touch events, real dismiss/scroll observed) and require the operator device smoke (AC12) as the honest final gate — do not certify iOS on chromium alone.
- **R4 — false-green in the e2e.** If the touch simulation no-ops, Cases B and C "pass" vacuously (nothing happened) and only Case A would expose it. Confirm Case A actually dismisses via the gesture (drawer detaches), proving the machinery is exercised.
- **R5 — mid-gesture handoff.** Confirm the spec's "latch at gesture start, no scroll→dismiss handoff mid-gesture" is what the implementation and tests actually encode (deterministic behaviour).
- **R6 — desktop untouched.** Confirm the body-pull does not hijack desktop wheel/trackpad/mouse scroll (grip is `display:none` on desktop; the drawer is a side-panel).

---

## Review

**Reviewer:** plan-reviewer (role 2 of 4), stateless, independent — pre-implementation. Grounded in: full read of `components/Drawer.tsx`, the #1447 history (`git log -p -2` — commits #49 and #53), `__tests__/drawer-scroll-contract.test.ts`, `e2e/drawer-long-subject.e2e.spec.ts`, `e2e/fixtures/board-fixture.ts`, the `.ak-drawer__body` / `.ak-drawer__grip` CSS in `app/globals.css`, and a live verification of every cairn citation + the AC3 privacy command.

### Decision (round 1): NEEDS-WORK → Decision (round 2, current): PASS

**Round 2 (re-review after planner revision) — all three findings verified genuinely resolved (not merely acknowledged), each re-proven live on this repo's git:**

1. **[BLOCKER] AC3 privacy pathspec — RESOLVED.** AC3 (lines 90–101) now uses the long-form `':(exclude)__tests__/*'` (plus long-form excludes for `*.example` / `ci.yml`) AND encodes an explicit rc-checked, fail-closed block: `rc=$?; [ "$rc" -eq 1 ] || { echo "privacy AC3 FAIL: rc=$rc"; exit 1; }`. Verified live: the plan's exact block returns `rc=1 → CLEAN (pass)`, and a fatal (`rc=128`, reproduced via the old short form) is correctly rejected as NON-clean → FAIL LOUD. Exit 128 can no longer read as "clean" — the silent-vacuity hole is closed. The pre-existing identical bug in `.github/workflows/ci.yml` is now tracked under #1457 (correctly out of #1455's write surface).
2. **[REQUIRED] AC1 fence independently checkable — RESOLVED.** A stable sentinel `data-ak-pulldown` is rendered on the scroll body (also the e2e's `pullBody` selector), and a named jest guard **`A6 (pull-down wiring fence)`** asserts `drawerSource` contains BOTH `data-ak-pulldown` AND a `scrollTop` reference; AC1 adds three independent greps (`data-ak-pulldown` in the test AND in `Drawer.tsx`, plus `A6` in the test) beyond `npm test` exit 0. Load-bearing confirmed: the markers are absent from `Drawer.tsx`/the test today (`grep -c` = 0), so deleting the pull-down wiring removes the marker and turns the suite RED. Honestly scoped as a source fence (cairn line 106), with the e2e (AC4–AC7) as the behavioural proof.
3. **[RECOMMENDED] Case-C vacuity — RESOLVED.** A "Shared-helper mandate" (lines 103–110) now REQUIRES Cases A/B/C to drive one `pullBody(page, {dy})` helper against `[data-ak-pulldown]`, with Case A (dismiss) as the proof-of-fire that certifies the shared dispatch, and forbids per-case hand-rolled touch dispatch. Case C (up → no-dismiss, AC6) explicitly reuses A's proven-fire helper, so a no-op'd touch can no longer green it vacuously.

No new issues introduced by the revision. The core feature design (scroll-vs-dismiss gate, #1447 preservation, UI-gate artifacts, chromium-vs-iOS honesty) is unchanged and remains sound. **Round-2 verdict: PASS — cleared for execution.**

---

**Round 1 findings (retained for provenance):** The feature design was strong — the scroll-vs-dismiss gate, #1447 preservation, non-vacuity anchor, UI-gate artifacts, and chromium-vs-iOS honesty were all well-specified. One binary AC (AC3) was defective as written and, in its CI-wrapper form, silently vacuous — empirically proven below. Two cheaper strengthenings on the regression-fence (AC1) and Case-C non-vacuity rounded it out. The revision was surgical; the core plan stood.

### Cairn-citation verification — REAL, faithfully quoted
Verified against the source T1 store (`~/.claude/cairn/t1-run-scratch/2026-07-03/ee426cae-…jsonl`):
- **Line 141** (the load-bearing trap) — quoted in the plan **verbatim and complete** ("iOS touch-scroll: min-height:0 fixes wheel/desktop but Framer-Motion drag on a scroll-region ANCESTOR breaks native finger-scroll on iOS Safari EVEN with dragListener=false + touch-action:auto … verify on the real failing engine (iOS device)"). Verified.
- **Line 210** (#1447 root-cause correction) — faithfully paraphrased ("flexbox bug not iOS touch-drag … reproduce the ACTUAL failing record, not a synthetic long-body proxy"). Verified.
- **Line 106** (contract-test caveat) + **Line 151** (synthetic-Touch no-op) — both real and faithfully represented. Verified.

No fabrication. The plan's stated understanding of *why* grip-only drag exists is corroborated by commit #49's own message ("the whole `motion.aside` was a y-drag surface, so framer-motion stamped `touch-action:pan-x` on it and killed native vertical touch-scroll").

### Checklist findings

1. **Binary AC quality** — Mostly good; two gaps (AC3 = blocker, AC1 = cheap fix), below. AC2/AC4–AC12 are checkable from outside the diff. No AC secretly requires diff-reading.
2. **Non-vacuity (both-ends)** — Case A (AC4) is a genuine anti-false-green anchor (drawer visible-before / absent-after via the body gesture). Case B (AC5) carries its *own* second non-vacuity guard (asserts `scrollTop` moved — a no-op touch fails it). Case C (AC6) is the one residually-vacuous case ("still visible" passes if the touch no-ops); the plan is honest about this in R4 but does not *mandate* the mechanism that rescues it — see required change #3.
3. **#1447 regression fence** — KEPT. AC1 preserves every existing `drawer-scroll-contract` assertion (A1/A2/A5/B1–B4 confirmed present in the test) and AC8 keeps all 4 `drawer-long-subject` e2e tests unchanged. The new touch-action invariant is *additive*, not a relaxation. Verified.
4. **Scroll-vs-dismiss gate (R1) + latch (R5)** — Well-specified: live `scrollTop` read at gesture start, `controls.start` only on a confirmed downward move at `scrollTop === 0`, decision **latched at gesture start** with no mid-gesture scroll-to-dismiss handoff (Interaction-spec Case B is explicit: "NEVER start a dismiss drag for this gesture, even if the finger later drags the content to the top"). Rejected Alternatives 1 & 2 correctly identify that gating must happen *before* `controls.start` (framer-motion claims the pointer at drag start). Verified.
5. **touch-action (R2)** — The plan explicitly forbids adding `touch-action: none/pan-x` to `.ak-drawer__body` and adds a jest fence for it. Confirmed the current `.ak-drawer__body` block has NO `touch-action` (scroll-permissive); `touch-action: none` is correctly scoped to `.ak-drawer__grip` only. Verified.
6. **chromium-vs-iOS honesty (R3)** — Honest. AC12 is a *named, explicitly-non-binary* operator iOS-device smoke; the plan states the chromium oracle is necessary-not-sufficient and that CI runs jest+typecheck+privacy only. Confirmed against `.github/workflows/ci.yml`: CI runs `npm run typecheck`, `npm test`, a commit-message check, and the privacy job — **no Playwright**. Verified.
7. **UI-task gate** — BOTH artifacts named: `design_brief` (AC9 → `.ai-workspace/design/1455-drawer-pulldown-dismiss-design.md`) AND `ui_evolve_verdict` (AC10 → `.ai-workspace/design/1455-ui-evolve-verdict.md`, `verdict: ACCEPT` + rubric score + real 390×844 mobile & 1440×900 desktop screenshots + no visual regression at rest). Verified.
8. **Privacy** — The plan file **itself is home-path-clean**: the only `/Users/`/`/home/` occurrences are inside the AC3 regex literal (each followed by `|`, so no real `/Users/<name>/` path — the AC3-shaped grep does not flag it). The current tree is genuinely clean (verified with a working long-form grep: exit 1 / no matches). Substance is fine; the *command* is defective — see required change #1.
9. **Scope/elegance** — Minimal-impact and elegant: reuses the existing `useDragControls` + `dragListener={false}` + `onDragEnd` (90px/600 threshold) and only adds a scroll-gated body-touch path guarded by `!reduce`. No gratuitous refactor. Verified.

### Required changes (for the SAME planner to revise)

1. **[BLOCKER] AC3's privacy command is broken as written and silently vacuous in the CI-wrapper form.** Empirically, on this repo's own git (2.54.0), the short-form pathspec `':!__tests__/*'` errors: `fatal: Unimplemented pathspec magic '_'` (exit 128) — git's short-form magic parser consumes the **leading underscore** of `__tests__` as a magic sigil. Proven: `':!node_modules'` works but `':!__tests__/*'`, `':!__tests__'`, `':^__tests__/*'`, and `':!_foo'` all exit 128, while the long form `':(exclude)__tests__/*'` works (exit 1 = clean). Consequences: (a) the executor/reviewer running AC3's bare command gets a fatal error, never a clean "no matches" — AC3 is unsatisfiable-as-written; (b) worse, the identical pattern in `.github/workflows/ci.yml` is wrapped as `if git grep … ':!__tests__/*'; then exit 1; fi` under `set -e` — the git fatal (128) makes the `if` false, the `then` is skipped, and the **home-path privacy check passes silently without ever running** (demonstrated live). **Fix:** rewrite AC3 to use the working long-form exclude `':(exclude)__tests__/*'` (keep the `':!*.example'` / `':!.github/workflows/ci.yml'` short-form excludes — those start with non-`_` chars and parse fine).
2. **[REQUIRED, cheap] AC1's new "body pull-down fence" is not independently checkable — name the exact assertion.** "gains a guard that fences the new body pull-down wiring" is aspirational as stated: `npm test` exiting 0 proves the *existing* assertions pass, not that a *new* one was added — an executor could skip it and AC1 still greens. Since this is the #1447-class regression fence for the new gate, name the concrete source marker the new assertion greps for (e.g. the touch-start handler + the `scrollTop === 0` gate + a scroll-body ref on `.ak-drawer__body` in `Drawer.tsx`) so its removal fails the suite. Keep the cairn-line-106 caveat that this is a source fence, not behavioural proof.
3. **[RECOMMENDED] Close the residual Case-C vacuity: mandate ONE shared body-touch helper across Cases A/B/C.** Case A proves the gesture fires (drawer detaches) and Case B proves it fires (scrollTop moves), but that proof only transfers to Case C ("up → still visible", otherwise vacuous) if all three cases drive the body through the **same** touch helper. Add an invariant to the e2e AC (AC4–AC6) that A/B/C share one helper, so a no-op touch would break A and B and can't leave C falsely green. (The plan already reasons this in R4 — make it a spec requirement, not just an observation.)

### Follow-ups:
- **Fix the same broken `':!__tests__/*'` pathspec + the swallow-error `if git grep` wrapper in `.github/workflows/ci.yml`** — pre-existing (NOT introduced by #1455), the identical bug means CI's home-path privacy grep can pass silently on any git that rejects the short-form leading-underscore pathspec. → file a follow-up task (VEI, ticket-at-identification) linked to #1455; harden the wrapper so a git error fails loudly (capture output or test exit `-eq 0` explicitly) rather than reading a fatal as "no matches".

### Ledger
Ledger line self-appended from ai-brain: `--role plan-review --verdict FAIL` (NEEDS-WORK) for task 1455.
