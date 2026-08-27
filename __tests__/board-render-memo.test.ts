/**
 * @jest-environment jsdom
 */
// board-render-memo.test.ts — board-render-perf-inp CORE lever 1, proven
// end-to-end through the REAL poll -> setBoard -> BoardColumn -> BoardCard
// path (not just the merge utility in isolation — ticket-equal.test.ts
// covers that). Card.tsx is mocked to a call-counting wrapper around its own
// real implementation, so this measures ACTUAL render calls, not a proxy.
//
// Same DOM-plumbing pattern as __tests__/board-poll-conditional.test.ts.
// Ticket count (10) is deliberately BELOW BoardColumn's WINDOW_THRESHOLD
// (60) so windowing stays off and this test isolates JUST the memoization
// question (no IntersectionObserver involved — jsdom's support for it is
// unreliable, and this test doesn't need it).

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { hasReducedMotionListener, prefersReducedMotion } from "motion-dom";
import type { Board, Ticket } from "@/lib/board-schema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

const cardCalls = jest.fn();
jest.mock("@/components/Card", () => {
  const actual = jest.requireActual("@/components/Card");
  const { createElement: h } = jest.requireActual("react");
  return {
    Card: (props: unknown) => {
      cardCalls(props);
      return h(actual.Card, props);
    },
  };
});

// Imported AFTER the mock so BoardView's dependency graph (via BoardCard) picks it up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BoardView } = require("@/components/BoardView");

const POLL_MS = 5000;
const SESSION_ID = "sess0001";

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
    sessions: [{ id: SESSION_ID, label: "synthetic session", lastActive: generatedAt, ticketCount: tickets.length, live: true }],
    tickets,
  };
}

function tenTickets(baseUpdatedAt: number): Ticket[] {
  const cols: Ticket["column"][] = ["todo", "in_progress", "in_review", "done"];
  return Array.from({ length: 10 }, (_, i) => ticket(`t${i}`, cols[i % cols.length], baseUpdatedAt - i * 1000));
}

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

beforeEach(() => {
  hasReducedMotionListener.current = false;
  prefersReducedMotion.current = null;
  setupMatchMedia();
  container = document.createElement("div");
  document.body.appendChild(container);
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {};
  }
  jest.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  jest.useFakeTimers({ doNotFake: ["requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask"] });
  // Pin the fake clock to an EXACT 60s (lib/clock.ts CLOCK_GRANULARITY_MS)
  // boundary — a single POLL_MS=5000ms tick then never crosses a quantize
  // boundary, so `now`'s quantized value is provably IDENTICAL before and
  // after the tick under test. Without this, `now` starts at whatever real
  // wall-clock instant the test happened to run, which could occasionally
  // land within 5s of a boundary and make every card's `nowMs` prop change
  // for a reason unrelated to what this test is proving (flaky-by-clock).
  jest.setSystemTime(1_800_000_000_000);
  cardCalls.mockClear();
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  container.remove();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function renderBoard(initial: Board): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root!.render(createElement(BoardView, { initial }));
  });
}

async function tick(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(POLL_MS);
  });
}

interface MockResp {
  status?: number;
  etag?: string;
  body?: Board;
}

function mockFetchSequence(responses: MockResp[]): jest.Mock {
  let i = 0;
  const fetchMock = jest.fn().mockImplementation(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name.toLowerCase() === "etag" ? r.etag ?? null : null) },
      text: async () => (status === 304 ? "" : JSON.stringify(r.body)),
      json: async () => r.body,
    } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("board-render-perf-inp CORE lever 1 — render work proportional to change", () => {
  it("a changed tick that touches ONE ticket re-renders exactly ONE Card, not all ten", async () => {
    const base = Date.now();
    const initialTickets = tenTickets(base);
    await renderBoard(board(initialTickets, base));

    // Initial mount renders every visible ticket's Card at least once.
    expect(cardCalls.mock.calls.length).toBeGreaterThanOrEqual(10);
    cardCalls.mockClear();

    // A changed tick: ONLY t3's updatedAt advances (everything else is
    // value-identical, even though JSON.parse below hands every ticket a
    // FRESH object reference — the exact defeat pattern lib/ticket-equal.ts
    // exists to undo).
    const changedTickets = tenTickets(base).map((t) =>
      t.id === "t3" ? { ...t, updatedAt: base + 999_000 } : { ...t },
    );
    // Same `generatedAt` as the initial board — a genuinely changed tick
    // that touches ONLY t3 must not also perturb the session's own
    // `lastActive` (a real board update to just one ticket doesn't bump
    // session freshness by itself); using a different value here would
    // change `sessionLastActive` for EVERY card, which is a real prop
    // difference this test isn't trying to exercise.
    mockFetchSequence([{ etag: '"e1"', body: board(changedTickets, base) }]);

    await tick();

    const rerenderedIds = new Set(cardCalls.mock.calls.map((c) => (c[0] as { ticket: Ticket }).ticket.id));
    expect(rerenderedIds).toEqual(new Set(["t3"]));
    expect(cardCalls.mock.calls.length).toBe(1);
  });

  it("an UNCHANGED (raw-text-identical) tick re-renders ZERO Cards", async () => {
    const base = Date.now();
    const initialTickets = tenTickets(base);
    const b = board(initialTickets, base);
    await renderBoard(b);
    cardCalls.mockClear();

    mockFetchSequence([{ etag: '"e1"', body: b }]); // byte-identical body every poll
    await tick();
    await tick();

    expect(cardCalls.mock.calls.length).toBe(0);
  });
});
