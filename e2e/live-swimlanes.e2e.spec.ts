// live-swimlanes.e2e.spec.ts — Playwright DOM acceptance checks for #1295 Live
// Swimlanes + counter, the ACs that cannot be proven node-side (they need a real
// layout engine + viewport): #1b (N<2 => no lanes, column board present), #4 (the
// mint "N LANES LIVE" counter wording + color + k=0 absence), #6 (column board
// still renders BELOW the lanes at N>=2), #7 (390px lanes stack with no horizontal
// overflow). The board is fed a deterministic synthetic payload via /api/board
// route interception — the real Vercel Blob is never touched.

import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { buildBoard } from "./fixtures/board-fixture";

const SCREENS = path.join(__dirname, "..", ".ai-workspace", "design", "screens-1295");
const MINT = "rgb(62, 242, 176)"; // --live #3ef2b0

/**
 * Intercept /api/board with a fixed synthetic board, load the board, and trigger an
 * immediate client poll (visibilitychange) so the page renders OUR payload without
 * waiting out the 5s interval.
 */
async function loadBoardState(
  page: Page,
  opts: { liveLanes: number; live?: boolean },
) {
  const board = buildBoard(opts);
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  // The poll closure reads document.hidden; the page is visible, so a synthetic
  // visibilitychange fires an immediate fetch of the intercepted route.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // Wait for our payload to be in the DOM (unique context ticket id is the anchor).
  await page.getByText("Context ticket 701", { exact: false }).first().waitFor({ timeout: 15_000 });
  // The first paint is the SSR sample board; our poll swaps it for the fixture and
  // the sample cards play their AnimatePresence exit. Wait for the card count to
  // settle to OUR fixture (liveLanes in_progress + the 3 context tickets) so a
  // screenshot is never taken mid-transition with stale cards overlapping.
  const expectedCards = opts.liveLanes + 3;
  await expect(page.locator(".ak-cardbtn")).toHaveCount(expectedCards, { timeout: 15_000 });
}

test.describe("#1295 Live Swimlanes — DOM acceptance", () => {
  test("#1b — N<2: zero lane rows, column board present (+ single/column screenshot)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loadBoardState(page, { liveLanes: 1 });

    // The header counter resolves first; gives the client time to settle.
    await expect(page.locator(".ak-lanecount")).toHaveText("1 LANE LIVE");
    // N<2 => the swimlane rows do NOT mount.
    await expect(page.locator(".ak-lane-row")).toHaveCount(0);
    // The normal column board is present.
    await expect(page.locator(".ak-strip")).toBeVisible();

    await page.screenshot({ path: path.join(SCREENS, "d-single-column.png"), fullPage: true });
  });

  test("#4 — counter wording + mint color at N=2, N=1; absent at k=0", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // N = 2 -> plural "2 LANES LIVE", mint.
    await loadBoardState(page, { liveLanes: 2 });
    const counter = page.locator(".ak-lanecount");
    await expect(counter).toHaveText("2 LANES LIVE");
    await expect(counter).toHaveCSS("color", MINT);

    // N = 1 -> singular "1 LANE LIVE".
    await page.unroute("**/api/board");
    await loadBoardState(page, { liveLanes: 1 });
    await expect(page.locator(".ak-lanecount")).toHaveText("1 LANE LIVE");

    // k = 0 (idle session) -> counter absent.
    await page.unroute("**/api/board");
    await loadBoardState(page, { liveLanes: 2, live: false });
    await expect(page.locator(".ak-lanecount")).toHaveCount(0);
  });

  test("#6 — at N>=2 the column board renders BELOW the lanes (+ 2-lane & 3-lane screenshots)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 2 lanes.
    await loadBoardState(page, { liveLanes: 2 });
    await expect(page.locator(".ak-lane-row")).toHaveCount(2);
    const lanes = await page.locator(".ak-lanes").boundingBox();
    const strip = await page.locator(".ak-strip").boundingBox();
    expect(lanes).not.toBeNull();
    expect(strip).not.toBeNull();
    // Column board sits below the lanes (its top is below the lanes' top edge).
    expect(strip!.y).toBeGreaterThan(lanes!.y);
    await expect(page.locator(".ak-strip")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENS, "d-2lane.png"), fullPage: true });

    // 3 lanes.
    await page.unroute("**/api/board");
    await loadBoardState(page, { liveLanes: 3 });
    await expect(page.locator(".ak-lane-row")).toHaveCount(3);
    await expect(page.locator(".ak-lanecount")).toHaveText("3 LANES LIVE");
    await page.screenshot({ path: path.join(SCREENS, "d-3lane.png"), fullPage: true });
  });

  test("#7 — 390px: lanes stack with no horizontal overflow (+ mobile screenshot)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadBoardState(page, { liveLanes: 2 });
    await expect(page.locator(".ak-lane-row")).toHaveCount(2);

    // The lane container must not overflow its own box horizontally.
    const overflow = await page.locator(".ak-lanes").evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // Each 4-role track also stays within its row (no crammed horizontal scroll).
    const tracks = page.locator(".ak-lane-track");
    const n = await tracks.count();
    for (let i = 0; i < n; i++) {
      const t = await tracks.nth(i).evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(t.scrollWidth).toBeLessThanOrEqual(t.clientWidth);
    }

    // And the document itself does not scroll horizontally at 390px.
    const docOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(docOverflow.scrollWidth).toBeLessThanOrEqual(docOverflow.clientWidth);

    await page.screenshot({ path: path.join(SCREENS, "m-2lane.png"), fullPage: true });
  });
});
