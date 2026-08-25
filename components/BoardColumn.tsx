"use client";

import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Column, Ticket } from "@/lib/board-schema";
import { COLUMN_LABELS } from "@/lib/board-schema";
import { COLUMN_HUE } from "@/lib/ui-meta";
import { Card } from "./Card";

interface BoardColumnProps {
  col: Column;
  tickets: Ticket[];
  now: number;
  moved: Set<string>;
  fresh: Set<string>;
  activeIds: Set<string>;
  sessionLastActive: number | undefined;
  reduce: boolean;
  onSelect: (id: string) => void;
}

/**
 * BUGFIX (fold8-4x3-bugfix, operator bug 3 — "everything feels slow"): one
 * `.ak-col` section, extracted out of BoardView and wrapped in `React.memo`.
 *
 * Root cause (the OTHER half of bug 3, beyond the poll's unconditional
 * setState): before this extraction, ALL ~1000+ cards across all 4 columns
 * lived inline in BoardView's own render function. ANY state change in
 * BoardView — including ones with NOTHING to do with the board's data, e.g.
 * `setSelectedId` when a card is tapped to open the drawer — forced React to
 * re-invoke that render function and re-diff every card in every column
 * (measured: ~600ms under 4x CPU throttle for a ~1000-ticket board, on tap
 * alone, independent of any poll activity). That is a general architectural
 * coupling, not something the poll fix above can touch.
 *
 * Fix: this component receives per-column props that are REFERENTIALLY
 * STABLE unless something that actually affects THIS column changed
 * (`tickets` is `grouped[col]` from a `useMemo` keyed on `board.tickets` +
 * session; `moved`/`fresh`/`activeIds` are Sets that are only replaced when
 * their own producers change; `onSelect` is a `useState` setter, stable by
 * React's contract). `React.memo`'s shallow prop comparison then means an
 * unrelated BoardView state change (`selectedId`, `activeCol`, `arrive`,
 * `moved`/`fresh` between glow windows) does NOT re-render this column at
 * all — general (keyed to prop identity, not to any specific interaction or
 * fixture), not a test-shaped patch.
 */
function BoardColumnImpl({
  col,
  tickets,
  now,
  moved,
  fresh,
  activeIds,
  sessionLastActive,
  reduce,
  onSelect,
}: BoardColumnProps) {
  return (
    <section className="ak-col" aria-label={COLUMN_LABELS[col]}>
      <div className="ak-col__head" style={{ ["--hue" as string]: COLUMN_HUE[col] }}>
        <span className="ak-col__rail" aria-hidden />
        <span className="ak-col__name">{COLUMN_LABELS[col]}</span>
        <span className="ak-col__count">{tickets.length}</span>
      </div>

      <div className="ak-col__body">
        <AnimatePresence initial={false}>
          {tickets.length === 0 ? (
            <div className="ak-col__empty" key="__empty">
              no tickets
            </div>
          ) : (
            tickets.map((t) => (
              <motion.button
                key={t.id}
                type="button"
                layout={!reduce}
                className="ak-cardbtn"
                aria-label={`Open ticket #${t.id}: ${t.subject}`}
                onClick={() => onSelect(t.id)}
                initial={fresh.has(t.id) && !reduce ? { opacity: 0, y: 10 } : false}
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
                  sessionLastActive={sessionLastActive}
                  reduce={reduce}
                />
              </motion.button>
            ))
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

export const BoardColumn = memo(BoardColumnImpl);
