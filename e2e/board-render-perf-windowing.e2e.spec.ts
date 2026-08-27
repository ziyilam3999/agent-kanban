// board-render-perf-windowing.e2e.spec.ts — AC-5 for task
// agent-kanban-board-render-perf-inp. Plan:
// .ai-workspace/plans/2026-08-26-board-render-perf-inp.md
//
// With the >=1,200-card fixture, document.querySelectorAll(".ak-cardbtn")
// must stay <= 250 at initial paint AND after scrolling the DONE column to
// its end (vs 1,207 at HEAD, unwindowed). Viewports chosen from the
// "fold8" tier band (640-1023.98px) where app/globals.css gives `.ak-col`
// its own `overflow-y: auto` (independent column scroll) — the same
// viewports already proven for column-scroll interaction in
// e2e/fold8-inp-under-poll.e2e.spec.ts.

import { test, expect, type Page } from "@playwright/test";
import { buildBoard } from "./fixtures/board-fixture";

const BIG_PAYLOAD = { count: 1200, descriptionBytes: 4_900 };
const MAX_MOUNTED = 250;

async function setupBoard(page: Page) {
  const board = buildBoard({ liveLanes: 0, live: true, bigPayload: BIG_PAYLOAD });
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: '"etag-1"' },
      body: JSON.stringify(board),
    });
  });
}

test.describe("AC-5 — mounted cards bounded by viewport (windowing)", () => {
  for (const vp of [
    { width: 750, height: 1000 },
    { width: 1000, height: 750 },
  ]) {
    test(`${vp.width}x${vp.height}: <=${MAX_MOUNTED} .ak-cardbtn at initial paint AND after scrolling DONE to its end`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupBoard(page);
      await page.goto("/", { waitUntil: "networkidle" });
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(page.locator(".ak-cardbtn").first()).toBeVisible({ timeout: 20_000 });
      // Let the IntersectionObserver's first callback settle past the
      // component's synchronous first-paint seed (BoardColumn.tsx
      // INITIAL_REAL_COUNT).
      await page.waitForTimeout(500);

      const initialCount = await page.locator(".ak-cardbtn").count();
      test.info().annotations.push({ type: "ac5-initial", description: String(initialCount) });
      expect(initialCount).toBeLessThanOrEqual(MAX_MOUNTED);

      // Scroll the DONE column to its end. `.ak-col`'s own overflow-y:auto
      // is what actually scrolls at this viewport tier (app/globals.css) —
      // a direct scrollTop assignment past scrollHeight clamps to the real
      // max position regardless of the windowing hook's placeholder-height
      // ESTIMATE (the browser clamps the assignment itself; no dependency
      // on the estimate's accuracy for reaching "the end").
      const doneCol = page.locator('section[aria-label="Done"]');
      await doneCol.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      // A couple more nudges + settle time, since the estimate can still
      // move once real cards near the new position get measured.
      await page.waitForTimeout(300);
      await doneCol.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(500);

      const afterScrollCount = await page.locator(".ak-cardbtn").count();
      test.info().annotations.push({ type: "ac5-after-scroll", description: String(afterScrollCount) });
      expect(afterScrollCount).toBeLessThanOrEqual(MAX_MOUNTED);
    });
  }
});
