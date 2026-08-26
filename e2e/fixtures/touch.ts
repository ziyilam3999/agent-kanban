// touch.ts — shared REAL-touch gesture helper for the fold8-4x3-bugfix specs
// (task: agent-kanban-fold8-4x3-bugfix). Plan:
// .ai-workspace/plans/2026-08-25-agent-kanban-fold8-4x3-bugfix-responsive.md
//
// A JS `element.dispatchEvent(new TouchEvent(...))` is a pure synthetic DOM
// event — it does NOT drive the browser's real touch-input pipeline, so it
// never exercises native scroll/snap machinery. Only an engine-level (CDP)
// touch input does. This is the SAME pattern already proven live in
// e2e/drawer-pulldown-dismiss.e2e.spec.ts (touchDrag) — reused here as a
// shared fixture so every new fold8-bugfix spec drives touch through
// byte-identical machinery (no divergent hand-rolled dispatch per file).

import type { Page } from "@playwright/test";

/**
 * Drive one continuous touchStart -> touchMove* -> touchEnd sequence at a
 * fixed (x, y0) start point, moving vertically by `dy` over `steps` frames.
 * `dy > 0` = drag DOWN (finger moves down the screen; typically reveals
 * content ABOVE, i.e. scrolls up / decreases scrollTop). `dy < 0` = drag UP
 * (finger moves up the screen; the natural "swipe up to see more below"
 * gesture — typically INCREASES scrollTop / reveals below-fold content).
 */
export async function touchDragAt(
  page: Page,
  opts: { x: number; y0: number; dy: number; steps?: number; stepDelayMs?: number },
) {
  const { x, y0, dy, steps = 15, stepDelayMs = 16 } = opts;
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: y0 }],
    });
    for (let i = 1; i <= steps; i++) {
      const y = y0 + (dy * i) / steps;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y }],
      });
      await page.waitForTimeout(stepDelayMs);
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Swipe UP (finger travels from `startYFrac` to a point `distFrac` higher,
 * both fractions of viewport height) at horizontal position `xFrac` (fraction
 * of viewport width). This is the "reveal content below the fold" gesture.
 * Returns nothing — callers re-measure state after calling this.
 */
export async function swipeUp(
  page: Page,
  opts: { xFrac?: number; startYFrac?: number; distFrac?: number; steps?: number },
) {
  const vp = page.viewportSize();
  if (!vp) throw new Error("swipeUp: no viewport size");
  const { xFrac = 0.5, startYFrac = 0.75, distFrac = 0.55, steps = 15 } = opts;
  const x = vp.width * xFrac;
  const y0 = vp.height * startYFrac;
  const dy = -Math.round(vp.height * distFrac);
  await touchDragAt(page, { x, y0, dy, steps });
}

/**
 * Drive one continuous touchStart -> touchMove* -> touchEnd sequence at a
 * fixed y, moving HORIZONTALLY by `dx` over `steps` frames. `dx < 0` = swipe
 * LEFT (finger moves right-to-left; the natural "advance to the next page"
 * gesture — increases `scrollLeft`). `dx > 0` = swipe RIGHT (decreases
 * `scrollLeft`). Mirrors `touchDragAt` above but for the x axis — added for
 * fold8-portrait-2col-paging's real horizontal-paging spec (AC-2); the
 * PR-branch fold8-scroll-reachability spec hand-rolled an equivalent
 * one-off CDP sequence inline before this fixture existed.
 */
export async function touchDragHorizontalAt(
  page: Page,
  opts: { xStart: number; y: number; dx: number; steps?: number; stepDelayMs?: number },
) {
  const { xStart, y, dx, steps = 15, stepDelayMs = 16 } = opts;
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: xStart, y }],
    });
    for (let i = 1; i <= steps; i++) {
      const x = xStart + (dx * i) / steps;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y }],
      });
      await page.waitForTimeout(stepDelayMs);
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Swipe LEFT (finger travels from `xStartFrac` to a point `distFrac` further
 * left, both fractions of viewport width) at vertical position `yFrac`
 * (fraction of viewport height) — the "advance to the next page" gesture.
 * Returns nothing — callers re-measure state after calling this.
 */
export async function swipeLeft(
  page: Page,
  opts: { yFrac?: number; xStartFrac?: number; distFrac?: number; steps?: number },
) {
  const vp = page.viewportSize();
  if (!vp) throw new Error("swipeLeft: no viewport size");
  const { yFrac = 0.5, xStartFrac = 0.85, distFrac = 0.7, steps = 15 } = opts;
  const y = vp.height * yFrac;
  const xStart = vp.width * xStartFrac;
  const dx = -Math.round(vp.width * distFrac);
  await touchDragHorizontalAt(page, { xStart, y, dx, steps });
}

/** Reverse of `swipeLeft` — the "go back to the previous page" gesture. */
export async function swipeRight(
  page: Page,
  opts: { yFrac?: number; xStartFrac?: number; distFrac?: number; steps?: number },
) {
  const vp = page.viewportSize();
  if (!vp) throw new Error("swipeRight: no viewport size");
  const { yFrac = 0.5, xStartFrac = 0.15, distFrac = 0.7, steps = 15 } = opts;
  const y = vp.height * yFrac;
  const xStart = vp.width * xStartFrac;
  const dx = Math.round(vp.width * distFrac);
  await touchDragHorizontalAt(page, { xStart, y, dx, steps });
}

/**
 * Read the scrollTop of every ancestor of `el` (matched by `selector`) PLUS
 * window.scrollY, as a flat array walked from the element up to <html>. This
 * is the GENERIC "which element (if any) scrolled" probe — deliberately NOT
 * pinned to `.ak-col` (plan-review note #4 / A5: the fix may legitimately
 * change WHICH element scrolls). Two calls with the SAME selector before/
 * after a gesture can be compared index-by-index; the ancestor chain is
 * static across a gesture (no DOM restructuring), so indices line up.
 */
export async function ancestorScrollOffsets(
  page: Page,
  selector: string,
): Promise<number[]> {
  return page.locator(selector).evaluate((el) => {
    const offsets: number[] = [];
    let node: Element | null = el;
    while (node) {
      offsets.push(node.scrollTop);
      node = node.parentElement;
    }
    offsets.push(window.scrollY);
    return offsets;
  });
}

/** True iff `after[i] > before[i]` for at least one index (some scroll offset increased). */
export function anyOffsetIncreased(before: number[], after: number[]): boolean {
  return after.some((v, i) => v > (before[i] ?? 0));
}

/** getBoundingClientRect() of the element matched by `selector`, as a plain object. */
export async function boxOf(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left, bottom: r.bottom, right: r.right };
  });
}

/** True iff the rect is fully within [0,0]..[vw,vh] (allow a 1px rounding slack). */
export function fullyInViewport(
  box: { top: number; left: number; bottom: number; right: number },
  vw: number,
  vh: number,
): boolean {
  return box.top >= -1 && box.left >= -1 && box.bottom <= vh + 1 && box.right <= vw + 1;
}
