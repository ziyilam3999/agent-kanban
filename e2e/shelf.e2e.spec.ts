// shelf.e2e.spec.ts — Playwright DOM/behavioural acceptance for board-noise
// triage S1 DISPLAY (task-kind-contract.md §4 D1-D2-D3), AC-1.4 + AC-1.5.
//
// Runs the REAL exporter (scripts/export-board.ts) against the shared S0
// fixture store (__tests__/fixtures/task-kind-store/, byte-identical lockstep
// copy of ai-brain's tests/fixtures/task-kind-store/ — AC-1.1) so this spec is
// tied to the actual export → build → render pipeline, not a hand-typed board
// object that could silently drift from what the exporter really produces.
// The board is fed to the running app via /api/board route interception (the
// same pattern as e2e/lane-reveal.e2e.spec.ts) — the real Vercel Blob is never
// touched.
//
// AC-1.4 (desktop, default viewport): sum of the four `.ak-col__count` values
// equals the number of `kind == "work"` fixture tickets; `details.ak-shelf`
// exists and is CLOSED on load; its summary matches
// `/Bookkeeping \d+ · Parked \d+ · Deferred \d+/`; the header matches
// `/\d+ ACTIVE · \d+ ON SHELF/`.
//
// AC-1.5 (390x844, hasTouch:true): tapping the shelf summary opens it — the
// shelf body's scrollHeight goes 0 -> >0 — while the four column counts stay
// unchanged. This is the REAL-interaction leg (Rule 19 / UI-task gate leg 3):
// it FAILS on the pre-fix commit 2de175457bf9ef5385b5aebb27f7e46a588d1852 (no
// `.ak-shelf` exists at all — every assertion below throws a locator-not-found
// error), which is exactly the point of a real interaction oracle: a
// screenshot-at-rest or a computed-style check cannot prove a collapsed
// element genuinely expands under a real tap.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import type { Board } from "../lib/board-schema";

const REPO_ROOT = path.join(__dirname, "..");
const FIXTURE_DIR = path.join(REPO_ROOT, "__tests__", "fixtures", "task-kind-store");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

/**
 * Run the REAL exporter against the shared S0 fixture store and return the
 * parsed Board. Writes to a scratch temp file (never data/board.json — that
 * path stays reserved for the real production export) and cleans it up.
 */
function exportFixtureBoard(): Board {
  const outFile = path.join(
    os.tmpdir(),
    `shelf-e2e-board-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  execFileSync(TSX_BIN, ["scripts/export-board.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TASKS_DIR: FIXTURE_DIR,
      OUT: outFile,
    },
    stdio: "pipe",
  });
  const board: Board = JSON.parse(fs.readFileSync(outFile, "utf8"));
  fs.rmSync(outFile, { force: true });
  return board;
}

/** Expected AC-1.4 counts, derived from the SAME exported board (never hand-counted). */
function deriveExpectations(board: Board) {
  const workCount = board.tickets.filter((t) => t.kind === "work").length;
  const openBookkeeping = board.tickets.filter(
    (t) => t.status !== "completed" && t.kind === "bookkeeping"
  ).length;
  const openParked = board.tickets.filter(
    (t) => t.status !== "completed" && t.kind === "parked"
  ).length;
  const openDeferred = board.tickets.filter(
    (t) => t.status !== "completed" && t.kind === "deferred"
  ).length;
  const activeWork = board.tickets.filter(
    (t) => t.status !== "completed" && t.kind === "work"
  ).length;
  const onShelf = openBookkeeping + openParked + openDeferred;
  return { workCount, openBookkeeping, openParked, openDeferred, activeWork, onShelf };
}

async function loadFixtureBoard(page: Page, board: Board): Promise<void> {
  await page.route("**/api/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(board),
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // Sanity: the fixture's plain work ticket 9001 is on the board somewhere.
  await page.getByText("Wire the new metrics exporter", { exact: false }).first().waitFor({
    timeout: 15_000,
  });
}

async function columnCountSum(page: Page): Promise<number> {
  const texts = await page.locator(".ak-col__count").allTextContents();
  expect(texts.length).toBe(4);
  return texts.reduce((sum, t) => sum + parseInt(t, 10), 0);
}

test.describe("board-noise triage S1 DISPLAY — shelf (AC-1.4)", () => {
  test("desktop: columns show only work, shelf is closed, summary + header match", async ({
    page,
  }) => {
    const board = exportFixtureBoard();
    const exp = deriveExpectations(board);
    // Sanity floor on the fixture itself — never a vacuous pass.
    expect(exp.workCount).toBeGreaterThan(0);
    expect(exp.onShelf).toBeGreaterThan(0);

    await loadFixtureBoard(page, board);

    // Sum of the four .ak-col__count values == count of kind=="work" fixtures.
    const sum = await columnCountSum(page);
    expect(sum).toBe(exp.workCount);

    // The shelf exists and is CLOSED on load.
    const shelf = page.locator("details.ak-shelf");
    await expect(shelf).toHaveCount(1);
    await expect(shelf).not.toHaveAttribute("open", "");

    // Summary matches the required format AND the exact derived counts.
    const summaryText = await page.locator(".ak-shelf__summary").innerText();
    expect(summaryText).toMatch(/Bookkeeping \d+ · Parked \d+ · Deferred \d+/);
    expect(summaryText).toContain(`Bookkeeping ${exp.openBookkeeping}`);
    expect(summaryText).toContain(`Parked ${exp.openParked}`);
    expect(summaryText).toContain(`Deferred ${exp.openDeferred}`);

    // Header pill matches the required format AND the exact derived counts.
    const headerText = await page.locator(".ak-shelfcount").innerText();
    expect(headerText).toMatch(/\d+ ACTIVE · \d+ ON SHELF/);
    expect(headerText).toContain(`${exp.activeWork} ACTIVE`);
    expect(headerText).toContain(`${exp.onShelf} ON SHELF`);

    // No horizontal overflow introduced (telemetry-console rule).
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});

test.describe("board-noise triage S1 DISPLAY — shelf real-interaction (AC-1.5)", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("mobile touch tap: shelf body scrollHeight goes 0 -> >0, column counts unchanged", async ({
    page,
  }) => {
    const board = exportFixtureBoard();
    await loadFixtureBoard(page, board);

    const beforeSum = await columnCountSum(page);

    const shelf = page.locator("details.ak-shelf");
    await expect(shelf).not.toHaveAttribute("open", "");

    const bodyBefore = await page.locator(".ak-shelf__body").evaluate((el) => el.scrollHeight);
    expect(bodyBefore).toBe(0);

    // REAL touch tap (hasTouch:true context) — not a synthetic .click().
    await page.locator(".ak-shelf__summary").tap();

    await expect(shelf).toHaveAttribute("open", "");
    await expect
      .poll(() => page.locator(".ak-shelf__body").evaluate((el) => el.scrollHeight))
      .toBeGreaterThan(0);

    const afterSum = await columnCountSum(page);
    expect(afterSum).toBe(beforeSum);
  });
});
