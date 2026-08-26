// fold8-portrait-2col-paging.e2e.spec.ts — Binary AC harness for task
// agent-kanban-fold8-uiux-redesign (portrait iteration round). Plan:
// .ai-workspace/plans/2026-08-26-fold8-portrait-2col-paging.md (AC-1..AC-9).
//
// Portrait now presents a 2-up, PAGE-SNAPPED horizontal strip (page A = TO
// DO/IN PROGRESS, page B = IN REVIEW/DONE) instead of the retired 2x2
// quadrant grid — this file supersedes the OLD portrait-2x2 geometry arms
// that lived in fold8-portrait-2x2.e2e.spec.ts / fold8-uiux-redesign.e2e.
// spec.ts / fold8-4x3-grid-tiers.e2e.spec.ts (amended alongside this file —
// see the plan's Spec-amendment inventory). Landscape is LOCKED and
// asserted unchanged by those same amended files' untouched landscape
// blocks — nothing here touches a landscape cell.
//
// Every layout/interaction claim is REAL geometry (boundingBox/
// getComputedStyle) plus REAL CDP touch (e2e/fixtures/touch.ts) — never
// computed-style-only for a layout/interaction claim (the incident this
// plan cites: "session-state-20260825-fold8-bugfix-lanes.md").

import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { buildBoard } from "./fixtures/board-fixture";
import {
  touchDragAt,
  swipeLeft,
  swipeRight,
  ancestorScrollOffsets,
  anyOffsetIncreased,
  boxOf,
  fullyInViewport,
} from "./fixtures/touch";

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });

const SCREENS = path.join(
  __dirname,
  "..",
  ".ai-workspace",
  "design",
  "screens-fold8-portrait-2col-paging",
);

const MODEL_PILL = { version: "claude-sonnet-5-20260315", effort: "high" };
// liveLanes(1, carries the model pill) + ctx(3) + bigPayload(40, round-robined
// across all 4 columns => ~10 each) — enough depth in EVERY column (both
// page A and page B) for the AC-2(d)/AC-7 vertical-reachability legs.
const LIVE_LANES = 1;
const BIG_PAYLOAD = { count: 40, descriptionBytes: 0 };
const EXPECTED_CARDS = LIVE_LANES + 3 + BIG_PAYLOAD.count;

async function loadPortraitBoard(page: Page, width: number, height: number, tag = "v1") {
  await page.setViewportSize({ width, height });
  const board = buildBoard({
    liveLanes: LIVE_LANES,
    live: true,
    modelPill: MODEL_PILL,
    bigPayload: BIG_PAYLOAD,
  });
  board.tickets = board.tickets.map((t) => ({ ...t, subject: `${t.subject} [${tag}]` }));
  await page.route("**/api/board", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(board) });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS, { timeout: 15_000 });
  await page.waitForTimeout(500);
  return board;
}

interface ColBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** getBoundingClientRect() (viewport-relative) for every `.ak-col`, DOM order = COLUMNS order. */
async function colBoxes(page: Page): Promise<ColBox[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".ak-col")).map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    }),
  );
}

function fullyVisibleIndices(boxes: ColBox[], width: number): number[] {
  return boxes
    .map((b, i) => ({ i, b }))
    .filter(({ b }) => b.left >= -1 && b.right <= width + 1)
    .map(({ i }) => i);
}

async function boardMetrics(page: Page) {
  return page.locator(".ak-board").evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    scrollLeft: el.scrollLeft,
  }));
}

async function dotStates(page: Page) {
  return page.locator(".ak-dots__dot").evaluateAll((els) =>
    els.map((el) => ({
      active: el.classList.contains("ak-dots__dot--active"),
      selected: el.getAttribute("aria-selected") === "true",
    })),
  );
}

/** Real vertical touch drag inside `.ak-col` index `i` — returns scrollTop before/after. */
async function verticalDragCol(page: Page, i: number) {
  const col = page.locator(".ak-col").nth(i);
  const before = await col.evaluate((el) => el.scrollTop);
  const box = await col.boundingBox();
  expect(box).not.toBeNull();
  await touchDragAt(page, {
    x: box!.x + box!.width / 2,
    y0: box!.y + box!.height * 0.7,
    dy: -Math.round(box!.height * 0.4),
    steps: 12,
  });
  await page.waitForTimeout(200);
  const after = await col.evaluate((el) => el.scrollTop);
  return { before, after };
}

/** Generic "some scroll path reaches a below-fold card" probe (AC-7's dead-zone check). */
async function checkDeadZone(page: Page, width: number, height: number) {
  const targetId = await page.evaluate(
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
  if (!targetId) return { startedOffscreen: false, scrolled: false, reachedAfter: true };
  const selector = `[aria-label^="Open ticket #${targetId}:"]`;
  const before = await boxOf(page, selector);
  const startedOffscreen = !fullyInViewport(before, width, height);
  const beforeOffsets = await ancestorScrollOffsets(page, selector);

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
  };
}

const PORTRAIT_CELLS = [
  { width: 750, height: 1000 },
  { width: 672, height: 850 },
];

// ---------------------------------------------------------------------------
// AC-1 — portrait is a 2-col PAGE (not 2x2, not all-4).
// ---------------------------------------------------------------------------

test.describe("AC-1 — exactly 2 fully-visible columns, one row, page-A peek", () => {
  for (const { width, height } of PORTRAIT_CELLS) {
    test(`${width}x${height}: 2 cols fully visible (42-52% width, >=300px), h-overflow, one row, page A = TODO+IN_PROGRESS + >=16px peek of col 3`, async ({
      page,
    }) => {
      await loadPortraitBoard(page, width, height);

      const metrics = await boardMetrics(page);
      // AC-1(a): real horizontal overflow.
      expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth + 4);

      const boxes = await colBoxes(page);
      const visible = fullyVisibleIndices(boxes, width);
      expect(visible.length).toBe(2);
      // AC-1(c): page A on load = columns 0,1 (TO DO, IN PROGRESS).
      expect(visible.sort((a, b) => a - b)).toEqual([0, 1]);

      for (const i of visible) {
        const frac = boxes[i].width / metrics.clientWidth;
        expect(frac).toBeGreaterThanOrEqual(0.42);
        expect(frac).toBeLessThanOrEqual(0.52);
        expect(boxes[i].width).toBeGreaterThanOrEqual(300);
      }

      // AC-1(b): all 4 columns share one row (max top-spread < one card height).
      const cardBox = await page.locator(".ak-cardbtn").first().boundingBox();
      const cardH = cardBox ? cardBox.height : 40;
      const tops = boxes.map((b) => b.top);
      const ySpread = Math.max(...tops) - Math.min(...tops);
      expect(ySpread).toBeLessThan(cardH);

      // AC-1(c): >=16px peek of column 3 (IN REVIEW) at the viewport's right edge.
      const col3 = boxes[2];
      const peek = width - col3.left;
      expect(peek).toBeGreaterThanOrEqual(16);

      await page.screenshot({
        path: path.join(SCREENS, `${width}x${height}-portrait-page-a.png`),
        fullPage: false,
      });
    });
  }
});

// ---------------------------------------------------------------------------
// AC-2 — real-gesture paging with page-snap (the mandatory real-interaction spec).
// ---------------------------------------------------------------------------

test.describe("AC-2 — real swipe pages cleanly, snaps, reverses, both pages scroll vertically", () => {
  for (const { width, height } of PORTRAIT_CELLS) {
    test(`${width}x${height}: swipe left -> page B (cols 3-4), no {col2,col3} straddle, reverse -> page A, vertical drag works on both pages`, async ({
      page,
    }) => {
      await loadPortraitBoard(page, width, height);
      const board = page.locator(".ak-board");
      const restA = await board.evaluate((el) => el.scrollLeft);

      // AC-2(a): real swipe left -> scrollLeft delta > 0, cols 3 & 4 fully visible.
      await swipeLeft(page, {});
      await page.waitForTimeout(500);
      const afterSwipe = await board.evaluate((el) => el.scrollLeft);
      expect(afterSwipe).toBeGreaterThan(restA);

      const boxesAfter = await colBoxes(page);
      const visibleAfter = fullyVisibleIndices(boxesAfter, width).sort((a, b) => a - b);
      expect(visibleAfter).toEqual([2, 3]);
      // AC-2(b): never a straddled {col2,col3} == index pair [1,2] rest.
      expect(visibleAfter).not.toEqual([1, 2]);
      const restB = afterSwipe;

      await page.screenshot({
        path: path.join(SCREENS, `${width}x${height}-portrait-page-b.png`),
        fullPage: false,
      });

      // AC-2(d): real vertical drag inside column 4 (page B) increases scrollTop.
      const col4 = await verticalDragCol(page, 3);
      expect(col4.after).toBeGreaterThan(col4.before);

      // A second settled swipe from page B lands on the SAME page-B rest
      // (±8px) — confirms the rest position is a stable page stop, not drift.
      await swipeLeft(page, {});
      await page.waitForTimeout(500);
      const settleAgain = await board.evaluate((el) => el.scrollLeft);
      expect(Math.abs(settleAgain - restB)).toBeLessThanOrEqual(8);

      // AC-2(c): reverse swipe returns to page A (scrollLeft ~= restA, ±8px).
      await swipeRight(page, {});
      await page.waitForTimeout(500);
      const afterReverse = await board.evaluate((el) => el.scrollLeft);
      expect(Math.abs(afterReverse - restA)).toBeLessThanOrEqual(8);
      const boxesReverse = await colBoxes(page);
      expect(fullyVisibleIndices(boxesReverse, width).sort((a, b) => a - b)).toEqual([0, 1]);

      // AC-2(d): real vertical drag inside column 1 (page A) increases scrollTop.
      const col1 = await verticalDragCol(page, 0);
      expect(col1.after).toBeGreaterThan(col1.before);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-3 — "more columns" affordance asserted in the DOM (dots).
// ---------------------------------------------------------------------------

test.describe("AC-3 — dots visible, pair-lit, single logical selection, tap jumps page", () => {
  for (const { width, height } of PORTRAIT_CELLS) {
    test(`${width}x${height}: 4 dots visible, page A lights dots 1-2, swipe lights dots 3-4, tap an offscreen dot jumps its page`, async ({
      page,
    }) => {
      await loadPortraitBoard(page, width, height);

      const dots = page.locator(".ak-dots");
      await expect(dots).toBeVisible();
      // AC-3(a).
      await expect(page.locator(".ak-dots__dot")).toHaveCount(4);

      // AC-3(b): on page A, exactly 2 dots carry the active marker (cols 1-2),
      // and exactly ONE dot carries the single logical aria-selected.
      const statesA = await dotStates(page);
      expect(statesA.map((s) => s.active)).toEqual([true, true, false, false]);
      expect(statesA.filter((s) => s.selected).length).toBe(1);
      expect(statesA[0].selected).toBe(true);

      await swipeLeft(page, {});
      await page.waitForTimeout(500);
      const statesB = await dotStates(page);
      expect(statesB.map((s) => s.active)).toEqual([false, false, true, true]);
      expect(statesB.filter((s) => s.selected).length).toBe(1);
      expect(statesB[2].selected).toBe(true);

      // AC-3(c): a real tap on the dot for a currently-offscreen column (col 1,
      // "IN PROGRESS" — offscreen while resting on page B) brings it into view.
      await page.locator(".ak-dots__dot").nth(1).click();
      await page.waitForTimeout(500);
      const boxes = await colBoxes(page);
      expect(fullyVisibleIndices(boxes, width).sort((a, b) => a - b)).toEqual([0, 1]);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-4(a) — NEW invariant: a poll tick that re-renders cards does NOT move
// the board off page B. (AC-4(b)/(c) are carried/controlled elsewhere — see
// the plan's Spec-amendment inventory.)
// ---------------------------------------------------------------------------

test.describe("AC-4(a) — poll tick does not move the board off page B (750x1000)", () => {
  test("resting on page B, a changed poll payload leaves scrollLeft at the page-B rest (±8px)", async ({
    page,
  }) => {
    let currentBoard = buildBoard({
      liveLanes: LIVE_LANES,
      live: true,
      modelPill: MODEL_PILL,
      bigPayload: BIG_PAYLOAD,
    });
    currentBoard.tickets = currentBoard.tickets.map((t) => ({ ...t, subject: `${t.subject} [v1]` }));
    await page.setViewportSize({ width: 750, height: 1000 });
    await page.route("**/api/board", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentBoard) });
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS, { timeout: 15_000 });
    await page.waitForTimeout(500);

    const board = page.locator(".ak-board");
    await swipeLeft(page, {});
    await page.waitForTimeout(500);
    const restB = await board.evaluate((el) => el.scrollLeft);
    const boxes = await colBoxes(page);
    expect(fullyVisibleIndices(boxes, 750).sort((a, b) => a - b)).toEqual([2, 3]);

    // Swap in a CHANGED payload for the next poll tick, then wait out the
    // real 5s poll cadence (no test-only cadence override).
    const next = buildBoard({
      liveLanes: LIVE_LANES,
      live: true,
      modelPill: MODEL_PILL,
      bigPayload: BIG_PAYLOAD,
    });
    next.tickets = next.tickets.map((t) => ({ ...t, subject: `${t.subject} [v2-poll-tick]` }));
    currentBoard = next;
    await page.waitForTimeout(5_600);

    // The tick actually fired.
    await expect(page.locator(".ak-cardbtn").first()).toContainText("v2-poll-tick", { timeout: 5_000 });

    const afterPoll = await board.evaluate((el) => el.scrollLeft);
    expect(Math.abs(afterPoll - restB)).toBeLessThanOrEqual(8);
    const boxesAfterPoll = await colBoxes(page);
    expect(fullyVisibleIndices(boxesAfterPoll, 750).sort((a, b) => a - b)).toEqual([2, 3]);
  });
});

// ---------------------------------------------------------------------------
// AC-6(extra) — non-blocking tightening: `.ak-dots` stays hidden at the
// landscape cells (the shared-component blast-radius fence).
// ---------------------------------------------------------------------------

test.describe("AC-6 tightening — .ak-dots stays hidden in landscape", () => {
  for (const { width, height } of [
    { width: 890, height: 660 },
    { width: 1000, height: 750 },
  ]) {
    test(`${width}x${height}: .ak-dots computed display is none`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const board = buildBoard({ liveLanes: 0, live: true, extraTodoCount: 5 });
      await page.route("**/api/board", async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(board) });
      });
      await page.goto("/", { waitUntil: "networkidle" });
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(page.locator(".ak-cardbtn").first()).toBeVisible({ timeout: 15_000 });

      const display = await page.locator(".ak-dots").evaluate((el) => getComputedStyle(el).display);
      expect(display).toBe("none");
    });
  }
});

// ---------------------------------------------------------------------------
// AC-7 — no dead zone across the partition (boundary cells).
// ---------------------------------------------------------------------------

test.describe("AC-7 — boundary cells: short portrait (newly engaged) + landscape<768 sliver (falls to strip)", () => {
  test("672x690: short portrait renders the 2-col paged tier and passes AC-2(d)-style reachability", async ({
    page,
  }) => {
    await loadPortraitBoard(page, 672, 690);

    const metrics = await boardMetrics(page);
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth + 4);
    const boxes = await colBoxes(page);
    expect(fullyVisibleIndices(boxes, 672).sort((a, b) => a - b)).toEqual([0, 1]);

    const col1 = await verticalDragCol(page, 0);
    expect(col1.after).toBeGreaterThan(col1.before);
  });

  test("750x710: landscape<768 sliver falls back to a working scroll path (strip page-scroll) — no unscrollable clamp", async ({
    page,
  }) => {
    await loadPortraitBoard(page, 750, 710);
    const result = await checkDeadZone(page, 750, 710);
    expect(result.startedOffscreen).toBe(true);
    expect(result.scrolled || result.reachedAfter).toBe(true);
    expect(result.reachedAfter).toBe(true);
  });
});
