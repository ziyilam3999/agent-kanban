// drawer-long-subject.e2e.spec.ts — Playwright layout-invariant check for #1447
// cycle 4 (Option B). The ticket-detail Drawer must stay SCROLLABLE for a
// pathologically long subject (#1444 ≈ 3,464 chars): the subject is relocated OUT
// of the pinned, non-shrinking `.ak-drawer__head` and into the TOP of the scroll
// body as `.ak-drawer__title`, so the head holds only fixed single-line elements
// and can never grow to starve the body. The board is fed a synthetic payload via
// /api/board route interception — the real Vercel Blob is never touched.
//
// The binary oracle is `body.clientHeight > head.clientHeight`: on master the head
// swells with the giant subject and dominates the ~86dvh column, so the body is
// squished to its padding floor (clientHeight ≈ 40 = 14+26px padding, content box 0)
// => RED. After Option B the head is a compact ~50px bar and the body owns the rest
// => GREEN. (A bare `clientHeight > 0` is vacuous — the 40px padding floor satisfies
// it even when fully starved.)
//
// Reads/writes only repo-relative paths (path.join(__dirname, "..", ...)) — no
// absolute/home-path literals, so it stays clean under the CI privacy grep.

import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { buildBoard } from "./fixtures/board-fixture";

const SCREENS = path.join(__dirname, "..", ".ai-workspace", "design", "screens-1447");
const TICKET_ID = "1444";

// #1444-shape: a description blob accidentally dumped into the `subject` param.
// Spaces present so wrapping is realistic; length ≈ 3,504 (near #1444's ~3,464).
const SUBJECT_3000 =
  "A description accidentally dumped into the subject field of ticket #1444. ".repeat(48);
// Moderate length (~594 chars) — exercises the invariant at a non-pathological size.
const SUBJECT_500 = "Relocate the drawer subject out of the pinned header. ".repeat(11);
// A single spaceless mega-token — hardens the overflow-wrap:anywhere guard: it must
// WRAP inside the body, never force the page to scroll horizontally.
const SUBJECT_MEGA_TOKEN = "x".repeat(1500);

/**
 * Intercept /api/board with a synthetic board carrying a long-subject #1444 card,
 * load the board, force an immediate poll, wait for the card count to settle, then
 * click the #1444 card and let the drawer's spring entrance settle.
 */
async function openLongSubjectDrawer(page: Page, subject: string) {
  const board = buildBoard({
    liveLanes: 1,
    longSubjectTicket: { id: TICKET_ID, subject },
  });
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
  // liveLanes(1) in_progress + 3 context tickets + 1 long-subject card = 5 cards.
  await expect(page.locator(".ak-cardbtn")).toHaveCount(5, { timeout: 15_000 });
  // Regex substring match survives a multi-thousand-char aria-label.
  await page
    .getByRole("button", { name: new RegExp(`Open ticket #${TICKET_ID}`) })
    .click();
  await expect(page.locator(".ak-drawer")).toBeVisible();
  // Let the AnimatePresence spring entrance (damping 32 / stiffness 320) settle so
  // measurements + screenshots are taken on a resting drawer.
  await page.waitForTimeout(800);
}

/** clientHeight (visible box) + scrollHeight (content) of the scroll body. */
async function bodyMetrics(page: Page) {
  return page.locator(".ak-drawer__body").evaluate((el) => ({
    c: el.clientHeight,
    s: el.scrollHeight,
  }));
}

/** clientHeight of the pinned head — bounded by construction after Option B. */
async function headHeight(page: Page) {
  return page.locator(".ak-drawer__head").evaluate((el) => el.clientHeight);
}

/** documentElement scroll vs client width — flags any horizontal page overflow. */
async function docWidths(page: Page) {
  return page.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth,
  }));
}

test.describe("#1447 Drawer long-subject scroll invariant (Option B)", () => {
  test("3,000+ char subject: body owns the column, not the head @390 (RED→GREEN oracle) + mobile screenshot", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLongSubjectDrawer(page, SUBJECT_3000);

    // The binary oracle. Master: giant subject in the pinned head => head dominates,
    // body squished to its 40px padding floor => `body.c > head.c` FAILS (RED).
    // Option B: compact ~50px head, body owns the rest => PASSES (GREEN).
    const body = await bodyMetrics(page);
    const head = await headHeight(page);
    console.log(
      `[#1447] 3000-char @390: body.clientHeight=${body.c} body.scrollHeight=${body.s} head.clientHeight=${head}`
    );
    expect(body.c).toBeGreaterThan(0); // body present at all
    expect(body.c).toBeGreaterThan(head); // head must NOT dominate/starve the body
    expect(body.s).toBeGreaterThan(body.c); // and the (now overflowing) body is scrollable

    // Drag-to-dismiss survives: the grip is present + visible on mobile.
    await expect(page.locator(".ak-drawer__grip")).toBeVisible();

    // Full subject text present (no truncation) as the accessible <h2> hero heading.
    const title = page.locator(".ak-drawer__title");
    await expect(title).toBeVisible();
    const titleLen = await title.evaluate((el) => (el.textContent ?? "").length);
    expect(titleLen).toBeGreaterThanOrEqual(SUBJECT_3000.length);

    // Screenshot the resting drawer at the TOP (compact bar + hero title) for ui-evolve.
    await page.screenshot({ path: path.join(SCREENS, "m-long-subject.png") });

    // Tail reachable: scrolling the body to the bottom actually moves it (no clipping).
    const scrolled = await page.locator(".ak-drawer__body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);

    // No horizontal page overflow at 390px (prose subject wraps cleanly).
    const dw = await docWidths(page);
    expect(dw.s).toBeLessThanOrEqual(dw.c);
  });

  test("500+ char subject: body not starved by the head @390 (invariant at moderate length)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLongSubjectDrawer(page, SUBJECT_500);

    const body = await bodyMetrics(page);
    const head = await headHeight(page);
    console.log(
      `[#1447] 500-char @390: body.clientHeight=${body.c} body.scrollHeight=${body.s} head.clientHeight=${head}`
    );
    expect(body.c).toBeGreaterThan(0);
    // Head stays compact (subject relocated), so the body owns the column even at a
    // moderate length that fits without scrolling on a tall viewport.
    expect(body.c).toBeGreaterThan(head);
    // Full subject present in the body as the hero heading.
    const title = page.locator(".ak-drawer__title");
    await expect(title).toBeVisible();
    const titleLen = await title.evaluate((el) => (el.textContent ?? "").length);
    expect(titleLen).toBeGreaterThanOrEqual(SUBJECT_500.length);
  });

  test("spaceless mega-token subject: wraps, no horizontal page scroll @390 (overflow-wrap guard)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLongSubjectDrawer(page, SUBJECT_MEGA_TOKEN);

    const body = await bodyMetrics(page);
    const head = await headHeight(page);
    expect(body.c).toBeGreaterThan(0); // body not starved even for a giant token
    expect(body.c).toBeGreaterThan(head); // head stays compact

    // The single giant token must WRAP (overflow-wrap:anywhere), not force overflow.
    const dw = await docWidths(page);
    expect(dw.s).toBeLessThanOrEqual(dw.c);
    const titleW = await page.locator(".ak-drawer__title").evaluate((el) => ({
      s: el.scrollWidth,
      c: el.clientWidth,
    }));
    expect(titleW.s).toBeLessThanOrEqual(titleW.c);
  });

  test("3,000+ char subject: body owns the column, not the head @1440 (desktop side panel) + desktop screenshot", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLongSubjectDrawer(page, SUBJECT_3000);

    const body = await bodyMetrics(page);
    const head = await headHeight(page);
    console.log(
      `[#1447] 3000-char @1440: body.clientHeight=${body.c} body.scrollHeight=${body.s} head.clientHeight=${head}`
    );
    expect(body.c).toBeGreaterThan(0);
    expect(body.c).toBeGreaterThan(head);
    expect(body.s).toBeGreaterThan(body.c);

    await page.screenshot({ path: path.join(SCREENS, "d-long-subject.png") });
  });
});
