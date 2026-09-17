// shelf-front-screen-reachable.e2e.spec.ts — Binary AC harness for task #2499
// (folding-phone front-screen: bookkeeping shelf unreachable below the
// full-height column). Plan:
// .ai-workspace/plans/2026-09-12-agent-kanban-folding-phone-shelf-unreachable-front-screen.md
// (AC1, AC2, AC3).
//
// AC1 — the collapsed `.ak-shelf__summary` must be reachable WITHIN the
// initial viewport (no page scroll performed) on the folding-phone
// front/cover screen (portrait, width <640px — 344x882). RED on master
// dd59d07 (no shell clamp below 640px — the base phone tier lets the page
// scroll freely, `.ak-strip.ak-board` takes its full natural height, and the
// source-order-LAST `<Shelf>` lands below the entire full-height column, per
// the plan's root-cause section); GREEN on the fix branch (candidate B: a
// phone-tier pinned/sticky collapsed shelf entry, app/globals.css
// `@media (max-width: 639.98px)`). REAL geometry (`boxOf`/`fullyInViewport`)
// — never `getComputedStyle` (the 2026-08-25 PR#73 lesson).
//
// AC2 — no regression to #83's bounded 60dvh opened body: a real touch
// gesture inside the opened `.ak-shelf__body` still produces a positive
// `scrollTop` delta, GREEN on both master and the fix branch (the pinned
// positioning is on the CLOSED `.ak-shelf` container only — it must not
// disturb the already-shipped opened-body scroll mechanics).
//
// AC3 — no regression to the 640-1023.98px grid/paged tiers: the collapsed
// summary stays within the initial viewport at a grid-tier cell (768x1024),
// IDENTICALLY on master and the fix branch (the grid-tier shell clamp,
// globals.css L2000-2027, and the collapsed-header block, L2029-2060, are
// both untouched by this fix — confirmed separately via
// `git diff dd59d07 -- app/globals.css`).
//
// nr-2499-red-genuine: the board must be TALL enough that the RED is
// genuine (summary.top > innerHeight by a real margin, not a coin-flip near
// the fold) — self-asserted below (the fixture self-assertion describe
// block), per Rule-17 ("the oracle must be able to vary": a quietly
// shrunk EXTRA_TODO must fail LOUDLY here, not silently pass AC1).

import { test, expect, type Page } from "@playwright/test";
import { buildBoard } from "./fixtures/board-fixture";
import { touchDragAt, boxOf, fullyInViewport } from "./fixtures/touch";

// Deep enough that the single 88vw `todo` column (real card content, no
// synthetic padding) is taller than every viewport this spec exercises,
// including the tightest cell (344x882) and the grid-tier cell (768x1024).
// Self-asserted below — a shrunk EXTRA_TODO fails the fixture-self-assertion
// describe block loudly, before any reachability assertion can be trusted.
const EXTRA_TODO = 40;
// liveLanes(0) + ctx(3: todo/in_review/done) + extraTodoCount(40) = 43 total
// cards; the `todo` column alone holds 1 (ctx) + 40 (extra) = 41 cards.
const EXPECTED_CARDS = 0 + 3 + EXTRA_TODO;

async function loadDeepBoard(page: Page) {
  const board = buildBoard({ liveLanes: 0, live: true, extraTodoCount: EXTRA_TODO });
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // Wait for the EXACT expected card count, not just "any card visible" — the
  // SSR first paint renders `data/board.sample.json` (a different fixture,
  // server-side, before our route interception can affect it), so a bare
  // "first card visible" check can race against stale sample-board DOM.
  await expect(page.locator(".ak-cardbtn")).toHaveCount(EXPECTED_CARDS, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

// AC2 needs a genuinely SCROLLABLE opened body (>=100 bookkeeping tickets,
// same production-volume shape `shelf-scroll.e2e.spec.ts` uses) — the
// `extraTodoCount` fixture above only deepens the main `.ak-strip` COLUMN
// (AC1's tall-column concern), it adds ZERO shelf-kind tickets, so an
// opened body built from it has no card content to scroll (a dead control
// that would pass trivially with nothing to scroll). Distinct `sk*` id
// namespace inside `buildBoard` — never collides with the `extraTodoCount`
// board above.
const SHELF_VOLUME = { bookkeeping: 60, parked: 15 } as const;

async function loadShelfVolumeBoard(page: Page) {
  const board = buildBoard({ liveLanes: 0, live: true, shelfVolume: SHELF_VOLUME });
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page
    .locator(".ak-shelf__summary")
    .filter({ hasText: `Bookkeeping ${SHELF_VOLUME.bookkeeping}` })
    .waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function bodyMetrics(page: Page) {
  return page.locator(".ak-shelf__body").evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollTop: el.scrollTop,
  }));
}

// ---------------------------------------------------------------------------
// Fixture self-assertion (nr-2499-red-genuine / Rule-17: the oracle must be
// able to vary). Runs at the SAME 344x882 folding-phone viewport AC1 uses.
// ---------------------------------------------------------------------------

test.describe("fixture self-assertion — the RED must be genuine (nr-2499-red-genuine)", () => {
  test.use({
    viewport: { width: 344, height: 882 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2.6,
  });

  test("EXTRA_TODO board yields the expected card count AND a column genuinely taller than the viewport", async ({
    page,
  }) => {
    await loadDeepBoard(page);

    const todoCards = await page.locator(".ak-col").first().locator(".ak-cardbtn").count();
    // 1 ctx `todo` card + EXTRA_TODO extra `todo` cards.
    expect(todoCards).toBe(1 + EXTRA_TODO);

    const [stripBox, innerHeight] = await Promise.all([
      boxOf(page, ".ak-strip.ak-board"),
      page.evaluate(() => window.innerHeight),
    ]);
    // A genuine margin (not a coin-flip near the fold): the column strip's
    // natural height must exceed 2x the viewport height.
    expect(stripBox.height).toBeGreaterThan(innerHeight * 2);
  });
});

// ---------------------------------------------------------------------------
// AC1 + AC2 — folding-phone front screen (344x882, portrait, touch).
// ---------------------------------------------------------------------------

test.describe("AC1 — folding-phone front screen (344x882, touch, portrait <640px)", () => {
  test.use({
    viewport: { width: 344, height: 882 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2.6,
  });

  test("collapsed shelf summary is reachable within the initial viewport, NO page scroll performed", async ({
    page,
  }) => {
    await loadDeepBoard(page);

    // Precondition: genuinely no page scroll has happened.
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    const [box, innerHeight] = await Promise.all([
      boxOf(page, ".ak-shelf__summary"),
      page.evaluate(() => window.innerHeight),
    ]);

    // Record the measured geometry (RED-evidence: on master this line prints
    // `top` far exceeding `innerHeight`; on the fix branch `top` sits inside
    // `[0, innerHeight]`).
    // eslint-disable-next-line no-console
    console.log(
      `[AC1] summary.top=${box.top} summary.bottom=${box.bottom} innerHeight=${innerHeight}`,
    );

    expect(fullyInViewport(box, 344, innerHeight)).toBe(true);
  });

  test("AC1b — the last card of the tall column is NOT occluded by the pinned bar at rest (nr-2499-occlusion)", async ({
    page,
  }) => {
    await loadDeepBoard(page);

    // Scroll the page fully to the bottom (this is a page-level scroll — the
    // occlusion guard must hold at the true end of the column, independent
    // of AC1's own "no scroll needed" claim).
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);

    const lastCardBox = await page.evaluate(() => {
      const col = document.querySelectorAll(".ak-col")[0];
      const cards = col ? Array.from(col.querySelectorAll(".ak-cardbtn")) : [];
      const el = cards[cards.length - 1];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    expect(lastCardBox).not.toBeNull();

    const shelfBox = await boxOf(page, ".ak-shelf__summary");
    // The last card's bottom edge must clear the pinned shelf bar's top edge
    // — i.e. the two boxes do not vertically overlap.
    expect(lastCardBox!.bottom).toBeLessThanOrEqual(shelfBox.top + 1);
  });
});

test.describe("AC2 — no regression to #83's bounded 60dvh opened body (344x882, touch)", () => {
  test.use({
    viewport: { width: 344, height: 882 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2.6,
  });

  test("a real touch swipe inside the opened body produces a positive scrollTop delta", async ({
    page,
  }) => {
    await loadShelfVolumeBoard(page);

    await page.locator(".ak-shelf__summary").tap();
    await expect(page.locator("details.ak-shelf")).toHaveAttribute("open", "");
    await expect
      .poll(() => page.locator(".ak-shelf__body").evaluate((el) => el.scrollHeight))
      .toBeGreaterThan(0);
    // Bring the opened body fully on-screen BEFORE computing the gesture's
    // start point — on master (pre-fix, no pinning) the body can render
    // below the fold after opening, same as `shelf-scroll.e2e.spec.ts`'s
    // proven `openShelf` helper already accounts for. Must hold on BOTH
    // master and the fix branch (AC2 is a no-regression check, not new
    // reachability behavior).
    await page.locator(".ak-shelf__body").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const box = await boxOf(page, ".ak-shelf__body");
    const before = await bodyMetrics(page);

    await touchDragAt(page, {
      x: box.x + box.width / 2,
      y0: box.y + box.height * 0.7,
      dy: -Math.round(box.height * 0.5),
      steps: 15,
    });

    await expect
      .poll(() => page.locator(".ak-shelf__body").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(before.scrollTop);
  });
});

// ---------------------------------------------------------------------------
// AC3 — 640-1023.98px grid-tier cell (768x1024), no regression.
// ---------------------------------------------------------------------------

test.describe("AC3 — grid-tier cell (768x1024), unchanged shell behavior", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("collapsed shelf summary is within the initial viewport at rest", async ({ page }) => {
    await loadDeepBoard(page);

    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    const [box, innerHeight] = await Promise.all([
      boxOf(page, ".ak-shelf__summary"),
      page.evaluate(() => window.innerHeight),
    ]);
    expect(fullyInViewport(box, 768, innerHeight)).toBe(true);
  });
});
