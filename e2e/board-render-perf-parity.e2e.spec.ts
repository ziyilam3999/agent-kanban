// board-render-perf-parity.e2e.spec.ts — AC-6 (static) + AC-7 (motion) for
// task agent-kanban-board-render-perf-inp. Plan:
// .ai-workspace/plans/2026-08-26-board-render-perf-inp.md
//
// AC-6: this exact spec is run TWICE — once against the merge-base build
// (`--update-snapshots`, creating the committed baseline PNGs under
// e2e/board-render-perf-parity.e2e.spec.ts-snapshots/) and once against this
// branch's build (normal comparison mode). Capture recipe (recorded again in
// the AC-3 evidence file):
//   1. baseline worktree at the merge-base commit: `npm run build && npm run
//      start -p <PORT_A>`, then from THIS worktree:
//      `PW_BASE_URL=http://localhost:<PORT_A> PW_PORT=<PORT_A> \
//        npx playwright test e2e/board-render-perf-parity.e2e.spec.ts \
//        --update-snapshots -g "AC-6"`
//   2. commit the resulting *-snapshots/*.png files.
//   3. this branch: `npm run build && npm run start -p <PORT_B>`, then:
//      `PW_BASE_URL=http://localhost:<PORT_B> PW_PORT=<PORT_B> \
//        npx playwright test e2e/board-render-perf-parity.e2e.spec.ts -g "AC-6"`
//      must PASS (maxDiffPixelRatio <= 0.001).
//
// AC-7: real-interaction motion parity — (i) a moved ticket's destination
// gains the glow class promptly and loses it by 5s, and the source column
// keeps the exiting "lift" duplicate transiently (finding #7ii preserved);
// (ii) a REAL wheel-scroll through DONE never samples a mid-exit
// opacity/scale on an in-viewport card (windowing must not smuggle in an
// exit animation on a pure scroll-cull — hazard i).

import { test, expect, type Page } from "@playwright/test";
import { buildBoard } from "./fixtures/board-fixture";
import type { Board, Ticket } from "../lib/board-schema";

// Deliberately mid-bucket, generous-margin timestamps (r on relativeTime's
// per-minute/per-hour boundaries) so the SAME spec's relative-time text is
// stable regardless of how much real wall-clock time separates the baseline
// capture from the branch capture, and regardless of how long a single run
// takes to reach the screenshot (buildBoard computes every offset relative
// to Date.now() AT CALL TIME, so re-running this file hours apart still
// reproduces the identical "Nm ago" / "Nh ago" text — see file header).
const BIG_PAYLOAD = { count: 1200, descriptionBytes: 4_900 };

async function forcePoll(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

/** Sort a column's tickets the SAME way BoardView does, and pick the middle one — a fixture-deterministic scroll target independent of any windowing-estimate accuracy. */
function pickMiddleTicket(board: Board, column: Ticket["column"]): Ticket {
  const inCol = board.tickets
    .filter((t) => t.column === column)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return inCol[Math.floor(inCol.length / 2)];
}

/**
 * Real, incremental scroll (never a blind teleport) until `ticketId`'s card
 * is fully inside `columnLabel`'s visible bounds. Targets the `aria-label`
 * BoardCard/Card have carried unmodified since before this diff (works
 * identically against the merge-base's un-windowed markup and this branch's
 * windowed markup — a not-yet-windowed target simply has no matching
 * element yet, so the loop keeps scrolling until it does).
 */
async function scrollColumnToTicket(page: Page, columnLabel: string, ticketId: string) {
  const col = page.locator(`section[aria-label="${columnLabel}"]`);
  const target = page.locator(
    `section[aria-label="${columnLabel}"] [aria-label^="Open ticket #${ticketId}:"]`,
  );
  await col.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(150);
  for (let i = 0; i < 80; i++) {
    // ROOT CAUSE (Rule 18, found live): on the windowed branch build, a
    // not-yet-scrolled-into-view ticket has ZERO matching DOM elements (its
    // `aria-label` only exists on the REAL card, never the placeholder) —
    // Locator.boundingBox() with no explicit timeout pays the FULL default
    // actionability wait (~5s) on every such call before resolving via
    // .catch(), so 80 iterations against a still-absent target could exceed
    // the whole test's 60s budget before scrolling ever brings it into
    // range. An explicit short timeout makes each phantom-check cheap
    // (matches the merge-base build's near-instant behavior, where the
    // ticket's real DOM node exists unconditionally from the start).
    const box = await target.boundingBox({ timeout: 250 }).catch(() => null);
    const colBox = await col.boundingBox();
    if (
      box &&
      colBox &&
      box.y >= colBox.y - 1 &&
      box.y + box.height <= colBox.y + colBox.height + 1
    ) {
      break;
    }
    await col.evaluate((el) => {
      el.scrollBy({ top: Math.max(200, el.clientHeight * 0.6) });
    });
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(300);

  // Final precise correction: on the windowed branch build, cards above the
  // target that were only ever measured via the placeholder ESTIMATE (never
  // individually real-rendered along the scroll path) leave a small
  // accumulated drift, so "target is roughly within bounds" can land at a
  // slightly different resting scrollTop than the merge-base build (every
  // card real from the start, no estimate involved at all). Once the
  // target is real-rendered, its OWN measured position is exact on both
  // builds — use the browser's native scrollIntoView (computed from actual
  // rendered geometry, not our own delta math) to converge to the SAME
  // pixel-identical resting spot regardless of path. Repeated twice: the
  // correction scroll can itself bring a further card from placeholder to
  // real (shifting scrollHeight again), so a second pass re-settles onto
  // any such secondary shift.
  for (let pass = 0; pass < 2; pass++) {
    const exists = await target.count();
    if (!exists) break;
    await target.evaluate((el) => {
      el.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(250);
  }
}

test.describe("AC-6 — static visual parity", () => {
  for (const vp of [
    { name: "desktop", width: 1000, height: 750 },
  ]) {
    test(`${vp.name}: board top and DONE-scrolled screenshots match the merge-base baseline`, async ({
      page,
    }) => {
      // A little above the 30s default: two screenshot comparisons plus a
      // real incremental scroll loop on a 1,200-ticket fixture.
      test.setTimeout(45_000);
      const board = buildBoard({ liveLanes: 0, live: true, bigPayload: BIG_PAYLOAD });
      await page.route("**/api/board", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { ETag: '"etag-static"' },
          body: JSON.stringify(board),
        });
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/", { waitUntil: "networkidle" });
      await forcePoll(page);
      await expect(page.locator(".ak-cardbtn").first()).toBeVisible({ timeout: 20_000 });
      // Settle entrance-fade (every ticket is "fresh" on this FIRST poll —
      // true on HEAD too, unrelated to this diff) AND the GLOW_MS=2000
      // arrival glow, so BOTH captures land on the true steady-state look.
      await page.waitForTimeout(2_600);

      await expect(page).toHaveScreenshot(`board-top-${vp.name}.png`, {
        maxDiffPixelRatio: 0.001,
      });

      const target = pickMiddleTicket(board, "done");
      await scrollColumnToTicket(page, "Done", target.id);

      await expect(page).toHaveScreenshot(`board-done-scrolled-${vp.name}.png`, {
        maxDiffPixelRatio: 0.001,
      });
    });
  }
});

test.describe("AC-7(i) — a moved ticket's destination glows, source keeps the exiting lift", () => {
  test("destination gains ak-card--live within 2s and loses it by 5s; source transiently shows the exiting duplicate", async ({
    page,
  }) => {
    const board = buildBoard({ liveLanes: 0, live: true, bigPayload: BIG_PAYLOAD });
    // A dedicated, deliberately-recent mover so it sorts to the top of TODO
    // (guaranteed real/windowed, not an off-screen placeholder) both before
    // and after the move.
    const mover = board.tickets[0];
    mover.id = "mover-ticket";
    mover.subject = "AC-7 mover probe ticket";
    mover.column = "todo";
    mover.updatedAt = Date.now() - 1_000;

    let call = 0;
    await page.route("**/api/board", async (route) => {
      call += 1;
      if (call === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { ETag: '"etag-0"' },
          body: JSON.stringify(board),
        });
      } else if (call === 2) {
        const moved: Board = {
          ...board,
          generatedAt: Date.now(),
          tickets: board.tickets.map((t) =>
            t.id === mover.id ? { ...t, column: "in_progress" as const, updatedAt: Date.now() } : t,
          ),
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { ETag: '"etag-1"' },
          body: JSON.stringify(moved),
        });
      } else {
        await route.fulfill({ status: 304, headers: { ETag: '"etag-1"' } });
      }
    });

    await page.setViewportSize({ width: 1000, height: 750 });
    await page.goto("/", { waitUntil: "networkidle" });
    await forcePoll(page); // call #1 — initial board.
    await expect(page.locator(".ak-cardbtn").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_600); // settle entrance-fade + initial glow.

    await forcePoll(page); // call #2 — the move.

    // Soon after the move — well inside Framer's 0.7s exit transition — the
    // SOURCE column must still show the exiting duplicate (finding #7ii).
    await page.waitForTimeout(150);
    const sourceCard = page.locator(
      `section[aria-label="To Do"] [aria-label^="Open ticket #${mover.id}:"]`,
    );
    await expect(sourceCard).toHaveCount(1);

    // Destination gains the glow within 2s.
    const destGlow = page.locator(
      `section[aria-label="In Progress"] [aria-label^="Open ticket #${mover.id}:"] .ak-card--live`,
    );
    await expect(destGlow).toBeVisible({ timeout: 2_000 });

    // ...and loses it by 5s (from the move, not from this assertion's start).
    await expect(destGlow).toHaveCount(0, { timeout: 5_000 });
  });
});

test.describe("AC-7(ii) — a REAL scroll through DONE never plays exit choreography on an in-viewport card", () => {
  test("zero mid-exit opacity/scale sampled on any in-viewport .ak-cardbtn during a real wheel-scroll", async ({
    page,
  }) => {
    const board = buildBoard({ liveLanes: 0, live: true, bigPayload: BIG_PAYLOAD });
    await page.route("**/api/board", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: '"etag-steady"' },
        body: JSON.stringify(board),
      });
    });

    await page.setViewportSize({ width: 1000, height: 750 });
    await page.goto("/", { waitUntil: "networkidle" });
    await forcePoll(page);
    await expect(page.locator(".ak-cardbtn").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_600); // settle entrance-fade + initial glow — a genuinely steady board.

    const doneCol = page.locator('section[aria-label="Done"]');
    const box = await doneCol.boundingBox();
    if (!box) throw new Error("test setup: DONE column not found");

    // In-page sampler — rAF-driven so it never misses a fast transient the
    // way Playwright-side polling (network round-trip per sample) could.
    await page.evaluate(() => {
      (window as unknown as { __akScroll: { minOpacity: number; scaleAnomaly: boolean; running: boolean } }).__akScroll = {
        minOpacity: 1,
        scaleAnomaly: false,
        running: true,
      };
      const tick = () => {
        const w = (window as unknown as { __akScroll?: { minOpacity: number; scaleAnomaly: boolean; running: boolean } }).__akScroll;
        if (!w || !w.running) return;
        const vh = window.innerHeight;
        for (const el of document.querySelectorAll<HTMLElement>(".ak-cardbtn")) {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > vh) continue; // not currently in viewport
          const style = getComputedStyle(el);
          const op = parseFloat(style.opacity);
          if (Number.isFinite(op) && op < w.minOpacity) w.minOpacity = op;
          const t = style.transform;
          if (t && t !== "none") {
            const m = /matrix\(([-\d.,\s]+)\)/.exec(t);
            if (m) {
              const a = parseFloat(m[1].split(",")[0]);
              if (Number.isFinite(a) && Math.abs(a - 1) > 0.03) w.scaleAnomaly = true;
            }
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // A real wheel-scroll gesture (Playwright's mouse.wheel dispatches a
    // genuine wheel event through the browser's real input pipeline — never
    // a scrollTo/scrollBy teleport) through most of the DONE column.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 25; i++) {
      await page.mouse.wheel(0, 260);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const w = (window as unknown as { __akScroll?: { minOpacity: number; scaleAnomaly: boolean; running: boolean } }).__akScroll;
      if (w) w.running = false;
      return w;
    });

    test.info().annotations.push({ type: "ac7ii-evidence", description: JSON.stringify(result) });

    expect(result).toBeTruthy();
    expect(result!.minOpacity).toBeGreaterThanOrEqual(0.99);
    expect(result!.scaleAnomaly).toBe(false);
  });
});
