// lane-bookkeeping-punch-out.test.ts — board-lanes-live plan AC-1..AC-6
// (.ai-workspace/plans/2026-08-23-board-lanes-live-punchin.md): orchestrator
// bookkeeping rows on a container ticket must not read as open punch-ins and
// inflate the "N LANES LIVE" pill.
//
// M1 (measured live on 1658-guard-build / 1660-scanner-build): an agent's
// `research` row carries `closedAt`, but its LATER `planner` row (same
// agentId, no `closedAt`) is genuinely open. `pipelineHasOpenPunchIn` used to
// filter non-pipeline rows BEFORE the per-agentId `closedAt` scan, so the
// research close-stamp was invisible and the agent read punched-IN forever.
// The fix (`buildAgentClosedAnywhere` in lib/active.ts) scans ALL roles for
// `closedAt` — role-blind agent-stop evidence.
//
// M2 (confirmed-real code path, not what lights the two named parents today):
// an agentId-LESS pipeline row that records a completed outcome (`artifact`)
// is a bookkeeping receipt, not a live always-open unit.
//
// AC-4 is the held-out back-compat control: a bare agentId-less,
// outcome-less {role, ts} row (the #1980 degraded-spawn placeholder) must
// STILL read as an open, always-live unit — proves the fix discriminates on
// outcome evidence, never on bare agentId absence.
//
// G2 (plan-review executor guidance): the AC-1/AC-2 "goes dark" fixtures set
// `updatedAt` OUTSIDE ACTIVE_WINDOW_MS (8 min) — inside it, disjunct-3
// recency alone would independently re-light the ticket and the "absent"
// assertion could not isolate the punch-in fix. Every open row's `ts` still
// sits inside INFLIGHT_LANE_CAP_MS (6h) so exclusion is never attributable
// to the dead-lane cap.

import {
  buildTicket,
  type RawLedgerLine,
  type RawTask,
} from "@/lib/build-board";
import {
  ACTIVE_WINDOW_MS,
  INFLIGHT_LANE_CAP_MS,
  chainInFlight,
  computeActiveIds,
  openPunchInClock,
} from "@/lib/active";
import { deriveLanes } from "@/lib/lanes";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const SID = "sess-blp-01";

// G2: comfortably outside the 8-min ACTIVE_WINDOW_MS, comfortably inside the
// 6h INFLIGHT_LANE_CAP_MS.
const OUTSIDE_WINDOW_MIN = ACTIVE_WINDOW_MS / MIN + 20; // 28 min
const WITHIN_CAP_MIN = 90; // 1.5h — well inside the 6h cap

function inProgressTask(id: string): RawTask {
  return {
    id,
    subject: `t${id}`,
    description: "",
    status: "in_progress",
    blocks: [],
    blockedBy: [],
  };
}

function line(
  role: string,
  minsAgo: number,
  fields?: Partial<RawLedgerLine>
): RawLedgerLine {
  return {
    role,
    ts: new Date(NOW - minsAgo * MIN).toISOString(),
    ...fields,
  };
}

const isoAgo = (minsAgo: number) => new Date(NOW - minsAgo * MIN).toISOString();

describe("board-lanes-live — bookkeeping rows must not falsely light a lane", () => {
  it("AC-1: MEASURED 1658-guard-build shape — closed research row (agent X) + open artifact-bearing planner row (agent X) + closed plan-review PASS row (agent Y) -> DARK, no lane", () => {
    const ticket = buildTicket(
      inProgressTask("guard-parent"),
      [
        // Agent X: research CLOSED, then a later open planner row (no closedAt,
        // carries the artifact — mirrors the measured shape exactly).
        line("research", WITHIN_CAP_MIN + 20, {
          agentId: "agentX",
          closedAt: isoAgo(WITHIN_CAP_MIN + 17),
        }),
        line("planner", WITHIN_CAP_MIN, {
          agentId: "agentX",
          artifact_path: "/tmp/plans/2026-08-23-guard-plan.md",
        }),
        // Agent Y: plan-review CLOSED with a PASS verdict.
        line("plan-review", WITHIN_CAP_MIN - 10, {
          agentId: "agentY",
          closedAt: isoAgo(WITHIN_CAP_MIN - 10),
          verdict: "PASS",
        }),
      ],
      NOW - OUTSIDE_WINDOW_MIN * MIN, // G2: updatedAt OUTSIDE the 8-min window
      SID,
      NOW - OUTSIDE_WINDOW_MIN * MIN
    );

    expect(chainInFlight(ticket)).toBe(false);
    const active = computeActiveIds([ticket], true, NOW);
    expect(active.has("guard-parent")).toBe(false);
    const lanes = deriveLanes([ticket], active);
    expect(lanes.some((l) => l.id === "guard-parent")).toBe(false);
  });

  it("AC-2 (M2 arm): agentId-LESS open pipeline row that records an artifact (orchestrator fallback note) -> DARK, no lane", () => {
    const ticket = buildTicket(
      inProgressTask("orch-note"),
      [
        line("executor", WITHIN_CAP_MIN, {
          // NO agentId — an orchestrator fallback append with no resolvable
          // agentId — but it DOES record a finished deliverable.
          artifact_path: "/tmp/artifacts/handoff-note.md",
        }),
      ],
      NOW - OUTSIDE_WINDOW_MIN * MIN, // G2: updatedAt OUTSIDE the 8-min window
      SID,
      NOW - OUTSIDE_WINDOW_MIN * MIN
    );

    expect(chainInFlight(ticket)).toBe(false);
    const active = computeActiveIds([ticket], true, NOW);
    expect(active.has("orch-note")).toBe(false);
    const lanes = deriveLanes([ticket], active);
    expect(lanes.some((l) => l.id === "orch-note")).toBe(false);
  });

  it("AC-3 (true-live control): agentId'd pipeline row, no closedAt ANYWHERE for that agent, no recorded outcome, ts within cap -> STILL active AND a lane", () => {
    const ticket = buildTicket(
      inProgressTask("real-work"),
      [
        line("executor", WITHIN_CAP_MIN, { agentId: "agent-live-01" }),
      ],
      NOW - WITHIN_CAP_MIN * MIN,
      SID,
      NOW - WITHIN_CAP_MIN * MIN
    );

    expect(chainInFlight(ticket)).toBe(true);
    const active = computeActiveIds([ticket], true, NOW);
    expect(active.has("real-work")).toBe(true);
    const lanes = deriveLanes([ticket], active);
    expect(lanes.some((l) => l.id === "real-work")).toBe(true);
  });

  it("AC-4 (held-out back-compat control): agentId-less AND outcome-less bare {role, ts} degraded-spawn placeholder -> STILL a live lane", () => {
    const ticket = buildTicket(
      inProgressTask("degraded-spawn"),
      [
        // No agentId, no artifact, no verdict, no closedAt — the documented
        // {role}-only graceful-degrade write shape.
        line("executor", WITHIN_CAP_MIN),
      ],
      NOW - WITHIN_CAP_MIN * MIN,
      SID,
      NOW - WITHIN_CAP_MIN * MIN
    );

    expect(chainInFlight(ticket)).toBe(true);
    const active = computeActiveIds([ticket], true, NOW);
    expect(active.has("degraded-spawn")).toBe(true);
    const lanes = deriveLanes([ticket], active);
    expect(lanes.some((l) => l.id === "degraded-spawn")).toBe(true);
  });

  describe("AC-5 (lockstep): chainInFlight and openPunchInClock can never disagree", () => {
    it("AC-1 fixture: chainInFlight is false AND openPunchInClock is undefined (no open-evidence rows)", () => {
      const ticket = buildTicket(
        inProgressTask("guard-parent"),
        [
          line("research", WITHIN_CAP_MIN + 20, {
            agentId: "agentX",
            closedAt: isoAgo(WITHIN_CAP_MIN + 17),
          }),
          line("planner", WITHIN_CAP_MIN, {
            agentId: "agentX",
            artifact_path: "/tmp/plans/2026-08-23-guard-plan.md",
          }),
          line("plan-review", WITHIN_CAP_MIN - 10, {
            agentId: "agentY",
            closedAt: isoAgo(WITHIN_CAP_MIN - 10),
            verdict: "PASS",
          }),
        ],
        NOW - OUTSIDE_WINDOW_MIN * MIN,
        SID,
        NOW - OUTSIDE_WINDOW_MIN * MIN
      );

      expect(chainInFlight(ticket)).toBe(false);
      expect(openPunchInClock(ticket)).toBeUndefined();
    });

    it("AC-3 fixture: both chainInFlight AND openPunchInClock report the open unit", () => {
      const ticket = buildTicket(
        inProgressTask("real-work"),
        [line("executor", WITHIN_CAP_MIN, { agentId: "agent-live-01" })],
        NOW - WITHIN_CAP_MIN * MIN,
        SID,
        NOW - WITHIN_CAP_MIN * MIN
      );

      expect(chainInFlight(ticket)).toBe(true);
      expect(openPunchInClock(ticket)).toBe(NOW - WITHIN_CAP_MIN * MIN);
    });
  });

  it("AC-6 sanity: INFLIGHT_LANE_CAP_MS still comfortably exceeds every open row's age used above", () => {
    expect(WITHIN_CAP_MIN * MIN).toBeLessThan(INFLIGHT_LANE_CAP_MS);
  });
});
