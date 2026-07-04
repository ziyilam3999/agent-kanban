"use client";

import { forwardRef } from "react";
import { motion } from "motion/react";
import type { Lane } from "@/lib/lanes";
import { PIPELINE_ROLES, roleColor, roleLabel } from "@/lib/ui-meta";

interface LiveSwimlanesProps {
  /** The live lanes to render — one row each. Caller mounts this only at length >= 2. */
  lanes: Lane[];
  /** Reduced-motion: omit the lit-stage pulse loop (static mint highlight remains). */
  reduce?: boolean;
  /**
   * #1456 — true for the one-shot arrival cue (mint ring/border pulse) right after
   * BoardView auto-reveals this panel on a genuine `<2 -> >=2` transition. Purely a
   * class toggle — no layout shift (see globals.css `.ak-lanes--arrive`).
   */
  arrive?: boolean;
}

/**
 * Live Swimlanes — one horizontal lane-row per live ticket, each showing its 4-role
 * track (planner → plan-review → executor → execution-review) with EXACTLY ONE stage
 * lit (`ak-lane-stage--live`) at the lane's current stage. Prior stages are
 * done-tinted, future stages dim. Purely presentational: no router hooks (so it stays
 * jest-renderable), no data fetching. Reuses the canonical role tokens so it never
 * disagrees with a card's pipeline pips.
 *
 * Forwards `ref` to the `.ak-lanes` section itself (#1456) — BoardView needs a
 * direct handle to the REVEALED element to `scrollIntoView` / measure its viewport
 * position; wrapping it in an extra DOM node would defeat `scroll-margin-top`
 * (which only applies to the `scrollIntoView` TARGET element).
 */
export const LiveSwimlanes = forwardRef<HTMLElement, LiveSwimlanesProps>(
  function LiveSwimlanes({ lanes, reduce, arrive }, ref) {
    return (
      <section
        ref={ref}
        className={`ak-lanes${arrive ? " ak-lanes--arrive" : ""}`}
        aria-label="live chains"
      >
        {lanes.map((lane) => (
          <div className="ak-lane-row" key={lane.id} data-ticket={lane.id}>
            <div className="ak-lane-head">
              <span className="ak-lane-id">#{lane.id}</span>
              <span className="ak-lane-subject">{lane.subject}</span>
            </div>

            <ol
              className="ak-lane-track"
              aria-label={`stage ${lane.currentStageIndex + 1} of ${PIPELINE_ROLES.length}`}
            >
              {PIPELINE_ROLES.map((role, idx) => {
                // #1468: a failed review's OWN stage renders red-tinted
                // regardless of index order (currentStageIndex may have
                // returned BACKWARD to a prior work role during a bounce, so
                // the plain idx-vs-currentStageIndex comparison alone would
                // read the failed review as "pending" — this check takes
                // precedence and is a no-op on every non-bounced lane, since
                // `failedStage` is undefined there).
                const state =
                  lane.failedStage === idx
                    ? "failed"
                    : idx < lane.currentStageIndex
                      ? "done"
                      : idx === lane.currentStageIndex
                        ? "live"
                        : "pending";
                const isLive = state === "live";
                const hue = roleColor(role);

                const inner = (
                  <span className="ak-lane-stage__label">{roleLabel(role)}</span>
                );

                return (
                  <li
                    key={role}
                    className={`ak-lane-stage ak-lane-stage--${state}`}
                    style={{ ["--stage" as string]: hue }}
                    aria-current={isLive ? "step" : undefined}
                  >
                    {isLive && !reduce ? (
                      <motion.span
                        className="ak-lane-stage__pulse"
                        animate={{ opacity: [0.5, 1, 0.5] }}
                        transition={{
                          duration: 1.7,
                          ease: "easeInOut",
                          repeat: Infinity,
                        }}
                      >
                        {inner}
                      </motion.span>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </section>
    );
  }
);
