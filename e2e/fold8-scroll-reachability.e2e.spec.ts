// fold8-scroll-reachability.e2e.spec.ts — AC-1 (bug 1: landscape scroll
// reachability) for task agent-kanban-fold8-4x3-bugfix. Plan:
// .ai-workspace/plans/2026-08-25-agent-kanban-fold8-4x3-bugfix-responsive.md
//
// REAL-INTERACTION oracle, not computed-style: every assertion here is
// "a touch gesture happened, and afterward some scroll offset moved AND/OR
// the target card is now inside the viewport" — never `getComputedStyle`.
// Frozen harness parameters (viewport matrix, fixture depth) live in this
// file; the red run (fdbc415) and the green run (fix branch) use the SAME
// file so the two runs are directly comparable.

import { test, expect, type Page } from "@playwright/test";
import { buildBoard } from "./fixtures/board-fixture";
import {
  touchDragAt,
  ancestorScrollOffsets,
  anyOffsetIncreased,
  boxOf,
  fullyInViewport,
} from "./fixtures/touch";

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });

// Deep enough that the TODO column overflows every viewport in the band —
// including the widest/shortest cells in the AC-1c sweep.
const EXTRA_TODO = 30;
// liveLanes(0) + ctx(3: todo/in_review/done) + extraTodoCount(30) = 33.
const EXPECTED_CARDS = 0 + 3 + EXTRA_TODO;

async function loadDeepBoard(page: Page) {
  const board = buildBoard({ liveLanes: 0, live: true, extraTodoCount: EXTRA_TODO });
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // Wait for the EXACT expected card count, not just "any card visible" — the
  // SSR first paint renders `data/board.sample.json` (a totally different
  // fixture, server-side, before our route interception can affect it), so a
  // bare "first card visible" check can race against stale sample-board DOM
  // and resolve a wrong ticket id downstream.
  await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

/**
 * Locate the FIRST card in the todo column (col index 0 — always the
 * leftmost/first column in every tier: flex strip, 2x2 grid, 4-up grid)
 * whose bounding rect is NOT fully inside the current viewport. Dynamic
 * (not a hardcoded fixture id) so every cell in the AC-1c sweep picks a
 * genuinely-just-offscreen card — the minimal distance needed to prove
 * reachability, not an arbitrary worst-case depth.
 */
async function findNearestOffscreenCardId(
  page: Page,
  width: number,
  height: number,
): Promise<string | null> {
  return page.evaluate(
    ({ width, height }) => {
      const col = document.querySelectorAll(".ak-col")[0];
      if (!col) return null;
      const buttons = Array.from(col.querySelectorAll(".ak-cardbtn"));
      for (const btn of buttons) {
        const r = btn.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const fully = r.top >= -1 && r.left >= -1 && r.bottom <= height + 1 && r.right <= width + 1;
        if (!fully) {
          const label = btn.getAttribute("aria-label") || "";
          const m = label.match(/Open ticket #(\S+):/);
          return m ? m[1] : null;
        }
      }
      return null;
    },
    { width, height },
  );
}

/**
 * Generic reachability probe: find a card that starts OFF-viewport in the
 * todo column, perform up to several real touch swipes-up centered over
 * that column, and assert that (a) SOME ancestor scroll offset (or
 * window.scrollY) strictly increased, AND (b) the target card ends fully
 * inside the viewport. Neither assertion is pinned to a specific scrolling
 * element (A5 / plan-review note #4) — `ancestorScrollOffsets` walks the
 * real DOM chain from the card up to <html> plus window.scrollY.
 */
async function checkReachability(page: Page, width: number, height: number) {
  const targetId = await findNearestOffscreenCardId(page, width, height);
  if (!targetId) {
    // No offscreen card at all -> the whole column already fits; trivially
    // "reachable" (nothing to reach). Distinguish this from a real pass.
    return { startedOffscreen: false, scrolled: false, reachedAfter: true, targetId: null };
  }
  const selector = `[aria-label^="Open ticket #${targetId}:"]`;

  const before = await boxOf(page, selector);
  const startedOffscreen = !fullyInViewport(before, width, height);
  const beforeOffsets = await ancestorScrollOffsets(page, selector);

  // Touch column 1's OWN bounding box, not a fixed viewport fraction — in
  // the 2x2 tier, column 1 only occupies the top-left QUADRANT (not the
  // full viewport height), so a fixed "near the bottom of the viewport"
  // anchor can land in a DIFFERENT column/row entirely. Clamp the start
  // point into the visible viewport (the column's own box can be far
  // taller than the viewport in the dead zone, where content isn't
  // layout-clipped, only overflow-clipped).
  for (let i = 0; i < 10; i++) {
    const colBox = await page.locator(".ak-col").first().boundingBox();
    if (!colBox) break;
    const x = colBox.x + colBox.width / 2;
    const y0 = Math.min(Math.max(colBox.y + 100, 60), height - 20);
    const dy = -Math.round(height * 0.5);
    await touchDragAt(page, { x, y0, dy, steps: 15, stepDelayMs: 16 });
    await page.waitForTimeout(80);
    const box = await boxOf(page, selector);
    if (fullyInViewport(box, width, height)) break;
  }

  const afterOffsets = await ancestorScrollOffsets(page, selector);
  const after = await boxOf(page, selector);

  return {
    startedOffscreen,
    scrolled: anyOffsetIncreased(beforeOffsets, afterOffsets),
    reachedAfter: fullyInViewport(after, width, height),
    targetId,
  };
}

test.describe("AC-1a — 840x660 structural dead zone (RED on fdbc415 by construction)", () => {
  test("a below-fold todo card becomes reachable by real touch swipe", async ({ page }) => {
    const width = 840;
    const height = 660;
    await page.setViewportSize({ width, height });
    await loadDeepBoard(page);

    const result = await checkReachability(page, width, height);
    expect(result.startedOffscreen).toBe(true); // precondition: card genuinely off-viewport at load
    expect(result.scrolled).toBe(true);
    expect(result.reachedAfter).toBe(true);
  });
});

test.describe("AC-1b — 1000x750 nominal Fold-open landscape (4-up tier)", () => {
  test("a below-fold todo card becomes reachable by real touch swipe", async ({ page }) => {
    const width = 1000;
    const height = 750;
    await page.setViewportSize({ width, height });
    await loadDeepBoard(page);

    const result = await checkReachability(page, width, height);
    expect(result.startedOffscreen).toBe(true);
    expect(result.scrolled).toBe(true);
    expect(result.reachedAfter).toBe(true);
  });
});

test.describe("AC-1c — band sweep (no dead zone anywhere in 640-1023 x 620-750)", () => {
  const WIDTHS = [640, 750, 840, 900, 1000, 1023];
  const HEIGHTS = [620, 660, 700, 750];

  for (const width of WIDTHS) {
    for (const height of HEIGHTS) {
      test(`${width}x${height}: below-fold card reachable`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await loadDeepBoard(page);
        const result = await checkReachability(page, width, height);
        expect(result.startedOffscreen).toBe(true);
        expect(result.scrolled || result.reachedAfter).toBe(true);
        expect(result.reachedAfter).toBe(true);
      });
    }
  }
});

test.describe("AC-4 hold-out — phone 390x844 (must stay GREEN on master AND fix)", () => {
  test("strip horizontal snap-scroll works by real swipe (scrollLeft changes + snaps)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadDeepBoard(page);

    // NOTE: `.ak-strip`'s own left padding (14px) makes Chromium's initial
    // scroll-snap settle land near scrollLeft=14, not exactly 0 — reproduced
    // independently of touch/mobile context (measured with a plain desktop
    // context too), so this is a pre-existing snap/padding interaction, not
    // part of this bugfix. Record `before` as a baseline instead of
    // asserting it is exactly 0.
    const before = await page.locator(".ak-strip").evaluate((el) => el.scrollLeft);

    // Real horizontal touch swipe (left) on the strip: drag finger from right
    // to left to advance to the next snap column.
    const vp = page.viewportSize()!;
    const client = await page.context().newCDPSession(page);
    const y = vp.height * 0.4;
    const xStart = vp.width * 0.85;
    const xEnd = vp.width * 0.1;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: xStart, y }],
    });
    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      const x = xStart + ((xEnd - xStart) * i) / steps;
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
      await page.waitForTimeout(16);
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach().catch(() => {});

    await page.waitForTimeout(400); // let scroll-snap settle
    const after = await page.locator(".ak-strip").evaluate((el) => el.scrollLeft);
    expect(after).toBeGreaterThan(before);

    const drawer = page.locator(".ak-cardbtn").first();
    await drawer.click();
    await expect(page.locator(".ak-drawer")).toBeVisible();
  });
});

test.describe("AC-4 hold-out — desktop 1440x900 (mouse, no touch; must stay GREEN on master AND fix)", () => {
  test("wheel scroll reaches below-fold cards in a 4-up column", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loadDeepBoard(page);

    const targetId = await findNearestOffscreenCardId(page, 1440, 900);
    expect(targetId).not.toBeNull();
    const selector = `[aria-label^="Open ticket #${targetId}:"]`;

    const before = await boxOf(page, selector);
    // Desktop tier keeps the pre-existing overflow-y:auto per-column model —
    // wheel scroll directly over the todo column.
    const col = page.locator(".ak-col").first();
    const colBox = await col.boundingBox();
    expect(colBox).not.toBeNull();
    await page.mouse.move(colBox!.x + colBox!.width / 2, colBox!.y + colBox!.height / 2);
    for (let i = 0; i < 20 && !fullyInViewport(await boxOf(page, selector), 1440, 900); i++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(50);
    }
    const after = await boxOf(page, selector);
    expect(fullyInViewport(before, 1440, 900)).toBe(false);
    expect(fullyInViewport(after, 1440, 900)).toBe(true);
  });
});
