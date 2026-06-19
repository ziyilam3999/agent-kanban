"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Board, Column, Ticket } from "@/lib/board-schema";
import { COLUMNS, COLUMN_LABELS } from "@/lib/board-schema";
import { COLUMN_HUE } from "@/lib/ui-meta";
import { Card } from "./Card";
import { PipelineMeter } from "./PipelineMeter";
import { SessionPicker } from "./SessionPicker";
import { Drawer } from "./Drawer";

const POLL_MS = 1500;
const GLOW_MS = 700;

/**
 * Tickets visible for the selected session. Tickets carry an 8-char `sessionId`
 * (v0.2.0+). FALLBACK: when NO ticket is tagged (a stale pre-v0.2.0 snapshot),
 * show ALL tickets rather than blanking the board.
 */
function filterVisible(
  tickets: Ticket[],
  sessionId: string | undefined
): Ticket[] {
  const anyTagged = tickets.some((t) => t.sessionId);
  if (!anyTagged) return tickets;
  return tickets.filter((t) => t.sessionId === sessionId);
}

export function BoardView({ initial }: { initial: Board }) {
  const reduce = useReducedMotion();
  const params = useSearchParams();

  const [board, setBoard] = useState<Board>(initial);
  // Deterministic SSR/first-paint clock; advances to wall-clock after mount.
  const [now, setNow] = useState<number>(initial.generatedAt);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [activeCol, setActiveCol] = useState(0);

  // Map of ticket-id -> last-seen column, for per-poll diffing. Scoped to the
  // selected session (see the session-change reset effect below).
  const prevCols = useRef<Map<string, Column>>(new Map());
  // Latest selected-session id, readable inside the (deps-empty) poll closure.
  const currentSessionIdRef = useRef<string | undefined>(undefined);
  const stripRef = useRef<HTMLDivElement>(null);
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Poll the API, diff each snapshot, flag movers + new tickets ----
  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch("/api/board", { cache: "no-store" });
        if (!res.ok) return;
        const next: Board = await res.json();
        if (!alive) return;

        // Diff only the SELECTED session's tickets so movement/fresh glow is
        // per-session (the full board carries every session's tickets now).
        const nextVisible = filterVisible(
          next.tickets,
          currentSessionIdRef.current
        );
        const movedNow = new Set<string>();
        const freshNow = new Set<string>();
        for (const t of nextVisible) {
          const prev = prevCols.current.get(t.id);
          if (prev === undefined) freshNow.add(t.id);
          else if (prev !== t.column) movedNow.add(t.id);
        }
        prevCols.current = new Map(nextVisible.map((t) => [t.id, t.column]));

        setBoard(next);
        setNow(Date.now());

        if (movedNow.size || freshNow.size) {
          setMoved(movedNow);
          setFresh(freshNow);
          if (glowTimer.current) clearTimeout(glowTimer.current);
          glowTimer.current = setTimeout(() => {
            if (!alive) return;
            setMoved(new Set());
            setFresh(new Set());
          }, GLOW_MS);
        }
      } catch {
        /* transient fetch error — keep last good board, retry next tick */
      }
    }

    setNow(Date.now());
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
      if (glowTimer.current) clearTimeout(glowTimer.current);
    };
  }, []);

  // ---- Selected session (URL ?session= wins, else the board default) ----
  // board.sessionId is the FULL session uuid; sessions[].id is its 8-char prefix
  // (and the ?session= param). Match by exact id OR prefix so both forms resolve.
  const selectedSession = params.get("session") ?? board.sessionId;
  const matchSession = (key: string) =>
    board.sessions.find((s) => s.id === key || key.startsWith(s.id)) ?? null;
  const currentSession =
    matchSession(selectedSession) ??
    matchSession(board.sessionId) ??
    board.sessions[0] ??
    null;
  const isLive = !!currentSession?.live;

  // ---- Tickets visible for the selected session ----
  // Tickets carry an 8-char `sessionId` (v0.2.0+); filter to the selected session.
  // FALLBACK: if NO ticket is tagged (a stale pre-v0.2.0 snapshot), show ALL tickets
  // instead of blanking the board. Match the ticket's 8-char id to currentSession.id.
  const visible = useMemo(
    () => filterVisible(board.tickets, currentSession?.id),
    [board.tickets, currentSession?.id]
  );

  // Keep the poll closure's session id current.
  currentSessionIdRef.current = currentSession?.id;

  // Re-key the poll-diff baseline whenever the selected session changes, so
  // switching sessions does NOT falsely flag every new-session card as moved/fresh.
  useEffect(() => {
    prevCols.current = new Map(
      filterVisible(board.tickets, currentSession?.id).map((t) => [
        t.id,
        t.column,
      ])
    );
    setMoved(new Set());
    setFresh(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession?.id]);

  // ---- Tickets grouped by column, newest-updated first ----
  const grouped = useMemo(() => {
    const g: Record<Column, Ticket[]> = {
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
    };
    for (const t of visible) g[t.column].push(t);
    for (const c of COLUMNS) g[c].sort((a, b) => b.updatedAt - a.updatedAt);
    return g;
  }, [visible]);

  const onStripScroll = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const per = el.scrollWidth / COLUMNS.length;
    const idx = Math.round(el.scrollLeft / per);
    setActiveCol(Math.max(0, Math.min(COLUMNS.length - 1, idx)));
  }, []);

  function scrollToCol(i: number) {
    const el = stripRef.current;
    if (!el) return;
    const per = el.scrollWidth / COLUMNS.length;
    el.scrollTo({ left: per * i, behavior: reduce ? "auto" : "smooth" });
  }

  const selectedTicket = selectedId
    ? visible.find((t) => t.id === selectedId) ?? null
    : null;

  return (
    <div className="ak-app">
      <h1 className="ak-sr-only">
        agent-kanban — live board for {currentSession?.label ?? "the current session"}
      </h1>
      <header className="ak-header">
        <div className="ak-header__row">
          <div className="ak-brand">
            <SessionPicker
              sessions={board.sessions}
              selectedId={selectedSession}
            />
          </div>
          <span
            className={`ak-live${isLive ? "" : " ak-live--off"}`}
            aria-live="polite"
          >
            <span className="ak-live__dot" aria-hidden />
            {isLive ? "LIVE" : "IDLE"}
          </span>
        </div>
        <PipelineMeter tickets={visible} />
      </header>

      <main>
        <div
          className="ak-strip"
          ref={stripRef}
          onScroll={onStripScroll}
          aria-label="pipeline columns"
        >
          {COLUMNS.map((col) => (
            <section className="ak-col" key={col} aria-label={COLUMN_LABELS[col]}>
              <div
                className="ak-col__head"
                style={{ ["--hue" as string]: COLUMN_HUE[col] }}
              >
                <span className="ak-col__rail" aria-hidden />
                <span className="ak-col__name">{COLUMN_LABELS[col]}</span>
                <span className="ak-col__count">{grouped[col].length}</span>
              </div>

              <div className="ak-col__body">
                <AnimatePresence initial={false}>
                  {grouped[col].length === 0 ? (
                    <div className="ak-col__empty" key="__empty">
                      no tickets
                    </div>
                  ) : (
                    grouped[col].map((t) => (
                      <motion.button
                        key={t.id}
                        type="button"
                        layout={!reduce}
                        className="ak-cardbtn"
                        aria-label={`Open ticket #${t.id}: ${t.subject}`}
                        onClick={() => setSelectedId(t.id)}
                        initial={
                          fresh.has(t.id) && !reduce
                            ? { opacity: 0, y: 10 }
                            : false
                        }
                        animate={{ opacity: 1, y: 0 }}
                        exit={
                          reduce
                            ? { opacity: 0 }
                            : { opacity: 0, scale: 0.97 }
                        }
                        transition={
                          reduce
                            ? { duration: 0 }
                            : { duration: 0.32, ease: "easeOut" }
                        }
                      >
                        <Card
                          ticket={t}
                          nowMs={now}
                          glow={moved.has(t.id) || fresh.has(t.id)}
                          reduce={!!reduce}
                        />
                      </motion.button>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </section>
          ))}
        </div>

        <div className="ak-dots" role="tablist" aria-label="jump to column">
          {COLUMNS.map((col, i) => (
            <button
              key={col}
              type="button"
              role="tab"
              aria-selected={activeCol === i}
              aria-label={COLUMN_LABELS[col]}
              className={`ak-dots__dot${
                activeCol === i ? " ak-dots__dot--active" : ""
              }`}
              onClick={() => scrollToCol(i)}
            />
          ))}
        </div>
      </main>

      <Drawer
        ticket={selectedTicket}
        nowMs={now}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
