"use client";

import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { Column, Ticket } from "@/lib/board-schema";
import { COLUMN_LABELS } from "@/lib/board-schema";
import { COLUMN_HUE } from "@/lib/ui-meta";
import { BoardCard } from "./BoardCard";

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

// board-render-perf-inp CORE lever 2 — mount only the cards near the viewport,
// not the whole column. Below this count windowing adds indirection for zero
// measured benefit (a column this small already renders in well under a
// frame) — skip it entirely and render every card for real, exactly like
// HEAD. Both the tiny columns (in_progress/in_review, ~1-2 tickets on a real
// board) and any small synthetic fixture stay on this simple, zero-risk path.
const WINDOW_THRESHOLD = 60;
// A card is considered "windowed" (rendered for real) once it is within this
// many pixels of the actual viewport, in EITHER direction — generous enough
// that a normal-speed scroll or touch-drag never shows a pop-in/pop-out edge.
// Pixel (not percentage) units: percentage rootMargin needs a newer browser
// baseline than pixel margins, which have been supported since the original
// IntersectionObserver spec.
//
// 600px (not the original 1200px; 300px was also live-tested and showed no
// further reliable improvement — see the evidence file's overscan sweep):
// `root: null` means intersection is measured against
// the PAGE viewport, and at the 4-up grid tier (>=900cqw, e.g. 1000x750)
// all 4 columns sit side by side with none of them horizontally clipped
// out of view — so the overscan margin's "extra" real (unwindowed) cards
// get paid FOUR TIMES over, once per simultaneously-visible column, versus
// TWICE at the narrower horizontal-scroll-strip tier (<=899.98cqw portrait,
// e.g. 750x1000) where only ~2 of the 4 columns are within the page
// viewport's horizontal bounds at once. Measured live (Rule 18): at 1200px,
// the 4-up tier's changed-tick tap-interaction median sat right at the
// AC-2/AC-3 200ms edge (72-216ms across repeated runs, occasionally over);
// 600px keeps the same never-visible-pop-in guarantee (a scroll/drag still
// has to travel 600px before it could ever reach a placeholder) while
// roughly halving the real-card count the 4-up tier's columns mount.
const OVERSCAN_MARGIN = "600px 0px 600px 0px";
// Rendered-for-real for the first paint, before the IntersectionObserver's
// first callback has had a chance to fire (root=null/viewport observers
// still take at least a microtask to report) — generous enough to cover any
// realistic viewport's first screenful without ever needing 1,207. Computed
// identically during SSR (pure slice of the already-sorted array), so there
// is no hydration mismatch between server and client first paint.
const INITIAL_REAL_COUNT = 40;
// Before any card in this column has been measured for real, assume this
// height (px) for a not-yet-seen ticket's placeholder — close to a typical
// single-line-subject card. Self-corrects toward the column's own measured
// tickets the moment any real card renders; this constant only matters for
// tickets nobody has scrolled near yet.
const DEFAULT_CARD_HEIGHT_PX = 120;

/**
 * BUGFIX (fold8-4x3-bugfix, operator bug 3 — "everything feels slow"): one
 * `.ak-col` section, extracted out of BoardView and wrapped in `React.memo`.
 *
 * board-render-perf-inp (2026-08-26) extends this: cards are no longer an
 * inline `tickets.map` of animated nodes — each is its own `React.memo`'d
 * `BoardCard`, keyed so an UNCHANGED ticket (value-equal to its previous poll
 * via `lib/ticket-equal.ts`'s reference-preserving merge, upstream in
 * BoardView) skips re-rendering entirely, and cards outside the viewport (+
 * a generous overscan) render as a cheap, non-animated placeholder instead of
 * paying Framer's `layout` measurement cost. See BoardCard.tsx for why this
 * can never desync AnimatePresence's enter/exit choreography from windowing.
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
  const windowingOn = tickets.length > WINDOW_THRESHOLD;

  const heightCache = useRef<Map<string, number>>(new Map());
  const elRefs = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Lazily seeded once (and identically during SSR + first client render —
  // pure, no browser API) with the first INITIAL_REAL_COUNT tickets so first
  // paint never renders the whole column, yet never flashes empty either.
  // The IntersectionObserver's first callback (below) corrects this to the
  // TRUE viewport-driven set shortly after mount.
  const [inViewIds, setInViewIds] = useState<Set<string> | null>(() =>
    windowingOn
      ? new Set(tickets.slice(0, INITIAL_REAL_COUNT).map((t) => t.id))
      : null,
  );

  useLayoutEffect(() => {
    if (!windowingOn) {
      observerRef.current?.disconnect();
      observerRef.current = null;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setInViewIds((prev) => {
          const next = new Set(prev ?? []);
          let didChange = false;
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.ticketId;
            if (!id) continue;
            const was = next.has(id);
            if (entry.isIntersecting && !was) {
              next.add(id);
              didChange = true;
            } else if (!entry.isIntersecting && was) {
              next.delete(id);
              didChange = true;
            }
          }
          return didChange ? next : (prev ?? next);
        });
      },
      { root: null, rootMargin: OVERSCAN_MARGIN, threshold: 0 },
    );
    observerRef.current = observer;
    for (const el of elRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [windowingOn]);

  const registerEl = useCallback((id: string, el: HTMLElement | null) => {
    const map = elRefs.current;
    const prev = map.get(id);
    if (prev && prev !== el) {
      observerRef.current?.unobserve(prev);
      map.delete(id);
    }
    if (el) {
      map.set(id, el);
      observerRef.current?.observe(el);
    }
  }, []);

  const measure = useCallback((id: string, h: number) => {
    heightCache.current.set(id, h);
  }, []);

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
            tickets.map((t) => {
              const windowed = !windowingOn || !inViewIds || inViewIds.has(t.id);
              return (
                <BoardCard
                  key={t.id}
                  ticket={t}
                  nowMs={now}
                  moved={moved.has(t.id)}
                  fresh={fresh.has(t.id)}
                  active={activeIds.has(t.id)}
                  sessionLastActive={sessionLastActive}
                  reduce={reduce}
                  onSelect={onSelect}
                  windowed={windowed}
                  estimatedHeight={heightCache.current.get(t.id) ?? DEFAULT_CARD_HEIGHT_PX}
                  onMeasure={measure}
                  registerEl={registerEl}
                />
              );
            })
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

export const BoardColumn = memo(BoardColumnImpl);
