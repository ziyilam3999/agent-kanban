import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveSwimlanes } from "@/components/LiveSwimlanes";
import type { Lane } from "@/lib/lanes";

const lane = (
  id: string,
  currentStageIndex: number,
  rolesSeen: string[] = [],
  reworking?: boolean,
  failedStage?: number,
): Lane => ({
  id,
  subject: `subject ${id}`,
  currentStageIndex,
  rolesSeen: new Set(rolesSeen),
  reworking,
  failedStage,
});

const render = (lanes: Lane[], reduce = false) =>
  renderToStaticMarkup(createElement(LiveSwimlanes, { lanes, reduce }));

// Count non-overlapping occurrences of a class token in markup.
const count = (markup: string, token: string) =>
  markup.split(token).length - 1;

describe("LiveSwimlanes render", () => {
  it("AC#2: 2 lanes → exactly 2 ak-lane-row nodes; 3 lanes → exactly 3", () => {
    expect(count(render([lane("1", 0), lane("2", 1)]), "ak-lane-row")).toBe(2);
    expect(
      count(render([lane("1", 0), lane("2", 1), lane("3", 2)]), "ak-lane-row"),
    ).toBe(3);
  });

  it("AC#3: exactly one ak-lane-stage--live per row, at the current stage", () => {
    const markup = render([lane("1", 2), lane("2", 0)]);
    // Two rows → exactly two lit stages total (one each).
    expect(count(markup, "ak-lane-stage--live")).toBe(2);
    // The lit stage carries the role label for its index.
    // Lane 1 current stage index 2 → EXECUTOR; lane 2 index 0 → PLANNER.
    expect(markup).toContain("EXECUTOR");
    expect(markup).toContain("PLANNER");
  });

  it("AC#3: stage states partition done/live/pending correctly", () => {
    // Single lane at index 1 → 1 done, 1 live, 2 pending.
    const markup = render([lane("1", 1)]);
    expect(count(markup, "ak-lane-stage--done")).toBe(1);
    expect(count(markup, "ak-lane-stage--live")).toBe(1);
    expect(count(markup, "ak-lane-stage--pending")).toBe(2);
  });

  it("renders all 4 role labels per lane track", () => {
    const markup = render([lane("1", 0)]);
    expect(markup).toContain("PLANNER");
    expect(markup).toContain("PLAN-REVIEW");
    expect(markup).toContain("EXECUTOR");
    expect(markup).toContain("EXEC-REVIEW");
  });

  it("0 lanes → no ak-lane-row nodes (empty section)", () => {
    expect(count(render([]), "ak-lane-row")).toBe(0);
  });

  it("AC#8: reduced motion → no motion pulse wrapper; static live highlight remains", () => {
    const reduced = render([lane("1", 2)], true);
    const animated = render([lane("1", 2)], false);
    // The pulse wrapper span only appears in the animated branch.
    expect(reduced).not.toContain("ak-lane-stage__pulse");
    expect(animated).toContain("ak-lane-stage__pulse");
    // The static lit stage is still present under reduced motion.
    expect(reduced).toContain("ak-lane-stage--live");
    expect(reduced).toContain("EXECUTOR");
  });

  describe("#1468 AC5: bounced lane — EXECUTOR not lit, PLANNER lit, plan-review --err-tinted", () => {
    it("plan-review-FAIL lane: currentStageIndex=0 (planner) + failedStage=1 (plan-review)", () => {
      const markup = render([lane("1", 0, [], true, 1)]);

      // Exactly one lit stage, and it's PLANNER (index 0), not EXECUTOR.
      expect(count(markup, "ak-lane-stage--live")).toBe(1);
      expect(count(markup, "ak-lane-stage--failed")).toBe(1);

      // The stage ordering is fixed (PLANNER, PLAN-REVIEW, EXECUTOR, EXEC-REVIEW),
      // so split on the stage boundary to correlate label <-> class per stage.
      const stages = markup.split("ak-lane-stage ak-lane-stage--").slice(1);
      expect(stages[0]).toMatch(/^live/); // planner: live
      expect(stages[1]).toMatch(/^failed/); // plan-review: failed (--err)
      expect(stages[2]).toMatch(/^pending/); // executor: NOT live
      expect(stages[3]).toMatch(/^pending/); // exec-review: pending
      expect(stages[2]).not.toContain("ak-lane-stage--live");
    });
  });
});
