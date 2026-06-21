"use client";

import type { Ticket } from "@/lib/board-schema";
import {
  COLUMN_HUE,
  PIPELINE_ROLES,
  phaseLine,
  roleColor,
  roleLabel,
} from "@/lib/ui-meta";
import { relativeTime } from "@/lib/relative-time";
import { parseSubjectTag, subjectTagLabel } from "@/lib/subject-tag";

interface CardProps {
  ticket: Ticket;
  nowMs: number;
  /** True for the GLOW_MS window right after this card changed column — drives
   *  the arrival glow (ak-card--live ring/tint, or ak-card--flash for reduce). */
  glow?: boolean;
  /** True while this ticket is the agent's CURRENT focus (live session +
   *  in_progress + touched recently) — drives the persistent "working" heartbeat. */
  active?: boolean;
  reduce?: boolean;
}

/** Telemetry tile — left hue rail, id + role pips, clamped subject, blocked/time footer. */
export function Card({ ticket, nowMs, glow, active, reduce }: CardProps) {
  const hue = COLUMN_HUE[ticket.column];
  const phase = phaseLine(ticket, active);
  const rolesSeen = new Set(ticket.comments.map((c) => c.role));
  const blocked = ticket.blockedBy.length > 0;
  // Lift a leading "[#1063]" / "[EPIC]" prefix out of the subject so it doesn't read as a
  // second ticket id next to the card's own #id — render it as a distinct chip instead.
  const subjectTag = parseSubjectTag(ticket.subject);

  const cls = [
    "ak-card",
    glow ? (reduce ? "ak-card--flash" : "ak-card--live") : "",
    active ? "ak-card--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} style={{ ["--hue" as string]: hue }}>
      <span className="ak-card__rail" aria-hidden />

      <div className="ak-card__top">
        <span className="ak-card__id">#{ticket.id}</span>
        <span
          className="ak-pips ak-pips--dim"
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

      <p
        className={`ak-phase${active ? " ak-phase--live" : ""}`}
        style={{ ["--phase" as string]: phase.hueVar }}
        aria-label={phase.ariaLabel}
      >
        {phase.text}
      </p>

      <p className="ak-card__subject">
        {subjectTag.tag && (
          <span
            className={`ak-tag${subjectTag.isParentRef ? " ak-tag--parent" : " ak-tag--epic"}`}
            title={subjectTag.isParentRef ? `part of ticket ${subjectTag.tag}` : subjectTag.tag}
          >
            {subjectTagLabel(subjectTag)}
          </span>
        )}
        {subjectTag.title}
      </p>

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
