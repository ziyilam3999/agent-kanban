// board-render-perf-inp.e2e.spec.ts — AC-2 (headline) for task
// agent-kanban-board-render-perf-inp. Plan:
// .ai-workspace/plans/2026-08-26-board-render-perf-inp.md
//
// Loads a >=1,200-ticket synthetic fixture board (one session — r3), applies
// >=4x CDP CPU throttle (r2: this file must be run against a PRODUCTION build
// — `next build && next start` — dev-mode React inflates the numbers), then
// on FIVE separate poll ticks delivers a GENUINELY CHANGED payload (a handful
// of tickets get a fresh `updatedAt`, forcing a real re-sort + re-render, not
// a no-op) and dispatches a REAL touch tap timed to contend with that tick's
// processing. Median interaction duration (PerformanceObserver('event')) over
// the 5 taps must be <= 200ms (AC-2).
//
// AC-3's power-check + branch/baseline comparison is NOT this file's job —
// this file only needs to independently PASS when run against the branch and
// (per AC-3(i)) FAIL when run, unmodified, against the merge-base build. The
// evidence file (.ai-workspace/reviews/2026-08-26-board-render-perf-inp-evidence.md)
// records BOTH runs' numbers, captured by running this exact spec twice
// (PW_BASE_URL pointed at each build) — see that file's own header for the
// exact commands used.

import { test, expect, type Page } from "@playwright/test";
import { buildBoard } from "./fixtures/board-fixture";
import { installPerfCollectors, readEvents, resetEvents, median } from "./fixtures/perf-collectors";
import type { Board } from "../lib/board-schema";

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });

// r4: "a fixed CPU throttle" across this task's own perf rig (this file,
// board-render-perf-unchanged-tick.e2e.spec.ts). NOT copied from
// e2e/fold8-inp-under-poll.e2e.spec.ts's 4x — that spec exercises a SMALLER
// fixture + a single tap-triggered re-render, not a 1,200-ticket poll-driven
// changed tick; measured live on this rig (Rule 18): at 4x, a changed tick's
// merge+render longtask is only ~115-124ms on this hardware — insufficient
// to push a contending tap past AC-3(i)'s 200ms power-check floor even on
// the UNWINDOWED merge-base build. Raised to 8x, the same changed-tick
// longtask measures ~239-242ms, clearing the floor. See the evidence file's
// "power check" section for the measured baseline numbers this justifies.
const CPU_THROTTLE_RATE = 8;
const POLL_MS = 5000; // components/BoardView.tsx POLL_MS — scheduling only.
// r3: synthetic + deterministic, one session, >=1,200 tickets, built by the
// already-committed e2e fixture generator (never a copy of live board.json;
// never on the publish path — this file only exists under e2e/).
const BIG_PAYLOAD = { count: 1200, descriptionBytes: 4_900 };
const INTERACTIONS = 5; // AC-2/AC-3's "median over >=5 such interactions"

/** A GENUINELY changed variant of `base`: a small, disjoint slice of tickets gets a fresh `updatedAt` each call (real content change, not a no-op — moves those tickets to the top of their column on re-sort). */
function mutateFixture(base: Board, seed: number): Board {
  const tickets = base.tickets.map((t) => ({ ...t }));
  const start = (seed * 3) % tickets.length;
  for (let i = start; i < start + 3 && i < tickets.length; i++) {
    tickets[i] = { ...tickets[i], updatedAt: Date.now() };
  }
  return { ...base, generatedAt: Date.now(), tickets };
}

// Returns the Node-side wall-clock (`Date.now()`, same clock the test uses)
// at which each `/api/board` request LANDED — populated synchronously inside
// the route handler, before the (possibly throttled-client-side) response is
// even parsed. `callTimes[0]` is the forced initial poll (visibilitychange);
// `callTimes[i]` for i>=1 are the natural `setInterval(poll, POLL_MS)` ticks.
// Predicting those from `navStart` assumes ticks fire at a fixed offset from
// navigation start, but mount (and therefore the interval's first fire) is
// itself delayed by ~500-600ms of client JS/hydration under throttle —
// anchoring on the OBSERVED first call instead sidesteps that assumption
// entirely (Rule 18: measured, not assumed).
async function setupRoute(page: Page): Promise<number[]> {
  const base = buildBoard({ liveLanes: 0, live: true, bigPayload: BIG_PAYLOAD });
  let call = 0;
  const callTimes: number[] = [];
  await page.route("**/api/board", async (route) => {
    const seed = call;
    call += 1;
    callTimes.push(Date.now());
    const b = seed === 0 ? base : mutateFixture(base, seed);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: `"etag-${seed}"` },
      body: JSON.stringify(b),
    });
  });
  return callTimes;
}

test.describe("AC-2 — tap during a CHANGED tick stays fast (headline)", () => {
  for (const vp of [
    { width: 750, height: 1000 },
    { width: 1000, height: 750 },
  ]) {
    test(`${vp.width}x${vp.height}: median interaction duration <= 200ms across ${INTERACTIONS} changed-tick contentions`, async ({
      page,
    }) => {
      await installPerfCollectors(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const callTimes = await setupRoute(page);

      const client = await page.context().newCDPSession(page);
      await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE_RATE });

      await page.goto("/", { waitUntil: "networkidle" });
      // Force the first poll immediately (mirrors the AC-5(iii) visibility
      // behavior) so the initial fixture lands without waiting a full
      // POLL_MS — the natural setInterval ticks (each a CHANGED payload)
      // then land at roughly n*POLL_MS after THIS first call, independent
      // of navigation start (see setupRoute's comment).
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(page.locator(".ak-cardbtn").first()).toBeVisible({ timeout: 20_000 });

      // callTimes[0] is guaranteed populated here: the first card can only
      // be visible after its poll response was fetched, parsed and
      // rendered, which happens strictly after the route handler recorded
      // this call's timestamp.
      const firstCallAt = callTimes[0];

      async function untilMs(targetMs: number) {
        const delta = targetMs - Date.now();
        if (delta > 0) await page.waitForTimeout(delta);
      }

      const touchClient = await page.context().newCDPSession(page);
      const perInteractionDurations: number[] = [];

      for (let i = 1; i <= INTERACTIONS; i++) {
        // Resolve the target card's bounding box EARLY, well before tick
        // i's predicted fire — never inside the timing-critical window.
        // Locator.boundingBox() requires the renderer's JS thread to be
        // free to execute, so calling it late would silently ABSORB the
        // wait until the very longtask we're trying to contend with
        // finishes, landing the tap strictly AFTER the block ends.
        const card = page.locator(".ak-cardbtn").nth(i % 5);
        const box = await card.boundingBox();

        // Scope this interaction's captured events to exactly this window
        // by clearing the buffer NOW (main thread still idle, well before
        // the tick fires) and reading it fresh after dispatching — this
        // sidesteps Node/page clock correlation entirely. Rule 18 finding:
        // a one-time Node-Date.now()-to-page-performance.now() correlation
        // drifted by ~590ms once 8x CDP CPU throttling was active, enough
        // for a timestamp-window filter to miss the very block event it was
        // trying to catch (measured live: the real click event's
        // performance.now() landed ~590ms earlier than the correlated
        // "now" computed right before dispatch).
        await resetEvents(page);

        // Dispatch 80ms AFTER tick i's predicted fire time (firstCallAt +
        // i*POLL_MS), not before it. Measured live on this rig (Rule 18,
        // via PerformanceObserver('event').duration rather than raw
        // longtask duration — an 'event' entry's duration only reflects
        // the REMAINING portion of whatever task is already running when
        // the input is queued, plus this event's own processing/paint, not
        // the whole task): the changed-tick's merge+render longtask starts
        // roughly ~40-140ms after the fetch call lands. +200 (landing deep
        // inside the task, little of it left to wait through) measured
        // median ~136ms — UNDER the 200ms floor even on the unfixed
        // merge-base build, failing AC-3(i)'s power check. +80 (landing
        // closer to the task's start, so more of it remains to contend
        // with) measured median 216ms on the same unfixed build — clears
        // the floor. See the evidence file for both sweep points' raw
        // numbers.
        await untilMs(firstCallAt + POLL_MS * i + 80);

        if (box) {
          // Input.dispatchTouchEvent is a CDP Input-domain call: it injects
          // synthetic input directly into the browser's input queue, the
          // same way a real OS-level touch event arrives — it does NOT
          // require the JS main thread to be free to be ACCEPTED, so this
          // (unlike evaluate()/boundingBox() above) genuinely lands at the
          // intended instant even while a longtask is running.
          await touchClient.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
          });
          await touchClient.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        }
        await page.waitForTimeout(700);

        const events = await readEvents(page);
        const worst = events.reduce((m, e) => Math.max(m, e.duration), 0);
        perInteractionDurations.push(worst);

        // Close whatever drawer opened, so the NEXT tap lands on a real
        // on-screen card again — this click happens well OUTSIDE the
        // measurement window above, so it never contaminates the sample.
        const closeBtn = page.locator(".ak-drawer button").first();
        if (await closeBtn.count()) {
          await closeBtn.click({ force: true }).catch(() => {});
        }
        await page.waitForTimeout(150);
      }

      await touchClient.detach().catch(() => {});

      const med = median(perInteractionDurations);

      test.info().annotations.push({
        type: "ac2-evidence",
        description: JSON.stringify({
          viewport: vp,
          throttle: CPU_THROTTLE_RATE,
          ticketCount: BIG_PAYLOAD.count,
          durations: perInteractionDurations,
          median: med,
        }),
      });
      // eslint-disable-next-line no-console
      console.log(
        `AC2_EVIDENCE ${JSON.stringify({ viewport: vp, median: med, durations: perInteractionDurations })}`,
      );

      expect(perInteractionDurations.length).toBe(INTERACTIONS);
      expect(med).toBeLessThanOrEqual(200);
    });
  }
});
