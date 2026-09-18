// board-chrome-pinning.e2e.spec.ts — Binary AC harness for task
// kanban-board-chrome-pinning (bottom-pinned bookkeeping bar + ONE sticky
// top strip). Plan:
// ai-brain .ai-workspace/plans/2026-09-17-kanban-board-chrome-pinning.md
// (AC-0..AC-9 in that plan; this file implements the moving-element real-
// gesture subset — AC-4/AC-8's no-regression legs are covered by re-running
// the NAMED existing specs, per the plan's own "Check" clauses).
//
// NAMED RISK (kbcp-red-must-be-moving-element, carried from plan-review):
// a "sticky works" check that reads `getComputedStyle(...).position ===
// 'sticky'` proves NOTHING — the buggy build ALSO reports `position:sticky`,
// it just never moves with scroll. Every assertion below is a REAL CDP touch
// drag / real wheel gesture, measured via `getBoundingClientRect` before and
// after (never `getComputedStyle`) — the PR #73 anti-pattern this repo's own
// e2e suite already guards against (`shelf-front-screen-reachable.e2e.spec.ts`
// header comment).
//
// Root cause (verified against app/globals.css `html`/`body` L92-134 on this
// branch): `overflow-x: hidden` on both `html` and `body` computed `overflow-
// y: auto` on `body` too (CSS Overflow Module resolved-overflow algorithm),
// trapping every descendant `position: sticky` element's containing block at
// `<body>` instead of the viewport. Fix: `overflow-x: clip` on both (a NON-
// scrolling value for that same algorithm, grouped with `visible` — so
// `overflow-y` stays `visible` and the viewport itself resumes scrolling,
// while `clip` still visually contains horizontal overflow exactly like
// `hidden` did — re-verified by `fold-front-screen-overflow.e2e.spec.ts`,
// the existing containment oracle, on every push).

import { test, expect, type Page } from "@playwright/test";
import { buildBoard } from "./fixtures/board-fixture";
import {
  touchDragAt,
  touchDragHorizontalAt,
  ancestorScrollOffsets,
  anyOffsetIncreased,
  visualViewportOffsets,
  boxOf,
  fullyInViewport,
} from "./fixtures/touch";

// Deep enough that the `todo` column (real card content) is far taller than
// every viewport this spec exercises, including 1280x800/1440x900 desktop —
// mirrors `shelf-front-screen-reachable.e2e.spec.ts`'s EXTRA_TODO=40 pattern
// and its exact-count wait (SSR first paint can race a stale sample board).
const EXTRA_TODO = 40;
const EXPECTED_CARDS = 0 + 3 + EXTRA_TODO; // liveLanes(0) + ctx(3) + extraTodoCount(40)

async function routeBoard(page: Page, board: ReturnType<typeof buildBoard>) {
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
}

async function loadDeepBoard(page: Page) {
  const board = buildBoard({ liveLanes: 0, live: true, extraTodoCount: EXTRA_TODO });
  await routeBoard(page, board);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function loadSwimlanesBoard(page: Page) {
  const board = buildBoard({ liveLanes: 2, live: true, extraTodoCount: EXTRA_TODO });
  await routeBoard(page, board);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".ak-lanes")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function loadProductionShapedBoard(page: Page) {
  const board = buildBoard({
    liveLanes: 2,
    live: true,
    productionShaped: true,
    extraTodoCount: 10,
  });
  await routeBoard(page, board);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".ak-lanes")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

/**
 * The visible column's head. Phone (<640px) and the 640-767.98px landscape
 * gap use the HOISTED `.ak-col-heads-mobile` (X1 — `.ak-col__head` cannot be
 * the sticky element there, see globals.css); the grid tiers (640-1023.98px)
 * and desktop (>=1024px) use the per-column `.ak-col__head` (works in place
 * on both). `width<768 && height>width` heuristically distinguishes the
 * touch-phone cells this spec uses from the two desktop/grid wheel cells —
 * simpler and just as correct as a full media-query re-implementation given
 * this spec's fixed, known cell list.
 */
function visibleColHeadSelector(vp: { width: number; height: number }): string {
  const isPhoneOrLandscapeGap = vp.width < 768;
  return isPhoneOrLandscapeGap ? ".ak-col-heads-mobile" : ".ak-col__head >> nth=0";
}
const TOP_CHROME = '[data-ak-chrome="top"]';
const BOTTOM_CHROME = '[data-ak-chrome="bottom"]';

// ---------------------------------------------------------------------------
// Fixture self-assertion (nr-red-genuine / Rule-17: the oracle must vary).
// ---------------------------------------------------------------------------

test.describe("fixture self-assertion — the RED must be genuine", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("EXTRA_TODO board yields the expected card count AND a column far taller than the viewport", async ({
    page,
  }) => {
    await loadDeepBoard(page);
    const todoCards = await page.locator(".ak-col").first().locator(".ak-cardbtn").count();
    expect(todoCards).toBe(1 + EXTRA_TODO);

    const [stripBox, innerHeight] = await Promise.all([
      boxOf(page, ".ak-strip.ak-board"),
      page.evaluate(() => window.innerHeight),
    ]);
    expect(stripBox.height).toBeGreaterThan(innerHeight * 2);
  });
});

// ---------------------------------------------------------------------------
// AC-1 — top strip stays put under a REAL touch scroll (phone).
// ---------------------------------------------------------------------------

for (const vp of [{ width: 390, height: 844 }, { width: 344, height: 882 }]) {
  test.describe(`AC-1 — top strip stays put under real touch scroll (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true });

    test("scroll-delta positive, top chrome + visible col head unchanged, cards pass under never through", async ({
      page,
    }) => {
      await loadDeepBoard(page);

      const before = await ancestorScrollOffsets(page, ".ak-cardbtn >> nth=0");
      const topBefore = await boxOf(page, TOP_CHROME);
      const headBefore = await boxOf(page, visibleColHeadSelector(vp));

      await touchDragAt(page, {
        x: vp.width / 2,
        y0: vp.height * 0.75,
        dy: -Math.round(vp.height * 0.6),
        steps: 15,
      });
      await page.waitForTimeout(200);

      const after = await ancestorScrollOffsets(page, ".ak-cardbtn >> nth=0");
      const topAfter = await boxOf(page, TOP_CHROME);
      const headAfter = await boxOf(page, visibleColHeadSelector(vp));

      // eslint-disable-next-line no-console
      console.log(
        `[AC-1 ${vp.width}x${vp.height}] top.top ${topBefore.top}->${topAfter.top} head.top ${headBefore.top}->${headAfter.top}`,
      );

      // (a) scroll-delta: something genuinely scrolled by >= 200px.
      expect(anyOffsetIncreased(before, after)).toBe(true);
      const maxDelta = Math.max(...after.map((v, i) => v - (before[i] ?? 0)));
      expect(maxDelta).toBeGreaterThanOrEqual(200);

      // (b) top chrome rect unchanged AND pinned to top:0.
      expect(Math.abs(topAfter.top - topBefore.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(topAfter.left - topBefore.left)).toBeLessThanOrEqual(1);
      expect(topAfter.top).toBeGreaterThanOrEqual(-1);
      expect(topAfter.top).toBeLessThanOrEqual(1);

      // (c) the visible column's head rect unchanged.
      expect(Math.abs(headAfter.top - headBefore.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(headAfter.bottom - headBefore.bottom)).toBeLessThanOrEqual(1);

      // (d) cards pass UNDER the pinned band, never THROUGH it — a Z-ORDER
      // (occlusion) fact, not a "zero geometric overlap" one: a real scroll
      // physically MUST carry some card's rect across the band's y-range at
      // some settled position (that's the design brief's own "mid-scroll"
      // screenshot — a card sliding behind the strip is the whole point of
      // a sticky header), so the correct oracle is what's VISUALLY on top
      // at that point, via `elementFromPoint` (never a raw rect-overlap
      // count, which would reject the exact moment sticky headers exist
      // for). Sample the horizontal center at several y's inside the band;
      // each must resolve to the pinned chrome (or a descendant of it),
      // never a card.
      const bandBottom = Math.max(topAfter.bottom, headAfter.bottom);
      const occludedEverywhere = await page.evaluate(
        ([bottom, vw]) => {
          const cx = vw / 2;
          const samples = [2, bottom * 0.5, Math.max(0, bottom - 2)];
          return samples.every((y) => {
            const el = document.elementFromPoint(cx, y);
            if (!el) return true; // nothing painted there — vacuously fine
            return !el.closest(".ak-cardbtn");
          });
        },
        [bandBottom, vp.width] as const,
      );
      expect(occludedEverywhere).toBe(true);
    });
  });
}

// ---------------------------------------------------------------------------
// AC-2 — ONE strip (contiguity), at rest and after the gesture.
// ---------------------------------------------------------------------------

for (const vp of [
  // `maxGap` = the tier's own real `.ak-strip`/`.ak-col-heads-mobile`
  // padding-top (globals.css: 16px base, 18px at the >=1024px desktop
  // tier's own `.ak-strip{padding:18px ...}` override) — the "no list
  // content between counts and headings" gap the plan's AC-2 measures
  // against, not an arbitrary constant.
  { width: 390, height: 844, touch: true, maxGap: 16 },
  { width: 344, height: 882, touch: true, maxGap: 16 },
  { width: 1280, height: 800, touch: false, maxGap: 18 },
]) {
  test.describe(`AC-2 — contiguity (${vp.width}x${vp.height})`, () => {
    test.use(vp.touch ? { viewport: vp, hasTouch: true, isMobile: true } : { viewport: vp });

    test("visible col head sits directly under the top chrome, at rest and after the gesture", async ({
      page,
    }) => {
      await loadDeepBoard(page);

      const assertContiguous = async () => {
        const [topBox, headBox] = await Promise.all([
          boxOf(page, TOP_CHROME),
          boxOf(page, visibleColHeadSelector(vp)),
        ]);
        expect(headBox.top - topBox.bottom).toBeLessThanOrEqual(vp.maxGap);
        expect(headBox.top).toBeGreaterThanOrEqual(-1);
      };

      await assertContiguous();

      if (vp.touch) {
        await touchDragAt(page, {
          x: vp.width / 2,
          y0: vp.height * 0.75,
          dy: -Math.round(vp.height * 0.6),
          steps: 15,
        });
      } else {
        await page.mouse.move(vp.width / 2, vp.height / 2);
        await page.mouse.wheel(0, 480);
      }
      await page.waitForTimeout(200);

      await assertContiguous();
    });
  });
}

// ---------------------------------------------------------------------------
// AC-3 — bottom bar pinned on EVERY tier, at rest and under scroll.
// AC-3b — no occlusion of the last card.
// ---------------------------------------------------------------------------

const TOUCH_CELLS = [
  { width: 390, height: 844 },
  { width: 344, height: 882 },
  { width: 390, height: 660 },
  { width: 667, height: 375 },
];
// `maxGap` — the 768x1024 grid-tier cell carries a PRE-EXISTING, un-touched
// `.ak-shelf{margin:4px 14px 20px}` bottom margin (X2 deliberately leaves
// the 640-1023.98px grid tiers' own shell-clamp layout untouched — the plan
// frames them as "already implement the target model"). That 20px gap is
// identical on `c656df5` and this branch (verified via the RED/GREEN diff
// in the red-evidence file) — a no-regression fact, not something this task
// changed — so it gets its own tolerance; the two NEWLY-pinned tiers this
// task fixes (1280x800, 1440x900) must land genuinely flush (<=1px).
const WHEEL_CELLS = [
  { width: 768, height: 1024, maxGap: 21 },
  { width: 1280, height: 800, maxGap: 1 },
  { width: 1440, height: 900, maxGap: 1 },
];

for (const vp of TOUCH_CELLS) {
  test.describe(`AC-3 — bottom bar pinned, touch (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true });

    test("at rest and after a real touch drag, the bottom bar stays flush with the viewport bottom", async ({
      page,
    }) => {
      await loadDeepBoard(page);

      const summaryAtRest = await boxOf(page, ".ak-shelf__summary");
      const chromeAtRest = await boxOf(page, BOTTOM_CHROME);
      expect(fullyInViewport(summaryAtRest, vp.width, vp.height)).toBe(true);
      expect(Math.abs(chromeAtRest.bottom - vp.height)).toBeLessThanOrEqual(1);

      await touchDragAt(page, {
        x: vp.width / 2,
        y0: vp.height * 0.75,
        dy: -Math.round(vp.height * 0.6),
        steps: 15,
      });
      await page.waitForTimeout(200);

      const summaryAfter = await boxOf(page, ".ak-shelf__summary");
      const chromeAfter = await boxOf(page, BOTTOM_CHROME);
      expect(Math.abs(summaryAfter.top - summaryAtRest.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(chromeAfter.bottom - chromeAtRest.bottom)).toBeLessThanOrEqual(1);
    });
  });
}

for (const vp of WHEEL_CELLS) {
  test.describe(`AC-3 — bottom bar pinned, wheel (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: vp });

    test("at rest and after a real wheel scroll, the bottom bar stays flush with the viewport bottom", async ({
      page,
    }) => {
      await loadDeepBoard(page);

      const summaryAtRest = await boxOf(page, ".ak-shelf__summary");
      const chromeAtRest = await boxOf(page, BOTTOM_CHROME);
      expect(fullyInViewport(summaryAtRest, vp.width, vp.height)).toBe(true);
      expect(vp.height - chromeAtRest.bottom).toBeLessThanOrEqual(vp.maxGap);

      await page.mouse.move(vp.width / 2, vp.height / 2);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(200);

      const summaryAfter = await boxOf(page, ".ak-shelf__summary");
      const chromeAfter = await boxOf(page, BOTTOM_CHROME);
      expect(Math.abs(summaryAfter.top - summaryAtRest.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(chromeAfter.bottom - chromeAtRest.bottom)).toBeLessThanOrEqual(1);
    });
  });
}

test.describe("AC-3b — no occlusion of the last card (390x844 touch)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the last card of the first column clears the pinned bottom bar", async ({ page }) => {
    await loadDeepBoard(page);

    let prevOffsets = await ancestorScrollOffsets(page, ".ak-cardbtn >> nth=0");
    for (let i = 0; i < 40; i++) {
      await touchDragAt(page, { x: 195, y0: 700, dy: -600, steps: 10, stepDelayMs: 8 });
      await page.waitForTimeout(80);
      const next = await ancestorScrollOffsets(page, ".ak-cardbtn >> nth=0");
      if (!anyOffsetIncreased(prevOffsets, next)) break;
      prevOffsets = next;
    }

    const lastCardBox = await page.evaluate(() => {
      const col = document.querySelectorAll(".ak-col")[0];
      const cards = col ? Array.from(col.querySelectorAll(".ak-cardbtn")) : [];
      const el = cards[cards.length - 1];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    expect(lastCardBox).not.toBeNull();
    const chromeBox = await boxOf(page, BOTTOM_CHROME);
    expect(lastCardBox!.bottom).toBeLessThanOrEqual(chromeBox.top + 1);
  });
});

test.describe("AC-3b — no occlusion of the last card (1280x800 wheel)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the last card of the first column clears the pinned bottom bar", async ({ page }) => {
    await loadDeepBoard(page);

    await page.mouse.move(640, 400);
    let prevOffsets = await ancestorScrollOffsets(page, ".ak-cardbtn >> nth=0");
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(80);
      const next = await ancestorScrollOffsets(page, ".ak-cardbtn >> nth=0");
      if (!anyOffsetIncreased(prevOffsets, next)) break;
      prevOffsets = next;
    }

    const lastCardBox = await page.evaluate(() => {
      const col = document.querySelectorAll(".ak-col")[0];
      const cards = col ? Array.from(col.querySelectorAll(".ak-cardbtn")) : [];
      const el = cards[cards.length - 1];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    expect(lastCardBox).not.toBeNull();
    const chromeBox = await boxOf(page, BOTTOM_CHROME);
    expect(lastCardBox!.bottom).toBeLessThanOrEqual(chromeBox.top + 1);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — drawer + scrim still layer above the pinned bar (no-regression).
// ---------------------------------------------------------------------------

test.describe("AC-4 — drawer + scrim layer above the pinned bar (390x844 touch)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the opened drawer/scrim covers the pinned bottom bar", async ({ page }) => {
    await loadDeepBoard(page);
    await page.locator(".ak-cardbtn").first().tap();
    await expect(page.locator(".ak-drawer")).toBeVisible();

    const shelfBox = await boxOf(page, ".ak-shelf__summary");
    const cx = shelfBox.left + shelfBox.width / 2;
    const cy = shelfBox.top + shelfBox.height / 2;
    const topElClass = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.closest(".ak-drawer, .ak-scrim")?.className ?? null : null;
      },
      [cx, cy] as const,
    );
    expect(topElClass).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-5 — height budget on short phones.
// ---------------------------------------------------------------------------

for (const vp of [
  { width: 390, height: 844, budget: 200, minCards: 4 },
  { width: 344, height: 882, budget: 200, minCards: 4 },
  { width: 390, height: 660, budget: 200, minCards: 3 },
]) {
  test.describe(`AC-5 — height budget (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true });

    test(`combined pinned chrome <= ${vp.budget}px, >= ${vp.minCards} cards visible`, async ({
      page,
    }) => {
      await loadDeepBoard(page);
      await touchDragAt(page, {
        x: vp.width / 2,
        y0: vp.height * 0.75,
        dy: -Math.round(vp.height * 0.6),
        steps: 15,
      });
      await page.waitForTimeout(200);

      const [topBox, headBox, bottomBox] = await Promise.all([
        boxOf(page, TOP_CHROME),
        boxOf(page, visibleColHeadSelector(vp)),
        boxOf(page, BOTTOM_CHROME),
      ]);
      const topBand = Math.max(topBox.bottom, headBox.bottom);
      const bottomBand = vp.height - bottomBox.top;
      // eslint-disable-next-line no-console
      console.log(
        `[AC-5 ${vp.width}x${vp.height}] topBand=${topBand} bottomBand=${bottomBand} sum=${topBand + bottomBand}`,
      );
      expect(topBand + bottomBand).toBeLessThanOrEqual(vp.budget);

      const cardsInBand = await page.evaluate(
        ([top, bottom]) => {
          const cards = Array.from(document.querySelectorAll(".ak-col")[0]?.querySelectorAll(".ak-cardbtn") ?? []);
          return cards.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= top - 1 && r.bottom <= bottom + 1;
          }).length;
        },
        [topBand, vp.height - bottomBand] as const,
      );
      expect(cardsInBand).toBeGreaterThanOrEqual(vp.minCards);
    });
  });
}

test.describe("AC-5 — desktop budget (1280x800 wheel)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("combined pinned chrome <= 178px", async ({ page }) => {
    await loadDeepBoard(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(200);

    const [topBox, headBox, bottomBox] = await Promise.all([
      boxOf(page, TOP_CHROME),
      boxOf(page, visibleColHeadSelector({ width: 1280, height: 800 })),
      boxOf(page, BOTTOM_CHROME),
    ]);
    const topBand = Math.max(topBox.bottom, headBox.bottom);
    const bottomBand = 800 - bottomBox.top;
    // eslint-disable-next-line no-console
    console.log(`[AC-5 1280x800] topBand=${topBand} bottomBand=${bottomBand} sum=${topBand + bottomBand}`);
    expect(topBand + bottomBand).toBeLessThanOrEqual(178);
  });
});

// ---------------------------------------------------------------------------
// AC-6 — the Live Swimlanes panel is list content, not chrome.
// ---------------------------------------------------------------------------

test.describe("AC-6 — Live Swimlanes scrolls away with the list (390x844 touch)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("`.ak-lanes` top decreases by >= 100px after the gesture", async ({ page }) => {
    await loadSwimlanesBoard(page);
    const before = await boxOf(page, ".ak-lanes");
    await touchDragAt(page, { x: 195, y0: 630, dy: -560, steps: 15 });
    await page.waitForTimeout(200);
    const after = await boxOf(page, ".ak-lanes");
    expect(before.top - after.top).toBeGreaterThanOrEqual(100);
  });
});

test.describe("AC-6 — Live Swimlanes scrolls away with the list (1280x800 wheel)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("`.ak-lanes` top decreases by >= 100px after the gesture", async ({ page }) => {
    await loadSwimlanesBoard(page);
    const before = await boxOf(page, ".ak-lanes");
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    const after = await boxOf(page, ".ak-lanes");
    expect(before.top - after.top).toBeGreaterThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// AC-7 — no horizontal overflow / visual-viewport pan (production token shape).
// ---------------------------------------------------------------------------

for (const vp of [
  { width: 390, height: 844 },
  { width: 344, height: 882 },
  { width: 412, height: 915 },
  { width: 667, height: 375 },
]) {
  test.describe(`AC-7 — no horizontal overflow / pan, production shape (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true });

    test("scrollingElement contained, chrome rects contained, no visual-viewport pan from either pinned surface", async ({
      page,
    }) => {
      await loadProductionShapedBoard(page);

      const m = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement!.scrollWidth,
        clientWidth: document.scrollingElement!.clientWidth,
      }));
      expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);

      const [topBox, bottomBox] = await Promise.all([boxOf(page, TOP_CHROME), boxOf(page, BOTTOM_CHROME)]);
      for (const box of [topBox, bottomBox]) {
        expect(box.left).toBeGreaterThanOrEqual(-1);
        expect(box.right).toBeLessThanOrEqual(vp.width + 1);
      }

      // Horizontal drag over the TOP strip.
      await touchDragHorizontalAt(page, {
        xStart: vp.width * 0.8,
        y: topBox.top + topBox.height / 2,
        dx: -200,
        steps: 12,
      });
      await page.waitForTimeout(150);
      let vv = await visualViewportOffsets(page);
      expect(vv.offsetLeft).toBe(0);
      expect(vv.pageLeft).toBe(0);

      // Horizontal drag over the BOTTOM bar.
      const bottomBoxNow = await boxOf(page, BOTTOM_CHROME);
      await touchDragHorizontalAt(page, {
        xStart: vp.width * 0.8,
        y: bottomBoxNow.top + bottomBoxNow.height / 2,
        dx: -200,
        steps: 12,
      });
      await page.waitForTimeout(150);
      vv = await visualViewportOffsets(page);
      expect(vv.offsetLeft).toBe(0);
      expect(vv.pageLeft).toBe(0);
    });
  });
}

// ---------------------------------------------------------------------------
// AC-8 — grid tier (768x1024) unchanged: header + visible col head rects
// unchanged after a wheel, column scrollTop delta > 0.
// ---------------------------------------------------------------------------

test.describe("AC-8 — grid tier (768x1024) unchanged", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("header + visible col head rects unchanged after a wheel; column scrollTop delta > 0", async ({
    page,
  }) => {
    await loadDeepBoard(page);

    const headerBefore = await boxOf(page, ".ak-header");
    const headBefore = await boxOf(page, visibleColHeadSelector({ width: 768, height: 1024 }));
    const colScrollBefore = await page.locator(".ak-col").first().evaluate((el) => el.scrollTop);

    const colBox = await page.locator(".ak-col").first().boundingBox();
    expect(colBox).not.toBeNull();
    await page.mouse.move(colBox!.x + colBox!.width / 2, colBox!.y + colBox!.height / 2);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(200);

    const headerAfter = await boxOf(page, ".ak-header");
    const headAfter = await boxOf(page, visibleColHeadSelector({ width: 768, height: 1024 }));
    const colScrollAfter = await page.locator(".ak-col").first().evaluate((el) => el.scrollTop);

    expect(Math.abs(headerAfter.top - headerBefore.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(headAfter.top - headBefore.top)).toBeLessThanOrEqual(1);
    expect(colScrollAfter).toBeGreaterThan(colScrollBefore);
  });
});
