// fold8-portrait-2x2.e2e.spec.ts — originally AC-2 (bug 2: portrait 2x2
// coherence + poll stability) for task agent-kanban-fold8-4x3-bugfix. Plan:
// .ai-workspace/plans/2026-08-25-agent-kanban-fold8-4x3-bugfix-responsive.md
//
// AMENDED for task agent-kanban-fold8-uiux-redesign (portrait iteration
// round). Plan: .ai-workspace/plans/2026-08-26-fold8-portrait-2col-paging.md
// — Spec-amendment inventory: "the 2x2 geometry leg is superseded by the new
// paged-portrait spec [fold8-portrait-2col-paging.e2e.spec.ts, which now
// owns AC-1's real 2-col-page geometry]; the scroll-survives-poll leg is
// CARRIED (re-targeted per AC-4(b))." This file now carries ONLY that
// carried leg — the strict 2-row x 2-col non-overlapping-quadrant geometry
// assertion is gone (a REAL assertion of that shape would now correctly FAIL
// on the new 2-up paged layout, which is the point: the old shape no longer
// exists). A light sanity check (4 columns exist, page itself never
// scrolls) is kept so a gross breakage still fails loudly here too.

import { test, expect, type Page } from "@playwright/test";
import { buildBoard } from "./fixtures/board-fixture";
import { touchDragAt } from "./fixtures/touch";

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6, viewport: { width: 750, height: 1000 } });

const EXTRA_TODO = 20;
// liveLanes(0) + ctx(3) + extraTodoCount(20) = 23.
const EXPECTED_CARDS = 0 + 3 + EXTRA_TODO;

function makeBoard(extraTag: string) {
  const board = buildBoard({ liveLanes: 0, live: true, extraTodoCount: EXTRA_TODO });
  // Tag every ticket's subject with `extraTag` so the SERIALIZED payload text
  // differs between the initial load and the "poll tick" refresh below (a
  // byte-identical payload would be a no-op under the fix — this leg is
  // specifically about a CHANGED tick, not an unchanged one).
  board.tickets = board.tickets.map((t) => ({ ...t, subject: `${t.subject} [${extraTag}]` }));
  return board;
}

/** Light sanity check: 4 columns exist and the PAGE itself never scrolls
 *  (columns may scroll internally — the shell-clamp 100dvh contract, held
 *  regardless of which 2-up/4-up tier is active underneath it). */
async function assertShellSane(page: Page) {
  const cols = page.locator(".ak-col");
  await expect(cols).toHaveCount(4);
  const pageScroll = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(pageScroll.scrollHeight).toBeLessThanOrEqual(pageScroll.innerHeight + 2);
}

test.describe("AC-4(b) (carried, re-targeted to the 2-up paged tier) — real-interaction sync leg", () => {
  test("column A's scrollTop is preserved across a poll tick that delivers a CHANGED payload", async ({
    page,
  }) => {
    let currentBoard = makeBoard("v1");
    await page.route("**/api/board", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentBoard),
      });
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS, { timeout: 15_000 });
    await page.waitForTimeout(500);

    await assertShellSane(page);

    // Real touch-scroll column A (todo, first .ak-col) by a real gesture —
    // column A is always fully visible on load (page A of the new 2-up
    // paged tier), so a first-`.ak-col` anchor is still correct.
    for (let i = 0; i < 6; i++) {
      const colBox = await page.locator(".ak-col").first().boundingBox();
      if (!colBox) break;
      const x = colBox.x + colBox.width / 2;
      const y0 = Math.min(colBox.y + colBox.height * 0.7, colBox.y + colBox.height - 20);
      await touchDragAt(page, { x, y0, dy: -Math.round(colBox.height * 0.4), steps: 12 });
      await page.waitForTimeout(60);
    }
    // Let native touch-scroll MOMENTUM fully settle before capturing the
    // baseline — a swipe gesture keeps drifting the scrollTop for a couple
    // hundred ms after touchend independent of any poll tick.
    let scrollTopAfterGesture = await page.locator(".ak-col").first().evaluate((el) => el.scrollTop);
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(150);
      const next = await page.locator(".ak-col").first().evaluate((el) => el.scrollTop);
      if (next === scrollTopAfterGesture) break;
      scrollTopAfterGesture = next;
    }
    expect(scrollTopAfterGesture).toBeGreaterThan(0);

    // Swap in a CHANGED payload for the next poll tick, then wait out the
    // shipped 5s poll cadence (no test-only cadence override — same real
    // interval the product uses).
    currentBoard = makeBoard("v2-poll-tick");
    await page.waitForTimeout(5_600);

    // The new payload landed (title text changed) -> the tick actually fired.
    await expect(page.locator(".ak-cardbtn").first()).toContainText("v2-poll-tick", { timeout: 5_000 });

    const scrollTopAfterPoll = await page.locator(".ak-col").first().evaluate((el) => el.scrollTop);
    expect(scrollTopAfterPoll).toBe(scrollTopAfterGesture);

    await assertShellSane(page);
  });
});
