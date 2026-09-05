# Interaction-test marker — agent-kanban-portrait-overflow-fold-front-screen-misclassified-as-phone

**Role:** executor (self-authored, per the UI-task gate's structured marker contract)
**Task:** `agent-kanban-portrait-overflow-fold-front-screen-misclassified-as-phone`
**Spec:** `e2e/fold-front-screen-overflow.e2e.spec.ts` (AC-2 describe block, "AC-2 — real interaction: the page cannot be panned")

## Named-risk note honored (nr-akfold-portrait-interaction-assert-unit)

Plan-review flagged that `asserts=scroll-delta` below is GATE-VOCABULARY ONLY (the
`ui-task-gate.sh` marker schema has no "visual-viewport-pan" token). The REAL assertion this
spec makes — read the spec file, not this marker — is:

```
expect(window.visualViewport.offsetLeft).toBe(0);
expect(window.visualViewport.pageLeft).toBe(0);
```

after a REAL CDP horizontal touch drag (`touchDragHorizontalAt`, `e2e/fixtures/touch.ts`, engine-
level `Input.dispatchTouchEvent` — never a synthetic `element.dispatchEvent`) across the
`.ak-lanes` panel, and separately after a real Playwright `page.mouse.wheel()` horizontal wheel
event. A `scrollLeft`-delta assertion is explicitly NOT used anywhere in this spec — it is the dead
control this whole task exists to kill (root-cause D: `window.scrollX`/`scrollLeft` stay 0 even
while the VISUAL viewport pans, because the layout viewport is what a body-only `overflow-x:hidden`
clamps).

## Structured fields (ui-task-gate.sh schema)

```
interaction-test:
asserts=scroll-delta
viewport=390x844 touch=true
red-on-prefix=0b275b0 (pre-fix app/globals.css — html had no overflow-x rule, .ak-lane-id had no
  shrink/overflow/ellipsis)
result=PASS
```

## Real measured RED (pre-fix, 0b275b0) — this spec run, both gestures

| Cell | Gesture | `visualViewport.offsetLeft` (RED) |
|---|---|---|
| 390x844 | real CDP touch drag over `.ak-lanes` | 212 |
| 390x844 | real wheel over `.ak-lanes` | 212 |
| 412x915 | real CDP touch drag over `.ak-lanes` | 190 |
| 412x915 | real wheel over `.ak-lanes` | 190 |
| 750x1000 | (green control — untouched) | 0 |

(These numbers are this spec's OWN reproduction with its own 2-lane, 71/80-char-id,
105-char-token fixture and an 85%-anchored 60%-of-width drag — a different gesture/fixture
composition than the planner's original scratch probe, which cited 198@390 / 176@412 on a
different ad hoc harness. Same class, same mechanism, same order of magnitude; see
`.ai-workspace/reviews/agent-kanban-fold-portrait-overflow-red-evidence.md` for the full run.)

## Real measured GREEN (PR head, this branch) — same spec, same gestures

All of AC-2's 6 assertions (touch + wheel at 390x844, 412x915, 750x1000) PASS:
`visualViewport.offsetLeft === 0` and `pageLeft === 0` at every cell, and the "N LANES LIVE" pill's
bounding box stays within `[0, innerWidth]`.

Result: **PASS**.
