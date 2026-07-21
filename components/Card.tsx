"use client";

import type { Ticket } from "@/lib/board-schema";
import {
  abbreviateModel,
  cardModel,
  COLUMN_HUE,
  heldFor,
  isHeld,
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
  /** Owning session's `lastActive` epoch (#1449) — the independent liveness signal
   *  the SHIPPING→STALE pill cross-checks so an actively-shipped card whose quiet
   *  ship tail hasn't touched its own `updatedAt` is not falsely dimmed to STALE.
   *  Optional: omitted → UNKNOWN liveness → the pill fails closed to SHIPPING. */
  sessionLastActive?: number;
  reduce?: boolean;
}

/** Telemetry tile — left hue rail, id + role pips, clamped subject, blocked/time footer. */
export function Card({ ticket, nowMs, glow, active, sessionLastActive, reduce }: CardProps) {
  const hue = COLUMN_HUE[ticket.column];
  const phase = phaseLine(ticket, active, nowMs, undefined, sessionLastActive);
  const rolesSeen = new Set(ticket.comments.map((c) => c.role));
  const blocked = ticket.blockedBy.length > 0;
  const model = cardModel(ticket);
  // #1516 — research is deliberately NOT in PIPELINE_ROLES (stays exactly four), so it never
  // draws a 5th pip. Render it as a distinct chip instead, next to the pips. `researchOpen`
  // tracks whether ANY research comment is still un-close-stamped (mirrors chainInFlight's
  // per-comment `!c.closedAt` check) purely for the tooltip/label — informational only, does
  // NOT drive the card's `active` glow (that's computeActiveIds' job upstream).
  const researchComments = ticket.comments.filter((c) => c.role === "research");
  const hasResearch = researchComments.length > 0;
  const researchOpen = researchComments.some((c) => !c.closedAt);
  // Lift a leading "[#1063]" / "[EPIC]" prefix out of the subject so it doesn't read as a
  // second ticket id next to the card's own #id — render it as a distinct chip instead.
  const subjectTag = parseSubjectTag(ticket.subject);
  // #1816 — on-hold state hook (AC7): a stable class that (a) pins the rail
  // hue to var(--hold) and (b) recedes the tile — opacity/transform only, zero
  // layout shift. `held` never coincides with `active` (computeActiveIds
  // excludes held tickets from the lane population upstream), so the rail
  // never has to arbitrate between the mint "breathing" treatment and the
  // static ochre one.
  const held = isHeld(ticket);
  const heldFooter = heldFor(ticket, nowMs);

  const cls = [
    "ak-card",
    glow ? (reduce ? "ak-card--flash" : "ak-card--live") : "",
    active ? "ak-card--active" : "",
    held ? "ak-card--hold" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} style={{ ["--hue" as string]: hue }}>
      <span className="ak-card__rail" aria-hidden />

      <div className="ak-card__top">
        <span className="ak-card__id">#{ticket.id}</span>
        <span className="ak-card__top-right">
          {hasResearch && (
            <span
              className={`ak-tag ak-tag--research${researchOpen ? " ak-tag--research-open" : ""}`}
              style={{ ["--research-hue" as string]: roleColor("research") }}
              title={`${roleLabel("research")}${researchOpen ? " — in flight" : " — done"}`}
            >
              {roleLabel("research")}
            </span>
          )}
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
        {heldFooter && <span className="ak-hold-footer">{heldFooter}</span>}
        {model && (
          <span className="ak-model">
            {abbreviateModel(model.version)}
            {model.effort && (
              <span className="ak-model__effort">·{model.effort}</span>
            )}
          </span>
        )}
        <span className="ak-card__time">
          {relativeTime(ticket.updatedAt, nowMs)}
        </span>
      </div>
    </div>
  );
}
