// lane-reveal.e2e.spec.ts — Playwright DOM/visual acceptance for #1456 (auto-reveal
// the Live Swimlanes panel on a genuine `<2 -> >=2` transition). Jest's jsdom oracle
// (__tests__/lane-reveal.test.ts) proves the WIRING (scrollIntoView is called); this
// file proves the thing jsdom cannot (plan risk r5) — a REAL layout engine + REAL
// viewport, so the "already-visible" don't-yank guard and the arrival cue's visual
// result are observable, and captures the real mobile + desktop screenshots the
// ui-evolve leg (#1112 UI-task gate) needs. The board is fed a deterministic
// synthetic payload via /api/board route interception — the real Vercel Blob is
// never touched (same pattern as e2e/live-swimlanes.e2e.spec.ts, #1295).

import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { buildBoard } from "./fixtures/board-fixture";

const SCREENS = path.join(__dirname, "..", ".ai-workspace", "design", "screens-1456");

// The shared #1295 fixture (liveLanes + 3 context tickets) renders a board short
// enough to fit one viewport — real content volume for the "you're scrolled down
// looking at the columns" scenario this feature exists for. Pad the `done` column
// with extra (never-active, old) tickets so the page genuinely needs a vertical
// scroll, which is the whole premise of #1456 (a panel that mounts off-screen).
const PADDING_TICKETS = 14;

function paddedBoard(opts: { liveLanes: number }) {
  const board = buildBoard(opts);
  const now = Date.now();
  for (let i = 0; i < PADDING_TICKETS; i++) {
    board.tickets.push({
      id: `pad-${i}`,
      subject: `Padding ticket ${i} — bulk column content so the page scrolls`,
      description: "",
      column: "done",
      status: "completed",
      blockedBy: [],
      comments: [],
      updatedAt: now - 60 * 60_000,
      sessionId: board.sessionId,
    });
  }
  board.sessions[0].ticketCount = board.tickets.length;
  return board;
}

/**
 * Intercept /api/board with a fixed synthetic board, load the board, and trigger an
 * immediate client poll (visibilitychange) so the page renders OUR payload without
 * waiting out the 5s interval. Mirrors e2e/live-swimlanes.e2e.spec.ts's helper.
 */
async function loadBoardState(page: Page, opts: { liveLanes: number }) {
  const board = paddedBoard(opts);
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.getByText("Context ticket 701", { exact: false }).first().waitFor({ timeout: 15_000 });
  const expectedCards = opts.liveLanes + 3 + PADDING_TICKETS;
  await expect(page.locator(".ak-cardbtn")).toHaveCount(expectedCards, { timeout: 15_000 });
}

/** Wait until window.scrollY stops changing — the `behavior:"smooth"` scrollIntoView
 *  animation is still in-flight for a few hundred ms after the class/DOM update, so a
 *  screenshot taken immediately after would capture a mid-animation frame. */
async function waitForScrollSettled(page: Page): Promise<void> {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return;
    last = y;
    await page.waitForTimeout(75);
  }
}

/** Re-route /api/board to a NEW board and fire the poll that picks it up. */
async function updateBoardState(page: Page, opts: { liveLanes: number }) {
  await page.unroute("**/api/board");
  const board = paddedBoard(opts);
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

for (const vp of [
  { name: "desktop", width: 1440, height: 900, prefix: "d" },
  { name: "mobile", width: 390, height: 844, prefix: "m" },
]) {
  test.describe(`#1456 auto-reveal — ${vp.name}`, () => {
    test(`${vp.name}: BEFORE (1 lane, panel absent) -> AFTER (2 lanes, revealed + glow)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // ---- BEFORE: 1 lane -> the panel does not mount at all. ----
      await loadBoardState(page, { liveLanes: 1 });
      await expect(page.locator(".ak-lane-row")).toHaveCount(0);
      // Scroll down toward the column strip — the operator's real-world vantage
      // point (the ELI5: "you're scrolled down looking at the columns"). Scroll
      // to the bottom so this is robust regardless of exact page height.
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight)
      );
      await page.waitForTimeout(150);
      const scrolledY = await page.evaluate(() => window.scrollY);
      expect(scrolledY).toBeGreaterThan(100); // sanity: the page actually scrolled
      // VIEWPORT-only (not fullPage) — fullPage stitches the ENTIRE scrollable
      // page regardless of scroll position, which would defeat the entire point
      // (this screenshot exists to show what's actually ON-SCREEN right now).
      await page.screenshot({
        path: path.join(SCREENS, `${vp.prefix}-before-1lane.png`),
      });

      // ---- Genuine <2 -> >=2 transition. ----
      await updateBoardState(page, { liveLanes: 2 });
      await expect(page.locator(".ak-lane-row")).toHaveCount(2, { timeout: 15_000 });

      // The reveal effect runs synchronously off the lane-count change; the
      // one-shot arrival class should already be applied.
      await expect(page.locator(".ak-lanes")).toHaveClass(/ak-lanes--arrive/, {
        timeout: 5_000,
      });
      // The scrollIntoView({behavior:"smooth"}) animation is still in-flight —
      // wait for it to settle before measuring/screenshotting, or we'd capture a
      // mid-animation frame.
      await waitForScrollSettled(page);

      // scrollIntoView({block:"start"}) should have brought the panel to (near) the
      // top of the viewport — the don't-yank / reveal actually moved the viewport.
      const lanesBox = await page.locator(".ak-lanes").boundingBox();
      expect(lanesBox).not.toBeNull();
      expect(lanesBox!.y).toBeLessThan(vp.height * 0.5);

      await page.screenshot({
        path: path.join(SCREENS, `${vp.prefix}-after-2lane-revealed.png`),
      });

      // No horizontal overflow introduced (telemetry-console rule, matches #1295 #7).
      const docOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(docOverflow.scrollWidth).toBeLessThanOrEqual(docOverflow.clientWidth);
    });
  });
}
