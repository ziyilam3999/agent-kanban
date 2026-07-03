/**
 * @jest-environment jsdom
 */
// lane-reveal.test.ts — #1456 BEHAVIORAL wiring oracle (RED-first, per-file jsdom
// docblock — the global jest.config.js testEnvironment stays "node" and every
// other *.test.ts in this suite is untouched).
//
// This file imports ONLY `BoardView` — a symbol that exists, with an UNCHANGED
// public signature, on BOTH origin/master and this branch — and drives a genuine
// `<2 -> >=2` live-lane transition through BoardView's PUBLIC surface (the
// `initial` prop plus the existing poll, via a mocked `fetch` + fake timers).
// It spies the REAL `Element.prototype.scrollIntoView`.
//
// Non-vacuity contract (plan AC#1, R1): running this UNMODIFIED file on
// origin/master must reach and FAIL an EXECUTED assertion (spy calls observed
// = 0, `0 !== 1`) — NOT an import/compile error. Do NOT import any new
// branch-only symbol (hook/prop/helper) here; that would make the master run
// fail by compile error instead, which a vacuous always-expects-1 test would
// also satisfy, proving nothing. See
// .ai-workspace/plans/2026-07-03-1456-lane-reveal.md AC#1 for the full contract.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { hasReducedMotionListener, prefersReducedMotion } from "motion-dom";
import { BoardView } from "@/components/BoardView";
import type { Board, LedgerComment, Ticket } from "@/lib/board-schema";

// React 19's `act` (imported from "react", not the deprecated
// react-dom/test-utils) only suppresses "not wrapped in act(...)" warnings when
// this flag is set — raw react-dom/client usage (no @testing-library/react)
// needs it set explicitly.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// BoardView's own private poll interval (jest.config.js is node-env; this
// per-file jsdom test cannot import a non-exported constant, so the value is
// mirrored here — see components/BoardView.tsx's `POLL_MS`).
const POLL_MS = 5000;

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

// ---------------------------------------------------------------- fixtures --

const NOW = 1_800_000_000_000; // fixed epoch — deterministic "recently touched" comments.
const SESSION_ID = "sess0001"; // 8 chars — equals BOTH board.sessionId and session.id.

function pipelineComment(): LedgerComment {
  return { role: "executor", ts: new Date(NOW).toISOString() };
}

/** A synthetic in_progress ticket that is unconditionally lane-eligible: it has
 *  one pipeline-role comment and no execution-review, so `chainInFlight()` is
 *  true and `computeActiveIds()` marks it active (within the 6h in-flight cap). */
function inProgressTicket(id: string): Ticket {
  return {
    id,
    subject: `synthetic ticket ${id}`,
    description: "",
    column: "in_progress",
    status: "in_progress",
    blockedBy: [],
    comments: [pipelineComment()],
    updatedAt: NOW,
    sessionId: SESSION_ID,
  };
}

function board(ticketIds: string[]): Board {
  return {
    schema: 1,
    generatedAt: NOW,
    sessionId: SESSION_ID,
    sessions: [
      {
        id: SESSION_ID,
        label: "synthetic session",
        lastActive: NOW,
        ticketCount: ticketIds.length,
        live: true,
      },
    ],
    tickets: ticketIds.map(inProgressTicket),
  };
}

// ------------------------------------------------------------- DOM plumbing --

let container: HTMLDivElement;
let root: Root | null;
let scrollIntoViewSpy: jest.SpyInstance;
let reducedMotionPref = false;

function setupMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      // framer-motion's useReducedMotion() queries "(prefers-reduced-motion)"
      // (no ": reduce" — see node_modules/framer-motion .../use-reduced-motion.mjs).
      matches: query === "(prefers-reduced-motion)" ? reducedMotionPref : false,
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
  reducedMotionPref = false;

  // framer-motion memoizes prefersReducedMotion in a module-level singleton
  // (`hasReducedMotionListener.current`), read LAZILY on the first
  // useReducedMotion() call in the whole process. Force it to re-read
  // window.matchMedia on the first render of EACH test, or every test after
  // the first would silently inherit test #1's reduced-motion setting.
  hasReducedMotionListener.current = false;
  prefersReducedMotion.current = null;

  setupMatchMedia();

  container = document.createElement("div");
  document.body.appendChild(container);

  // jsdom implements no layout engine, so Element.prototype.scrollIntoView does
  // not exist — stub it before spying (jest.spyOn requires the method to
  // already exist on the prototype).
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {};
  }
  scrollIntoViewSpy = jest
    .spyOn(Element.prototype, "scrollIntoView")
    .mockImplementation(() => {});

  // Let the real (jsdom-provided) requestAnimationFrame run natively so
  // motion's internal animation frameloop isn't starved by our fake-timer
  // advances, which drive ONLY the POLL_MS interval below.
  jest.useFakeTimers({
    doNotFake: [
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "queueMicrotask",
    ],
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
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Mount BoardView with `initial`, flushing the mount-time effects. */
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

/** Queue the sequence of `/api/board` responses a mocked poll loop will see —
 *  the LAST entry repeats for any poll beyond the sequence length (steady state). */
function mockFetchSequence(boards: Board[]): void {
  let i = 0;
  global.fetch = jest.fn().mockImplementation(async () => {
    const b = boards[Math.min(i, boards.length - 1)];
    i++;
    return {
      ok: true,
      json: async () => b,
    } as Response;
  }) as unknown as typeof fetch;
}

/** Click the card button for `id` (the public surface for opening the Drawer). */
async function clickCard(id: string): Promise<void> {
  const btn = container.querySelector<HTMLButtonElement>(
    `[aria-label^="Open ticket #${id}:"]`
  );
  if (!btn) throw new Error(`test setup: no card button found for #${id}`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// --------------------------------------------------------------------- AC#1 --

describe("#1456 auto-reveal — behavioral wiring oracle (AC#1)", () => {
  it("(a) fires exactly once on a genuine <2 -> >=2 transition", async () => {
    await renderBoard(board(["t1"])); // 1 lane — panel absent.
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    mockFetchSequence([board(["t1", "t2"])]); // poll bumps to 2 lanes.
    await tick();

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({
      block: "start",
      behavior: "smooth",
    });
  });

  it("(b) does NOT fire on a present->present transition (2 -> 3)", async () => {
    await renderBoard(board(["t1", "t2"])); // mounts already at 2 lanes.
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    mockFetchSequence([board(["t1", "t2", "t3"])]); // poll bumps to 3 lanes.
    await tick();

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it("(c) first-load seed proof: mounting already at >=2 does NOT fire", async () => {
    await renderBoard(board(["t1", "t2"])); // already >=2 lanes at mount — no transition.

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    // A no-op poll (unchanged lane count) must also stay silent.
    mockFetchSequence([board(["t1", "t2"])]);
    await tick();

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it("(d) reduced motion -> scrollIntoView called with behavior:\"auto\"", async () => {
    reducedMotionPref = true;

    await renderBoard(board(["t1"]));
    mockFetchSequence([board(["t1", "t2"])]);
    await tick();

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({
      block: "start",
      behavior: "auto",
    });
  });

  it("(e) does NOT fire while the ticket Drawer is open", async () => {
    await renderBoard(board(["t1"]));
    await clickCard("t1"); // opens the Drawer (selectedId != null).

    mockFetchSequence([board(["t1", "t2"])]);
    await tick();

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });
});
