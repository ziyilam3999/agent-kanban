// fold8-4x3-grid-tiers.e2e.spec.ts — Playwright DOM/computed-style acceptance
// checks for the Samsung Fold 8 (4:3 unfolded) responsive-board task.
// Plan: .ai-workspace/plans/2026-08-25-fold8-4x3-responsive.md (AC-0..AC-9).
// Brief: docs/fold8-4x3-design-brief.md / docs/fold8-4x3-fable-critique.md.
//
// Vehicle: the BUILT app (`npm run build && npm start`) driven by Playwright/
// Chromium at the plan's 4 contract viewports (1000x750, 750x1000, 390x844,
// 1440x900), with a synthetic board fed via /api/board route interception
// (the established e2e pattern in this repo — see live-swimlanes.e2e.spec.ts /
// drawer-long-subject.e2e.spec.ts) giving the TODO column 21 cards (>=20 per
// the plan's vehicle requirement: 1 ctx todo + 20 extraTodoCount) and 2 live
// in_progress lanes so `.ak-lanes` mounts for the AC-7 scroll-margin check.
// Every probe is a computed style / rendered-DOM-geometry / screenshot check —
// never "the code says X" (Rule: outside-the-diff verification only).

import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { buildBoard } from "./fixtures/board-fixture";

const SCREENS = path.join(
  __dirname,
  "..",
  ".ai-workspace",
  "design",
  "screens-fold8-4x3",
);

// liveLanes(2) + ctx(3: todo/in_review/done) + extraTodoCount(20) = 25 cards;
// ctx contributes 1 more `todo` card, so TODO column total = 1 + 20 = 21 (>= 20).
const LIVE_LANES = 2;
const EXTRA_TODO = 20;
const EXPECTED_CARDS = LIVE_LANES + 3 + EXTRA_TODO;

/**
 * Intercept /api/board with a fixed synthetic board, load the board, and
 * trigger an immediate client poll (visibilitychange) so the page renders OUR
 * payload without waiting out the 5s interval. Mirrors the established
 * loadBoardState() pattern in live-swimlanes.e2e.spec.ts.
 */
async function loadFold8Board(page: Page) {
  const board = buildBoard({
    liveLanes: LIVE_LANES,
    live: true,
    extraTodoCount: EXTRA_TODO,
  });
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS, {
    timeout: 15_000,
  });
  // Every card in this fixture is "fresh" relative to the SSR sample board's
  // prevCols baseline, so all 25 play the arrival fade-in (opacity 0->1,
  // y:10->0). Let it settle before any computed-style/screenshot assertion —
  // a screenshot taken mid-fade under-reports a deep column's visible cards.
  await page.waitForTimeout(500);
}

/** getComputedStyle(...).gridTemplateColumns / Rows, split into track counts. */
async function gridTracks(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    const cols = cs.gridTemplateColumns.trim();
    const rows = cs.gridTemplateRows.trim();
    const colCount = cols === "none" || cols === "" ? 0 : cols.split(/\s+/).length;
    const rowCount = rows === "none" || rows === "" ? 0 : rows.split(/\s+/).length;
    return { display: cs.display, cols, rows, colCount, rowCount };
  });
}

test.describe("Fold8 4:3 — AC-0 container-query smoke (tier switches in ONE session)", () => {
  test("CSS.supports(container-type:inline-size)===true AND .ak-board switches 4-up grid <-> 2-up paged flex strip across a live viewport resize", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    await loadFold8Board(page);

    const supports = await page.evaluate(() =>
      CSS.supports("container-type: inline-size"),
    );
    expect(supports).toBe(true);

    const landscape = await gridTracks(page, ".ak-board");
    expect(landscape.display).toBe("grid");
    expect(landscape.colCount).toBe(4);
    expect(landscape.rowCount).toBe(1);

    // Same page, same session — resize live, no reload.
    await page.setViewportSize({ width: 750, height: 1000 });
    // Container-query re-layout is synchronous with the resize, but give one
    // frame for React/Motion effects that may re-run on viewport change.
    await page.waitForTimeout(150);

    // fold8-portrait-2col-paging (P1/P5): portrait is now a 2-up PAGED flex
    // strip (real horizontal overflow + scroll-snap), not a 2x2 CSS grid —
    // `gridTemplateColumns`/`Rows` correctly compute to "none" (colCount/
    // rowCount 0) under `display:flex`. Assert the tier actually switched:
    // display flips to flex AND real horizontal overflow appears.
    const portrait = await gridTracks(page, ".ak-board");
    expect(portrait.display).toBe("flex");
    expect(portrait.colCount).toBe(0);
    expect(portrait.rowCount).toBe(0);
    const portraitOverflow = await page.locator(".ak-board").evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(portraitOverflow.scrollWidth).toBeGreaterThan(portraitOverflow.clientWidth + 4);
  });
});

test.describe("Fold8 4:3 — AC-1 landscape 4-up (1000x750)", () => {
  test("4 column tracks, one row, no horizontal overflow + screenshot", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    await loadFold8Board(page);

    const tracks = await gridTracks(page, ".ak-board");
    expect(tracks.display).toBe("grid");
    expect(tracks.colCount).toBe(4);
    expect(tracks.rowCount).toBe(1);

    const cols = await page.locator(".ak-col").all();
    expect(cols.length).toBe(4);
    for (const col of cols) {
      const box = await col.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1000 + 1);
    }

    const overflow = await page.evaluate(() => {
      const board = document.querySelector(".ak-board")!;
      return {
        boardScrollW: board.scrollWidth,
        boardClientW: board.clientWidth,
        docScrollW: document.documentElement.scrollWidth,
        winInnerW: window.innerWidth,
      };
    });
    expect(overflow.boardScrollW).toBeLessThanOrEqual(overflow.boardClientW);
    expect(overflow.docScrollW).toBeLessThanOrEqual(overflow.winInnerW);

    await page.screenshot({
      path: path.join(SCREENS, "1000x750-landscape-4up.png"),
      fullPage: false,
    });
  });
});

test.describe("Fold8 4:3 — AC-2 portrait 2-up paged (superseded 2x2) + independent column scroll (750x1000)", () => {
  test("2-up flex strip (not a grid), TODO column independently scrollable, page does not scroll + screenshot", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 750, height: 1000 });
    await loadFold8Board(page);

    // fold8-portrait-2col-paging: portrait is a 2-up PAGED flex strip now
    // (real h-overflow + scroll-snap), not a 2x2 CSS grid — see
    // fold8-portrait-2col-paging.e2e.spec.ts's AC-1 for the full
    // geometry/paging/dots contract. This test keeps only the two
    // assertions that were always ITS OWN (not superseded): the tier
    // actually switched off `display:grid`, and TODO's independent scroll.
    const tracks = await gridTracks(page, ".ak-board");
    expect(tracks.display).toBe("flex");
    expect(tracks.colCount).toBe(0);
    expect(tracks.rowCount).toBe(0);

    // TODO is the first `.ak-col` (COLUMNS order: todo, in_progress, in_review, done).
    const todoCol = page.locator(".ak-col").first();
    const metrics = await todoCol.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(["auto", "scroll"]).toContain(metrics.overflowY);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    // Screenshot at REST (scrollTop 0) before the scroll-independence probe
    // below mutates TODO's scrollTop — a clean canonical capture for the
    // ui-evolve vision judge, not a mid-scroll frame.
    await page.screenshot({
      path: path.join(SCREENS, "750x1000-portrait-2up-paged.png"),
      fullPage: false,
    });

    const before = await page.evaluate(() => ({
      other: document.querySelectorAll(".ak-col")[1]?.scrollTop ?? 0,
      win: window.scrollY,
    }));

    await todoCol.evaluate((el) => {
      el.scrollTop = 200;
    });
    await page.waitForTimeout(50);

    const after = await page.evaluate(() => ({
      todo: document.querySelectorAll(".ak-col")[0]?.scrollTop ?? 0,
      other: document.querySelectorAll(".ak-col")[1]?.scrollTop ?? 0,
      win: window.scrollY,
    }));
    expect(after.todo).toBeGreaterThan(0);
    expect(after.other).toBe(before.other);
    expect(after.win).toBe(before.win);

    const docScroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));
    expect(docScroll.scrollHeight).toBeLessThanOrEqual(docScroll.innerHeight + 1);
  });
});

test.describe("Fold8 4:3 — AC-3 collapsed header (both grid tiers)", () => {
  for (const vp of [
    { name: "1000x750", width: 1000, height: 750 },
    { name: "750x1000", width: 750, height: 1000 },
  ]) {
    test(`${vp.name}: header <=48px, full tiles absent, segmented bar present + ordered`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loadFold8Board(page);

      const headerBox = await page.locator(".ak-header").boundingBox();
      expect(headerBox).not.toBeNull();
      expect(headerBox!.height).toBeLessThanOrEqual(48);

      const segCount = await page.locator(".ak-meter__seg").count();
      if (segCount > 0) {
        const boxes = await page.locator(".ak-meter__seg").evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return r.width * r.height;
          }),
        );
        for (const area of boxes) expect(area).toBe(0);
      }

      const meterbars = page.locator(".ak-meterbar");
      await expect(meterbars).toHaveCount(1);
      const meterbarVisible = await meterbars.first().isVisible();
      expect(meterbarVisible).toBe(true);

      const segs = page.locator(".ak-meterbar__seg");
      await expect(segs).toHaveCount(4);

      // Ordering: counts are todo=21, in_progress=2(live lanes), in_review=1,
      // done=1 — todo strictly largest, so its segment must be the widest
      // (never strictly narrower than any other).
      const widths = await segs.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().width),
      );
      const maxOther = Math.max(widths[1], widths[2], widths[3]);
      expect(widths[0]).toBeGreaterThanOrEqual(maxOther);
    });
  }
});

test.describe("Fold8 4:3 — AC-4 phone NON-REGRESSION (390x844)", () => {
  test("flex snap-strip unchanged, dots present, 88vw column, page scrolls, bottom-sheet drawer + screenshot", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadFold8Board(page);

    const boardStyle = await page.locator(".ak-board").evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        display: cs.display,
        overflowX: cs.overflowX,
        scrollSnapType: cs.scrollSnapType,
      };
    });
    expect(boardStyle.display).toBe("flex");
    expect(["auto", "scroll"]).toContain(boardStyle.overflowX);
    expect(boardStyle.scrollSnapType).toContain("x");
    expect(boardStyle.scrollSnapType).toContain("mandatory");

    const dots = page.locator(".ak-dots");
    await expect(dots).toBeVisible();
    const dotsBox = await dots.boundingBox();
    expect(dotsBox).not.toBeNull();
    expect(dotsBox!.height).toBeGreaterThan(0);
    const dotCount = await page.locator(".ak-dots__dot").count();
    expect(dotCount).toBe(4);

    const firstColWidth = await page
      .locator(".ak-col")
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(firstColWidth).toBeGreaterThanOrEqual(343.2 - 2);
    expect(firstColWidth).toBeLessThanOrEqual(343.2 + 2);

    const pageScroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));
    expect(pageScroll.scrollHeight).toBeGreaterThan(pageScroll.innerHeight);

    await page.locator(".ak-cardbtn").first().click();
    await expect(page.locator(".ak-drawer")).toBeVisible();
    await page.waitForTimeout(500);
    const drawerBox = await page.locator(".ak-drawer").boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.y + drawerBox!.height).toBeGreaterThanOrEqual(844 - 2);
    expect(drawerBox!.width).toBeGreaterThanOrEqual(390 * 0.9);

    await page.screenshot({
      path: path.join(SCREENS, "390x844-phone-strip.png"),
      fullPage: false,
    });
  });
});

test.describe("Fold8 4:3 — AC-5 desktop NON-REGRESSION (1440x900)", () => {
  test("4-up grid, dots hidden, side-panel drawer 440px + screenshot", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loadFold8Board(page);

    const tracks = await gridTracks(page, ".ak-board");
    expect(tracks.display).toBe("grid");
    expect(tracks.colCount).toBe(4);

    const dotsDisplay = await page
      .locator(".ak-dots")
      .evaluate((el) => getComputedStyle(el).display);
    expect(dotsDisplay).toBe("none");

    await page.locator(".ak-cardbtn").first().click();
    await expect(page.locator(".ak-drawer")).toBeVisible();
    await page.waitForTimeout(500);
    const drawerBox = await page.locator(".ak-drawer").boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.x + drawerBox!.width).toBeGreaterThanOrEqual(1440 - 2);
    expect(drawerBox!.width).toBeGreaterThanOrEqual(440 - 2);
    expect(drawerBox!.width).toBeLessThanOrEqual(440 + 2);
    expect(drawerBox!.y).toBeLessThanOrEqual(2);
    expect(drawerBox!.y + drawerBox!.height).toBeGreaterThanOrEqual(900 - 2);

    await page.screenshot({
      path: path.join(SCREENS, "1440x900-desktop.png"),
      fullPage: false,
    });
  });
});

test.describe("Fold8 4:3 — AC-6 100dvh shell (both grid tiers, no page scroll)", () => {
  for (const vp of [
    { name: "1000x750", width: 1000, height: 750 },
    { name: "750x1000", width: 750, height: 1000 },
  ]) {
    test(`${vp.name}: .ak-app is a 2-row grid = window.innerHeight, page does not scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loadFold8Board(page);

      const shell = await page.evaluate(() => {
        const app = document.querySelector(".ak-app") as HTMLElement;
        const header = document.querySelector(".ak-header") as HTMLElement;
        const cs = getComputedStyle(app);
        const rows = cs.gridTemplateRows.trim().split(/\s+/);
        return {
          display: cs.display,
          rowCount: rows.length,
          appHeight: app.getBoundingClientRect().height,
          headerHeight: header.getBoundingClientRect().height,
          rowsRaw: cs.gridTemplateRows,
        };
      });
      expect(shell.display).toBe("grid");
      expect(shell.rowCount).toBe(2);
      expect(shell.appHeight).toBeGreaterThanOrEqual(vp.height - 2);
      expect(shell.appHeight).toBeLessThanOrEqual(vp.height + 2);

      const pageScroll = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      expect(pageScroll.scrollHeight).toBeLessThanOrEqual(pageScroll.innerHeight + 1);
    });
  }
});

test.describe("Fold8 4:3 — AC-7 grid-tier drawer + swimlane clearance", () => {
  test("1000x750: side-panel drawer; both grid tiers: .ak-lanes scroll-margin-top >= header height", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    await loadFold8Board(page);

    await page.locator(".ak-cardbtn").first().click();
    await expect(page.locator(".ak-drawer")).toBeVisible();
    await page.waitForTimeout(500);
    const drawerBox = await page.locator(".ak-drawer").boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.x + drawerBox!.width).toBeGreaterThanOrEqual(1000 - 2);
    expect(drawerBox!.width).toBeGreaterThanOrEqual(440 - 2);
    expect(drawerBox!.y).toBeLessThanOrEqual(2);
    expect(drawerBox!.y + drawerBox!.height).toBeGreaterThanOrEqual(750 - 2);

    for (const vp of [
      { width: 1000, height: 750 },
      { width: 750, height: 1000 },
    ]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(100);
      const check = await page.evaluate(() => {
        const lanes = document.querySelector(".ak-lanes") as HTMLElement | null;
        const header = document.querySelector(".ak-header") as HTMLElement;
        if (!lanes) return { hasLanes: false, scrollMarginTop: 0, headerHeight: 0 };
        const smt = parseFloat(getComputedStyle(lanes).scrollMarginTop || "0");
        return {
          hasLanes: true,
          scrollMarginTop: smt,
          headerHeight: header.getBoundingClientRect().height,
        };
      });
      expect(check.hasLanes).toBe(true);
      expect(check.scrollMarginTop).toBeGreaterThanOrEqual(check.headerHeight);
    }
  });
});
