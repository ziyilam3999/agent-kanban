# #1455 — Execution review (drawer pull-down-from-top drag-to-dismiss)

**Decision: PASS**

Tag: `3ROLE_TASK:1455 ROLE:execution-review`. Stateless, independent reviewer — did NOT write this code. PR #54 (`1455-drawer-pulldown` → `master`). Reviewed in-worktree at `<repo>/.claude/worktrees/1455-drawer-pulldown`. Every automatable AC the executor was responsible for (AC1–AC9, AC11) is independently re-proven below with real command output. AC10 (ui-evolve verdict) is a **separate leg** (I was explicitly told not to run ui-evolve) — it is expected-pending, not an executor miss. AC12 (iOS device smoke) is the honest non-blocking residual, recorded not gated.

---

## Cairn search (done first)
`node skills/cairn/bin/cairn-find.mjs "drawer"` and `"touch"` — hits confirm the load-bearing traps the plan is built around: T1 2026-07-03 line 141 ("Framer-Motion drag on a scroll-region ANCESTOR breaks native finger-scroll on iOS Safari … chromium scrolls fine, iOS doesn't … verify on the real failing engine"), line 210 (#1447 = flexbox bug, reproduce the actual failing record), line 106 (a source contract test is not runtime behavioural proof). All three are faithfully honored in the diff (grip-only drag kept; source fence + Playwright oracle; AC12 iOS residual surfaced).

---

## Per-AC evidence

### AC1 — `npm test` green + independent A6 fence present, genuinely both-ends (RED on master)
- **Full suite:** `npx jest` → **26 suites passed, 281 tests passed** (Time 3.75s). Matches the executor's 281/281 claim.
- **Contract suite:** `npx jest drawer-scroll-contract` → **13 passed / 13 total**, including the two new fences:
  - `A6 (pull-down wiring fence): … renders the stable sentinel data-ak-pulldown on the scroll body` ✓
  - `A6 (pull-down wiring fence): … gates the body pull-down gesture on a live scrollTop read` ✓
  - All pre-existing #1447 guards (A1/A2/A5/B1–B4) still green.
- **Both-ends proven (not a compile/import artifact):** the test loads the source as a STRING via `readFileSync(join(__dirname, "..", "components", "Drawer.tsx"))` and asserts `.toMatch()`. On `origin/master`:
  - `git show origin/master:components/Drawer.tsx | grep -c data-ak-pulldown` → **0**
  - `git show origin/master:components/Drawer.tsx | grep -c scrollTop` → **0**
  - `git show origin/master:__tests__/drawer-scroll-contract.test.ts | grep -c A6` → **0**
  So BOTH A6 assertions fail as genuine `0 matches ≠ expected` assertion failures on master — a real RED, not a throw/compile error. The second fence (`scrollTop`) is non-vacuous specifically because master's Drawer had zero `scrollTop` references, so it truly tracks the new gate.
- **Independent greps (outside the diff):** `data-ak-pulldown` present in both `Drawer.tsx` and the test; `A6` present in the test — all exit 0.

### AC2 — `npm run typecheck` exit 0
`tsc --noEmit` → **exit 0**, no diagnostics.

### AC3 — Privacy grep clean (fail-closed, long-form pathspec)
Ran the plan's exact long-form command in the worktree:
```
git grep -nIE '(/Users/|/home/|[A-Za-z]:[\\/]Users[\\/])[A-Za-z0-9._-]+/' \
  -- . ':(exclude)*.example' ':(exclude).github/workflows/ci.yml' ':(exclude)__tests__/*'
rc=$?   # → rc=1  (match-none = CLEAN)
```
`PRIVACY_RC=1 → CLEAN`. Cross-checked with a pager-immune count form: `git grep -IE '<pattern>' -- . <excludes> | grep -Ec '.'` → **MATCH_COUNT=0**. No `/Users/` or `/home/` home paths in any tracked, non-exempt file (the new e2e spec, design brief, and this review all use repo-relative / no-path literals). No employer/internal identifiers, no personal email. `test-results/` (Playwright artifacts from my runs) is gitignored (`!!` in `git status --ignored`) and will NOT ship.

### AC4–AC7 — Playwright behavioural oracle (Cases A/B/C/D), independently RE-RUN
`PW_WEB_SERVER=1 npx playwright test e2e/drawer-pulldown-dismiss.e2e.spec.ts` → **4 passed (18.9s)**:
- **AC4 Case A (anchor):** at-top + drag-down → `.ak-drawer` detaches (`toHaveCount(0)`). Proof-of-fire: a no-op'd `pullBody` would leave it visible → this case would FAIL. It passed → the shared dispatch is genuinely live. ✓
- **AC5 Case B:** scrolled (`scrollTop=120`) + same `pullBody({dy:180})` → drawer STILL visible AND `finalScrollTop < 120` (native scroll moved content, sheet did not dismiss). Non-vacuous via its own scrollTop-moved assertion. ✓
- **AC6 Case C:** at-top + drag-UP (`dy:-180`) via the SAME helper → drawer STILL visible. Non-vacuity transfers from A's proven-fire dispatch (shared-helper mandate satisfied — Cases A/B/C all route through `pullBody` → `touchDrag([data-ak-pulldown])`; no per-case hand-rolled dispatch). ✓
- **AC7 Case D:** grip press + downward drag on `.ak-drawer__grip` (NOT the body helper) → drawer detaches. Existing affordance intact. ✓

The oracle uses CDP `Input.dispatchTouchEvent` (real engine-level touch input driving the real PointerEvent stream), not synthetic `new TouchEvent` — correct per cairn line 151.

### AC8 — #1447 long-subject regression guard, independently RE-RUN
`PW_WEB_SERVER=1 npx playwright test e2e/drawer-long-subject.e2e.spec.ts` → **4 passed (15.7s)**. For 3,000/500/mega-token subjects: body owns the column (e.g. `body.clientHeight=648 body.scrollHeight=2124 head.clientHeight=50` @390 — body is scrollable to its tail, head stays 50px), no horizontal page overflow, grip visible on mobile, desktop side-panel unbroken. The long-subject invariant is preserved.

### AC9 — design_brief present + non-empty
`.ai-workspace/design/1455-drawer-pulldown-dismiss-design.md` — present, **51 lines**, substantive (expands the POV, documents the implementation trap honestly, references the 3 committed screenshots). (`.ai-workspace/design/1455-drawer-pulldown.md` is a byte-identical duplicate — harmless redundancy; both non-empty.)

### AC10 — ui_evolve_verdict — PENDING (separate leg, out of this review's scope)
`.ai-workspace/design/1455-ui-evolve-verdict.md` is ABSENT. This is EXPECTED: ui-evolve is a separate leg (I was told not to run it). The screenshots it needs are already committed (`screens-1455/{m-01-resting-state,m-02-mid-pulldown,d-01-side-panel}.png`). **This is not a blocker for the execution-review PASS, but the ui-evolve ACCEPT verdict IS a required gate before merge** — flagging so it is not lost.

### AC11 — Execution-review PASS
This document. Decision: PASS.

### AC12 — iOS real-device smoke — honest non-blocking residual
Recorded, not gated. See risk R3 below.

---

## Risky-implementation findings (this is where I tried to break it)

**R1/R5 — scroll-vs-dismiss gate + latch: VERIFIED IN CODE, distinguishes BOTH direction AND scrollTop.**
The gate is a single latched expression: `gesture.dismiss = dy > 0 && gesture.startedAtTop` (set once, when `|dy| ≥ PULLDOWN_INTENT_PX (6)`, then never re-evaluated). `startedAtTop` is captured at pointer-down from the LIVE `(bodyRef.current?.scrollTop ?? -1) === 0`. This genuinely ANDs direction (`dy > 0`) with position (`startedAtTop`) — Case B (`startedAtTop === false`) can never dismiss regardless of later direction, and Case C (`startedAtTop === true` but `dy < 0`) stays scroll. No mid-gesture scroll→dismiss handoff. Matches the Interaction spec exactly, not just the tests.

**R2 — no scroll-killing `touch-action` on the body: CONFIRMED.**
`app/globals.css` is NOT in the diff (unchanged). Its `.ak-drawer__body` block (L1037) has flex/min-height:0/overflow-y:auto/overscroll-behavior:contain/`-webkit-overflow-scrolling:touch`/padding — **no `touch-action`**. The only `touch-action: none` in the file (L958) is inside `.ak-drawer__grip`, pre-existing. Framer-motion does not stamp touch-action on the body either (drag stays on `motion.aside` with `dragListener={false}`, unchanged). The #1447 mechanism is intact.

**Listener lifecycle — no leak/refire.** The non-passive `touchstart`/`touchmove` listeners are added in a `useEffect` whose cleanup calls `removeEventListener` for both; deps `[reduce, ticket]` re-attach on body remount and remove on unmount/close (the body only exists in the DOM while `ticket` is set, via AnimatePresence). No dangling listener across drawer open/close cycles.

**No double-apply of scroll (native + manual).** For a gesture that `startedAtTop`, native scroll is pre-emptively suppressed (touchstart `preventDefault` at scrollTop 0 + touchmove `preventDefault` while `startedAtTop`), and ONLY the manual `scrollTop +=` replay runs. For Case B (`startedAtTop === false`) the touchmove listener does NOT `preventDefault` (native scroll runs) AND the manual replay branch is gated on `startedAtTop` (never fires). The two paths are mutually exclusive — no path applies both. The replay math is correct: the resolving move applies the full `startY→current` delta, subsequent moves apply per-step `lastY - clientY` deltas — no gap, no overlap.

**Reduced-motion / accessibility: RESPECTED.** All four body handlers (`onBodyPointerDown/Move/End`) and both native listeners early-return when `reduce` (`useReducedMotion()`) is true; `motion.aside` uses `drag={reduce ? false : "y"}` and the dismiss exit animation is `{opacity:0}` at `duration: 0` under reduce. The new gesture adds no motion path when reduced-motion is on — dismiss stays ✕ / ESC / scrim, identical to today.

**R6 — desktop untouched: VERIFIED.** The body pointer handlers early-return on `e.pointerType !== "touch"`, so a desktop mouse drag/select never engages dismiss; wheel/trackpad scroll never routes through these handlers at all. Grip is `display:none` on desktop. Desktop scroll behaves exactly as before.

**R3 — chromium ≠ iOS (the real residual).** My behavioural proof is Chromium CDP touch; the whole mechanism is a non-passive `touchstart preventDefault` + **manual `scrollTop` replay** designed around a Chromium/WebKit takeover the executor verified empirically. The manual replay is LINEAR — it has **no momentum/inertia**, so on real iOS the *first* from-top scroll gesture (which is owned for its whole lifetime once `startedAtTop`) will lose flick momentum until the finger lifts; subsequent gestures (scrollTop > 0, Case B) get native momentum scroll. This is a *feel* degradation, NOT a #1447-class "can't scroll" regression (AC8 proves the body stays scrollable to its tail). Per cairn line 141 a green chromium run is necessary-but-not-sufficient — **AC12 operator iOS-Safari device smoke is a genuine required residual before/with merge: (a) long ticket still finger-scrolls top→bottom, (b) pull-down at top dismisses, (c) pull-down while scrolled does NOT dismiss.** Do not let the chromium oracle alone certify iOS.

**Minor observation 1 (tap-suppression) — currently MOOT, forward-looking caveat.** `onTouchStart` calls `preventDefault()` for any single-finger touch at `scrollTop === 0`, which suppresses compatibility mouse/`click` synthesis. Today this is harmless: `.ak-drawer__body` contains ZERO interactive elements (hero title, description `<p>`, PipelineProgress, and the timeline are all non-interactive `<span>`/`<p>`/`<li>`; the close `<button>` lives in `.ak-drawer__head`, outside the body). CAVEAT for future work: if a link/button is ever added inside the body, a tap on it while at the very top could be swallowed on touch devices — worth a guard or a comment then. Not a blocker now.

**Minor observation 2 (touchscreen desktop).** The body-pull is gated on `pointerType === "touch"`, not on viewport, so a touch-pull on a touchscreen *desktop* side-panel at the top would engage dismiss. The contract only scopes "mouse/wheel must not dismiss" (satisfied); touch-on-touchscreen-desktop dismissing is a gray area, not a contract violation. Note only.

---

## Verdict

**PASS.** typecheck exit 0; jest 281/281 (contract 13/13 incl. 2 genuinely-RED-on-master A6 fences); privacy grep clean (rc=1 / 0 matches, fail-closed); Playwright oracle 4/4 (A/B/C/D) and #1447 long-subject 4/4, both independently re-run by me; design brief present. The gate correctly ANDs direction and scrollTop, latches once, cleans up its listeners, never double-applies scroll, respects reduced-motion, and leaves desktop + every #1447 mechanism untouched. Remaining gates outside this review: the **ui-evolve ACCEPT verdict (AC10)** and the **iOS-device smoke (AC12, R3)** — both required before merge; neither is an executor defect. No blocking issues found.
