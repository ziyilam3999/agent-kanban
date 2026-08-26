// board-fixture.ts — deterministic synthetic Board payloads for the Live-Swimlanes
// e2e checks. Timestamps are generated relative to Date.now() at call time so the
// `computeActiveIds` freshness window (8 min) is satisfied in CI as well as locally
// — a STATIC fixture with baked timestamps would age out and collapse a 2-lane
// state to 1 lane. Purely a TEST input: never written to the real Vercel Blob.

import { COLUMNS } from "../../lib/board-schema";
import type { Board, LedgerComment, Ticket } from "../../lib/board-schema";

const SESSION_ID = "sess0001";

// The 4-role pipeline in execution order — a lane's current stage = highest index present.
type Role = "planner" | "plan-review" | "executor" | "execution-review";
const ROLE_ORDER: Role[] = ["planner", "plan-review", "executor", "execution-review"];
// Mirrors lib/ui-meta.ts WORK_PIPELINE_ROLES — the exact role set cardModel()
// scans backward for on an in_progress ticket. Kept as a local literal (not an
// import) so this fixture never depends on app source for its own shape.
const WORK_ROLES = new Set<Role>(["planner", "executor"]);

/**
 * fold8-uiux-redesign AC-2(b)(2) — the model/effort provenance pill (`.ak-model`)
 * renders on a card ONLY when the ticket's current-actor comment (the newest
 * planner/executor comment for an in_progress ticket — lib/ui-meta.ts cardModel)
 * carries `modelVersion`. The baseline fixture never set this field, so `.ak-model`
 * count was unconditionally 0 across the WHOLE suite — the removal AC could not
 * be captured as RED evidence (plan-review Round-1 R1). `opts.modelVersion` lets a
 * caller opt a SPECIFIC lane's comment set into carrying real provenance; every
 * existing caller that omits it is byte-for-byte unaffected (back-compat).
 */
function comments(
  upTo: number,
  baseTs: number,
  opts?: { modelVersion?: string; effort?: string },
): LedgerComment[] {
  const list: LedgerComment[] = ROLE_ORDER.slice(0, upTo + 1).map((role, i) => ({
    role,
    ts: new Date(baseTs + i * 1000).toISOString(),
    agentId: `agent-${role}-${i}`,
    artifact: `${role}.md`,
    ...(role.endsWith("review") ? { verdict: "APPROVE" } : {}),
  }));
  if (opts?.modelVersion) {
    // Attach to the NEWEST work-role comment, not blindly the last comment —
    // cardModel stops at the first planner/executor match scanning from the
    // end, so any other position would silently fail to render the pill.
    for (let i = list.length - 1; i >= 0; i--) {
      if (WORK_ROLES.has(list[i].role as Role)) {
        list[i] = {
          ...list[i],
          modelVersion: opts.modelVersion,
          ...(opts.effort ? { effort: opts.effort } : {}),
        };
        break;
      }
    }
  }
  return list;
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
  /**
   * Extra plain (non-live, old-timestamp) `todo` tickets — the fold8-4x3 grid-tier
   * ACs need a TODO column deep enough to overflow a `.ak-col`'s height (AC-2's
   * scrollHeight > clientHeight independent-scroll check). Undefined/0 for
   * existing callers => ticket count unchanged (back-compat).
   */
  extraTodoCount?: number;
  /**
   * fold8-4x3-bugfix AC-3 — production-scale synthetic board (the operator's
   * real board is ~1195 tickets / ~5.25MB, per production Blob measurement,
   * NOT a repo file). `count` extra `todo` tickets, each with a `description`
   * padded to `descriptionBytes` so the SERIALIZED payload reaches a target
   * scale independent of the AC-1/AC-2 `extraTodoCount` fixture (which is
   * comparatively tiny). Spread across every column (round-robin) so the
   * per-column overflow + full-board reconcile cost is realistic, not just
   * one column. Undefined => no tickets added (back-compat).
   */
  bigPayload?: { count: number; descriptionBytes: number };
  /**
   * fold8-uiux-redesign AC-2(b)(2) — when set (and `liveLanes >= 1`), lane 0's
   * comment set carries real `modelVersion` (+ `effort`) provenance so
   * `.ak-model` genuinely renders on that card (see `comments()` above).
   * Lane 0 always stages at `i % ROLE_ORDER.length === 0` ("planner"), a
   * WORK_ROLES member by construction, so this is always attachable when
   * `liveLanes >= 1`. Undefined => no card carries modelVersion (back-compat:
   * every existing caller sees `.ak-model` count 0, exactly as before).
   */
  modelPill?: { version: string; effort?: string };
}

/**
 * Build a Board with `liveLanes` freshly-touched in_progress tickets (distinct
 * current stages) plus a handful of non-live tickets in the other columns so the
 * column board always has content. With `live:false` the session is idle so
 * computeActiveIds returns the empty set (k=0 — counter absent).
 */
export function buildBoard({
  liveLanes,
  live = true,
  longSubjectTicket,
  extraTodoCount,
  bigPayload,
  modelPill,
}: BuildOpts): Board {
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
      comments: comments(
        stage,
        now - 60_000 - i * 5_000,
        i === 0 ? modelPill && { modelVersion: modelPill.version, effort: modelPill.effort } : undefined,
      ),
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

  // Extra plain `todo` tickets (fold8-4x3 AC-2's overflow depth). Old + never
  // active — same shape as the context tickets above, just numbered distinctly
  // so they never collide with ctx/lane/longSubjectTicket ids.
  for (let i = 0; i < (extraTodoCount ?? 0); i++) {
    tickets.push({
      id: `8${String(i).padStart(3, "0")}`,
      subject: `Fold8 AC-probe fixture ticket #${i + 1} — a moderately long subject line exercising the 2-line clamp and card density under the compact grid-tier card variant`,
      description: "",
      column: "todo",
      status: "pending",
      blockedBy: [],
      comments: [],
      updatedAt: now - (30 + i) * 60_000,
      sessionId: SESSION_ID,
    });
  }

  // fold8-4x3-bugfix AC-3 — production-scale filler, round-robined across all
  // 4 columns. Uses a distinct id namespace (`9k...`) so it never collides
  // with the live-lane (`90i`), context (`70x`), longSubject, or extraTodo
  // (`8ddd`) id spaces above.
  if (bigPayload && bigPayload.count > 0) {
    const filler = "x".repeat(Math.max(0, bigPayload.descriptionBytes));
    for (let i = 0; i < bigPayload.count; i++) {
      const column = COLUMNS[i % COLUMNS.length];
      const status: Ticket["status"] =
        column === "done" ? "completed" : column === "todo" ? "pending" : "in_progress";
      tickets.push({
        id: `9k${i}`,
        subject: `Production-scale fixture ticket #${i + 1} of ${bigPayload.count} — synthetic AC-3 payload-scale filler`,
        description: filler,
        column,
        status,
        blockedBy: [],
        comments: [],
        updatedAt: now - (60 + i) * 60_000, // old + never active
        sessionId: SESSION_ID,
      });
    }
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
