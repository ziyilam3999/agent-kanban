"use client";

import type { Ticket } from "@/lib/board-schema";
import {
  COLUMN_HUE,
  PIPELINE_ROLES,
  roleColor,
  roleLabel,
} from "@/lib/ui-meta";
import { relativeTime } from "@/lib/relative-time";

interface CardProps {
  ticket: Ticket;
  nowMs: number;
  /** True for the GLOW_MS window right after this card changed column — drives
   *  the arrival glow (ak-card--live ring/tint, or ak-card--flash for reduce). */
  glow?: boolean;
  reduce?: boolean;
}

/** Telemetry tile — left hue rail, id + role pips, clamped subject, blocked/time footer. */
export function Card({ ticket, nowMs, glow, reduce }: CardProps) {
  const hue = COLUMN_HUE[ticket.column];
  const rolesSeen = new Set(ticket.comments.map((c) => c.role));
  const blocked = ticket.blockedBy.length > 0;

  const cls = [
    "ak-card",
    glow ? (reduce ? "ak-card--flash" : "ak-card--live") : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} style={{ ["--hue" as string]: hue }}>
      <span className="ak-card__rail" aria-hidden />

      <div className="ak-card__top">
        <span className="ak-card__id">#{ticket.id}</span>
        <span
          className="ak-pips"
          role="img"
          aria-label={`pipeline progress: ${rolesSeen.size} of 4 roles`}
        >
          {PIPELINE_ROLES.map((role) => {
            const on = rolesSeen.has(role);
            return (
              <span
                key={role}
                className={`ak-pip${on ? " ak-pip--on" : ""}`}
                style={on ? { ["--pip" as string]: roleColor(role) } : undefined}
                title={`${roleLabel(role)}${on ? "" : " (pending)"}`}
              />
            );
          })}
        </span>
      </div>

      <p className="ak-card__subject">{ticket.subject}</p>

      <div className="ak-card__foot">
        {blocked && (
          <span className="ak-blocked">
            ⛔ blocked by #{ticket.blockedBy.join(", #")}
          </span>
        )}
        <span className="ak-card__time">
          {relativeTime(ticket.updatedAt, nowMs)}
        </span>
      </div>
    </div>
  );
}
