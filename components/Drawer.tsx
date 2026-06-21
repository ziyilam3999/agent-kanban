"use client";

import { useEffect, useRef } from "react";
import {
  AnimatePresence,
  motion,
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
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={onDragEnd}
          >
            <span className="ak-drawer__grip" aria-hidden />

            <div className="ak-drawer__head">
              <span className="ak-drawer__id">#{ticket.id}</span>
              <h2 className="ak-drawer__subject">{ticket.subject}</h2>
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

            <div className="ak-drawer__body">
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
