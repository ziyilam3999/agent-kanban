// board-fixture.ts — deterministic synthetic Board payloads for the Live-Swimlanes
// e2e checks. Timestamps are generated relative to Date.now() at call time so the
// `computeActiveIds` freshness window (8 min) is satisfied in CI as well as locally
// — a STATIC fixture with baked timestamps would age out and collapse a 2-lane
// state to 1 lane. Purely a TEST input: never written to the real Vercel Blob.

import type { Board, Ticket } from "../../lib/board-schema";

const SESSION_ID = "sess0001";

// The 4-role pipeline in execution order — a lane's current stage = highest index present.
type Role = "planner" | "plan-review" | "executor" | "execution-review";
const ROLE_ORDER: Role[] = ["planner", "plan-review", "executor", "execution-review"];

function comments(upTo: number, baseTs: number) {
  return ROLE_ORDER.slice(0, upTo + 1).map((role, i) => ({
    role,
    ts: new Date(baseTs + i * 1000).toISOString(),
    agentId: `agent-${role}-${i}`,
    artifact: `${role}.md`,
    ...(role.endsWith("review") ? { verdict: "APPROVE" } : {}),
  }));
}

interface BuildOpts {
  /** Number of genuinely-live in_progress tickets (each becomes a candidate lane). */
  liveLanes: number;
  /** Whether the session is live — false => activeIds empty => zero lanes, no counter. */
  live?: boolean;
  /**
   * Optional extra CARD ticket carrying a chosen (possibly pathologically long)
   * subject, appended in the `todo` column so it renders as a clickable `.ak-cardbtn`
   * without joining the live lanes. Undefined for existing callers => ticket count
   * unchanged (back-compat: live-swimlanes still sees exactly liveLanes + 3 cards).
   */
  longSubjectTicket?: { id: string; subject: string };
}

/**
 * Build a Board with `liveLanes` freshly-touched in_progress tickets (distinct
 * current stages) plus a handful of non-live tickets in the other columns so the
 * column board always has content. With `live:false` the session is idle so
 * computeActiveIds returns the empty set (k=0 — counter absent).
 */
export function buildBoard({ liveLanes, live = true, longSubjectTicket }: BuildOpts): Board {
  const now = Date.now();
  const tickets: Ticket[] = [];

  // Live in_progress lanes — each fresh (within the 8-min window), distinct stage.
  for (let i = 0; i < liveLanes; i++) {
    const stage = i % ROLE_ORDER.length; // cycle stages so each lane lights a different node
    tickets.push({
      id: `90${i}`,
      subject: `Live chain ${i + 1} — concurrent four-role pipeline under telemetry`,
      description: "",
      column: "in_progress",
      status: "in_progress",
      blockedBy: [],
      comments: comments(stage, now - 60_000 - i * 5_000),
      updatedAt: now - i * 2_000, // all within the 8-min active window
      sessionId: SESSION_ID,
    });
  }

  // Context tickets in the other columns so the column board (.ak-strip) has content.
  const ctx: Array<[string, Ticket["column"], Ticket["status"]]> = [
    ["701", "todo", "pending"],
    ["702", "in_review", "in_progress"],
    ["703", "done", "completed"],
  ];
  for (const [id, column, status] of ctx) {
    tickets.push({
      id,
      subject: `Context ticket ${id} in ${column}`,
      description: "",
      column,
      status,
      blockedBy: [],
      comments: [],
      updatedAt: now - 30 * 60_000, // old: never counts as a live lane
      sessionId: SESSION_ID,
    });
  }

  // Optional long-subject card (the #1447 drawer-scroll regression fixture). Placed
  // in `todo`/`pending` so it renders as a clickable card WITHOUT joining the live
  // lanes (computeActiveIds only considers in_progress). Old + never active.
  if (longSubjectTicket) {
    tickets.push({
      id: longSubjectTicket.id,
      subject: longSubjectTicket.subject,
      description: "",
      column: "todo",
      status: "pending",
      blockedBy: [],
      comments: [],
      updatedAt: now - 20 * 60_000,
      sessionId: SESSION_ID,
    });
  }

  const ticketCount = tickets.length;
  return {
    schema: 1,
    generatedAt: now,
    sessionId: SESSION_ID,
    sessions: [
      {
        id: SESSION_ID,
        label: `active just now · ${ticketCount} tickets`,
        lastActive: now,
        ticketCount,
        live,
      },
    ],
    tickets,
  };
}
