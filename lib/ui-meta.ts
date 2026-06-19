// ui-meta.ts — shared display tokens for the telemetry UI (column hues + role
// metadata). One source so the card pips, pipeline meter, and drawer timeline all
// agree on colors and the canonical 4-role pipeline order.

import type { Column } from "./board-schema";

/** CSS-var hue per column — the thin status rail + count tint, never a fill. */
export const COLUMN_HUE: Record<Column, string> = {
  todo: "var(--todo)",
  in_progress: "var(--prog)",
  in_review: "var(--review)",
  done: "var(--done)",
};

/** Short mono label per column for the pipeline meter readout. */
export const COLUMN_METER_LABEL: Record<Column, string> = {
  todo: "TODO",
  in_progress: "PROG",
  in_review: "REVIEW",
  done: "DONE",
};

/** The 4-role pipeline, in execution order — drives the card progress pips. */
export const PIPELINE_ROLES = [
  "planner",
  "plan-review",
  "executor",
  "execution-review",
] as const;

export type PipelineRole = (typeof PIPELINE_ROLES)[number];

/** Color-code per role (drawer nodes + pips). Free-form roles fall back to dim. */
export const ROLE_COLOR: Record<string, string> = {
  planner: "var(--prog)",
  "plan-review": "var(--review)",
  executor: "var(--live)",
  "execution-review": "var(--done)",
  orchestrator: "var(--fg-dim)",
};

/** Mono-caps label per role for the drawer timeline + pip tooltips. */
export const ROLE_LABEL: Record<string, string> = {
  planner: "PLANNER",
  "plan-review": "PLAN-REVIEW",
  executor: "EXECUTOR",
  "execution-review": "EXEC-REVIEW",
  orchestrator: "ORCHESTRATOR",
};

export function roleColor(role: string): string {
  return ROLE_COLOR[role] ?? "var(--fg-dim)";
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.toUpperCase();
}
