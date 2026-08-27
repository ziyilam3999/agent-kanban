"use client";

import { memo, useCallback, useLayoutEffect, useRef } from "react";
import { motion } from "motion/react";
import type { Ticket } from "@/lib/board-schema";
import { Card } from "./Card";

export interface BoardCardProps {
  ticket: Ticket;
  nowMs: number;
  /** This ticket is in the poll's `moved` set (changed column this tick). */
  moved: boolean;
  /** This ticket is in the poll's `fresh` set (newly appeared this tick). */
  fresh: boolean;
  active: boolean;
  sessionLastActive: number | undefined;
  reduce: boolean;
  onSelect: (id: string) => void;
  /**
   * board-render-perf-inp CORE lever 2 (windowing): true renders the REAL
   * animated card; false renders a lightweight, non-interactive placeholder
   * of the SAME estimated height (preserves column scrollHeight / scrollbar
   * length — hazard iv) with NO Card markup and `layout={false}` (no Framer
   * layout-measurement cost — the dominant cost this lever targets).
   *
   * Hazard (i)/(ii) safety: this ticket's React `key` (its id) is ALWAYS
   * present as an AnimatePresence child, in both the real and placeholder
   * render — windowing only swaps which CONTENT that key renders, it never
   * adds/removes the key. AnimatePresence's exit/enter lifecycle is driven
   * purely by a ticket entering/leaving BoardColumn's `tickets` array (a
   * genuine data change), so toggling `windowed` on scroll can never trigger
   * an unwanted exit animation, and a genuine on-screen departure (rendered
   * `windowed=true` at the moment it leaves the data) still plays the real
   * exit-lift on the real Card content.
   */
  windowed: boolean;
  /** Best current estimate of this card's real rendered height (px) — used ONLY for the placeholder's height when `!windowed`. */
  estimatedHeight: number;
  /** Reports this ticket's REAL measured height back to the column's shared height cache whenever the real card renders, so the estimate for every not-yet-measured ticket keeps improving. */
  onMeasure: (id: string, height: number) => void;
  /** Registers/unregisters this card's DOM node with the column's shared IntersectionObserver (the windowing decision itself — see BoardColumn). Called with `null` on unmount. */
  registerEl: (id: string, el: HTMLElement | null) => void;
}

function BoardCardImpl({
  ticket,
  nowMs,
  moved,
  fresh,
  active,
  sessionLastActive,
  reduce,
  onSelect,
  windowed,
  estimatedHeight,
  onMeasure,
  registerEl,
}: BoardCardProps) {
  const localRef = useRef<HTMLButtonElement | null>(null);

  const setRef = useCallback(
    (el: HTMLButtonElement | null) => {
      localRef.current = el;
      registerEl(ticket.id, el);
    },
    [registerEl, ticket.id],
  );

  const handleClick = useCallback(() => onSelect(ticket.id), [onSelect, ticket.id]);

  // Re-measure the REAL card's rendered height whenever its own visible
  // content could have changed height (ticket fields, glow/active state,
  // sessionLastActive) — deliberately NOT on every `nowMs` tick: at this
  // app's granularity (lib/relative-time.ts is minute-granular; lib/ui-meta
  // heldFor is day-granular) a clock advance changes what a line SAYS, never
  // how many lines there are, so re-measuring on every tick would be pure
  // waste — the same reasoning BoardView's clock-quantization relies on.
  useLayoutEffect(() => {
    if (!windowed) return;
    const el = localRef.current;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    if (h > 0) onMeasure(ticket.id, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowed, ticket, active, moved, fresh, sessionLastActive]);

  if (!windowed) {
    return (
      <motion.button
        ref={setRef}
        type="button"
        layout={false}
        className="ak-card-spacer"
        style={{ height: estimatedHeight }}
        aria-hidden="true"
        tabIndex={-1}
        data-ticket-id={ticket.id}
      />
    );
  }

  return (
    <motion.button
      ref={setRef}
      type="button"
      layout={!reduce}
      className="ak-cardbtn"
      aria-label={`Open ticket #${ticket.id}: ${ticket.subject}`}
      onClick={handleClick}
      data-ticket-id={ticket.id}
      initial={fresh && !reduce ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={
        reduce
          ? { opacity: 0 }
          : // "Lift" — a card leaving a column GROWS + fades (lifted off the
            // board), not shrinks-away.
            { opacity: 0, scale: 1.06 }
      }
      transition={
        reduce
          ? { duration: 0 }
          : // A deliberate, trackable lift — 0.7s on ease-in-out
            // (easeInOutCubic) so the fade is EVENLY paced across the whole
            // move and stays visible, not front-loaded like an expo-out
            // (which drops opacity in the first ~200ms and still reads as a
            // flick). Slow start, slow finish.
            { duration: 0.7, ease: [0.65, 0, 0.35, 1] }
      }
    >
      <Card
        ticket={ticket}
        nowMs={nowMs}
        glow={moved || fresh}
        active={active}
        sessionLastActive={sessionLastActive}
        reduce={reduce}
      />
    </motion.button>
  );
}

export const BoardCard = memo(BoardCardImpl);
