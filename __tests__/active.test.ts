import * as fs from "node:fs";
import * as path from "node:path";
import { computeActiveIds, ACTIVE_WINDOW_MS } from "@/lib/active";
import { resolveTicketKind } from "@/lib/ticket-kind";
import type { Ticket } from "@/lib/board-schema";

const NOW = 1_000_000_000_000;

function ticket(id: string, column: Ticket["column"], minsAgo: number): Ticket {
  return {
    id,
    subject: `t${id}`,
    description: "",
    column,
    status: column === "in_progress" ? "in_progress" : column === "done" ? "completed" : "pending",
    blockedBy: [],
    comments: [],
    updatedAt: NOW - minsAgo * 60_000,
    sessionId: "sess0001",
  };
}

describe("computeActiveIds", () => {
  it("REGRESSION (#1083): the most-recent in_progress ticket breathes while live even when OLDER than the window", () => {
    // #1082 was actively worked for 12 min with no file touch → mtime 12 min old,
    // well past the 8-min window. It is still the current focus → must breathe.
    const tickets = [
      ticket("1082", "in_progress", 12),
      ticket("1079", "in_progress", 52),
      ticket("1063", "in_progress", 357),
    ];
    const active = computeActiveIds(tickets, true, NOW);
    expect(active.has("1082")).toBe(true); // current focus (most recent), past window
    expect(active.has("1079")).toBe(false); // older, not the focus
    expect(active.has("1063")).toBe(false);
  });

  it("an idle (non-live) session lights nothing", () => {
    const tickets = [ticket("1", "in_progress", 0)];
    expect(computeActiveIds(tickets, false, NOW).size).toBe(0);
  });

  it("a board with no in_progress tickets lights nothing", () => {
    const tickets = [ticket("1", "todo", 0), ticket("2", "done", 1)];
    expect(computeActiveIds(tickets, true, NOW).size).toBe(0);
  });

  it("parallel work: other in_progress tickets touched within the window also breathe", () => {
    const tickets = [
      ticket("a", "in_progress", 1), // focus (most recent) + within window
      ticket("b", "in_progress", 5), // within the 8-min window → parallel
      ticket("c", "in_progress", 30), // past window, not the focus → dark
    ];
    const active = computeActiveIds(tickets, true, NOW);
    expect(active.has("a")).toBe(true);
    expect(active.has("b")).toBe(true);
    expect(active.has("c")).toBe(false);
  });

  it("never lights a todo / done / in_review ticket", () => {
    const tickets = [
      ticket("todo", "todo", 0),
      ticket("done", "done", 0),
      ticket("review", "in_review", 0),
      ticket("ip", "in_progress", 0),
    ];
    const active = computeActiveIds(tickets, true, NOW);
    expect(active.has("todo")).toBe(false);
    expect(active.has("done")).toBe(false);
    expect(active.has("review")).toBe(false);
    expect(active.has("ip")).toBe(true);
  });

  it("the window is widened past the old brittle 3-min value", () => {
    expect(ACTIVE_WINDOW_MS).toBeGreaterThan(3 * 60 * 1000);
  });

  // board-noise triage (task-kind-contract.md §4 D4, S1 AC-1.3) — an
  // in_progress ticket whose resolved kind is NOT "work" (bookkeeping /
  // parked / deferred) never lights a lane or counts toward the ceiling,
  // even though it is the most-recent in_progress ticket (would otherwise
  // win the "focus" disjunct unconditionally). A chore is not a lane.
  it("board-noise D4: an in_progress bookkeeping ticket is EXCLUDED from activeIds", () => {
    const bookkeepingTicket: Ticket = { ...ticket("chore-1", "in_progress", 0), kind: "bookkeeping" };
    const workTicket = ticket("work-1", "in_progress", 2);
    const active = computeActiveIds([bookkeepingTicket, workTicket], true, NOW);
    expect(active.has("chore-1")).toBe(false);
    expect(active.has("work-1")).toBe(true);
  });

  it("board-noise D4: an in_progress bookkeeping ticket ALONE lights nothing (not just demoted)", () => {
    const bookkeepingTicket: Ticket = { ...ticket("chore-1", "in_progress", 0), kind: "bookkeeping" };
    const active = computeActiveIds([bookkeepingTicket], true, NOW);
    expect(active.size).toBe(0);
  });

  it("board-noise D4: an in_progress ticket with no kind field (pre-board-noise snapshot) still lights — the view default is work", () => {
    const active = computeActiveIds([ticket("legacy-1", "in_progress", 0)], true, NOW);
    expect(active.has("legacy-1")).toBe(true);
  });

  // AC-1.3 literal wording: "a fixture snapshot with an in_progress
  // bookkeeping ticket in a live session yields an activeIds set that
  // excludes it" — bound directly to the shared S0 fixture (9011:
  // in_progress, kind bookkeeping/quarantine-sweep, the fixture's own
  // dedicated in_progress-invariant case).
  it("AC-1.3: the S0 fixture's in_progress bookkeeping ticket (9011) is excluded from a live session's activeIds", () => {
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "fixtures", "task-kind-store", "fixture-session-000", "9011.json"),
        "utf8"
      )
    );
    expect(raw.status).toBe("in_progress");
    expect(resolveTicketKind(raw)).toBe("bookkeeping");

    const fixtureTicket: Ticket = { ...ticket("9011", "in_progress", 0), kind: resolveTicketKind(raw) };
    const active = computeActiveIds([fixtureTicket], true, NOW);
    expect(active.has("9011")).toBe(false);
  });
});
