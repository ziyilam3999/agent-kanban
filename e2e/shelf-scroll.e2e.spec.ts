// shelf-scroll.e2e.spec.ts — Binary AC harness for task
// agent-kanban-shelf-bookkeeping-drawer-body-unbounded-no-internal-scroll.
// Plan: .ai-workspace/plans/2026-09-11-shelf-drawer-bounded-scroll.md (AC-1..AC-5).
//
// The opened `.ak-shelf__body` must be its OWN bounded, self-scrolling panel
// at PRODUCTION volume (>=100 bookkeeping + >=20 parked tickets) — the S0
// fixture's ~14-card shelf can never surface this defect (a 14-card body is
// shorter than any sane ceiling), so this spec builds a synthetic
// production-volume board via `buildBoard({ shelfVolume })` and self-asserts
// its own counts/lengths before measuring anything (Rule-17: "the oracle
// must be able to vary" — a quietly shrunk fixture fails loudly here).
//
// Every interaction claim is REAL geometry (boundingBox/scrollTop) plus REAL
// CDP touch (e2e/fixtures/touch.ts) or a real wheel event — never
// computed-style-only for an interaction claim (Rule 19 / UI-task gate leg 3;
// the 2026-08-25 incident this doctrine exists to prevent).
//
// RED on `752a531`: `.ak-shelf[open] > .ak-shelf__body` has no max-height and
// no overflow-y — AC-1/AC-2/AC-3 fail at both cells (AC-5 fails by
// precondition, since AC-3's `scrollTop` never leaves 0). See
// `.ai-workspace/reviews/agent-kanban-shelf-bookkeeping-drawer-body-unbounded-no-internal-scroll-red-evidence.md`
// for the recorded RED run + the AC-4 no-pin scratch-variant RED.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import type { Board } from "../lib/board-schema";
import { buildBoard } from "./fixtures/board-fixture";
import {
  touchDragAt,
  touchDragHorizontalAt,
  visualViewportOffsets,
  boxOf,
} from "./fixtures/touch";

const REPO_ROOT = path.join(__dirname, "..");
const FIXTURE_DIR = path.join(REPO_ROOT, "__tests__", "fixtures", "task-kind-store");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

/** Run the REAL exporter against the shared S0 fixture store (same ~14-ticket
 * shelf store `e2e/shelf.e2e.spec.ts` uses) — the AC-6 hold-out board. */
function exportS0FixtureBoard(): Board {
  const outFile = path.join(
    os.tmpdir(),
    `shelf-scroll-e2e-board-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  execFileSync(TSX_BIN, ["scripts/export-board.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, TASKS_DIR: FIXTURE_DIR, OUT: outFile },
    stdio: "pipe",
  });
  const board: Board = JSON.parse(fs.readFileSync(outFile, "utf8"));
  fs.rmSync(outFile, { force: true });
  return board;
}

const SHELF_VOLUME = { bookkeeping: 105, parked: 22, productionIdShape: true } as const;

/** Build the production-volume shelf board AND self-assert its own shape
 * (Rule-17: the oracle must be able to vary — a shrunk fixture fails loudly,
 * not silently, right here, before any measurement below can be trusted). */
function buildProductionShelfBoard(): Board {
  const board = buildBoard({ liveLanes: 1, live: true, shelfVolume: SHELF_VOLUME });
  const bookkeeping = board.tickets.filter(
    (t) => t.kind === "bookkeeping" && t.status !== "completed"
  );
  const parked = board.tickets.filter((t) => t.kind === "parked" && t.status !== "completed");
  expect(bookkeeping.length).toBeGreaterThanOrEqual(100);
  expect(parked.length).toBeGreaterThanOrEqual(20);
  const has80CharId = bookkeeping.some((t) => t.id.length === 80);
  expect(has80CharId).toBe(true);
  const has105CharToken = bookkeeping.some((t) =>
    t.subject.split(/\s+/).some((tok) => tok.length === 105)
  );
  expect(has105CharToken).toBe(true);
  return board;
}

/**
 * The SSR first paint renders `data/board.sample.json` (a totally different
 * fixture) BEFORE our `/api/board` route interception can affect it (same
 * gotcha `fold8-scroll-reachability.e2e.spec.ts` documents) — and those
 * stale sample cards then run an EXIT animation before finally unmounting,
 * which measurably shrinks `document.scrollHeight` (and clamps
 * `window.scrollY`) a few hundred ms into the test, entirely independent of
 * anything this spec does. Rather than assume an exact predicted card count
 * (a completed/"done" ticket may not always render 1:1), poll `.ak-cardbtn`
 * until its count stops changing — a direct, board-shape-agnostic signal
 * that the stale DOM has fully cleared before any geometry/scroll
 * measurement below can be trusted.
 */
async function waitForCardCountStable(page: Page): Promise<void> {
  let last = -1;
  let streak = 0;
  for (let i = 0; i < 80; i++) {
    const n = await page.locator(".ak-cardbtn").count();
    if (n === last && n > 0) {
      streak++;
      if (streak >= 5) return;
    } else {
      streak = 0;
    }
    last = n;
    await page.waitForTimeout(100);
  }
}

async function loadShelfBoard(page: Page): Promise<Board> {
  const board = buildProductionShelfBoard();
  await page.route("**/api/board", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(board) });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page
    .locator(".ak-shelf__summary")
    .filter({ hasText: `Bookkeeping ${SHELF_VOLUME.bookkeeping}` })
    .waitFor({ timeout: 15_000 });
  await waitForCardCountStable(page);
  return board;
}

/** Wait until window.scrollY stops changing (same proven pattern as
 * `lane-reveal.e2e.spec.ts`'s `waitForScrollSettled`) — a `scrollIntoView`
 * lands its final position a few hundred ms after the DOM update, so an
 * AC-2 baseline captured too early would misattribute that settle-in-flight
 * drift to the gesture itself (measured live: a 129px correction ~300ms
 * after an instant `scrollTo`, reproduced even with ZERO touch gesture). */
async function waitForScrollSettled(page: Page): Promise<void> {
  let last = "";
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const [y, docH] = await page.evaluate(() => [
      window.scrollY,
      document.documentElement.scrollHeight,
    ]);
    const key = `${y}:${docH}`;
    if (key === last) {
      streak++;
      if (streak >= 5) return;
    } else {
      streak = 0;
    }
    last = key;
    await page.waitForTimeout(75);
  }
}

/** Open the shelf (real touch tap when `useTap`, else a plain click), wait
 * for the body to genuinely engage (real scrollHeight, not just `[open]`),
 * then bring the body fully on-screen (executor notes: gestures must start
 * INSIDE the body's box, which requires it not be scrolled out of view by
 * the page's own scroll position first) and let the page's own scroll
 * position fully settle before returning. */
async function openShelf(page: Page, useTap: boolean): Promise<void> {
  const summary = page.locator(".ak-shelf__summary");
  if (useTap) {
    await summary.tap();
  } else {
    await summary.click();
  }
  await expect(page.locator("details.ak-shelf")).toHaveAttribute("open", "");
  await expect
    .poll(() => page.locator(".ak-shelf__body").evaluate((el) => el.scrollHeight))
    .toBeGreaterThan(0);
  await page.locator(".ak-shelf__body").scrollIntoViewIfNeeded();
  await waitForScrollSettled(page);
}

async function bodyMetrics(page: Page) {
  return page.locator(".ak-shelf__body").evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
  }));
}

/** Count of `.ak-shelf-card` boxes lying FULLY inside the body's own box (not
 * the viewport) — "pages a list" (>=3), not "peeps one card". */
async function cardsFullyInsideBody(page: Page): Promise<number> {
  return page.evaluate(() => {
    const body = document.querySelector(".ak-shelf__body");
    if (!body) return 0;
    const b = body.getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll(".ak-shelf-card"));
    let count = 0;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && r.left >= b.left - 1 && r.right <= b.right + 1) {
        count++;
      }
    }
    return count;
  });
}

/** True iff the FIRST or LAST `.ak-shelf-card` (global DOM order across every
 * group — never a per-group `:first-of-type`/`:last-of-type`, which matches
 * once PER GROUP and throws a Playwright strict-mode violation) lies fully
 * inside the `.ak-shelf__body` box (not the viewport). */
async function edgeCardFullyInsideBody(page: Page, which: "first" | "last"): Promise<boolean> {
  return page.evaluate((w) => {
    const body = document.querySelector(".ak-shelf__body");
    const cards = Array.from(document.querySelectorAll(".ak-shelf-card"));
    const el = w === "first" ? cards[0] : cards[cards.length - 1];
    if (!body || !el) return false;
    const b = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && r.left >= b.left - 1 && r.right <= b.right + 1;
  }, which);
}

/** getBoundingClientRect() of the FIRST `.ak-shelf-card` in global DOM order. */
async function firstCardBox(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".ak-shelf-card");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
  });
}

/**
 * Append a non-shrinkable stub inside the body (a stand-in for a future wide
 * child) — always wider than the body's OWN clientWidth (never a bare fixed
 * 600px, which can sit narrower than a wide desktop body and thus never
 * overflow anything — the oracle must be able to vary regardless of cell
 * width) plus a fixed 600px floor for the narrowest mobile cell.
 *
 * Deliberately does NOT write `el.scrollLeft = x` itself (plan L49 — the
 * both-ends oracle for this arm is a REAL user-gesture drag/wheel, driven by
 * the caller right after this returns, matching the RED control text
 * verbatim: "on a scratch variant ... the drag reads body.scrollLeft > 0").
 * A raw JS `scrollLeft` write is a CSSOM-level escape hatch that a real user
 * can never trigger — measured live, Chromium still applies a JS write to
 * `scrollLeft` even through `overflow-x:hidden` when the OTHER axis is
 * `auto` (the two axes share one scrolling box), so asserting against a raw
 * write would fail even on the CORRECT fix and prove nothing about actual
 * containment. A real touch-drag / wheel gesture is what `overflow-x:hidden`
 * genuinely blocks (no user-gesture scrolling on that axis) — that's the
 * oracle AC-4 needs.
 */
async function injectWideStub(page: Page): Promise<void> {
  await page.locator(".ak-shelf__body").evaluate((el) => {
    const stub = document.createElement("div");
    stub.className = "shelf-scroll-test-wide-stub";
    const width = Math.max(600, el.clientWidth + 300);
    stub.style.cssText = `width:${width}px;flex-shrink:0;height:10px;`;
    el.appendChild(stub);
  });
  await new Promise((r) => setTimeout(r, 50));
}

// ---------------------------------------------------------------------------
// Fixture self-assertion (Rule-17: the oracle must be able to vary).
// ---------------------------------------------------------------------------

test.describe("production-volume shelf fixture self-assertion", () => {
  test("buildBoard({shelfVolume}) yields >=100 bookkeeping + >=20 parked, an 80-char id, a 105-char token", async () => {
    buildProductionShelfBoard();
  });
});

// ---------------------------------------------------------------------------
// Mobile cell: 390x844, hasTouch, isMobile, DPR 2.6.
// ---------------------------------------------------------------------------

test.describe("mobile 390x844 (touch)", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2.6,
  });

  test("AC-1: bounded panel — overflow engaged, height <= 0.70x innerHeight, >=3 cards fully inside", async ({
    page,
  }) => {
    await loadShelfBoard(page);
    await openShelf(page, true);

    const m = await bodyMetrics(page);
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight);

    const [bodyBox, innerHeight] = await Promise.all([
      boxOf(page, ".ak-shelf__body"),
      page.evaluate(() => window.innerHeight),
    ]);
    expect(bodyBox.height).toBeLessThanOrEqual(0.7 * innerHeight);

    const fullyInside = await cardsFullyInsideBody(page);
    expect(fullyInside).toBeGreaterThanOrEqual(3);
  });

  test("AC-2: real touch swipe-up inside the body scrolls the panel, not the page", async ({
    page,
  }) => {
    await loadShelfBoard(page);
    await openShelf(page, true);

    const box = await boxOf(page, ".ak-shelf__body");
    const y0 = box.y + box.height * 0.7;
    // Self-asserted: the swipe start point genuinely lies inside the body's box.
    expect(y0).toBeGreaterThanOrEqual(box.y);
    expect(y0).toBeLessThanOrEqual(box.y + box.height);

    const before = await bodyMetrics(page);
    const beforeScrollY = await page.evaluate(() => window.scrollY);

    await touchDragAt(page, {
      x: box.x + box.width / 2,
      y0,
      dy: -Math.round(box.height * 0.5),
      steps: 15,
    });

    await expect
      .poll(() => page.locator(".ak-shelf__body").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(before.scrollTop);
    // Let any deferred browser scroll-position settle-in-flight resolve
    // BEFORE reading the final scrollY (see `waitForScrollSettled` above) —
    // otherwise a not-yet-settled intermediate value can be misattributed to
    // the gesture itself.
    await waitForScrollSettled(page);

    const after = await bodyMetrics(page);
    const afterScrollY = await page.evaluate(() => window.scrollY);
    expect(after.scrollTop - before.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(afterScrollY - beforeScrollY)).toBeLessThanOrEqual(1);
  });

  test("AC-3: reachability, both ends", async ({ page }) => {
    await loadShelfBoard(page);
    await openShelf(page, true);

    await page.locator(".ak-shelf__body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(80);
    const atEnd = await bodyMetrics(page);
    expect(Math.abs(atEnd.scrollTop - (atEnd.scrollHeight - atEnd.clientHeight))).toBeLessThanOrEqual(1);
    expect(await edgeCardFullyInsideBody(page, "last")).toBe(true);

    await page.locator(".ak-shelf__body").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(80);
    const atStart = await bodyMetrics(page);
    expect(atStart.scrollTop).toBe(0);
    expect(await edgeCardFullyInsideBody(page, "first")).toBe(true);
  });

  test("AC-4: no horizontal overflow — document, body, touch-drag pan, injected wide child", async ({
    page,
  }) => {
    await loadShelfBoard(page);
    await openShelf(page, true);

    let overflow = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.scrollingElement!.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    expect((await bodyMetrics(page)).scrollLeft).toBe(0);

    const box = await boxOf(page, ".ak-shelf__body");
    await touchDragHorizontalAt(page, {
      xStart: box.x + box.width * 0.7,
      y: box.y + box.height * 0.5,
      dx: -Math.round(box.width * 0.5),
      steps: 12,
    });
    await page.waitForTimeout(150);
    const vv = await visualViewportOffsets(page);
    expect(vv.offsetLeft).toBe(0);
    expect((await bodyMetrics(page)).scrollLeft).toBe(0);

    // Second arm: a test-injected non-shrinkable wide child (stand-in for a
    // future wide card) must NOT surface horizontal overflow even when a
    // REAL touch drag is driven directly over it — the explicit
    // `overflow-x:hidden` pin blocks user-gesture scrolling on that axis
    // (plan L49 RED control: the no-pin scratch variant's drag reads
    // `body.scrollLeft > 0` here).
    await injectWideStub(page);
    const box2 = await boxOf(page, ".ak-shelf__body");
    await touchDragHorizontalAt(page, {
      xStart: box2.x + box2.width * 0.7,
      y: box2.y + box2.height * 0.5,
      dx: -Math.round(box2.width * 0.5),
      steps: 12,
    });
    await page.waitForTimeout(150);
    overflow = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.scrollingElement!.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    const vv2 = await visualViewportOffsets(page);
    expect(vv2.offsetLeft).toBe(0);
    expect((await bodyMetrics(page)).scrollLeft).toBe(0);
  });

  test("AC-5: sticky group labels — Bookkeeping pinned first, Parked pinned after the group ends", async ({
    page,
  }) => {
    await loadShelfBoard(page);
    await openShelf(page, true);

    const cardBox = await firstCardBox(page);
    expect(cardBox).not.toBeNull();
    const parkedLabelOffsetTop = await page
      .locator(".ak-shelf__group-label", { hasText: "Parked" })
      .evaluate((el) => (el as HTMLElement).offsetTop);

    // Drive scrollTop to ~3 card heights — still well inside the 105-card
    // Bookkeeping group.
    await page.locator(".ak-shelf__body").evaluate((el, y) => {
      el.scrollTop = y;
    }, Math.ceil(cardBox!.height * 3));
    await page.waitForTimeout(80);

    let bodyBox = await boxOf(page, ".ak-shelf__body");
    let bookkeepingLabel = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll(".ak-shelf__group-label")).find((n) =>
        n.textContent?.includes("Bookkeeping")
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    expect(bookkeepingLabel).not.toBeNull();
    expect(bookkeepingLabel!.top).toBeGreaterThanOrEqual(bodyBox.top - 1);
    expect(bookkeepingLabel!.top).toBeLessThanOrEqual(bodyBox.top + 24);
    expect(bookkeepingLabel!.bottom).toBeLessThanOrEqual(bodyBox.bottom + 1);
    expect(bookkeepingLabel!.left).toBeGreaterThanOrEqual(bodyBox.left - 1);
    expect(bookkeepingLabel!.right).toBeLessThanOrEqual(bodyBox.right + 1);

    // Drive well past the Bookkeeping group's end (into the Parked group).
    await page.locator(".ak-shelf__body").evaluate((el, y) => {
      el.scrollTop = y;
    }, parkedLabelOffsetTop + 40);
    await page.waitForTimeout(80);

    bodyBox = await boxOf(page, ".ak-shelf__body");
    const parkedLabel = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll(".ak-shelf__group-label")).find((n) =>
        n.textContent?.includes("Parked")
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    expect(parkedLabel).not.toBeNull();
    expect(parkedLabel!.top).toBeGreaterThanOrEqual(bodyBox.top - 1);
    expect(parkedLabel!.top).toBeLessThanOrEqual(bodyBox.top + 24);

    bookkeepingLabel = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll(".ak-shelf__group-label")).find((n) =>
        n.textContent?.includes("Bookkeeping")
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    expect(bookkeepingLabel).not.toBeNull();
    // The Bookkeeping label has released (scrolled with its group) and is no
    // longer inside the body's box.
    expect(bookkeepingLabel!.bottom).toBeLessThan(bodyBox.top);
  });
});

// ---------------------------------------------------------------------------
// Desktop cell: 1440x900.
// ---------------------------------------------------------------------------

test.describe("desktop 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC-1: bounded panel — overflow engaged, height <= 0.70x innerHeight, >=3 cards fully inside", async ({
    page,
  }) => {
    await loadShelfBoard(page);
    await openShelf(page, false);

    const m = await bodyMetrics(page);
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight);

    const [bodyBox, innerHeight] = await Promise.all([
      boxOf(page, ".ak-shelf__body"),
      page.evaluate(() => window.innerHeight),
    ]);
    expect(bodyBox.height).toBeLessThanOrEqual(0.7 * innerHeight);

    const fullyInside = await cardsFullyInsideBody(page);
    expect(fullyInside).toBeGreaterThanOrEqual(3);
  });

  test("AC-2: a real wheel event over the body scrolls it", async ({ page }) => {
    await loadShelfBoard(page);
    await openShelf(page, false);

    const box = await boxOf(page, ".ak-shelf__body");
    const before = await bodyMetrics(page);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 600);

    await expect
      .poll(() => page.locator(".ak-shelf__body").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(before.scrollTop);
  });

  test("AC-3: reachability, both ends", async ({ page }) => {
    await loadShelfBoard(page);
    await openShelf(page, false);

    await page.locator(".ak-shelf__body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(80);
    const atEnd = await bodyMetrics(page);
    expect(Math.abs(atEnd.scrollTop - (atEnd.scrollHeight - atEnd.clientHeight))).toBeLessThanOrEqual(1);
    expect(await edgeCardFullyInsideBody(page, "last")).toBe(true);

    await page.locator(".ak-shelf__body").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(80);
    const atStart = await bodyMetrics(page);
    expect(atStart.scrollTop).toBe(0);
    expect(await edgeCardFullyInsideBody(page, "first")).toBe(true);
  });

  test("AC-4: no horizontal overflow — document, body, injected wide child", async ({ page }) => {
    await loadShelfBoard(page);
    await openShelf(page, false);

    let overflow = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.scrollingElement!.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    expect((await bodyMetrics(page)).scrollLeft).toBe(0);

    await injectWideStub(page);
    const box2 = await boxOf(page, ".ak-shelf__body");
    // Real horizontal wheel gesture (deltaX) directly over the injected wide
    // child — mirrors AC-2 desktop's real `page.mouse.wheel(0, 600)` vertical
    // pattern, but on the x axis, matching plan L49's "the drag reads
    // body.scrollLeft > 0" RED control (a raw `el.scrollLeft=` JS write is
    // not the oracle here — see injectWideStub's doc comment).
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.wheel(600, 0);
    await page.waitForTimeout(150);
    overflow = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.scrollingElement!.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    expect((await bodyMetrics(page)).scrollLeft).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-6 hold-out — the new ceiling must not CLIP content: (a) the ~14-ticket
// S0-scale board (real card content measures ~124px/card — at 390x844 that's
// ~1730px, genuinely TALLER than the 506px/60dvh cap, so it also scrolls;
// "reads its full body" means every card stays REACHABLE via scroll, not
// that no scrolling is needed) is fully reachable both ends, same as AC-3;
// (b) a GENUINELY short list (content shorter than the cap) shows with NO
// dead space — the panel hugs its content instead of stretching to the cap.
// ---------------------------------------------------------------------------

test.describe("AC-6 hold-out — the ceiling does not clip or dead-space a short list", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("S0 fixture shelf (~14 tickets, real content) — fully reachable both ends, nothing clipped", async ({
    page,
  }) => {
    const board = exportS0FixtureBoard();
    const shelfCount = board.tickets.filter(
      (t) => t.status !== "completed" && t.kind && t.kind !== "work"
    ).length;
    expect(shelfCount).toBeGreaterThan(0);
    await page.route("**/api/board", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(board) });
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.locator(".ak-shelf__summary").waitFor({ timeout: 15_000 });
    await waitForCardCountStable(page);
    await openShelf(page, true);

    await page.locator(".ak-shelf__body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(80);
    expect(await edgeCardFullyInsideBody(page, "last")).toBe(true);

    await page.locator(".ak-shelf__body").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(80);
    expect(await edgeCardFullyInsideBody(page, "first")).toBe(true);
  });

  test("a genuinely short list (content < the dvh ceiling) shows with no dead space", async ({
    page,
  }) => {
    const board = buildBoard({
      liveLanes: 1,
      live: true,
      shelfVolume: { bookkeeping: 2, parked: 1 },
    });
    await page.route("**/api/board", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(board) });
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.locator(".ak-shelf__summary").waitFor({ timeout: 15_000 });
    await waitForCardCountStable(page);
    await openShelf(page, true);

    const m = await bodyMetrics(page);
    // No internal overflow is engaged — the 3-card list's content is well
    // under the 60dvh cap, so the panel hugs it (no dead space below the
    // last card, unlike a fixed-height container would leave).
    expect(m.scrollHeight - m.clientHeight).toBeLessThanOrEqual(1);
    const bodyBox = await boxOf(page, ".ak-shelf__body");
    expect(Math.abs(bodyBox.height - m.scrollHeight)).toBeLessThanOrEqual(2);
  });
});
