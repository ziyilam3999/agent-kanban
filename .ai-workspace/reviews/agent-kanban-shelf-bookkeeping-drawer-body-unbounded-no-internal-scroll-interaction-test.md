# Interaction-test marker — agent-kanban-shelf-bookkeeping-drawer-body-unbounded-no-internal-scroll

**Role:** executor (self-authored, per the UI-task gate's structured marker contract)
**Task:** `agent-kanban-shelf-bookkeeping-drawer-body-unbounded-no-internal-scroll`
**Spec:** `e2e/shelf-scroll.e2e.spec.ts` (AC-2 describe blocks — "AC-2: real touch swipe-up inside the
body scrolls the panel, not the page" (mobile 390x844) and "AC-2: a real wheel event over the body
scrolls it" (desktop 1440x900))

## Structured fields (ui-task-gate.sh schema)

```
interaction-test: e2e/shelf-scroll.e2e.spec.ts (AC-2 mobile touch swipe, AC-2 desktop wheel, AC-4 both cells)
asserts=scroll-delta
viewport=390x844 touch=true
red-on-prefix=752a531 (pre-fix app/globals.css — .ak-shelf[open] > .ak-shelf__body had no
  max-height/overflow-y/overflow-x/overscroll-behavior; the body was an unbounded flex column,
  so a real touch swipe over it never moved body.scrollTop and the page scrolled instead)
result=PASS
```

## What the spec actually asserts (read the spec file, not this marker)

A REAL CDP touch drag (`touchDragAt`, `e2e/fixtures/touch.ts`, engine-level
`Input.dispatchTouchEvent` — never a synthetic `element.dispatchEvent`) over `.ak-shelf__body` at
390x844, asserting:

```
expect(after.scrollTop - before.scrollTop).toBeGreaterThan(0);
expect(Math.abs(afterScrollY - beforeScrollY)).toBeLessThanOrEqual(1);
```

i.e. the body's OWN `scrollTop` genuinely advances, and the PAGE (`window.scrollY`) does not move —
the "scrolls the panel, not the page" containment property. A separate desktop cell (1440x900) drives
a real `page.mouse.wheel(0, 600)` over the body and asserts the same `scrollTop` delta (per
plan-review's carry-forward note: the desktop cell asserts only the `scrollTop` delta, deliberately
NOT a `scrollY` no-op check — weaker by design, matching the plan's stated intent for that cell).

AC-4 additionally drives a real horizontal touch drag (mobile, `touchDragHorizontalAt`) and a real
horizontal wheel gesture (desktop, `page.mouse.wheel(600, 0)`) directly over a test-injected
non-shrinkable wide child, asserting `body.scrollLeft` stays `0` and
`window.visualViewport.offsetLeft` stays `0` — this is a REAL-GESTURE oracle, not a raw
`element.scrollLeft = x` JS write (see `injectWideStub`'s doc comment in the spec: a raw JS write is
a CSSOM-level escape hatch no real user gesture can trigger, and — measured live — Chromium still
lets a JS write move `scrollLeft` through `overflow-x:hidden` when the other axis is `auto`, so it is
not a valid discriminator; a real touch-drag/wheel gesture is what `overflow-x:hidden` +
`touch-action:pan-y` genuinely block).

## Real measured RED (pre-fix, `752a531c30608537b69c814ce9b52a830f399ffe`) — this spec run

| Test | Cell | Assertion | Expected | Received |
|---|---|---|---|---|
| AC-1 | 390x844 | `scrollHeight > clientHeight` | `> 16931` | `16931` (equal, no overflow engaged) |
| AC-2 | 390x844 | `scrollTop` delta after real touch swipe | `> 0` | `0` (body never scrolled; page did) |
| AC-5 | 390x844 | Parked group label pinned within `bodyBox.top + 24` | `<= 24` | `13987.89` (no sticky containment — everything scrolled off with the page) |
| AC-1 | 1440x900 | `scrollHeight > clientHeight` | `> 14665` | `14665` (equal, no overflow engaged) |
| AC-2 | 1440x900 | `scrollTop` delta after real wheel event | `> 0` | `0` (body never scrolled) |

(AC-3 and AC-4 pass on the plain `752a531` baseline at both cells — expected per the plan: AC-3's
"card fully inside body's own box" is trivially true when the body is unbounded and nothing is
clipped, and AC-4's document-level + real-gesture reading has nothing to overflow without a wide
child present. The plan places AC-4's RED control on a SEPARATE no-pin scratch variant, not the plain
`752a531` baseline — see the AC-7 red-evidence file for that run: both mobile (real touch drag,
`scrollLeft` received 216) and desktop (real wheel, `scrollLeft` received 328) genuinely RED there,
proving the oracle can vary.)

## Real measured GREEN (PR head, this branch) — same spec, same gestures

All 12 tests in `e2e/shelf-scroll.e2e.spec.ts` PASS, plus both pre-existing tests in
`e2e/shelf.e2e.spec.ts` (AC-1.4 / AC-1.5, no regression). AC-2 mobile: real touch swipe advances
`scrollTop` while `scrollY` stays within 1px. AC-2 desktop: real wheel event advances `scrollTop`.
AC-4 both cells: real horizontal gestures over an injected wide child leave `scrollLeft` and
`visualViewport.offsetLeft` at `0`.

Result: **PASS**.
