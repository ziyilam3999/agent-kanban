"use client";

import type { Ticket } from "@/lib/board-schema";
import { COLUMNS } from "@/lib/board-schema";
import { COLUMN_HUE, COLUMN_METER_LABEL } from "@/lib/ui-meta";

/** 4-segment telemetry readout: TODO n · PROG n · REVIEW n · DONE n, each hue-tinted.
 *
 * Renders BOTH the full stat-tile readout (`.ak-meter`, phone + desktop) and a
 * compact proportional segmented bar (`.ak-meterbar`, the fold8-4x3 grid tiers)
 * unconditionally — CSS alone decides which is visible at a given container/
 * viewport size (globals.css, the 640-1023.98px grid-tier media block), so no
 * client-side breakpoint branching is needed here. */
export function PipelineMeter({ tickets }: { tickets: Ticket[] }) {
  const counts = COLUMNS.reduce<Record<string, number>>((acc, c) => {
    acc[c] = 0;
    return acc;
  }, {});
  for (const t of tickets) counts[t.column] = (counts[t.column] ?? 0) + 1;

  return (
    <>
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

      {/* Compact proportional readout for the grid tiers (640-1023.98px) — one bar,
          4 hue-tinted segments sized by relative count. A small non-zero flex-grow
          floor (0.001) keeps a 0-count segment from vanishing to literal 0px while
          still guaranteeing a strictly-larger count never yields a strictly
          narrower segment (AC-3's ordering contract). */}
      <div className="ak-meterbar" role="group" aria-label="pipeline proportions">
        {COLUMNS.map((col) => (
          <span
            key={col}
            className="ak-meterbar__seg"
            style={{
              ["--seg" as string]: COLUMN_HUE[col],
              flex: `${Math.max(counts[col], 0.001)} 0 2px`,
            }}
            title={`${COLUMN_METER_LABEL[col]} ${counts[col]}`}
          />
        ))}
      </div>
    </>
  );
}
