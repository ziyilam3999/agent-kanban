// fold8-uiux-redesign.e2e.spec.ts — Playwright acceptance checks for task
// agent-kanban-fold8-uiux-redesign (design D1-D4, AC-1..AC-5). Plan:
// .ai-workspace/plans/2026-08-25-agent-kanban-fold8-uiux-redesign.md
//
// Every layout/interaction claim here is REAL geometry (boundingBox /
// getComputedStyle over the rendered DOM) plus REAL CDP touch
// (e2e/fixtures/touch.ts, Input.dispatchTouchEvent) — never
// computed-style-only for a layout/interaction claim (the incident this plan
// cites: "session-state-20260825-fold8-bugfix-lanes.md"). RED evidence
// against `daa97750` was captured with these SAME spec files (CSS mechanism
// reverted, fixture kept) before the fix landed — see the PR body for the
// numbers.
//
// PR #74's own specs (fold8-scroll-reachability, fold8-inp-under-poll,
// fold8-portrait-2x2, fold8-4x3-grid-tiers) are UNMODIFIED by this task
// (AC-3a) — this file is additive, reusing their proven patterns rather than
// editing them.

import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { buildBoard } from "./fixtures/board-fixture";
import {
  touchDragAt,
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
  "screens-fold8-uiux-redesign",
);

// Deep enough that the TODO column overflows every cell in the AC-1 sweep +
// AC-2 portrait cells (same depth PR #74's fold8-scroll-reachability proved
// sufficient across an overlapping 640-1023 x 620-750 band).
const EXTRA_TODO = 30;
const LIVE_LANES = 1; // lane 0 -> ticket id "900", carries the model pill (AC-2(b)(2)).
const EXPECTED_CARDS = LIVE_LANES + 3 + EXTRA_TODO;
const MODEL_PILL = { version: "claude-sonnet-5-20260315", effort: "high" };
// Base (non-compact) `.ak-card` padding-top from app/globals.css `.ak-card` —
// AC-2(b)(4)'s floor ("padding >= the base card's").
const BASE_CARD_PADDING_TOP = 11;

async function loadDeepBoard(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  const board = buildBoard({
    liveLanes: LIVE_LANES,
    live: true,
    extraTodoCount: EXTRA_TODO,
    modelPill: MODEL_PILL,
  });
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

/** getComputedStyle(...).gridTemplateColumns/Rows track counts (mirrors fold8-4x3-grid-tiers). */
async function gridTracks(page: Page) {
  return page.locator(".ak-board").evaluate((el) => {
    const cs = getComputedStyle(el);
    const cols = cs.gridTemplateColumns.trim();
    const rows = cs.gridTemplateRows.trim();
    const colCount = cols === "none" || cols === "" ? 0 : cols.split(/\s+/).length;
    const rowCount = rows === "none" || rows === "" ? 0 : rows.split(/\s+/).length;
    return { display: cs.display, colCount, rowCount };
  });
}

interface BoardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * AC-1(a)'s geometry-equivalent arm: 4 distinct column x-bands sharing ONE
 * y-band (max col-top spread < one card height) — a 2x2 has only 2 distinct
 * x-bands and a y-spread of roughly one full row height, so it fails BOTH
 * this and the gridTemplateRows=1 computed-style form.
 */
async function oneRowFourUp(page: Page, width: number) {
  const cols = page.locator(".ak-col");
  const count = await cols.count();
  const boxes: BoardBox[] = [];
  for (let i = 0; i < count; i++) {
    const b = await cols.nth(i).boundingBox();
    if (b) boxes.push(b);
  }
  const fullyVisible = boxes.filter(
    (b) => b.x >= -1 && b.y >= -1 && b.x + b.width <= width + 1,
  );
  const xs = Array.from(new Set(boxes.map((b) => Math.round(b.x / 4) * 4)));
  const ys = boxes.map((b) => b.y);
  const ySpread = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const cardBox = await page.locator(".ak-cardbtn").first().boundingBox();
  const cardH = cardBox ? cardBox.height : 40;
  return {
    fullyVisibleCount: fullyVisible.length,
    distinctXBands: xs.length,
    ySpread,
    oneRow: ySpread < cardH,
  };
}

async function hOverflow(page: Page) {
  return page.evaluate(() => {
    const board = document.querySelector(".ak-board")!;
    return { boardScrollW: board.scrollWidth, boardClientW: board.clientWidth };
  });
}

/** Same pattern as PR #74's fold8-scroll-reachability findNearestOffscreenCardId. */
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

/** Real CDP touch-drag reachability probe — AC-1(b) / AC-3(d). */
async function checkReachability(page: Page, width: number, height: number) {
  const targetId = await findNearestOffscreenCardId(page, width, height);
  if (!targetId) {
    return { startedOffscreen: false, scrolled: false, reachedAfter: true };
  }
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

async function densityDeltas(page: Page) {
  const pipsVisible = await page.locator(".ak-pips:visible").count();
  const modelVisible = await page.locator(".ak-model:visible").count();
  const subjectSize = await page
    .locator(".ak-card__subject")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const cardPaddingTop = await page
    .locator(".ak-card")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  const colNameSize = await page
    .locator(".ak-col__name")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  return { pipsVisible, modelVisible, subjectSize, cardPaddingTop, colNameSize };
}

// ---------------------------------------------------------------------------
// AC-1(a)+(b) & AC-3(d) — landscape one-row 4-up + real-touch reachability.
// Union of the 3 red-proven strip cells + the {768,816,890,932,1000}x
// {608,660,750} sweep (890x660 coincides with a sweep cell — de-duplicated).
// ---------------------------------------------------------------------------

const RED_CELLS = [
  { width: 890, height: 660 },
  { width: 840, height: 660 },
  { width: 768, height: 650 },
];
const SWEEP_WIDTHS = [768, 816, 890, 932, 1000];
const SWEEP_HEIGHTS = [608, 660, 750];
const SWEEP_CELLS = SWEEP_WIDTHS.flatMap((width) => SWEEP_HEIGHTS.map((height) => ({ width, height })));

function cellKey(c: { width: number; height: number }) {
  return `${c.width}x${c.height}`;
}
const seenCells = new Set<string>();
const LANDSCAPE_CELLS = [...RED_CELLS, ...SWEEP_CELLS].filter((c) => {
  const k = cellKey(c);
  if (seenCells.has(k)) return false;
  seenCells.add(k);
  return true;
});

test.describe("AC-1(a)+(b) & AC-3(d) — landscape one-row 4-up, real-touch reachability, no dead zone", () => {
  for (const { width, height } of LANDSCAPE_CELLS) {
    test(`${width}x${height}: 4 col-tracks x 1 row-track, 0 h-overflow, real scroll reaches below-fold card`, async ({
      page,
    }) => {
      await loadDeepBoard(page, width, height);

      const tracks = await gridTracks(page);
      expect(tracks.display).toBe("grid");
      // A 2x2 has colCount=2/rowCount=2 — fails BOTH arms (D1 rejects 2x2 in landscape).
      expect(tracks.colCount).toBe(4);
      expect(tracks.rowCount).toBe(1);

      const geo = await oneRowFourUp(page, width);
      expect(geo.fullyVisibleCount).toBe(4);
      expect(geo.distinctXBands).toBe(4);
      expect(geo.oneRow).toBe(true);

      const overflow = await hOverflow(page);
      expect(overflow.boardScrollW).toBeLessThanOrEqual(overflow.boardClientW + 4);

      const colBefore = await page.locator(".ak-col").first().evaluate((el) => el.scrollTop);
      const result = await checkReachability(page, width, height);
      const colAfter = await page.locator(".ak-col").first().evaluate((el) => el.scrollTop);

      expect(result.startedOffscreen).toBe(true);
      expect(result.scrolled).toBe(true);
      expect(result.reachedAfter).toBe(true);
      expect(colAfter).toBeGreaterThan(colBefore);

      if ((width === 1000 && height === 750) || (width === 890 && height === 660)) {
        await page.screenshot({
          path: path.join(SCREENS, `${width}x${height}-landscape-4up.png`),
          fullPage: false,
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// AC-2(a)+(b) — portrait 2-col PAGED geometry (superseded 2x2, see
// fold8-portrait-2col-paging.e2e.spec.ts's own AC-1 for the full paging/
// swipe/dots contract — this block keeps the geometry+density arms LOCAL to
// this file's existing loadDeepBoard/densityDeltas fixtures) + the 5 density
// deltas (AC-5's vehicle — unchanged mechanism, still valid on the new tier).
// ---------------------------------------------------------------------------

/** AC-1(a)/(b): exactly 2 fully-visible `.ak-col`s (42-52% width, >=300px),
 *  real horizontal overflow, and all 4 columns share one row. Same shape as
 *  this file's own `oneRowFourUp` helper above, generalized off the "4
 *  fully visible" landscape assumption to "2 fully visible" for the portrait
 *  paged tier. */
async function twoUpPagedGeometry(page: Page, width: number) {
  const cols = page.locator(".ak-col");
  await expect(cols).toHaveCount(4);
  const boxes: BoardBox[] = [];
  for (let i = 0; i < 4; i++) {
    const b = await cols.nth(i).boundingBox();
    expect(b).not.toBeNull();
    boxes.push(b!);
  }
  const fullyVisible = boxes
    .map((b, i) => ({ i, b }))
    .filter(({ b }) => b.x >= -1 && b.x + b.width <= width + 1);
  expect(fullyVisible.length).toBe(2);
  expect(fullyVisible.map(({ i }) => i).sort((a, b) => a - b)).toEqual([0, 1]);

  const metrics = await page.locator(".ak-board").evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth + 4);
  for (const { b } of fullyVisible) {
    const frac = b.width / metrics.clientWidth;
    expect(frac).toBeGreaterThanOrEqual(0.42);
    expect(frac).toBeLessThanOrEqual(0.52);
    expect(b.width).toBeGreaterThanOrEqual(300);
  }

  const ys = boxes.map((b) => b.y);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  const cardBox = await page.locator(".ak-cardbtn").first().boundingBox();
  const cardH = cardBox ? cardBox.height : 40;
  expect(ySpread).toBeLessThan(cardH);
}

const PORTRAIT_CELLS = [
  { width: 750, height: 1000 },
  { width: 672, height: 850 },
];

test.describe("AC-2(a)+(b) — portrait paged geometry + 5 density deltas + real per-column scroll", () => {
  for (const { width, height } of PORTRAIT_CELLS) {
    test(`${width}x${height}: 2-col page (not 2x2), pips=0, model-pill=0, subject>=14px, padding>=base, col-name>=12.5px`, async ({
      page,
    }) => {
      await loadDeepBoard(page, width, height);
      await twoUpPagedGeometry(page, width);

      const d = await densityDeltas(page);
      expect(d.pipsVisible).toBe(0);
      expect(d.modelVisible).toBe(0);
      expect(d.subjectSize).toBeGreaterThanOrEqual(14);
      expect(d.cardPaddingTop).toBeGreaterThanOrEqual(BASE_CARD_PADDING_TOP);
      expect(d.colNameSize).toBeGreaterThanOrEqual(12.5);

      // Real touch-drag independent-scroll check (AC-2a).
      const before = await page.locator(".ak-col").first().evaluate((el) => el.scrollTop);
      const colBox = await page.locator(".ak-col").first().boundingBox();
      expect(colBox).not.toBeNull();
      await touchDragAt(page, {
        x: colBox!.x + colBox!.width / 2,
        y0: colBox!.y + colBox!.height * 0.7,
        dy: -Math.round(colBox!.height * 0.4),
        steps: 12,
      });
      await page.waitForTimeout(150);
      const after = await page.locator(".ak-col").first().evaluate((el) => el.scrollTop);
      expect(after).toBeGreaterThan(before);

      await page.screenshot({
        path: path.join(SCREENS, `${width}x${height}-portrait-glance.png`),
        fullPage: false,
      });
    });
  }
});

test.describe("AC-2(b) landscape inheritance — 890x660 (same glance card as portrait)", () => {
  test("890x660: pips=0, model-pill=0, subject>=14px", async ({ page }) => {
    await loadDeepBoard(page, 890, 660);
    const d = await densityDeltas(page);
    expect(d.pipsVisible).toBe(0);
    expect(d.modelVisible).toBe(0);
    expect(d.subjectSize).toBeGreaterThanOrEqual(14);
  });
});

// ---------------------------------------------------------------------------
// AC-2(c) — no information lost: the drawer still presents pipeline-role +
// model/effort (retired from the CARD, not from the ticket's own record).
// ---------------------------------------------------------------------------

test.describe("AC-2(c) — drawer retains pipeline-role + model/effort info", () => {
  test("tapping the model-pill card opens the drawer with role + model text visible", async ({ page }) => {
    await loadDeepBoard(page, 750, 1000);
    // Lane 0 -> ticket id "900" (the one carrying MODEL_PILL, see loadDeepBoard).
    const card = page.locator('[aria-label^="Open ticket #900:"]');
    await card.click();
    await expect(page.locator(".ak-drawer")).toBeVisible();
    await page.waitForTimeout(400);

    const roleNode = page.locator(".ak-node__role").first();
    await expect(roleNode).toBeVisible();
    const roleText = await roleNode.textContent();
    expect(roleText).toBeTruthy();

    const modelNode = page.locator(".ak-node__model").first();
    await expect(modelNode).toBeVisible();
    const modelText = await modelNode.textContent();
    // abbreviateModel strips the "claude-" prefix from MODEL_PILL.version.
    expect(modelText).toContain("sonnet");
    expect(modelText).toContain("high");
  });
});

// ---------------------------------------------------------------------------
// AC-3(b) — INP under the 5s poll at the NEW 4-up cell (890x660). 750x1000 is
// already covered by PR #74's UNMODIFIED fold8-inp-under-poll.e2e.spec.ts.
// ---------------------------------------------------------------------------

interface InpEvent {
  duration: number;
  inputDelay: number;
}

test.describe("AC-3(b) — INP under poll at 890x660 (new 4-up cell)", () => {
  test("890x660: touch-scroll interaction straddling a poll tick stays <200ms duration / <100ms input delay", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __akEvents: InpEvent[] }).__akEvents = [];
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const e = entry as PerformanceEventTiming;
            (window as unknown as { __akEvents: InpEvent[] }).__akEvents.push({
              duration: e.duration,
              inputDelay: e.processingStart - e.startTime,
            });
          }
        }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
      } catch {
        /* event timing not supported */
      }
    });

    await page.setViewportSize({ width: 890, height: 660 });
    const board = buildBoard({ liveLanes: 0, live: true, bigPayload: { count: 1000, descriptionBytes: 3000 } });
    await page.route("**/api/board", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(board) });
    });

    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    const navStart = Date.now();
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator(".ak-cardbtn").first()).toBeVisible({ timeout: 20_000 });

    const POLL_MS = 5000;
    async function untilMsFromNav(targetMs: number) {
      const delta = navStart + targetMs - Date.now();
      if (delta > 0) await page.waitForTimeout(delta);
    }
    // Straddle poll tick #2 with a real touch-scroll burst (mirrors PR #74's methodology).
    await untilMsFromNav(POLL_MS * 2 - 300);
    const colBox = await page.locator(".ak-col").first().boundingBox();
    if (colBox) {
      await touchDragAt(page, {
        x: colBox.x + colBox.width / 2,
        y0: colBox.y + Math.min(60, colBox.height * 0.3),
        dy: -Math.min(200, colBox.height * 0.5),
        steps: 20,
        stepDelayMs: 16,
      });
    }
    await page.waitForTimeout(700);

    const events = await page.evaluate(
      () => (window as unknown as { __akEvents: InpEvent[] }).__akEvents,
    );
    const worstDelay = events.reduce((m, e) => Math.max(m, e.inputDelay), 0);
    const worstDuration = events.reduce((m, e) => Math.max(m, e.duration), 0);
    test.info().annotations.push({
      type: "inp-890x660",
      description: JSON.stringify({ count: events.length, worstDelay, worstDuration }),
    });
    expect(worstDelay).toBeLessThan(100);
    expect(worstDuration).toBeLessThan(200);
  });
});
