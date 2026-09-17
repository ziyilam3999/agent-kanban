# Red-evidence — #2499 folding-phone front-screen shelf reachability

Task: `2499` / `agent-kanban` (`Bookkeeping shelf unreachable on folding-phone front screen`). Plan:
`.ai-workspace/plans/2026-09-12-agent-kanban-folding-phone-shelf-unreachable-front-screen.md`
(plan-review PASS, `71d942a`). Spec: `e2e/shelf-front-screen-reachable.e2e.spec.ts`.

RED baseline: `origin/master dd59d07` (a temporary detached worktree at that exact commit, product
code UNTOUCHED, new spec file copied in — no CSS/component edits present). GREEN: the fix branch
`2499-folding-phone-shelf-reachable`, SAME spec file, SAME frozen harness parameters.

## AC1 — collapsed shelf reachable within the initial viewport [RED -> GREEN]

`PW_WEB_SERVER=1 npx playwright test e2e/shelf-front-screen-reachable.e2e.spec.ts --project=chromium --reporter=list`

Harness: 344x882 touch viewport (`hasTouch:true, isMobile:true, deviceScaleFactor:2.6`), a
synthetic production-volume board (`buildBoard({ liveLanes:0, extraTodoCount:40 })` — 43 total
cards, 41 in the `todo` column) so the single 88vw column is genuinely taller than the viewport.
Fixture self-assertion (nr-2499-red-genuine) confirms `.ak-col` card count == 41 AND
`.ak-strip.ak-board` height > 2x `innerHeight` BEFORE any reachability assertion runs — passes
identically on both master and the fix branch (the fixture itself is untouched by the CSS fix).

### Measured RED (master `dd59d07`)

```
[AC1] summary.top=5499.75 summary.bottom=5536.96875 innerHeight=882
✘ AC1 — collapsed shelf summary is reachable within the initial viewport, NO page scroll performed
  Expected: true   Received: false   (fullyInViewport(box, 344, innerHeight))
```

`summary.top` (5499.75) exceeds `innerHeight` (882) by **4617.75px** — a ~6.2x-viewport-height
margin, not a coin-flip near the fold. `window.scrollY` was confirmed `0` (no page scroll was
performed) immediately before this measurement — the failure is a genuine "below the fold at
rest" defect, matching the plan's root-cause section verbatim (no shell clamp below 640px; the
base phone tier free-scrolls; `.ak-strip.ak-board` takes its full natural height; `<Shelf>`
renders source-order-last in `.ak-main` and lands below the entire full-height column).

### Measured GREEN (fix branch `2499-folding-phone-shelf-reachable`)

```
[AC1] summary.top=837.78125 summary.bottom=881 innerHeight=882
✓ AC1 — collapsed shelf summary is reachable within the initial viewport, NO page scroll performed (2.1s)
```

`summary.bottom` (881) is inside `innerHeight` (882); `summary.top` (837.78) is inside `[0,
innerHeight]` — the collapsed shelf is fully reachable at rest, no scroll performed
(`window.scrollY === 0` asserted). Mechanism: `app/globals.css` `@media (max-width: 639.98px)`
pins `.ak-shelf` via `position: fixed; bottom: 0` (see the CSS block's own comment for why
`position: sticky` was tried first and measured to be trapped by the `html`/`body`
`overflow-x:hidden` -> computed `overflow-y:auto` ancestor chain — reproduced empirically before
this fallback was applied, same class of trap the plan's Rule-18 note flagged).

### AC1b — occlusion guard (nr-2499-occlusion) [GREEN on both — not a RED-first AC]

Scrolls the page to `document.documentElement.scrollHeight` (the true page bottom) and asserts
the LAST `.ak-cardbtn` in the `todo` column's bottom edge clears the pinned/natural shelf bar's
top edge (no vertical overlap). Passes on both master (the shelf sits in normal flow after the
last card — trivially non-overlapping) and the fix branch (the `.ak-strip.ak-board`
`padding-bottom: 72px` reserve, added in the SAME media block, keeps the last card clear of the
`position: fixed` bar's footprint).

## AC2 — no regression to #83's bounded 60dvh opened body [GREEN on both]

Board: `buildBoard({ liveLanes:0, shelfVolume:{ bookkeeping:60, parked:15 } })` (production-volume
shelf content — `extraTodoCount` alone does not populate the shelf's own body, so an
`extraTodoCount`-only board would be a dead control here). Opens the shelf via a real `.tap()`,
brings the body on-screen (`scrollIntoViewIfNeeded`, same discipline `shelf-scroll.e2e.spec.ts`'s
proven `openShelf` helper already uses), then drives a real CDP touch-drag (`touchDragAt`) inside
the body and asserts a positive `scrollTop` delta.

- **Master `dd59d07`**: PASS (2.2s) — `#83`'s bounded body is unaffected (that fix already shipped
  at this sha; #2499 does not touch it).
- **Fix branch**: PASS (2.2s) — the phone-tier `position: fixed` on the CLOSED `.ak-shelf`
  container does not disturb the opened body's own `max-height:60dvh; overflow-y:auto` mechanics
  (untouched CSS, confirmed separately by the static grep below).

Static confirm: `command grep -nE 'max-height:\s*60dvh' app/globals.css` -> exit 0, one match,
`app/globals.css:616` (`.ak-shelf[open] > .ak-shelf__body`), byte-for-byte unchanged from master.

## AC3 — no regression to the 640-1023.98px grid tier [GREEN on both, IDENTICAL]

768x1024 (portrait, matches the `(min-width:640px) and (max-width:899.98px) and
(orientation:portrait)` grid-tier gate, globals.css L2002/L2000-2027). Asserts the collapsed
summary is within the initial viewport at rest — the pre-existing shell clamp already makes this
true; the #2499 fix does not touch that block.

- **Master `dd59d07`**: PASS (2.1s).
- **Fix branch**: PASS (2.0s) — byte-identical outcome.

Diff-scope confirm: `git diff dd59d07 -- app/globals.css` shows exactly ONE hunk, `@@ -648,6
+648,86 @@` (80 lines inserted after the existing shelf-scrollbar rules, before the sticky
group-label block) — nowhere near the shell-clamp block (L2000-2027) or the collapsed-header
block (L2029-2060). `git diff dd59d07 --stat -- app/globals.css` -> `1 file changed, 80
insertions(+)`, zero deletions (purely additive, matching the plan's monotonicity note).

## Full regression sweep on the fix branch (no other tier/spec broken)

- `e2e/shelf-scroll.e2e.spec.ts` + `e2e/shelf.e2e.spec.ts` (the #83 + S1-display oracles): 14/14
  PASS.
- `e2e/fold-front-screen-overflow.e2e.spec.ts` (the #79/AC-10 overflow guard, all tiers incl.
  390x844/412x915/750x1000/1200x800): 34/34 PASS.
- `e2e/fold8-scroll-reachability.e2e.spec.ts` (the #1590/#73 dead-zone + AC-4 phone/desktop
  hold-outs, incl. 840x660): 28/28 PASS.
- `npm test` (jest, all 51 suites / 512 tests): PASS.
- `npx tsc --noEmit`: clean, zero errors.

Result: **AC1 RED-on-master / GREEN-on-fix (genuine, ~4618px margin). AC2 and AC3 GREEN on both
— no regression.**
