"use client";

import { useCallback, useEffect, useState } from "react";
import type { Ticket, TicketKind } from "@/lib/board-schema";
import { Card } from "./Card";

interface ShelfProps {
  /** OPEN (non-terminal) non-work tickets for the selected session, any kind
   *  in {bookkeeping, parked, deferred}. Already filtered by the caller. */
  tickets: Ticket[];
  now: number;
  onSelect: (id: string) => void;
}

const SHELF_KINDS: ReadonlyArray<{ kind: TicketKind; label: string }> = [
  { kind: "bookkeeping", label: "Bookkeeping" },
  { kind: "parked", label: "Parked" },
  { kind: "deferred", label: "Deferred" },
];

/** localStorage key for the viewer's remembered open/closed shelf state (#D2). */
const SHELF_OPEN_KEY = "ak-shelf-open";

/**
 * Best-effort read of the viewer's remembered shelf open/closed state.
 * try/catch guarded (private-browsing / storage-blocked contexts throw) — a
 * failed read is treated as "no stored preference", which resolves to
 * CLOSED (the AC-1.4 default: closed on load for a fresh viewer/context).
 */
function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(SHELF_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredOpen(open: boolean): void {
  try {
    window.localStorage.setItem(SHELF_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* best-effort — a blocked/private storage context is not fatal */
  }
}

/**
 * board-noise triage (task-kind-contract.md §4 D2) — the collapsed shelf strip
 * below the column board. Holds every OPEN non-work ticket (bookkeeping /
 * parked / deferred), grouped by kind, closed by default (AC-1.4), with the
 * open/closed state remembered per viewer (localStorage, try/catch — never
 * fatal if storage is unavailable).
 */
export function Shelf({ tickets, now, onSelect }: ShelfProps) {
  // Deterministic SSR/first-paint state (closed) — the stored preference is
  // read client-side only, after mount, avoiding a hydration mismatch.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(readStoredOpen());
  }, []);

  const onToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      const next = e.currentTarget.open;
      setOpen(next);
      writeStoredOpen(next);
    },
    []
  );

  const counts: Record<TicketKind, number> = {
    work: 0,
    bookkeeping: 0,
    parked: 0,
    deferred: 0,
  };
  for (const t of tickets) {
    const k = t.kind ?? "work";
    counts[k] = (counts[k] ?? 0) + 1;
  }

  const summary = SHELF_KINDS.map(({ kind, label }) => `${label} ${counts[kind]}`).join(" · ");

  return (
    <details className="ak-shelf" open={open} onToggle={onToggle}>
      <summary className="ak-shelf__summary">{summary}</summary>
      <div className="ak-shelf__body">
        {SHELF_KINDS.map(({ kind, label }) => {
          const group = tickets.filter((t) => (t.kind ?? "work") === kind);
          if (group.length === 0) return null;
          return (
            <div className="ak-shelf__group" key={kind}>
              <p className="ak-shelf__group-label">{label}</p>
              <div className="ak-shelf__cards">
                {group.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="ak-cardbtn ak-shelf-card"
                    aria-label={`Open ticket #${t.id}: ${t.subject}`}
                    onClick={() => onSelect(t.id)}
                  >
                    <Card ticket={t} nowMs={now} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
