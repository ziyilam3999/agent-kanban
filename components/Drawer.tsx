"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
  type PanInfo,
} from "motion/react";
import type { Ticket } from "@/lib/board-schema";
import { COLUMN_LABELS } from "@/lib/board-schema";
import {
  COLUMN_HUE,
  PIPELINE_ROLES,
  roleColor,
  roleLabel,
  verdictHue,
} from "@/lib/ui-meta";
import { relativeTime, elapsedGap } from "@/lib/relative-time";

interface DrawerProps {
  ticket: Ticket | null;
  /** Wall-clock ms epoch, threaded from BoardView, for relative timestamps. */
  nowMs: number;
  onClose: () => void;
}

/**
 * Minimum vertical travel (px) before a body touch gesture commits to a
 * scroll-vs-dismiss decision. Below this, a stray tap/jitter is ignored so we
 * don't latch a direction on noise. Small enough to feel immediate once the
 * user is genuinely pulling.
 */
const PULLDOWN_INTENT_PX = 6;

/** In-flight body pull-down gesture, tracked per active touch pointer. */
interface PulldownGesture {
  pointerId: number;
  startY: number;
  /** Latest known finger Y — used to compute per-step deltas for manual scroll replay. */
  lastY: number;
  /**
   * Captured once, at gesture start: was the body already at `scrollTop===0`?
   * Native scroll is pre-emptively suppressed (see the touchstart/touchmove
   * effect below) for the whole ambiguous window whenever this is true — a
   * Chromium/WebKit touch-action:auto region commits to native scroll
   * handling within a few px of ANY vertical movement, regardless of
   * scrollTop, so we must own the gesture from the first frame to have any
   * chance at the dismiss path. If it then resolves to "scroll" (an upward
   * pull), native scrolling does NOT resume mid-gesture once its default has
   * been prevented (verified empirically) — see the manual scrollTop replay
   * in onBodyPointerMove below.
   */
  startedAtTop: boolean;
  /**
   * Latched scroll-vs-dismiss decision — `null` while still ambiguous (too
   * little vertical travel yet to tell direction), then set exactly once:
   * `true` = dismiss (down + at-top), `false` = scroll (never re-evaluated).
   */
  dismiss: boolean | null;
}

/** Local wall-clock HH:MM for a ledger ISO timestamp (client-only — drawer is post-click). */
function localClock(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Bottom-sheet (mobile) / side panel (desktop) showing one ticket's black-box log. */
export function Drawer({ ticket, nowMs, onClose }: DrawerProps) {
  const reduce = useReducedMotion();
  const controls = useDragControls();
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Per-gesture scratch state — a ref (not state) so tracking a touch never
  // triggers a re-render; only one touch is tracked at a time (pointerId-gated).
  const pulldownGesture = useRef<PulldownGesture | null>(null);

  // Lock scroll, focus the close button, ESC + focus-trap while open.
  useEffect(() => {
    if (!ticket) return;
    const prevOverflow = document.body.style.overflow;
    // Remember the trigger (the card button) so focus returns there on close.
    const trigger = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = sheetRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Return focus to the card that opened the drawer (keyboard place-keeping).
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [ticket, onClose]);

  function onDragEnd(_e: unknown, info: PanInfo) {
    if (info.offset.y > 90 || info.velocity.y > 600) onClose();
  }

  /**
   * Retain native-touch gesture ownership for the whole duration of any
   * gesture that starts at `scrollTop===0`. A Chromium/mobile-WebKit
   * touch-action:auto region commits to native scroll handling after only a
   * few px of movement — REGARDLESS of `scrollTop` — and fires `pointercancel`
   * the instant it does, which permanently cuts off the PointerEvent stream
   * `onBodyPointerMove` below relies on to make the gate decision and drive
   * `controls.start`. A plain `Element.addEventListener` (non-passive) is
   * required: calling `preventDefault()` from React's synthetic
   * onPointerDown/onPointerMove — or from a passive listener — does NOT
   * suppress that native takeover (verified empirically); nor does native
   * scrolling resume mid-gesture once its default HAS been prevented, even if
   * a later touchmove stops calling preventDefault (also verified
   * empirically) — hence the gesture, once claimed, is owned for its entire
   * lifetime (see `startedAtTop` above). This listener does ONLY
   * gesture-ownership bookkeeping; the actual dismiss-vs-scroll decision,
   * `controls.start` call, and manual scroll replay live in the PointerEvent
   * handlers below (Pointer events fire before their sibling Touch events for
   * the same input step, so `pulldownGesture` is always fresh by the time
   * this runs).
   */
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    function onTouchStart(e: TouchEvent) {
      if (reduce || e.touches.length !== 1) return;
      if ((bodyRef.current?.scrollTop ?? -1) === 0) e.preventDefault();
    }

    function onTouchMove(e: TouchEvent) {
      if (reduce) return;
      // Own every touchmove of a gesture that started at the top, for its
      // whole lifetime — whichever way it resolves (dismiss-drag or manual
      // scroll replay, both driven from onBodyPointerMove below). A gesture
      // that started scrolled (Case B) never reaches here with startedAtTop,
      // so native scroll runs completely untouched, as today.
      if (pulldownGesture.current?.startedAtTop) e.preventDefault();
    }

    body.addEventListener("touchstart", onTouchStart, { passive: false });
    body.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      body.removeEventListener("touchstart", onTouchStart);
      body.removeEventListener("touchmove", onTouchMove);
    };
    // Re-attach whenever the body element (re)mounts — it only exists in the
    // DOM while `ticket` is set (AnimatePresence), so `bodyRef.current` is
    // null on the drawer's very first (closed) render.
  }, [reduce, ticket]);

  /**
   * Native-iOS-style pull-down-to-dismiss on the scroll BODY (alongside the
   * existing grip-only drag). Touch-only (mouse/pen pointer types are ignored
   * so a desktop mouse drag/select never engages this — the grip stays the
   * only desktop-adjacent affordance; desktop hides the grip entirely).
   */
  function onBodyPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (reduce || e.pointerType !== "touch") return;
    pulldownGesture.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      startedAtTop: (bodyRef.current?.scrollTop ?? -1) === 0,
      dismiss: null,
    };
  }

  /**
   * The scroll-vs-dismiss gate (R1/R5): latched ONCE, the moment a downward
   * intent is first detected, from the scroll body's LIVE `scrollTop` at
   * gesture START (captured in `startedAtTop` above). If the body wasn't at
   * the very top, or the finger is moving up, this gesture is native scroll
   * for its entire lifetime — never re-evaluated mid-drag (that
   * hand-off-after-native-scroll-has-the-pointer path is the #1447 trap).
   */
  function onBodyPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (reduce || e.pointerType !== "touch") return;
    const gesture = pulldownGesture.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;

    if (gesture.dismiss === null) {
      const dy = e.clientY - gesture.startY;
      if (Math.abs(dy) < PULLDOWN_INTENT_PX) return; // still ambiguous

      gesture.dismiss = dy > 0 && gesture.startedAtTop;
      if (gesture.dismiss) {
        // Hand off to the same dismiss-drag machinery the grip uses —
        // identical rubber-band + release threshold (onDragEnd, unchanged).
        controls.start(e);
      } else if (gesture.startedAtTop && bodyRef.current) {
        // Resolved to scroll, but native scrolling was pre-emptively
        // suppressed for this gesture (it started at the top) and won't
        // resume on its own — replay the movement onto scrollTop ourselves.
        bodyRef.current.scrollTop += gesture.lastY - e.clientY;
      }
      gesture.lastY = e.clientY;
      return;
    }

    if (gesture.dismiss === false && gesture.startedAtTop && bodyRef.current) {
      bodyRef.current.scrollTop += gesture.lastY - e.clientY;
    }
    gesture.lastY = e.clientY;
    // dismiss === true: framer-motion's own drag machinery owns the rest.
    // dismiss === false && !startedAtTop: native scroll owns it (Case B) —
    // untouched, exactly as today.
  }

  function onBodyPointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    if (pulldownGesture.current?.pointerId === e.pointerId) {
      pulldownGesture.current = null;
    }
  }

  return (
    <AnimatePresence>
      {ticket && (
        <>
          <motion.div
            className="ak-scrim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
          />
          <motion.aside
            ref={sheetRef}
            className="ak-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Ticket #${ticket.id} audit log`}
            initial={reduce ? { opacity: 0 } : { y: "100%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={
              reduce ? { duration: 0 } : { type: "spring", damping: 32, stiffness: 320 }
            }
            drag={reduce ? false : "y"}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={onDragEnd}
          >
            <span
              className="ak-drawer__grip"
              aria-hidden
              onPointerDown={(e) => {
                if (!reduce) controls.start(e);
              }}
            />

            <div className="ak-drawer__head">
              <span className="ak-drawer__id">#{ticket.id}</span>
              <span
                className="ak-chip"
                style={{ ["--hue" as string]: COLUMN_HUE[ticket.column] }}
              >
                {COLUMN_LABELS[ticket.column]}
              </span>
              <button
                ref={closeRef}
                type="button"
                className="ak-drawer__close"
                aria-label="Close"
                onClick={onClose}
              >
                ✕
              </button>
            </div>

            <div
              ref={bodyRef}
              className="ak-drawer__body"
              data-ak-pulldown
              onPointerDown={onBodyPointerDown}
              onPointerMove={onBodyPointerMove}
              onPointerUp={onBodyPointerEnd}
              onPointerCancel={onBodyPointerEnd}
            >
              {/* Hero title — first block of the SCROLL body. Relocated out of the
                  pinned head (#1447 Option B) so a pathologically long subject only
                  makes the body taller (and scrollable), never starves it. */}
              <h2 className="ak-drawer__title">{ticket.subject}</h2>

              {ticket.description && (
                <p className="ak-drawer__desc">{ticket.description}</p>
              )}

              <PipelineProgress ticket={ticket} />

              <p className="ak-drawer__section">Black-box timeline</p>

              {ticket.comments.length === 0 ? (
                <p className="ak-timeline__empty">No role events recorded yet.</p>
              ) : (
                <ol className="ak-timeline">
                  {ticket.comments.map((c, i) => {
                    const gap =
                      i > 0
                        ? elapsedGap(ticket.comments[i - 1].ts, c.ts)
                        : null;
                    return (
                      <li
                        key={`${c.role}-${c.ts}-${i}`}
                        className="ak-node"
                        style={{ ["--node" as string]: roleColor(c.role) }}
                      >
                        <span className="ak-node__dot" aria-hidden />
                        <div className="ak-node__head">
                          <span className="ak-node__role">
                            {roleLabel(c.role)}
                          </span>
                          {c.verdict && (
                            <span
                              className="ak-verdict"
                              style={{
                                ["--vhue" as string]: verdictHue(c.verdict),
                              }}
                            >
                              {c.verdict}
                            </span>
                          )}
                          <span className="ak-node__ts">
                            {relativeTime(Date.parse(c.ts), nowMs)}
                            {localClock(c.ts) && ` · ${localClock(c.ts)}`}
                          </span>
                          {gap && (
                            <span className="ak-node__elapsed">{gap}</span>
                          )}
                          {c.agentId && (
                            <span className="ak-node__agent">·{c.agentId}</span>
                          )}
                        </div>
                        {c.skipReason ? (
                          <span className="ak-node__skip">
                            — skipped: {c.skipReason}
                          </span>
                        ) : c.artifact ? (
                          <span className="ak-node__artifact">
                            ▸ {c.artifact}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * 4-step pipeline-progress header (planner → plan-review → executor → exec-review).
 * A step is DONE when its role appears in the ledger; the first not-yet-acted role
 * is the CURRENT/next pending stage.
 */
function PipelineProgress({ ticket }: { ticket: Ticket }) {
  const rolesSeen = new Set(ticket.comments.map((c) => c.role));
  const nextPending = PIPELINE_ROLES.find((r) => !rolesSeen.has(r)) ?? null;
  const doneCount = PIPELINE_ROLES.filter((r) => rolesSeen.has(r)).length;

  return (
    <div
      className="ak-pipeline"
      role="img"
      aria-label={`pipeline progress: ${doneCount} of ${PIPELINE_ROLES.length} roles complete${
        nextPending ? `, next: ${roleLabel(nextPending)}` : ""
      }`}
    >
      {PIPELINE_ROLES.map((role) => {
        const done = rolesSeen.has(role);
        const current = !done && role === nextPending;
        const state = done ? "done" : current ? "current" : "pending";
        return (
          <div
            key={role}
            className={`ak-pipeline__step ak-pipeline__step--${state}`}
            style={{ ["--step" as string]: roleColor(role) }}
          >
            <span className="ak-pipeline__bar" aria-hidden />
            <span className="ak-pipeline__label">{roleLabel(role)}</span>
          </div>
        );
      })}
    </div>
  );
}
