// ticket-equal.test.ts — board-render-perf-inp CORE lever 1: ticketsEqual +
// mergeTickets (lib/ticket-equal.ts). Proves the reference-preserving merge
// actually reuses unchanged ticket objects (the property BoardCard's
// React.memo depends on) and correctly detects every field a real board
// update can change.

import { ticketsEqual, mergeTickets } from "@/lib/ticket-equal";
import type { Ticket } from "@/lib/board-schema";

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1",
    subject: "subject",
    description: "",
    column: "todo",
    status: "pending",
    blockedBy: [],
    comments: [],
    updatedAt: 1000,
    sessionId: "sess0001",
    ...overrides,
  };
}

describe("ticketsEqual", () => {
  it("is true for the identical reference", () => {
    const t = ticket();
    expect(ticketsEqual(t, t)).toBe(true);
  });

  it("is true for two distinct objects with identical fields", () => {
    expect(ticketsEqual(ticket(), ticket())).toBe(true);
  });

  it.each<[keyof Ticket, unknown]>([
    ["subject", "different subject"],
    ["description", "different description"],
    ["column", "in_progress"],
    ["status", "in_progress"],
    ["updatedAt", 2000],
    ["sessionId", "other0001"],
    ["onHold", "blocked on X"],
  ])("is false when %s differs", (field, value) => {
    const a = ticket();
    const b = ticket({ [field]: value } as Partial<Ticket>);
    expect(ticketsEqual(a, b)).toBe(false);
  });

  it("is false when blockedBy differs (length)", () => {
    expect(ticketsEqual(ticket({ blockedBy: [] }), ticket({ blockedBy: ["t2"] }))).toBe(false);
  });

  it("is false when blockedBy differs (content, same length)", () => {
    expect(ticketsEqual(ticket({ blockedBy: ["t2"] }), ticket({ blockedBy: ["t3"] }))).toBe(
      false,
    );
  });

  it("is true when blockedBy is the same content via different array references", () => {
    expect(ticketsEqual(ticket({ blockedBy: ["t2", "t3"] }), ticket({ blockedBy: ["t2", "t3"] }))).toBe(
      true,
    );
  });

  it("is false when a comment field differs", () => {
    const a = ticket({ comments: [{ role: "executor", ts: "2026-01-01T00:00:00Z", verdict: "PASS" }] });
    const b = ticket({ comments: [{ role: "executor", ts: "2026-01-01T00:00:00Z", verdict: "FAIL" }] });
    expect(ticketsEqual(a, b)).toBe(false);
  });

  it("is false when comment count differs", () => {
    const a = ticket({ comments: [{ role: "executor", ts: "t" }] });
    const b = ticket({ comments: [{ role: "executor", ts: "t" }, { role: "planner", ts: "t2" }] });
    expect(ticketsEqual(a, b)).toBe(false);
  });

  it("is true when comments are content-identical via different array/object references", () => {
    const a = ticket({ comments: [{ role: "executor", ts: "t", closedAt: "t2" }] });
    const b = ticket({ comments: [{ role: "executor", ts: "t", closedAt: "t2" }] });
    expect(ticketsEqual(a, b)).toBe(true);
  });
});

describe("mergeTickets", () => {
  it("reuses the OLD reference for every value-unchanged ticket", () => {
    const prev = [ticket({ id: "a" }), ticket({ id: "b" })];
    // A fresh JSON.parse-shaped array — same VALUES, brand-new objects.
    const next = [ticket({ id: "a" }), ticket({ id: "b" })];
    const merged = mergeTickets(prev, next);
    expect(merged[0]).toBe(prev[0]);
    expect(merged[1]).toBe(prev[1]);
  });

  it("keeps the NEW reference for a genuinely changed ticket, and reuses the rest", () => {
    const prev = [ticket({ id: "a" }), ticket({ id: "b", updatedAt: 1000 })];
    const changedB = ticket({ id: "b", updatedAt: 2000 });
    const next = [ticket({ id: "a" }), changedB];
    const merged = mergeTickets(prev, next);
    expect(merged[0]).toBe(prev[0]); // "a" unchanged -> old ref reused
    expect(merged[1]).toBe(changedB); // "b" changed -> new ref kept
    expect(merged[1]).not.toBe(prev[1]);
  });

  it("uses the fresh object for a newly-added ticket (no prior reference to reuse)", () => {
    const prev = [ticket({ id: "a" })];
    const freshC = ticket({ id: "c" });
    const next = [ticket({ id: "a" }), freshC];
    const merged = mergeTickets(prev, next);
    expect(merged[0]).toBe(prev[0]);
    expect(merged[1]).toBe(freshC);
  });

  it("drops a removed ticket (result follows `next`'s membership, not `prev`'s)", () => {
    const prev = [ticket({ id: "a" }), ticket({ id: "b" })];
    const next = [ticket({ id: "a" })];
    const merged = mergeTickets(prev, next);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("a");
  });

  it("returns `next` unmodified in shape when `prev` is empty (first-ever fetch)", () => {
    const next = [ticket({ id: "a" }), ticket({ id: "b" })];
    const merged = mergeTickets([], next);
    expect(merged).toBe(next);
  });
});
