import { computeActiveIds, ACTIVE_WINDOW_MS } from "@/lib/active";
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
});
