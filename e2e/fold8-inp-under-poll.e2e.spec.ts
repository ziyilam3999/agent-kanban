// fold8-inp-under-poll.e2e.spec.ts — AC-3 (bug 3: responsiveness under the
// live poll) for task agent-kanban-fold8-4x3-bugfix. Plan:
// .ai-workspace/plans/2026-08-25-agent-kanban-fold8-4x3-bugfix-responsive.md
//
// FROZEN harness parameters (identical for red-on-master and green-on-fix):
//   - production-scale synthetic board via buildBoard's bigPayload option:
//     1000 tickets, descriptionBytes=3000 -> measured 3.25MB serialized
//     (calibrated 2026-08-25; see PR body / red-evidence file for the raw
//     measurement — NOT a repo file, an independent synthetic fixture).
//   - shipped poll cadence (POLL_MS=5000 in components/BoardView.tsx) — NO
//     test-only cadence override.
//   - CDP CPU throttle: CPU_THROTTLE_RATE below (start 4x; raise once to 6x
//     and freeze if 4x does not reproduce red on master per AC-3's own
//     escape hatch — see red-evidence file for which value was frozen).
//   - PerformanceObserver('longtask') and PerformanceObserver('event',
//     {durationThreshold:16, buffered:true}) collectors, installed via
//     page.addInitScript so they attach before any app JS runs.

import { test, expect, type Page } from "@playwright/test";
import { buildBoard } from "./fixtures/board-fixture";
import { touchDragAt } from "./fixtures/touch";

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });

// FROZEN — see file header. Bump ONCE (4 -> 6) only if 4x fails to reproduce
// red on master; if bumped, both red and green runs MUST use the new value.
const CPU_THROTTLE_RATE = 4;

const BIG_PAYLOAD = { count: 1000, descriptionBytes: 3000 };
const POLL_MS = 5000; // components/BoardView.tsx POLL_MS — mirrored here for scheduling only, never used to change app behavior.

function installCollectors(page: Page) {
  return page.addInitScript(() => {
    (window as unknown as { __akLongtasks: Array<{ start: number; duration: number }> }).__akLongtasks = [];
    (
      window as unknown as {
        __akEvents: Array<{ name: string; start: number; duration: number; inputDelay: number }>;
      }
    ).__akEvents = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          (window as unknown as { __akLongtasks: Array<{ start: number; duration: number }> }).__akLongtasks.push({
            start: e.startTime,
            duration: e.duration,
          });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* longtask not supported — leave empty, the assertion will then be vacuous-true (documented) */
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEventTiming;
          (
            window as unknown as {
              __akEvents: Array<{ name: string; start: number; duration: number; inputDelay: number }>;
            }
          ).__akEvents.push({
            name: e.name,
            start: e.startTime,
            duration: e.duration,
            inputDelay: e.processingStart - e.startTime,
          });
        }
      }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    } catch {
      /* event timing not supported */
    }
  });
}

async function readLongtasks(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __akLongtasks: Array<{ start: number; duration: number }> }).__akLongtasks,
  );
}

async function readEvents(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __akEvents: Array<{ name: string; start: number; duration: number; inputDelay: number }>;
        }
      ).__akEvents,
  );
}

async function setupThrottledBigBoard(page: Page, width: number, height: number) {
  await installCollectors(page);
  await page.setViewportSize({ width, height });
  const board = buildBoard({ liveLanes: 0, live: true, bigPayload: BIG_PAYLOAD });
  await page.route("**/api/board", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(board) });
  });

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE_RATE });

  const navStart = Date.now();
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".ak-cardbtn").first()).toBeVisible({ timeout: 20_000 });
  return { navStart, client };
}

/** Real touch-scroll burst on the given selector's bounding box for ~duration ms. */
async function scrollBurst(page: Page, selector: string, durationMs: number) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y0 = box.y + Math.min(60, box.height * 0.3);
  const steps = Math.max(4, Math.round(durationMs / 16));
  await touchDragAt(page, { x, y0, dy: -Math.min(200, box.height * 0.5), steps, stepDelayMs: 16 });
}

test.describe("AC-3a — idle-tick cost (ZERO longtasks >=100ms across >=3 UNCHANGED-payload poll ticks)", () => {
  for (const vp of [
    { width: 750, height: 1000 },
    { width: 1000, height: 750 },
  ]) {
    test(`${vp.width}x${vp.height}: no longtask attributable to an unchanged poll tick`, async ({ page }) => {
      await setupThrottledBigBoard(page, vp.width, vp.height);

      // Mark the observation window's start AFTER the FIRST poll tick has
      // already fired (+ settle buffer) — that first tick is an unavoidable
      // one-time "first observation" of the payload (there is no PRIOR
      // fetch to compare against, on master OR on the fix), so it always
      // does a full parse+render exactly once. Starting the window there
      // means every tick actually OBSERVED (#2, #3, #4) is genuinely
      // "unchanged relative to the previous tick" — the real steady-state
      // scenario the operator hit (an already-open board left running).
      await page.waitForTimeout(POLL_MS + 800);
      const observationStart = await page.evaluate(() => performance.now());

      // Idle for >=3 more full poll cycles (payload never changes — same
      // route handler serves the SAME board object the whole time). No
      // interaction during this window: any longtask here is attributable
      // to background work (the poll tick), not to user input.
      await page.waitForTimeout(POLL_MS * 3 + 800);

      const longtasks = await readLongtasks(page);
      const inWindow = longtasks.filter((t) => t.start >= observationStart);
      const big = inWindow.filter((t) => t.duration >= 100);
      // Attach full readout for the red-evidence record even on failure.
      test.info().annotations.push({
        type: "longtasks",
        description: JSON.stringify({
          observationStart,
          totalInWindow: inWindow.length,
          big: big.length,
          sample: big.slice(0, 6),
        }),
      });
      expect(big.length).toBe(0);
    });
  }
});

test.describe("AC-3b — interaction latency under active polling (worst input delay <100ms, worst duration <200ms)", () => {
  for (const vp of [
    { width: 750, height: 1000 },
    { width: 1000, height: 750 },
  ]) {
    test(`${vp.width}x${vp.height}: tap+drawer-scroll+column-scroll stay responsive across poll ticks`, async ({
      page,
    }) => {
      const { navStart } = await setupThrottledBigBoard(page, vp.width, vp.height);

      async function untilMsFromNav(targetMs: number) {
        const delta = navStart + targetMs - Date.now();
        if (delta > 0) await page.waitForTimeout(delta);
      }

      // Let poll tick #1 fire UNDISTURBED first — it is an unavoidable
      // one-time "first observation" of the payload (no prior fetch to
      // compare against, on master OR on the fix), so it always does a full
      // parse+render exactly once. Our interactions below straddle ticks
      // #2/#3/#4 instead — each genuinely "unchanged relative to the
      // previous tick", the real steady-state scenario the operator hit.
      await untilMsFromNav(POLL_MS * 1 + 400);

      // (i) tap a card -> drawer opens, timed to straddle poll tick #2.
      await untilMsFromNav(POLL_MS * 2 - 300);
      const card = page.locator(".ak-cardbtn").first();
      const cardBox = await card.boundingBox();
      if (cardBox) {
        const client = await page.context().newCDPSession(page);
        await client.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 }],
        });
        await client.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await client.detach().catch(() => {});
      }
      await page.waitForTimeout(600);
      await expect(page.locator(".ak-drawer")).toBeVisible({ timeout: 5_000 });

      // (ii) touch-scroll the drawer body, straddling poll tick #3.
      await untilMsFromNav(POLL_MS * 3 - 300);
      await scrollBurst(page, "[data-ak-pulldown], .ak-drawer__body, .ak-drawer", 700);

      // Close the drawer (tap the scrim/close button) before touching a column.
      const closeBtn = page.locator(".ak-drawer button").first();
      if (await closeBtn.count()) {
        await closeBtn.click({ force: true }).catch(() => {});
      }
      await page.waitForTimeout(200);

      // (iii) touch-scroll a board column, straddling poll tick #4.
      await untilMsFromNav(POLL_MS * 4 - 300);
      await scrollBurst(page, ".ak-col", 700);

      await page.waitForTimeout(500);

      const events = await readEvents(page);
      const worstDelay = events.reduce((m, e) => Math.max(m, e.inputDelay), 0);
      const worstDuration = events.reduce((m, e) => Math.max(m, e.duration), 0);
      test.info().annotations.push({
        type: "events",
        description: JSON.stringify({ count: events.length, worstDelay, worstDuration }),
      });

      expect(worstDelay).toBeLessThan(100);
      expect(worstDuration).toBeLessThan(200);
    });
  }
});
