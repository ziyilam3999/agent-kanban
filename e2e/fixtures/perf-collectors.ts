// perf-collectors.ts — shared PerformanceObserver collector installer for the
// board-render-perf-inp perf specs. Extracted from the proven pattern in
// e2e/fold8-inp-under-poll.e2e.spec.ts (task agent-kanban-fold8-4x3-bugfix) so
// every new perf spec in THIS task drives the identical measurement machinery
// rather than a divergent hand-rolled copy per file.

import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __akLongtasks?: Array<{ start: number; duration: number }>;
    __akEvents?: Array<{ name: string; start: number; duration: number; inputDelay: number }>;
  }
}

export function installPerfCollectors(page: Page) {
  return page.addInitScript(() => {
    window.__akLongtasks = [];
    window.__akEvents = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__akLongtasks!.push({ start: e.startTime, duration: e.duration });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* longtask not supported — leave empty, the assertion is then vacuous-true (documented) */
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEventTiming;
          window.__akEvents!.push({
            name: e.name,
            start: e.startTime,
            duration: e.duration,
            inputDelay: e.processingStart - e.startTime,
          });
        }
      }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    } catch {
      /* event timing not supported */
    }
  });
}

export async function readLongtasks(page: Page) {
  return page.evaluate(() => window.__akLongtasks ?? []);
}

export async function readEvents(page: Page) {
  return page.evaluate(() => window.__akEvents ?? []);
}

// Clears the collected 'event' entries. Used to scope a read to exactly one
// interaction window WITHOUT any Node/page clock correlation: correlating
// Node's Date.now() to the page's performance.now() drifts once CDP CPU
// throttling is active (measured live on this rig, Rule 18 — a ~590ms
// drift was observed at 8x throttle between a one-time origin correlation
// and the browser's own event timestamps, enough to make a timestamp-window
// filter miss the very block it was trying to catch). Reset-then-read
// sidesteps clock correlation entirely: whatever lands in the buffer
// between a reset and the next read is, by construction, this window's
// activity.
export async function resetEvents(page: Page) {
  await page.evaluate(() => {
    window.__akEvents = [];
  });
}

export async function resetLongtasks(page: Page) {
  await page.evaluate(() => {
    window.__akLongtasks = [];
  });
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
