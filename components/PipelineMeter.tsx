"use client";

import type { Ticket } from "@/lib/board-schema";
import { COLUMNS } from "@/lib/board-schema";
import { COLUMN_HUE, COLUMN_METER_LABEL } from "@/lib/ui-meta";

/** 4-segment telemetry readout: TODO n · PROG n · REVIEW n · DONE n, each hue-tinted. */
export function PipelineMeter({ tickets }: { tickets: Ticket[] }) {
  const counts = COLUMNS.reduce<Record<string, number>>((acc, c) => {
    acc[c] = 0;
    return acc;
  }, {});
  for (const t of tickets) counts[t.column] = (counts[t.column] ?? 0) + 1;

  return (
    <div className="ak-meter" role="group" aria-label="pipeline state">
      {COLUMNS.map((col) => (
        <div
          key={col}
          className="ak-meter__seg"
          style={{ ["--seg" as string]: COLUMN_HUE[col] }}
        >
          <span className="ak-meter__label">{COLUMN_METER_LABEL[col]}</span>
          <span className="ak-meter__count">{counts[col]}</span>
        </div>
      ))}
    </div>
  );
}
