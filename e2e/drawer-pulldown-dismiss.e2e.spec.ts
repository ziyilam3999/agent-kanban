// drawer-pulldown-dismiss.e2e.spec.ts — Playwright behavioural oracle for #1455
// (native-iOS-style pull-down-from-top drag-to-dismiss on the ticket Drawer's
// scroll BODY, alongside the pre-existing grip-only dismiss). This is the real
// behavioural proof for the scroll-vs-dismiss gate; the jest guard in
// __tests__/drawer-scroll-contract.test.ts (A6) only fences the source wiring.
//
// Chromium/CDP touch emulation is a necessary-but-NOT-sufficient oracle for
// iOS Safari (cairn: "chromium scrolls fine, iOS doesn't") — the honest
// residual is AC12, an operator real-device smoke, recorded (not gated) in
// .ai-workspace/design/1455-drawer-pulldown.md.
//
// Reads/writes only repo-relative paths — no absolute/home-path literals, so
// this stays clean under the CI privacy grep.

import { test, expect, type Page } from "@playwright/test";
import { buildBoard } from "./fixtures/board-fixture";

// Touch-enabled mobile viewport — the pull-down gesture is a touch-only
// affordance (desktop hides the grip and never wires body-touch dismiss).
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

const TICKET_SHORT = "701";
const TICKET_LONG = "1444";
// Long enough to force scrollHeight > clientHeight in the ~86dvh mobile sheet
// (mirrors the proven-scrollable magnitude in drawer-long-subject.e2e.spec.ts).
const SUBJECT_LONG =
  "A long ticket subject used to force a scrollable drawer body for the pull-down-vs-scroll gate. ".repeat(
    40
  );

/**
 * Intercept /api/board with a synthetic board, load it, and open one ticket's
 * drawer. `long: true` swaps in a pathologically long subject so the body is
 * genuinely scrollable (Case B needs scrollHeight > clientHeight).
 */
async function openDrawer(page: Page, opts: { long?: boolean } = {}) {
  const board = opts.long
    ? buildBoard({
        liveLanes: 1,
        longSubjectTicket: { id: TICKET_LONG, subject: SUBJECT_LONG },
      })
    : buildBoard({ liveLanes: 1 });
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  // The poll closure reads document.hidden; force an immediate fetch of the
  // intercepted route (same technique as drawer-long-subject.e2e.spec.ts).
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const ticketId = opts.long ? TICKET_LONG : TICKET_SHORT;
  // liveLanes(1) + 3 context tickets [+1 long-subject card when opts.long].
  const expectedCount = opts.long ? 5 : 4;
  await expect(page.locator(".ak-cardbtn")).toHaveCount(expectedCount, {
    timeout: 15_000,
  });
  await page
    .getByRole("button", { name: new RegExp(`Open ticket #${ticketId}`) })
    .click();
  await expect(page.locator(".ak-drawer")).toBeVisible();
  // Let the AnimatePresence spring entrance settle before gesturing.
  await page.waitForTimeout(800);
}

/**
 * Low-level real touch drag via CDP `Input.dispatchTouchEvent`. A JS
 * `element.dispatchEvent(new TouchEvent(...))` is a pure synthetic DOM event —
 * it does NOT drive the browser's real touch-input pipeline, so it never
 * synthesizes the PointerEvents Drawer.tsx actually listens on
 * (onPointerDown/onPointerMove). Only an engine-level (CDP) touch input does.
 * Drives one continuous touchstart -> touchmove* -> touchend sequence against
 * the element at `selector`. `dy>0` = drag down, `dy<0` = drag up.
 */
async function touchDrag(
  page: Page,
  opts: { selector: string; dy: number; steps?: number }
) {
  const { selector, dy, steps = 12 } = opts;
  const el = page.locator(selector);
  const box = await el.boundingBox();
  if (!box) throw new Error(`touchDrag: ${selector} has no bounding box`);
  const x = box.x + box.width / 2;
  const y0 = box.y + Math.min(40, box.height / 4);

  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: y0 }],
    });
    for (let i = 1; i <= steps; i++) {
      const y = y0 + (dy * i) / steps;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y }],
      });
      await page.waitForTimeout(16);
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * THE shared body-touch helper (shared-helper mandate). Cases A, B and C all
 * drive the gesture through this exact function, targeting `[data-ak-pulldown]`
 * — the stable sentinel body marker rendered by Drawer.tsx (also fenced by
 * jest guard A6). Because Case A proves this dispatch actually FIRES the
 * gesture (the drawer dismisses), Cases B and C cannot silently pass on a
 * no-op'd touch — they run byte-identical dispatch machinery Case A has
 * already proven live. Do NOT hand-roll a divergent touch dispatch per case.
 */
async function pullBody(page: Page, opts: { dy: number; steps?: number }) {
  await touchDrag(page, {
    selector: "[data-ak-pulldown]",
    dy: opts.dy,
    steps: opts.steps,
  });
}

test.describe("#1455 Drawer pull-down-from-top drag-to-dismiss", () => {
  test("Case A (anchor): at-top + drag down dismisses the drawer — proves pullBody actually fires", async ({
    page,
  }) => {
    await openDrawer(page);

    const scrollTop = await page
      .locator("[data-ak-pulldown]")
      .evaluate((el) => el.scrollTop);
    expect(scrollTop).toBe(0);
    await expect(page.locator(".ak-drawer")).toBeVisible();

    await pullBody(page, { dy: 180 });

    // A no-op'd helper would leave the drawer visible — this assertion FAILS
    // in that case, which is exactly the proof-of-fire this case exists for.
    await expect(page.locator(".ak-drawer")).toHaveCount(0, { timeout: 5_000 });
  });

  test("Case B: scrolled + drag down scrolls the body, does NOT dismiss", async ({
    page,
  }) => {
    await openDrawer(page, { long: true });

    const initialScrollTop = await page
      .locator("[data-ak-pulldown]")
      .evaluate((el) => {
        el.scrollTop = 120;
        return el.scrollTop;
      });
    expect(initialScrollTop).toBeGreaterThan(0);
    // Let the programmatic scroll settle a frame before gesturing.
    await page.waitForTimeout(50);

    await pullBody(page, { dy: 180 });

    // Latched at gesture start (scrollTop > 0 when the downward intent was
    // first detected) — never dismisses, even though the drag itself scrolls
    // scrollTop back toward 0 as it plays out (Interaction spec Case B).
    await expect(page.locator(".ak-drawer")).toBeVisible();

    const finalScrollTop = await page
      .locator("[data-ak-pulldown]")
      .evaluate((el) => el.scrollTop);
    // Non-vacuity: a no-op'd touch would leave scrollTop unchanged at 120.
    expect(finalScrollTop).toBeLessThan(initialScrollTop);
  });

  test("Case C: at-top + drag up does NOT dismiss (reuses A's proven-fire dispatch)", async ({
    page,
  }) => {
    await openDrawer(page);

    await pullBody(page, { dy: -180 });

    await expect(page.locator(".ak-drawer")).toBeVisible();
  });

  test("Case D: grip drag still dismisses (existing affordance intact — NOT via the shared body helper)", async ({
    page,
  }) => {
    await openDrawer(page);

    const grip = page.locator(".ak-drawer__grip");
    await expect(grip).toBeVisible();

    // Grip drag targets `.ak-drawer__grip`, not [data-ak-pulldown] — proves
    // the pre-existing affordance is untouched by the new body-pull wiring.
    await touchDrag(page, { selector: ".ak-drawer__grip", dy: 180 });

    await expect(page.locator(".ak-drawer")).toHaveCount(0, { timeout: 5_000 });
  });
});
