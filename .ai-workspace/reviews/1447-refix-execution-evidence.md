# 1447 (CYCLE 2 — REFIX) — EXECUTION EVIDENCE

`3ROLE_TASK:1447 ROLE:executor` · repo `agent-kanban` · branch `1447-drawer-scroll-refix` (off `origin/master` @ f760c2c) · session `ee426cae-9054-4680-91ab-5397aa6f573a`

Option B — KEEP the swipe gesture, ship `transform: translateZ(0)` ALONE (single-variable experiment). Plan: `.ai-workspace/plans/2026-07-03-1447-drawer-scroll-refix.md` (PASSED plan-review v2 `.ai-workspace/reviews/1447-refix-plan-review.md`).

---

## Production diff — EXACTLY ONE CSS line (AC4)

```
diff --git a/app/globals.css b/app/globals.css
@@ -1029,6 +1029,7 @@ button {
   overflow-y: auto;
   overscroll-behavior: contain; /* don't chain scroll to the page behind */
   -webkit-overflow-scrolling: touch; /* momentum scroll on iOS */
+  transform: translateZ(0); /* iOS: force the overflow region onto its own touch-scroll/compositing layer (single-variable fix — #1447 cycle 2) */
   padding: 14px 16px 26px;
 }
```

`git diff --stat origin/master -- app components` → `app/globals.css | 1 +` (1 insertion). No other production change.

## AC1 — Drawer.tsx byte-identical to master (single-variable guarantee)

`git diff origin/master -- components/Drawer.tsx` → **EMPTY** (printed nothing). Motion `drag`, `dragListener={false}`, `onDragEnd`, `useDragControls`, the grip's `onPointerDown`, and the entrance/exit spring all remain exactly as merged in f760c2c.

## AC2 / AC5 — grip + desktop panel unchanged

`.ak-drawer__grip` still declares `touch-action: none` + `cursor: grab` (untouched). Desktop media query still sets `.ak-drawer { left:auto; right:0; top:0; bottom:0; width:min(440px,92vw) }` and `.ak-drawer__grip { display:none }` (untouched — outside the one-line diff).

---

## CG1 — Gates (all GREEN, real output)

| Gate | Command | Result |
|---|---|---|
| Typecheck (AC12) | `npx tsc --noEmit` | **exit 0** (no output) |
| Full jest suite (AC11) | `npm test` | **26 suites / 272 tests passed** |
| Jest tripwire (AC6) | `npx jest drawer-scroll-contract` | **7/7 passed** |
| E2E permanent guard (AC7) | `PW_PORT=3947 PW_WEB_SERVER=1 npx playwright test drawer-scroll` | **passed** — see below |

> **Lint**: this repo has NO `lint` script, no eslint config, and no eslint dependency in `package.json`. Its static-analysis gate is `tsc --noEmit` (green above) — that is the repo's lint-equivalent, matching the plan's CG1/AC12.

> **Port note**: port 3939 (the AC7 default) was already occupied by a *foreign* `next dev` from the primary clone's diagnosis session. With `reuseExistingServer: true`, running on 3939 would have served the primary clone's build (not this worktree's), silently masking my CSS changes and breaking the e2e RED demo. So the spec was made `baseURL`-relative (`page.goto("/")` instead of hardcoded `localhost:3939`) and each verification ran with `PW_PORT=<free>` so Playwright booted **this worktree's** `next dev`. In CI (3939 free) the literal AC7 command works unchanged.

### E2E GREEN (AC7) — trusted CDP touch swipe, chromium mobile

```json
{ "before": 0, "after": 548, "delta": 548,
  "overflow": { "scrollHeight": 3548, "clientHeight": 640 },
  "touchmoveEvents": { "n": 9, "prevented": 0 } }
```
- Precondition — body overflows: `scrollHeight 3548 > clientHeight 640` ✓
- Scroll moved: `scrollTop 0 → 548` (delta **548px** > 100 threshold) ✓
- No touch blocking: **0** touchmove `defaultPrevented` (9 touchmove events observed) ✓

---

## CG2 — Both-ends RED proof (AC9)

A guard never seen RED is not trusted. Both demonstrated RED, then restored to GREEN.

### (1) e2e RED — strip `min-height:0` + `overflow-y:auto` from `.ak-drawer__body`

Re-ran `PW_PORT=3948 PW_WEB_SERVER=1 npx playwright test drawer-scroll.e2e`:
```
Error: expect(received).toBeGreaterThan(expected)
    Expected: > 3548
    Received:   3548
>  97 |   expect(dims.scrollHeight).toBeGreaterThan(dims.clientHeight);
  1 failed
```
Without the recipe the body expands to full content height (`scrollHeight == clientHeight == 3548`) — no overflow region, nothing to scroll — so the precondition fails. **This proves the e2e detects a broken scroll recipe.** Restored both lines → e2e GREEN again (delta 548, prevented 0).

### (2) jest RED — delete the `transform: translateZ(0)` line

Re-ran `npx jest drawer-scroll-contract`:
```
Expected pattern: /transform\s*:\s*translateZ\(\s*0\s*\)/
Received string:  "... -webkit-overflow-scrolling: touch; ... padding: 14px 16px 26px; "
> 81 |     expect(body).toMatch(/transform\s*:\s*translateZ\(\s*0\s*\)/);
Tests:       1 failed, 6 passed, 7 total
```
**This proves the jest tripwire actually guards THIS cycle's fix.** Restored the line → jest GREEN again (7/7).

### CRUCIAL HONEST CAVEAT (chromium cannot RED on the actual fix)

There is **NO chromium behavioral both-ends for `translateZ(0)`**. Chromium scrolls fine WITH or WITHOUT the hint (it scrolled fine even on the cycle-1 shipped-broken state, delta 548 either way). The e2e RED above breaks the *scroll recipe* (a different thing), not the `translateZ` variable — under a CSS-only single-variable change chromium is **structurally incapable** of a behavioral RED on the variable, because the failure it targets is iOS-only and chromium does not reproduce it. The jest tripwire is a **structural** (source-present) guard, not a behavioral one. **The ONLY oracle that can prove the fix WORKS is the operator's real iPhone (plan AC14 / CG5). Chromium-green ≠ iOS-works** — this is the exact trap that made cycle 1 falsely green.

---

## CG3 — Chromium scrolled-to-bottom screenshot (AC10, Rule-19 eyeball)

`test-results/1447-drawer-scrolled-bottom.png` → copied to `.ai-workspace/reviews/1447-drawer-scrolled-bottom.png`.

Eyeballed: the frame shows the drawer scrolled to the very bottom — ticket description ending at "Paragraph 60 … somewhere to go", then the pipeline-progress header (PLANNER / PLAN-REVIEW / EXECUTOR / EXEC-REVIEW) and the full BLACK-BOX TIMELINE with all 4 role rows. Text renders **crisply** in chromium (no visible blur); no letterboxing, no dev-text leak, no placeholder, correct drawer chrome (grip bar, ✕, IN PROGRESS chip). The small "N" glyph bottom-left is the expected Next.js dev-mode indicator.

## CG4 — UI-task-gate

No *intended* visual change — one CSS compositing hint on the scroll body; swipe/grip/dismiss unchanged. Recommended satisfaction is the specific `metadata.ui_gate_skip` (≥20 chars) at `TaskUpdate→completed`:

> `single-variable functional scroll fix — one CSS line (transform: translateZ(0)) on the drawer body for iOS scroll-layer promotion; zero intended visual change; swipe/grip/dismiss unchanged; proven by chromium trusted-touch e2e + operator real-device scroll`

The chromium scrolled-to-bottom screenshot (CG3) is the eyeball evidence. The one cosmetic risk `translateZ(0)` introduces (promoted-layer text softening at some retina DPRs) is folded into AC14 for on-device confirmation.

## AC13 — Privacy (public repo)

`git grep -nE '/Users/|/home/' -- app __tests__ e2e` over committed files → nothing (tests read source via `join(__dirname, "..")`; fixtures synthetic; no home-path/secret/employer-brand literals).

## AC8 — Diag removed

`e2e/drawer-scroll-diag.e2e.spec.ts` does not exist on this branch (never on origin/master). The untracked diag in the primary clone was `mv`-quarantined to `~/coding_projects/_quarantine/1447-drawer-scroll-diag-20260703/` per Rule 14.

---

## CG5 — AC14 operator real-device (NOT satisfiable by any machine here — FINAL GATE)

**#1447 cannot be marked done until the operator loads the deployed/preview build on their real iPhone (iOS Safari), opens a long ticket (≥ ~30 timeline nodes), and confirms: (a) a finger-drag on the body scrolls all the way to the bottom; (b) swipe-down-on-grip dismiss + ✕ / scrim-tap / Escape all still work; (c) the ticket text/timeline still renders CRISPLY (no blurriness — `translateZ(0)` can soften a promoted layer at some retina DPRs).** No local test substitutes (no iOS engine here; CDP trusted-touch is chromium-only). This is the single-variable verdict: scrolls ⇒ `translateZ(0)` alone was the fix (drag exonerated); doesn't ⇒ cycle 3 executes Appendix A (remove drag).

## Plan-review MINOR folds applied to the carried plan

- L95 CRUCIAL HONEST CAVEAT: "AC13 / CG5" → **"AC14 / CG5"** (AC13 is the privacy grep).
- AC14 now also asks the operator to confirm text renders CRISPLY (translateZ promoted-layer softening risk); §UI-task-gate softened "zero visual change" → "nothing a user *intends* to look at … cosmetic risk verified on device per AC14".
