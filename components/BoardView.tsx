"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Board, Column, Ticket } from "@/lib/board-schema";
import { COLUMNS, COLUMN_LABELS } from "@/lib/board-schema";
import { computeActiveIds } from "@/lib/active";
import { deriveLanes } from "@/lib/lanes";
import { decideLaneReveal } from "@/lib/lane-reveal";
import { COLUMN_HUE } from "@/lib/ui-meta";
import { Card } from "./Card";
import { LiveSwimlanes } from "./LiveSwimlanes";
import { PipelineMeter } from "./PipelineMeter";
import { SessionPicker } from "./SessionPicker";
import { Drawer } from "./Drawer";

// 5s poll: paired with the /api/board CDN cache (s-maxage=10), most polls are
// served from the edge, not Compute — the #1138 Fast-Origin-Transfer cut. Board
// freshness lags at most ~10s, imperceptible for a live dashboard.
const POLL_MS = 5000;
// Hold the moved/fresh flag for the full arrival-glow animation (ak-glow 1.9s).
const GLOW_MS = 2000;
// #1456: hold the Live Swimlanes one-shot arrival cue for the full
// `ak-lanes-arrive` keyframe run (globals.css, 1.9s — the ak-glow family duration).
const ARRIVE_MS = 1900;

/**
 * #1456 — true when `el`'s bounding box is ALREADY fully within the viewport
 * (the auto-reveal "don't-yank" guard). A zero-size rect (not yet laid out —
 * also jsdom's default with no real layout engine) is treated as NOT visible:
 * there is nothing on-screen yet to consider "already revealed". NOTE: this
 * runtime computation has NO automated jsdom proof (plan risk r5 — jsdom
 * returns an all-zero rect for every element); its correctness rests on the
 * ui-evolve real-browser screenshots, not a unit test.
 */
function isAlreadyInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  return (
    rect.top >= 0 && rect.left >= 0 && rect.bottom <= vh && rect.right <= vw
  );
}

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
  // #1456: true for the one-shot Live Swimlanes arrival cue (`ak-lanes--arrive`).
  const [arrive, setArrive] = useState(false);

  // Map of ticket-id -> last-seen column, for per-poll diffing. Scoped to the
  // selected session (see the session-change reset effect below).
  const prevCols = useRef<Map<string, Column>>(new Map());
  // Latest selected-session id, readable inside the (deps-empty) poll closure.
  const currentSessionIdRef = useRef<string | undefined>(undefined);
  const stripRef = useRef<HTMLDivElement>(null);
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #1456: the revealed Live Swimlanes panel (`.ak-lanes`) — scrollIntoView target
  // + viewport-visibility probe. Forwarded through LiveSwimlanes to the section
  // itself (not a wrapper) so `scroll-margin-top` applies to the right element.
  const panelRef = useRef<HTMLElement>(null);
  const arriveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Poll the API, diff each snapshot, flag movers + new tickets ----
  useEffect(() => {
    let alive = true;

    async function poll() {
      // Skip while the tab is hidden (board left open on a phone in a pocket): no
      // point spending Edge Requests + Origin/Blob transfer on a board nobody is
      // looking at. We refresh immediately when it becomes visible again (below).
      if (typeof document !== "undefined" && document.hidden) return;
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

    // Refresh the instant the tab is focused again so a returning viewer sees fresh
    // state without waiting for the next interval tick (pairs with the hidden-skip
    // in poll() above).
    function onVisible() {
      if (document.visibilityState === "visible") poll();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }

    setNow(Date.now());
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
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

  // ---- Tickets the agent is ACTIVELY working right now (breathing heartbeat) ----
  // In a live session, the most-recently-updated in-progress ticket (the current
  // focus) always breathes, plus any in-progress ticket touched within the window
  // (parallel work). `now` advances each poll, so when the session goes idle the
  // heartbeat stops. See lib/active.ts for WHY a pure "updated within N min" rule
  // is wrong here (the file-mtime touch cadence is coarse → it goes dark mid-work).
  const activeIds = useMemo(
    () => computeActiveIds(visible, isLive, now),
    [visible, isLive, now],
  );

  // ---- Live swimlanes — one lane per genuinely-live in-progress chain ----
  // Pure client derivation over the activeIds set already in hand (NO new fetch).
  // The header counter shows the count whenever >= 1; the swimlane ROWS mount only
  // when >= 2 (genuine parallel work), above the unchanged column board.
  const lanes = useMemo(() => deriveLanes(visible, activeIds), [visible, activeIds]);
  const laneCount = activeIds.size;

  // ---- #1456: auto-reveal the Live Swimlanes panel when it first appears ----
  // Seeded from lanes.length AT FIRST RENDER (not useRef(0)) so a page that
  // loads already at >=2 lanes does NOT auto-scroll on mount — only a genuine
  // mid-session `<2 -> >=2` crossing counts as an "appearance". Keys on
  // `lanes.length`, the EXACT mount predicate below (`lanes.length >= 2 &&
  // <LiveSwimlanes/>`) — NOT `laneCount` (= activeIds.size) above, a different
  // population that can diverge (deriveLanes further filters to in_progress ∪
  // shipping-after-pass). See lib/lane-reveal.ts for the guard-decision logic.
  const prevLaneCountRef = useRef<number>(lanes.length);

  useEffect(() => {
    const prevCount = prevLaneCountRef.current;
    const currentCount = lanes.length;
    prevLaneCountRef.current = currentCount;

    const el = panelRef.current;
    const alreadyVisible = !!el && isAlreadyInViewport(el);
    const decision = decideLaneReveal({
      prevCount,
      currentCount,
      alreadyVisible,
      drawerOpen: selectedId != null,
      reducedMotion: !!reduce,
    });

    if (decision.reveal && el) {
      // No .focus() — scrollIntoView only, so no focus theft (a11y is already
      // served by the header's aria-live "N LANES LIVE" pill).
      el.scrollIntoView({ block: "start", behavior: decision.behavior });
      setArrive(true);
      if (arriveTimer.current) clearTimeout(arriveTimer.current);
      arriveTimer.current = setTimeout(() => setArrive(false), ARRIVE_MS);
    }

    return () => {
      if (arriveTimer.current) clearTimeout(arriveTimer.current);
    };
  }, [lanes.length, selectedId, reduce]);

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
          <div className="ak-status">
            {laneCount >= 1 && (
              <span className="ak-lanecount" aria-live="polite">
                {laneCount} {laneCount === 1 ? "LANE" : "LANES"} LIVE
              </span>
            )}
            <span
              className={`ak-live${isLive ? "" : " ak-live--off"}`}
              aria-live="polite"
            >
              <span className="ak-live__dot" aria-hidden />
              {isLive ? "LIVE" : "IDLE"}
            </span>
          </div>
        </div>
        <PipelineMeter tickets={visible} />
      </header>

      <main>
        {lanes.length >= 2 && (
          <LiveSwimlanes
            ref={panelRef}
            lanes={lanes}
            reduce={!!reduce}
            arrive={arrive}
          />
        )}

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
                            : // "Lift" — a card leaving a column GROWS + fades
                              // (lifted off the board), not shrinks-away.
                              { opacity: 0, scale: 1.06 }
                        }
                        transition={
                          reduce
                            ? { duration: 0 }
                            : // A deliberate, trackable lift — 0.7s on ease-in-out
                              // (easeInOutCubic) so the fade is EVENLY paced across the
                              // whole move and stays visible, not front-loaded like an
                              // expo-out (which drops opacity in the first ~200ms and
                              // still reads as a flick). Slow start, slow finish.
                              { duration: 0.7, ease: [0.65, 0, 0.35, 1] }
                        }
                      >
                        <Card
                          ticket={t}
                          nowMs={now}
                          glow={moved.has(t.id) || fresh.has(t.id)}
                          active={activeIds.has(t.id)}
                          sessionLastActive={currentSession?.lastActive}
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
