# Interaction-test marker — board-noise-s1-display (S1 DISPLAY, AC-1.5)

**Role:** executor (self-authored, per the UI-task gate's structured marker contract)
**Task:** `board-noise-s1-display`
**Spec:** `e2e/shelf.e2e.spec.ts`, describe block "board-noise triage S1 DISPLAY — shelf real-interaction (AC-1.5)", test "mobile touch tap: shelf body scrollHeight goes 0 -> >0, column counts unchanged"

## What the spec actually asserts (read the spec, this marker only summarizes)

A real Playwright `.tap()` (touch-context `hasTouch:true`, engine-level input — not a synthetic
`element.click()`/`dispatchEvent`) on `.ak-shelf__summary` at viewport 390×844:

```
const bodyBefore = await page.locator(".ak-shelf__body").evaluate((el) => el.scrollHeight);
expect(bodyBefore).toBe(0);                         // closed: genuinely 0, not just visually hidden

await page.locator(".ak-shelf__summary").tap();

await expect(shelf).toHaveAttribute("open", "");
await expect.poll(() => page.locator(".ak-shelf__body").evaluate((el) => el.scrollHeight))
  .toBeGreaterThan(0);                               // open: genuinely rendered with real height

const afterSum = await columnCountSum(page);
expect(afterSum).toBe(beforeSum);                    // the four .ak-col__count values are UNCHANGED
```

This is a genuine real-interaction oracle, not a computed-style check: a static
`getComputedStyle(...).display` read at rest cannot prove a collapsed element actually opens under a
real touch tap — only measuring `scrollHeight` before and after a real `.tap()` proves the disclosure
mechanism (native `<details>` toggle + the CSS wired against it) is genuinely wired end-to-end.

## A real bug this spec caught during development (not hypothetical)

The naive CSS (`.ak-shelf__body { display: flex; ... }` unconditionally) did NOT get suppressed by
this Chromium build while the `<details>` was closed — `scrollHeight` measured 1955/1915 (non-zero)
against a closed shelf on the first run of this spec, i.e. it would have FAILED `expect(bodyBefore
).toBe(0)` even on the FIXED build. Fixed by making `display:none` explicit on `.ak-shelf__body` and
scoping the flex layout to `.ak-shelf[open] > .ak-shelf__body` only (see
`app/globals.css`). This is exactly the class of defect a real-interaction / real-measurement oracle
catches and a screenshot-at-rest would not (a closed-details screenshot looks identical whether the
hidden content underneath measures 0 or 1900px).

## Structured fields (ui-task-gate.sh schema)

```
interaction-test:
asserts=scroll-delta
viewport=390x844 touch=true
red-on-prefix=2de175457bf9ef5385b5aebb27f7e46a588d1852 (pre-fix origin/master HEAD — this
  branch's own fork point; no `.ak-shelf` element exists at all, so every locator in this spec
  throws "element(s) not found")
result=PASS
```

## Real measured RED (pre-fix, 2de175457bf9ef5385b5aebb27f7e46a588d1852)

Reproduced live this session: created a throwaway worktree at commit
`2de175457bf9ef5385b5aebb27f7e46a588d1852` (this branch's own fork point from `origin/master`),
copied ONLY `e2e/shelf.e2e.spec.ts` + the shared fixture directory into it (no other source change),
and ran the spec against that unmodified pre-fix build:

```
1) [chromium] › e2e/shelf.e2e.spec.ts:105:7 › ... AC-1.4 ... desktop: columns show only work ...
   Error: expect(received).toBeGreaterThan(expected)
   Expected: > 0
   Received:   0
   (exp.workCount === 0 — the pre-fix exporter carries no `kind` field at all)

2) [chromium] › e2e/shelf.e2e.spec.ts:150:7 › ... AC-1.5 ... mobile touch tap ...
   Error: expect(locator).not.toHaveAttribute(expected) failed
   Locator: locator('details.ak-shelf')
   Error: element(s) not found
   (no `.ak-shelf` element exists anywhere in the pre-fix DOM)
```

Both AC-1.4 and AC-1.5 genuinely fail on the red prefix — the interaction test is a live control, not
a vacuous always-pass assertion.

## Real measured GREEN (PR head, this branch)

```
✓  1 [chromium] › ... AC-1.4 ... desktop: columns show only work, shelf is closed, summary + header match
✓  2 [chromium] › ... AC-1.5 ... mobile touch tap: shelf body scrollHeight goes 0 -> >0, column counts unchanged
2 passed
```

Result: **PASS**.
