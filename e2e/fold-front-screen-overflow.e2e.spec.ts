// fold-front-screen-overflow.e2e.spec.ts — Binary AC harness for task
// agent-kanban-portrait-overflow-fold-front-screen-misclassified-as-phone.
// Plan: .ai-workspace/plans/2026-09-05-agent-kanban-fold-portrait-overflow.md
// (AC-1..AC-10). Review: .ai-workspace/reviews/agent-kanban-portrait-overflow-
// fold-front-screen-misclassified-as-phone-plan-review.md (Decision: PASS).
//
// Root cause (verified against origin/master @ 0b275b0): `.ak-lane-id` was
// `white-space:nowrap` with no shrink/overflow/ellipsis (its sibling
// `.ak-lane-subject` already had the full combo), so a real 71-80 char
// production task-slug id overflowed its row at the Fold's cover-screen
// width (390-412 CSS px) — the FIXTURE used numeric `90${i}` ids, which
// never overflow anything, so three earlier overflow-guard rounds never
// caught this. `body{overflow-x:hidden}` alone did not stop a real touch
// drag from panning the VISUAL viewport (document.scrollingElement is
// `<html>`, not `<body>`) — the header pills and meter tiles slid off-screen
// even though `window.scrollX` stayed 0.
//
// Every interaction claim here is REAL CDP touch (touchDragHorizontalAt,
// e2e/fixtures/touch.ts) or a real Playwright wheel event — never a
// synthetic `element.dispatchEvent` and never computed-style-only for an
// interaction claim (the fold8-4x3 PR #73 incident this repo's UI-gate
// doctrine cites).

import { test, expect, type Page } from "@playwright/test";
import path from "path";
import {
  buildBoard,
  PRODUCTION_ID_71,
  PRODUCTION_ID_80,
  PRODUCTION_TOKEN_105,
} from "./fixtures/board-fixture";
import {
  touchDragHorizontalAt,
  ancestorScrollOffsets,
  anyOffsetIncreased,
  boxOf,
  fullyInViewport,
  visualViewportOffsets,
} from "./fixtures/touch";

const SCREENS = path.join(
  __dirname,
  "..",
  ".ai-workspace",
  "design",
  "screens-agent-kanban-fold-portrait-overflow",
);

// 2 production-shaped live lanes (71-char id + 105-char token subject on lane
// 0, 80-char id on lane 1) + the 3 fixed context tickets (todo/in_review/done).
const LIVE_LANES = 2;
const EXPECTED_CARDS = LIVE_LANES + 3;

async function loadProdBoard(page: Page, width: number, height: number, extraTodoCount = 0) {
  await page.setViewportSize({ width, height });
  const board = buildBoard({
    liveLanes: LIVE_LANES,
    live: true,
    productionShaped: true,
    extraTodoCount,
  });
  await page.route("**/api/board", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(board) });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS + extraTodoCount, {
    timeout: 15_000,
  });
  await page.waitForTimeout(500);
  return board;
}

async function pageMetrics(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.scrollingElement!.scrollWidth,
    clientWidth: document.scrollingElement!.clientWidth,
  }));
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Per-`.ak-lane-row` geometry: the row's own right edge, plus its id/track boxes. */
async function laneGeometry(
  page: Page,
): Promise<Array<{ rowRight: number; id: Rect | null; track: Rect | null }>> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".ak-lane-row"));
    return rows.map((row) => {
      const rowBox = row.getBoundingClientRect();
      const idEl = row.querySelector(".ak-lane-id");
      const trackEl = row.querySelector(".ak-lane-track");
      const toRect = (r: DOMRect): Rect => ({
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      });
      return {
        rowRight: rowBox.right,
        id: idEl ? toRect(idEl.getBoundingClientRect()) : null,
        track: trackEl ? toRect(trackEl.getBoundingClientRect()) : null,
      };
    });
  });
}

interface ColBox extends Rect {
  width: number;
  height: number;
}

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

// ---------------------------------------------------------------------------
// Production-shaped board — self-asserted payload lengths BEFORE measuring
// (Rule-17: "the oracle must be able to vary" — a quietly-shortened fixture
// must fail this loudly rather than silently pass every geometry AC below).
// ---------------------------------------------------------------------------

test.describe("Production-shaped fixture — self-asserted payload lengths", () => {
  test("ids/token are exactly 71 / 80 / 105 chars, no whitespace, on the built board payload", () => {
    const board = buildBoard({ liveLanes: LIVE_LANES, live: true, productionShaped: true });
    const lane0 = board.tickets.find(
      (t) => t.column === "in_progress" && t.subject.includes(PRODUCTION_TOKEN_105),
    );
    const lane1 = board.tickets.find((t) => t.id === PRODUCTION_ID_80);
    expect(lane0, "lane 0 (71-char id + 105-char token subject) must exist").toBeTruthy();
    expect(lane1, "lane 1 (80-char id) must exist").toBeTruthy();
    expect(lane0!.id).toBe(PRODUCTION_ID_71);
    expect(lane0!.id.length).toBe(71);
    expect(lane1!.id.length).toBe(80);
    expect(PRODUCTION_TOKEN_105.length).toBe(105);
    expect(/\s/.test(lane0!.id)).toBe(false);
    expect(/\s/.test(lane1!.id)).toBe(false);
    expect(/\s/.test(PRODUCTION_TOKEN_105)).toBe(false);
  });

  test.describe("rendered DOM", () => {
    test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });
    test("the live-lanes panel actually renders the 71/80-char ids and the 105-char token", async ({
      page,
    }) => {
      await loadProdBoard(page, 750, 1000);
      const idsText = await page.locator(".ak-lane-id").allTextContents();
      expect(idsText).toContain(`#${PRODUCTION_ID_71}`);
      expect(idsText).toContain(`#${PRODUCTION_ID_80}`);
      const subjectsText = await page.locator(".ak-lane-subject").allTextContents();
      expect(subjectsText.some((t) => t.includes(PRODUCTION_TOKEN_105))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// AC-1 — zero page-level horizontal overflow, across matrix M.
// RED on 0b275b0 at 390x844 (588 vs 390) and 412x915 (588 vs 412); every
// other cell is a GREEN control that must stay green.
// ---------------------------------------------------------------------------

const TOUCH_CELLS = [
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 640, height: 1000 },
  { width: 672, height: 850 },
  { width: 750, height: 832 },
  { width: 750, height: 1000 },
  { width: 832, height: 750 },
  { width: 900, height: 1000 },
];
const DESKTOP_CELLS = [
  { width: 1024, height: 800 },
  { width: 1200, height: 800 },
];

test.describe("AC-1 — zero page-level horizontal overflow (production-shaped board)", () => {
  test.describe("touch/mobile-emulated cells (<1024)", () => {
    test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });
    for (const { width, height } of TOUCH_CELLS) {
      test(`${width}x${height}: scrollWidth <= clientWidth`, async ({ page }) => {
        await loadProdBoard(page, width, height);
        const m = await pageMetrics(page);
        expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
      });
    }
  });

  test.describe("desktop cells (>=1024)", () => {
    for (const { width, height } of DESKTOP_CELLS) {
      test(`${width}x${height}: scrollWidth <= clientWidth`, async ({ page }) => {
        await loadProdBoard(page, width, height);
        const m = await pageMetrics(page);
        expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-2 — real interaction: the page cannot be panned (UI-gate leg 3).
// RED on 0b275b0 at 390 (offsetLeft 198) and 412 (176); 750x1000 is a green
// control. The REAL assertion is visualViewport.offsetLeft/pageLeft === 0
// (named-risk note nr-akfold-portrait-interaction-assert-unit — NOT a
// scrollLeft delta, a dead control for this class).
// ---------------------------------------------------------------------------

test.describe("AC-2 — real interaction: the page cannot be panned", () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });
  const CELLS = [
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 750, height: 1000 },
  ];
  for (const { width, height } of CELLS) {
    test(`${width}x${height}: real touch drag over the lanes panel leaves visualViewport at 0`, async ({
      page,
    }) => {
      await loadProdBoard(page, width, height);
      const lanesBox = await boxOf(page, ".ak-lanes");
      await touchDragHorizontalAt(page, {
        xStart: lanesBox.x + lanesBox.width * 0.85,
        y: lanesBox.y + lanesBox.height / 2,
        dx: -Math.round(width * 0.6), // |dx| >= 50% of the viewport width
        steps: 15,
      });
      await page.waitForTimeout(300);
      const vv = await visualViewportOffsets(page);
      expect(vv.offsetLeft).toBe(0);
      expect(vv.pageLeft).toBe(0);

      const pillBox = await boxOf(page, ".ak-lanecount");
      expect(pillBox.left).toBeGreaterThanOrEqual(0);
      expect(pillBox.right).toBeLessThanOrEqual(width);
    });

    test(`${width}x${height}: a real horizontal wheel over the lanes panel leaves visualViewport at 0`, async ({
      page,
    }) => {
      await loadProdBoard(page, width, height);
      const lanesBox = await boxOf(page, ".ak-lanes");
      await page.mouse.move(lanesBox.x + lanesBox.width / 2, lanesBox.y + lanesBox.height / 2);
      await page.mouse.wheel(Math.round(width * 0.6), 0);
      await page.waitForTimeout(300);
      const vv = await visualViewportOffsets(page);
      expect(vv.offsetLeft).toBe(0);
      expect(vv.pageLeft).toBe(0);

      const pillBox = await boxOf(page, ".ak-lanecount");
      expect(pillBox.left).toBeGreaterThanOrEqual(0);
      expect(pillBox.right).toBeLessThanOrEqual(width);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-3 — root-level containment, independent of the id fix. A test-injected
// 600px non-shrinkable element (a stand-in for any FUTURE overflow source)
// still cannot pan the page. RED on 0b275b0 at 390 (the body-only clamp
// pans); 750x1000 is a green control. Vertical reachability at 390x844
// stays green.
// ---------------------------------------------------------------------------

test.describe("AC-3 — root-level containment, independent of the id fix", () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });
  const CELLS = [
    { width: 390, height: 844 },
    { width: 750, height: 1000 },
  ];
  for (const { width, height } of CELLS) {
    test(`${width}x${height}: a test-injected 600px-wide non-shrinkable element still cannot pan the page`, async ({
      page,
    }) => {
      await loadProdBoard(page, width, height);
      await page.evaluate(() => {
        const el = document.createElement("div");
        el.setAttribute("data-test-overflow-stub", "1");
        el.style.width = "600px";
        el.style.minWidth = "600px";
        el.style.flexShrink = "0";
        el.style.height = "20px";
        el.style.whiteSpace = "nowrap";
        el.textContent = "test-injected-future-overflow-stand-in";
        document.querySelector(".ak-lanes")?.appendChild(el);
      });
      const lanesBox = await boxOf(page, ".ak-lanes");
      await touchDragHorizontalAt(page, {
        xStart: lanesBox.x + lanesBox.width * 0.85,
        y: lanesBox.y + lanesBox.height / 2,
        dx: -Math.round(width * 0.6),
        steps: 15,
      });
      await page.waitForTimeout(300);
      const vv = await visualViewportOffsets(page);
      expect(vv.offsetLeft).toBe(0);
      expect(vv.pageLeft).toBe(0);
    });
  }

  test("390x844: vertical reachability stays green (a below-fold card is still reached by a real swipe)", async ({
    page,
  }) => {
    await loadProdBoard(page, 390, 844, 20);
    const targetId = await page.evaluate(() => {
      const col = document.querySelectorAll(".ak-col")[0];
      if (!col) return null;
      const buttons = Array.from(col.querySelectorAll(".ak-cardbtn"));
      for (const btn of buttons) {
        const r = btn.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const fully = r.top >= -1 && r.left >= -1 && r.bottom <= 844 + 1 && r.right <= 390 + 1;
        if (!fully) {
          const label = btn.getAttribute("aria-label") || "";
          const m = label.match(/Open ticket #(\S+):/);
          return m ? m[1] : null;
        }
      }
      return null;
    });
    expect(targetId, "fixture must have produced an off-screen card to reach").toBeTruthy();
    const selector = `[aria-label^="Open ticket #${targetId}:"]`;
    const beforeOffsets = await ancestorScrollOffsets(page, selector);

    // Real vertical touch drag (swipe up), anchored to the VIEWPORT (not the
    // column's own boundingBox, which can be far taller than 844px with 21
    // cards in the todo column — a start point derived from the box's full
    // height would land off-screen and CDP would dispatch an invalid touch).
    // A plain inline CDP drag (not the shared touchDragAt helper) so this
    // AC-3 check stays self-contained without a second touch.ts import.
    const colBox = await page.locator(".ak-col").first().boundingBox();
    expect(colBox).not.toBeNull();
    const client = await page.context().newCDPSession(page);
    try {
      for (let i = 0; i < 15; i++) {
        const x = colBox!.x + colBox!.width / 2;
        const y0 = Math.min(Math.max(colBox!.y + 100, 60), 844 - 20);
        const dy = -Math.round(844 * 0.5);
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
        for (let s = 1; s <= 12; s++) {
          await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y: y0 + (dy * s) / 12 }],
          });
          await page.waitForTimeout(16);
        }
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(150);
        const box = await boxOf(page, selector);
        if (fullyInViewport(box, 390, 844)) break;
      }
    } finally {
      await client.detach().catch(() => {});
    }
    const afterOffsets = await ancestorScrollOffsets(page, selector);
    const after = await boxOf(page, selector);
    expect(anyOffsetIncreased(beforeOffsets, afterOffsets) || fullyInViewport(after, 390, 844)).toBe(
      true,
    );
    expect(fullyInViewport(after, 390, 844)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — lane id stays inside its row, never overlaps the track.
// RED on 0b275b0 at 390/412 (id right 539 vs row right 369) and at
// 672x850/750x832/750x1000/832x750/900x1000/1024x800/1200x800 (id drawn
// under the track); 640x1000 is a green control (stacked tier).
// ---------------------------------------------------------------------------

test.describe("AC-4 — lane id stays inside its row and never overlaps the track", () => {
  test.describe("touch/mobile-emulated cells (<1024)", () => {
    test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });
    for (const { width, height } of TOUCH_CELLS) {
      test(`${width}x${height}: id.right <= row.right+1, id never intersects track`, async ({
        page,
      }) => {
        await loadProdBoard(page, width, height);
        const lanes = await laneGeometry(page);
        expect(lanes.length).toBeGreaterThanOrEqual(LIVE_LANES);
        for (const lane of lanes) {
          expect(lane.id, "every lane row must render .ak-lane-id").not.toBeNull();
          expect(lane.id!.right).toBeLessThanOrEqual(lane.rowRight + 1);
          if (lane.track) {
            expect(intersects(lane.id!, lane.track)).toBe(false);
          }
        }
      });
    }
  });

  test.describe("desktop cells (>=1024)", () => {
    for (const { width, height } of DESKTOP_CELLS) {
      test(`${width}x${height}: id.right <= row.right+1, id never intersects track`, async ({
        page,
      }) => {
        await loadProdBoard(page, width, height);
        const lanes = await laneGeometry(page);
        expect(lanes.length).toBeGreaterThanOrEqual(LIVE_LANES);
        for (const lane of lanes) {
          expect(lane.id).not.toBeNull();
          expect(lane.id!.right).toBeLessThanOrEqual(lane.rowRight + 1);
          if (lane.track) {
            expect(intersects(lane.id!, lane.track)).toBe(false);
          }
        }
      });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5 — tier selection unchanged, with the production-shaped board.
// Control: green today, must stay green.
// ---------------------------------------------------------------------------

test.describe("AC-5 — tier selection unchanged with the production-shaped board", () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });

  test("390x844: phone strip — flex board, exactly 1 fully visible column, lanes stacked, meter visible", async ({
    page,
  }) => {
    await loadProdBoard(page, 390, 844);
    const display = await page.locator(".ak-board").evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("flex");
    const boxes = await colBoxes(page);
    expect(fullyVisibleIndices(boxes, 390).length).toBe(1);
    const headDirection = await page
      .locator(".ak-lane-row")
      .first()
      .evaluate((el) => getComputedStyle(el).flexDirection);
    expect(headDirection).toBe("column");
    await expect(page.locator(".ak-meter")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENS, "390x844-phone.png"), fullPage: false });
  });

  test("750x1000: portrait 2-up paged tier — 2 fully-visible columns, horizontal overflow present", async ({
    page,
  }) => {
    await loadProdBoard(page, 750, 1000);
    const m = await page.locator(".ak-board").evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(m.scrollWidth).toBeGreaterThan(m.clientWidth + 4);
    const boxes = await colBoxes(page);
    const visible = fullyVisibleIndices(boxes, 750).sort((a, b) => a - b);
    expect(visible).toEqual([0, 1]);
    await page.screenshot({ path: path.join(SCREENS, "750x1000-portrait-page-a.png"), fullPage: false });
  });

  test("1200x800: desktop 4-up grid — grid board, 4 columns fully visible, dots hidden", async ({
    page,
  }) => {
    await loadProdBoard(page, 1200, 800);
    const display = await page.locator(".ak-board").evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("grid");
    const boxes = await colBoxes(page);
    expect(fullyVisibleIndices(boxes, 1200).length).toBe(4);
    const dotsDisplay = await page.locator(".ak-dots").evaluate((el) => getComputedStyle(el).display);
    expect(dotsDisplay).toBe("none");
    await page.screenshot({ path: path.join(SCREENS, "1200x800-desktop.png"), fullPage: false });
  });
});
