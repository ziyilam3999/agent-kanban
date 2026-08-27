// ticket-equal.ts — board-render-perf-inp CORE lever 1 (render work proportional
// to change): value-equality + a reference-preserving merge for Board.tickets.
//
// `JSON.parse` produces a FRESH object for every ticket on every poll tick that
// actually changed something, even for tickets whose content is byte-identical
// (plan finding #4). That defeats a naive per-card `React.memo` (which bails on
// REFERENCE equality of the `ticket` prop) by design — a lever must either
// compare by VALUE or restore stable identity. `mergeTickets` does the latter:
// it reuses the OLD ticket object for any ticket whose fields are unchanged, so
// exactly the K tickets that genuinely changed get a new reference, and every
// downstream `React.memo` (BoardCard) correctly skips re-rendering the rest.

import type { LedgerComment, Ticket } from "./board-schema";

function commentsEqual(a: LedgerComment[], b: LedgerComment[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (
      x.role !== y.role ||
      x.ts !== y.ts ||
      x.agentId !== y.agentId ||
      x.artifact !== y.artifact ||
      x.skipReason !== y.skipReason ||
      x.verdict !== y.verdict ||
      x.modelVersion !== y.modelVersion ||
      x.modelTier !== y.modelTier ||
      x.effort !== y.effort ||
      x.closedAt !== y.closedAt
    ) {
      return false;
    }
  }
  return true;
}

function stringArrayEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** True iff every FIELD of `a` and `b` is value-equal (same ticket content, not merely the same id). */
export function ticketsEqual(a: Ticket, b: Ticket): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.subject === b.subject &&
    a.description === b.description &&
    a.column === b.column &&
    a.status === b.status &&
    a.updatedAt === b.updatedAt &&
    a.sessionId === b.sessionId &&
    a.onHold === b.onHold &&
    stringArrayEqual(a.blockedBy, b.blockedBy) &&
    commentsEqual(a.comments, b.comments)
  );
}

/**
 * Build a new tickets array from `next`, reusing each `prev` ticket's OBJECT
 * REFERENCE wherever the two are value-equal (same id, byte-identical fields).
 * A genuinely-changed or newly-added ticket keeps the fresh `next` object.
 * Removed tickets simply do not appear (the result is built by walking `next`,
 * never `prev`) — this is the merge of a full replacement snapshot, not a
 * patch: `next` is always authoritative for membership and order.
 */
export function mergeTickets(prev: Ticket[], next: Ticket[]): Ticket[] {
  if (prev.length === 0) return next;
  const prevById = new Map<string, Ticket>();
  for (const t of prev) prevById.set(t.id, t);
  return next.map((t) => {
    const old = prevById.get(t.id);
    return old && ticketsEqual(old, t) ? old : t;
  });
}
