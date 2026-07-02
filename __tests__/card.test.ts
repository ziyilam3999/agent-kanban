import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Card } from "@/components/Card";
import type { Column, LedgerComment, Ticket } from "@/lib/board-schema";

const ticket = (
  column: Column,
  comments: LedgerComment[] = []
): Ticket => ({
  id: "100",
  subject: "Do the thing",
  description: "",
  column,
  status: column === "done" ? "completed" : column === "todo" ? "pending" : "in_progress",
  blockedBy: [],
  comments,
  updatedAt: 1,
});

const render = (t: Ticket, active = false) =>
  renderToStaticMarkup(createElement(Card, { ticket: t, nowMs: 2, active }));

describe("Card phase line render", () => {
  it("in_review + PASS card → markup carries the shipping pill (PASS + SHIPPING — #1410)", () => {
    // Re-derived for #1410: an in_review card whose newest exec-review resolved
    // PASS now renders the ✓ PASS — SHIPPING pill (fresh: nowMs=2, updatedAt=1).
    // Asserting SHIPPING (not just REVIEW/PASS substrings) so this cannot go
    // accidentally green via pip titles.
    const markup = render(
      ticket("in_review", [
        { role: "executor", ts: "2026-06-21T01:00:00.000Z" },
        { role: "execution-review", ts: "2026-06-21T02:00:00.000Z", verdict: "PASS" },
      ])
    );
    expect(markup).toContain("PASS");
    expect(markup).toContain("SHIPPING");
  });

  it("todo card with no comments → markup carries QUEUED and no verdict token", () => {
    const markup = render(ticket("todo"));
    expect(markup).toContain("QUEUED");
    // No verdict token leaks onto a queued card. ("REVIEW" intentionally NOT asserted —
    // it appears in the de-emphasized pip titles PLAN-REVIEW / EXEC-REVIEW.)
    expect(markup).not.toContain("PASS");
    expect(markup).not.toContain("APPROVE");
    expect(markup).not.toContain("◆ REVIEW");
  });

  it("in_progress executor card → markup carries the EXECUTOR phase line", () => {
    const markup = render(
      ticket("in_progress", [{ role: "executor", ts: "2026-06-21T01:00:00.000Z" }])
    );
    expect(markup).toContain("EXECUTOR");
    expect(markup).toContain("ak-phase");
  });

  it("ACTIVE no-role in_progress card → WORKING + ak-phase--live, one live signal (no footer working node)", () => {
    const markup = render(
      ticket("in_progress", [{ role: "orchestrator", ts: "2026-06-21T01:00:00.000Z" }]),
      true
    );
    expect(markup).toContain("WORKING");
    expect(markup).toContain("ak-phase--live");
    // Dedupe: the live word lives ONLY on the phase line — no second footer
    // "working" node (RED on master, which renders both).
    expect(markup).not.toContain("ak-working");
    expect(markup).not.toContain(">working<");
  });

  it("NOT-active no-role in_progress card → STARTED, no ak-phase--live pulse", () => {
    const markup = render(
      ticket("in_progress", [{ role: "orchestrator", ts: "2026-06-21T01:00:00.000Z" }])
    );
    expect(markup).toContain("STARTED");
    expect(markup).not.toContain("ak-phase--live");
    expect(markup).not.toContain("ak-working");
  });
});
