// Permanent guard — ticket-detail Drawer touch-scroll (#1447).
//
// WHAT THIS PROVES (and what it CANNOT):
//  (i)   Proves the scroll MECHANISM works under TRUSTED touch in CHROMIUM:
//        a real CDP `Input.dispatchTouchEvent` swipe scrolls `.ak-drawer__body`
//        (synthetic `new Touch()`/dispatchEvent does NOT trigger native
//        scrolling — only trusted input does, so we drive CDP directly).
//  (ii)  Does NOT prove iOS Safari. There is no local iOS engine here
//        (`xcrun simctl` empty), CDP trusted-touch is chromium-only, and WebKit
//        forbids `new Touch()`. Critically, chromium scrolls fine WITH OR
//        WITHOUT this cycle's `transform: translateZ(0)` fix, so this spec
//        CANNOT distinguish "translateZ present" from "translateZ absent".
//  (iii) The iOS proof is the MANUAL operator-real-device step (plan AC14 / CG5)
//        — the only fix-oracle. Chromium-green != iOS-works.
//  (iv)  It DOES go RED if the flex/overflow scroll recipe is broken so the body
//        no longer overflows/scrolls under trusted touch (RED demo: strip
//        min-height:0 + overflow-y:auto). That is what it guards.
//
// Uses synthetic fixture data only (page.route stub) — no real board, no
// network, no ~/.claude. Runs under the chromium project:
//   PW_WEB_SERVER=1 npx playwright test drawer-scroll
import { test, expect, chromium } from "@playwright/test";
import type { Board, Ticket } from "../lib/board-schema";

const LONG = Array.from({ length: 60 }, (_, i) =>
  `Paragraph ${i + 1}: deliberately long ticket description to force the drawer body to overflow far past the mobile viewport so vertical touch-scroll has somewhere to go.`
).join("\n\n");

function longBoard(): Board {
  const now = Date.now();
  const tickets: Ticket[] = [
    {
      id: "900",
      subject: "LONG ticket — drawer scroll repro",
      description: LONG,
      column: "in_progress",
      status: "in_progress",
      blockedBy: [],
      comments: ["planner", "plan-review", "executor", "execution-review"].map((role, i) => ({
        role: role as Ticket["comments"][number]["role"],
        ts: new Date(now - 60000 + i * 1000).toISOString(),
        agentId: `agent-${i}`,
        artifact: `${role}-artifact-with-a-longish-path.md`,
        ...(role.endsWith("review") ? { verdict: "APPROVE" } : {}),
      })),
      updatedAt: now,
      sessionId: "sess0001",
    },
    { id: "701", subject: "Context ticket 701 in todo", description: "", column: "todo", status: "pending", blockedBy: [], comments: [], updatedAt: now - 1800000, sessionId: "sess0001" },
  ];
  return {
    schema: 1, generatedAt: now, sessionId: "sess0001",
    sessions: [{ id: "sess0001", label: `active just now · ${tickets.length} tickets`, lastActive: now, ticketCount: tickets.length, live: true }],
    tickets,
  };
}

test("drawer body scrolls under trusted touch (chromium mobile + CDP)", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);

  await page.route("**/api/board", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(longBoard()) });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.getByText("LONG ticket", { exact: false }).first().waitFor({ timeout: 15000 });

  await page.locator(".ak-cardbtn", { hasText: "LONG ticket" }).first().click();
  await page.waitForSelector(".ak-drawer", { timeout: 8000 });
  await page.waitForTimeout(500);

  // Instrument: capture-phase touchmove listener records defaultPrevented + count.
  await page.evaluate(() => {
    (window as unknown as { __tm: { n: number; prevented: number } }).__tm = { n: 0, prevented: 0 };
    document.addEventListener("touchmove", (e) => {
      const w = window as unknown as { __tm: { n: number; prevented: number } };
      w.__tm.n++;
      // read after other listeners run: schedule microtask check
      queueMicrotask(() => { if (e.defaultPrevented) w.__tm.prevented++; });
    }, { capture: true, passive: true });
  });

  // PRECONDITION — the body must actually overflow, else the swipe proves nothing.
  const dims = await page.locator(".ak-drawer__body").evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(dims.scrollHeight).toBeGreaterThan(dims.clientHeight);

  const before = await page.locator(".ak-drawer__body").evaluate((el) => el.scrollTop);
  const box = await page.locator(".ak-drawer__body").boundingBox();
  if (!box) throw new Error("no body box");
  const cx = box.x + box.width / 2;
  const y0 = box.y + box.height * 0.82;
  const y1 = box.y + box.height * 0.18;

  // Trusted CDP touch swipe UP (finger drags content up → scrollTop increases).
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: y0 }] });
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y }] });
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(600); // let momentum settle

  const after = await page.locator(".ak-drawer__body").evaluate((el) => el.scrollTop);
  const tm = await page.evaluate(() => (window as unknown as { __tm: { n: number; prevented: number } }).__tm);

  console.log("\n===== TRUSTED TOUCH SWIPE (chromium mobile) =====");
  console.log(JSON.stringify({ before, after, delta: after - before, overflow: dims, touchmoveEvents: tm }, null, 2));

  // ASSERTIONS — the scroll mechanism works under trusted touch.
  expect(after - before).toBeGreaterThan(100); // scrollTop advanced > 100px
  expect(tm.prevented).toBe(0);                // nothing blocked the touch scroll

  // Rule-19 evidence: JS-scroll to the end and capture the scrolled-to-bottom body.
  await page.locator(".ak-drawer__body").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(150);
  await page.screenshot({ path: "test-results/1447-drawer-scrolled-bottom.png" });

  await browser.close();
});
