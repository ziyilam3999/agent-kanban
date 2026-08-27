/**
 * @jest-environment jsdom
 */
// board-poll-conditional.test.ts — fold8-poll-metered-payload-diet AC 5 + AC 6.
//
// AC 5: the client poll (a) presents the last-seen ETag as `If-None-Match` on every
// poll AFTER the first successful fetch, (b) sends ZERO /api/board fetches while the
// document is hidden, (c) fires a fetch immediately on visibilitychange -> visible.
//
// AC 6: a `200(v1) -> 304 -> 200(v2)` sequence is a true no-op on the 304 tick — board
// data is unreset, UI-interaction state survives (NRN-2), the `now` clock keeps
// advancing so idle heartbeats/relative-time don't stall (NRN-1) — and the v2 change
// still lands on the very next poll.
//
// Same DOM-plumbing pattern as __tests__/lane-reveal.test.ts (per-file jsdom docblock;
// the global jest.config.js testEnvironment stays "node"; every other *.test.ts is
// untouched). This file does NOT re-use lane-reveal's fixture builders (a different
// board shape is more legible for the column-placement + relative-time assertions
// below) but follows the same mount/tick/act idiom.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { hasReducedMotionListener, prefersReducedMotion } from "motion-dom";
import { BoardView } from "@/components/BoardView";
import type { Board, Ticket } from "@/lib/board-schema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// BoardView's own private poll interval — mirrored here (jsdom test can't import a
// non-exported constant). See components/BoardView.tsx's `POLL_MS`.
const POLL_MS = 5000;

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

// ---------------------------------------------------------------- fixtures --

const SESSION_ID = "sess0001"; // 8 chars — equals both board.sessionId and session.id.

function ticket(id: string, column: Ticket["column"], updatedAt: number): Ticket {
  return {
    id,
    subject: `synthetic ticket ${id}`,
    description: "",
    column,
    status: column === "done" ? "completed" : "in_progress",
    blockedBy: [],
    comments: [],
    updatedAt,
    sessionId: SESSION_ID,
  };
}

function board(tickets: Ticket[], generatedAt: number): Board {
  return {
    schema: 1,
    generatedAt,
    sessionId: SESSION_ID,
    sessions: [
      {
        id: SESSION_ID,
        label: "synthetic session",
        lastActive: generatedAt,
        ticketCount: tickets.length,
        live: true,
      },
    ],
    tickets,
  };
}

// ------------------------------------------------------------- DOM plumbing --

let container: HTMLDivElement;
let root: Root | null;

function setupMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

/** Reset document.hidden/visibilityState to the jsdom default (visible). */
function setDocumentVisible(visible: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => !visible,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
}

beforeEach(() => {
  hasReducedMotionListener.current = false;
  prefersReducedMotion.current = null;
  setupMatchMedia();
  setDocumentVisible(true);

  container = document.createElement("div");
  document.body.appendChild(container);

  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {};
  }
  jest.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});

  jest.useFakeTimers({
    doNotFake: ["requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask"],
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  container.remove();
  setDocumentVisible(true);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function renderBoard(initial: Board): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root!.render(createElement(BoardView, { initial }));
  });
}

/** Advance past one POLL_MS tick, flushing the fetch + resulting state update. */
async function tick(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(POLL_MS);
  });
}

/** Fire an out-of-schedule poll via visibilitychange (no timer advance — lets a
 *  test observe state WHILE a just-set glow/timer is still mid-flight, unlike
 *  tick() which always crosses a full 5s and would let GLOW_MS=2s expire first). */
async function fireVisible(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await jest.advanceTimersByTimeAsync(0);
  });
}

async function clickCard(id: string): Promise<void> {
  const btn = container.querySelector<HTMLButtonElement>(
    `[aria-label^="Open ticket #${id}:"]`
  );
  if (!btn) throw new Error(`test setup: no card button found for #${id}`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// ---------------------------------------------------------- fetch mocking ---

interface MockResp {
  status?: number; // default 200
  etag?: string;
  body?: Board;
}

/** Queue a sequence of /api/board responses; the LAST entry repeats for any poll
 *  beyond the sequence length. Mirrors the real fetch Response surface BoardView's
 *  poll actually reads: `.status`, `.headers.get("ETag")`, `.text()`. */
function mockFetchSequence(responses: MockResp[]): jest.Mock {
  let i = 0;
  const fetchMock = jest.fn().mockImplementation(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "etag" ? r.etag ?? null : null,
      },
      text: async () => (status === 304 ? "" : JSON.stringify(r.body)),
      json: async () => r.body,
    } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** The `If-None-Match` header value BoardView sent on fetch call #`i` (0-indexed). */
function ifNoneMatchOnCall(fetchMock: jest.Mock, i: number): string | undefined {
  const init = fetchMock.mock.calls[i]?.[1] as { headers?: Record<string, string> };
  return init?.headers?.["If-None-Match"];
}

// ============================================================== AC 5 ========

describe("fold8-poll-metered-payload-diet AC 5 — conditional-request + visibility", () => {
  it("(i) sends If-None-Match with the last-seen ETag on polls AFTER the first successful fetch", async () => {
    await renderBoard(board([ticket("t1", "todo", 1)], 1));

    const fetchMock = mockFetchSequence([
      { etag: '"etag-1"', body: board([ticket("t1", "todo", 1)], 1) },
      { etag: '"etag-2"', body: board([ticket("t1", "in_progress", 2)], 2) },
    ]);

    await tick(); // poll #1 — no prior ETag known yet.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ifNoneMatchOnCall(fetchMock, 0)).toBeUndefined();

    await tick(); // poll #2 — must present the ETag returned by poll #1.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ifNoneMatchOnCall(fetchMock, 1)).toBe('"etag-1"');
  });

  it("(ii) sends ZERO /api/board fetches while the document is hidden", async () => {
    await renderBoard(board([ticket("t1", "todo", 1)], 1));
    const fetchMock = mockFetchSequence([
      { etag: '"etag-1"', body: board([ticket("t1", "todo", 1)], 1) },
    ]);

    setDocumentVisible(false);
    await tick();
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(iii) fires a fetch immediately when visibility returns to visible", async () => {
    setDocumentVisible(false);
    await renderBoard(board([ticket("t1", "todo", 1)], 1));
    const fetchMock = mockFetchSequence([
      { etag: '"etag-1"', body: board([ticket("t1", "todo", 1)], 1) },
    ]);

    // No timer advance at all — only the visibility flip should trigger a fetch.
    setDocumentVisible(true);
    await fireVisible();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================== AC 6 ========

describe("fold8-poll-metered-payload-diet AC 6 — 304 is a no-op; change lands within one poll", () => {
  it("board data survives a 304 unreset, and a real change lands on the very next poll", async () => {
    await renderBoard(board([ticket("t1", "todo", 1)], 1));

    mockFetchSequence([
      // tick 1 — 200(v1): t1 moves todo -> in_progress.
      { etag: '"etag-v1"', body: board([ticket("t1", "in_progress", 2)], 2) },
      // tick 2 — 304: unchanged.
      { status: 304, etag: '"etag-v1"' },
      // tick 3 — 200(v2): t1 moves in_progress -> in_review, a REAL change.
      { etag: '"etag-v2"', body: board([ticket("t1", "in_review", 3)], 3) },
    ]);

    await tick(); // v1 lands.
    expect(
      container.querySelector('section[aria-label="In Progress"]')?.textContent
    ).toContain("synthetic ticket t1");
    expect(
      container.querySelector('section[aria-label="To Do"] .ak-col__count')
        ?.textContent
    ).toBe("0");

    await tick(); // 304 — must be a no-op: v1 state unreset.
    expect(
      container.querySelector('section[aria-label="In Progress"]')?.textContent
    ).toContain("synthetic ticket t1");
    expect(
      container.querySelector('section[aria-label="In Review"] .ak-col__count')
        ?.textContent
    ).toBe("0");

    await tick(); // v2 — the real change must land within this ONE poll.
    expect(
      container.querySelector('section[aria-label="In Review"]')?.textContent
    ).toContain("synthetic ticket t1");
    expect(
      container.querySelector('section[aria-label="In Progress"] .ak-col__count')
        ?.textContent
    ).toBe("0");
  });

  it("NRN-1: the `now` clock keeps advancing across repeated 304 ticks (idle heartbeat / relative-time doesn't freeze)", async () => {
    const FIXED_START = 1_800_000_000_000;
    jest.setSystemTime(FIXED_START);

    // t1 stays in the SAME column for every tick below — this test isolates
    // JUST the `now`-clock question, deliberately independent of any column
    // move (a column change would leave a STALE exiting duplicate in the DOM
    // during its AnimatePresence exit animation — see the NRN-2 test's
    // column-scoped query comment for the full explanation of that trap).
    const updatedAt = FIXED_START - 53_000; // 53s before mount -> "just now" (<60s).

    await renderBoard(board([ticket("t1", "todo", updatedAt)], updatedAt));
    expect(
      container.querySelector('[aria-label^="Open ticket #t1:"] .ak-card__time')
        ?.textContent
    ).toBe("just now");

    mockFetchSequence([
      // tick 1 (+5s, total 58s) — 200(v1): same column, so no AnimatePresence
      // exit/enter duplicate — still "just now" (<60s).
      { etag: '"etag-v1"', body: board([ticket("t1", "todo", updatedAt)], FIXED_START) },
      // every tick after: 304 — the branch under test.
      { status: 304, etag: '"etag-v1"' },
    ]);

    await tick();
    expect(
      container.querySelector('[aria-label^="Open ticket #t1:"] .ak-card__time')
        ?.textContent
    ).toBe("just now");

    // board-render-perf-inp: `now` is quantized to a 60s grid (lib/clock.ts)
    // so an individual relative-time crossing can lag the TRUE wall-clock
    // moment by up to one full granularity step (documented, intentional —
    // "no rendered string may lag HEAD behavior by more than 60s", AC-4).
    // Advance across enough 304 ticks (15 * 5s = 75s of real elapsed time,
    // comfortably past any 60s-grid boundary from here) to observe the
    // crossing — proving the 304 branch is what's still advancing the clock,
    // not that it happens on the very next tick.
    for (let i = 0; i < 15; i++) {
      await tick();
    }
    expect(
      container.querySelector('[aria-label^="Open ticket #t1:"] .ak-card__time')
        ?.textContent
    ).toBe("1m ago");
  });

  it("NRN-2: a selected/open drawer + an in-flight glow survive a 304 that arrives mid-flight", async () => {
    await renderBoard(board([ticket("t1", "todo", 1)], 1));

    mockFetchSequence([
      // tick 1 — 200(v1): t1 moves, triggering `moved` -> glow.
      { etag: '"etag-v1"', body: board([ticket("t1", "in_progress", 2)], 2) },
    ]);
    await tick();

    // Scoped to the destination column: framer-motion's AnimatePresence keeps
    // the STALE, exiting "To Do" copy of this card in the DOM for the
    // duration of its exit animation (COLUMNS renders "To Do" before "In
    // Progress", so an unscoped, whole-container querySelector can find that
    // stale node FIRST) — scoping to the section this ticket now belongs in
    // is the reliable way to grab the live, freshly-rendered instance.
    const inProgress = () =>
      container.querySelector('section[aria-label="In Progress"]');
    const cardBtn = () =>
      inProgress()?.querySelector<HTMLButtonElement>(
        '[aria-label^="Open ticket #t1:"]'
      );
    expect(cardBtn()?.querySelector(".ak-card--live")).toBeTruthy(); // glow is live.

    // Select / open the drawer BEFORE the 304 (NRN-2).
    await act(async () => {
      cardBtn()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
      "Ticket #t1 audit log"
    );

    // A second poll, fired with ZERO fake-time advance (via visibilitychange,
    // not the natural 5s interval) so the glow's own 2s auto-clear timer has
    // NOT yet fired — this isolates "does the 304 branch itself clear glow"
    // from "did glow's own timer expire it", which a full tick() cannot do.
    const secondFetchMock = mockFetchSequence([{ status: 304, etag: '"etag-v1"' }]);
    await fireVisible();

    // The out-of-schedule poll genuinely fired, presenting the last-seen ETag.
    expect(secondFetchMock).toHaveBeenCalledTimes(1);
    expect(ifNoneMatchOnCall(secondFetchMock, 0)).toBe('"etag-v1"');

    // Drawer survives.
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
      "Ticket #t1 audit log"
    );
    // Glow survives — the 304 branch did not synchronously clear it.
    expect(cardBtn()?.querySelector(".ak-card--live")).toBeTruthy();
    // Board data survives unreset (still shows v1's column, not v0's or blank).
    expect(inProgress()?.textContent).toContain("synthetic ticket t1");
  });
});
