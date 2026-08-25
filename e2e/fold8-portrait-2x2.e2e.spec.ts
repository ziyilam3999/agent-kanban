// fold8-portrait-2x2.e2e.spec.ts — AC-2 (bug 2: portrait 2x2 coherence + poll
// stability) for task agent-kanban-fold8-4x3-bugfix. Plan:
// .ai-workspace/plans/2026-08-25-agent-kanban-fold8-4x3-bugfix-responsive.md
//
// Geometric assertions on real boundingBox() numbers (never screenshots), plus
// a real-interaction sync leg: touch-scroll one column, THEN deliver a fresh
// intercepted /api/board payload (simulating a live poll tick), and assert the
// scrolled column's scrollTop survives + the 2x2 geometry still holds.

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
  // specifically about a CHANGED tick, not an unchanged one; AC-3 covers
  // unchanged-payload cost separately).
  board.tickets = board.tickets.map((t) => ({ ...t, subject: `${t.subject} [${extraTag}]` }));
  return board;
}

interface BoardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: BoardBox, b: BoardBox): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function within(inner: BoardBox, outer: BoardBox, slack = 2): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

async function assertGeometryCoherent(page: Page) {
  const cols = page.locator(".ak-col");
  await expect(cols).toHaveCount(4);
  const boardBox = await page.locator(".ak-board").boundingBox();
  expect(boardBox).not.toBeNull();

  const boxes: BoardBox[] = [];
  for (let i = 0; i < 4; i++) {
    const b = await cols.nth(i).boundingBox();
    expect(b).not.toBeNull();
    boxes.push(b!);
  }

  // No pairwise overlap.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(overlaps(boxes[i], boxes[j])).toBe(false);
    }
  }
  // Every box inside .ak-board's box.
  for (const b of boxes) {
    expect(within(b, boardBox!)).toBe(true);
  }
  // 2 rows x 2 cols: exactly 2 distinct x-starts and 2 distinct y-starts
  // (rounded to survive sub-pixel rendering).
  const xs = Array.from(new Set(boxes.map((b) => Math.round(b.x / 4) * 4)));
  const ys = Array.from(new Set(boxes.map((b) => Math.round(b.y / 4) * 4)));
  expect(xs.length).toBe(2);
  expect(ys.length).toBe(2);

  // Board fits the frame — no body-level vertical scrollability (columns
  // themselves may scroll internally; the PAGE must not).
  const pageScroll = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(pageScroll.scrollHeight).toBeLessThanOrEqual(pageScroll.innerHeight + 2);
}

test.describe("AC-2 — portrait 2x2 geometric coherence (750x1000)", () => {
  test("4 columns form a non-overlapping 2x2 grid inside the board, page does not scroll", async ({
    page,
  }) => {
    const board = makeBoard("v1");
    await page.route("**/api/board", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(board) });
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    // Wait for the EXACT expected count (not just "any card") — the SSR
    // first paint renders data/board.sample.json server-side, before route
    // interception can affect it; a bare "first card visible" check can
    // race against that stale DOM.
    await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS, { timeout: 15_000 });
    await page.waitForTimeout(500);

    await assertGeometryCoherent(page);
  });
});

test.describe("AC-2 — real-interaction sync leg (scroll survives a live poll tick)", () => {
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
    // Wait for the EXACT expected count (not just "any card") — the SSR
    // first paint renders data/board.sample.json server-side, before route
    // interception can affect it; a bare "first card visible" check can
    // race against that stale DOM.
    await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS, { timeout: 15_000 });
    await page.waitForTimeout(500);

    await assertGeometryCoherent(page);

    // Real touch-scroll column A (todo, first .ak-col) by a real gesture,
    // anchored to column A's OWN bounding box — in the 2x2 tier it only
    // occupies the top-left quadrant, so a viewport-fraction anchor can miss
    // it entirely and land in a different row/column.
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
    // hundred ms after touchend independent of any poll tick (measured:
    // ~300ms to stabilize here), and comparing against a mid-momentum
    // snapshot would misattribute normal inertia to the poll.
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

    await assertGeometryCoherent(page);
  });
});
