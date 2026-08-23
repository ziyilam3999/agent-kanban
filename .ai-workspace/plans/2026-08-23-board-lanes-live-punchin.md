# Plan: board-lanes-live — stop bookkeeping rows from lighting false-live lanes (2026-08-23)

Task: `board-lanes-live` | Repo: agent-kanban | Author: planner seat (Fable). Reviewed by an
independent plan-review seat (never self-reviewed).

cairn: query "punch" matched — "[T1] 2026-07-24 …: 2026-07-24: Fable-5 audit confirmed the
agent-kanban 'N LANES LIVE' pill can sho[w an inflated count]" (t1-run-scratch/2026-07-24/
ee426cae….jsonl:377) — this exact over-count class was already stoned once. Query "lane" also
matched "Punch-out-gated liveness (board closedAt punch-ins) lies forever for abnormally-[closed
agents]" (2026-07-26 jsonl:374) — close-stamp delivery is the known weak edge of this predicate.

## ELI5

The kanban board has a pill saying "N LANES LIVE" — how many agents are really working right now.
A lane counts as live when someone "punched in" (started) and has not "punched out" (finished).
But the orchestrator (the note-taker) also writes bookkeeping rows on big container tickets —
rows that record work that ALREADY FINISHED, yet carry no punch-out stamp. The board reads those
as "someone is still here" and showed 5 live lanes when only ~2 agents were truly running. The
fix teaches the board two things it can already see in its data: (1) if a worker's badge number
is stamped "left" anywhere on the ticket, that worker holds nothing open; (2) a row that already
records the finished deliverable is a receipt, not a punch-in. Real workers — including old-style
rows with no badge number and no receipt — still light their lanes exactly as today.

## Execution model

Delegate to a **cc-executor subagent** (knob-A `delegate`: one coherent surface — `lib/active.ts`
plus unit tests — in an isolated worktree branched from `origin/master`). Evaluator: **both** —
test-oracle (jest fixtures, one per direction below) and the independent execution-review seat.

## Problem

`computeActiveIds` (lib/active.ts) counts a ticket as an in-flight lane while
`pipelineHasOpenPunchIn` finds any "open punch-in", bounded by the 6h `INFLIGHT_LANE_CAP_MS`;
`deriveLanes` (lib/lanes.ts) renders whatever `computeActiveIds` returns. Two sibling mechanisms
make orchestrator bookkeeping rows read as open punch-ins:

- **M1 (measured on the live ledgers — the mechanism actually lighting the named parents).**
  `pipelineHasOpenPunchIn` evaluates punch-out PER agentId but only over PIPELINE-role rows. On
  `1658-guard-build`, agent `a20f07198e90eed1b` has a closed `research` row (closedAt
  2026-08-23T11:13:27Z) AND an orchestrator-appended `planner` row (ts 11:34:06, artifact_path
  set, NO closedAt). The research close-stamp is filtered out (`research` is not in
  PIPELINE_ROLE_SET), so the agent reads punched-IN and the parent registers as a live lane for
  6h after the append. Identical shape on `1660-scanner-build` (agent `a065ce9be1d6a7988`,
  research closedAt 10:24 vs open planner row ts 11:23). Both tickets are `status: in_progress`,
  so they sit in the lane population.
- **M2 (the dispatch brief's confirmed code-read mechanism; real in code, not what lights the two
  named parents today).** An agentId-LESS open pipeline row is treated as "its own always-open
  unit" (the #1980 back-compat branch, active.ts:196-198). Orchestrator fallback appends
  (`append --role <r> --artifact <path>` with no resolvable agentId) produce exactly such rows.
  **Premise correction (verified against live data, per verify-brief-premises doctrine):** the
  named parents' open rows DO carry agentIds — a fix for M2 alone would not darken them. Both
  mechanisms must be covered.

Why the rows exist at all: SubagentStop stamps `closedAt` on the (task, role) the spawn was
tagged with; bookkeeping/attribution rows appended later (or onto a different task id) never
receive one. That is writer-side reality the render side must tolerate.

## Fix

**Decision: Option C, refined by the live evidence — liveness keys on "genuine open role
punch-in", discriminated by outcome-evidence and agent-stop-evidence, not by agentId presence.**

The invariant `pipelineHasOpenPunchIn` (and its verbatim mirror in `openPunchInClock` — the #1980
"can never disagree" lockstep) must implement:

1. **Agent-stop evidence is role-blind.** A `closedAt` on ANY row for an agentId — research and
   orchestrator rows included — marks that agent stopped. A stopped one-shot subagent cannot hold
   any lane open under any role (consistent with #1590 monotone: a genuine reopen mints a fresh
   agentId). Kills M1.
2. **Outcome-bearing rows are receipts, not punch-ins.** A pipeline row that records a completed
   outcome (a deliverable artifact recorded, a review verdict, or a close-stamp) does not hold a
   lane open — with or without an agentId. This matches the ledger writer's own doctrine (ai-brain
   3role-ledger.mjs `priorRowConveysOutcome`: "agentId AND artifact_path … is fully done"). Kills
   M2 for orchestrator notes, which always record an artifact.
3. **The genuine degraded placeholder stays live.** An agentId-less open row with NO outcome
   evidence (the documented {role}-only spawn-edge write in ai-brain's
   three-role-spawn-ledger.sh graceful-degrade path) remains an always-open unit — the legacy
   lanes the back-compat branch exists for stay lit.

Options weighed:
- **(A) require a real agentId on the open punch-in — REJECTED.** Insufficient: the two named
  parents' open rows carry agentIds, so A does not fix the reported case at all (measured above).
  Harmful: the {role}-only degraded spawn placeholder is a documented write shape for a
  genuinely-RUNNING role; requiring agentId darkens that real lane through its silent legs.
- **(B) exclude parent/meta container tickets — REJECTED.** No reliable mechanical meta-vs-work
  signal exists: the parents' task JSON carries no container flag (verified — only prose subject
  conventions and `metadata.parent_ticket`, which points the wrong way), the exported Ticket
  schema carries no metadata bag beyond `on_hold`, and the false-open-row mechanism is not
  confined to containers anyway (any ticket the orchestrator bookkeeps can false-light).
- **(C) genuine-punch-in discrimination — PICKED**, as refined above: it fixes both measured
  mechanisms with signals already present in the exported data, and preserves the legacy/degraded
  live-lane cases A would kill.

Accepted residual: after a fresh orchestration touch, a parent still breathes via the 8-minute
recency window (disjunct 3) — the same accepted transient inline work has — instead of 6 hours.
A mid-run self-append that records an artifact before the role's SubagentStop reads as a receipt;
the self-append is by convention the role's last act, and the 8-minute window covers the tail.

**Render-side only (verified):** `computeActiveIds`/`deriveLanes` run at render time over
`data/board.json`, whose comments already carry `role`, `ts`, `agentId`, `closedAt`, `verdict`,
and `artifact` presence (build-board.ts `toComment`). **No re-export / `npm run kanban:sync` / no
schema change is needed.**

## Binary AC

All checkable from outside the diff by running jest in the repo; fixtures are session-live,
`in_progress`, not held, with `nowMs` inside the 6h cap of every open row's ts (so exclusion is
attributable to the punch-in predicate, never to the cap). One control per direction.

- **AC-1 (direction 1 — false-live goes dark; fixture mirrors the MEASURED M1 rows, not the
  brief's prose).** A ticket whose comments replicate `1658-guard-build`'s live shape — agent X:
  `research` row WITH closedAt + `planner` row with artifact and NO closedAt; agent Y:
  `plan-review` row with closedAt + verdict PASS — is ABSENT from `computeActiveIds(...)` and
  yields no lane from `deriveLanes(...)`. Jest exit 0.
- **AC-2 (direction 1, M2 arm).** A ticket whose only open pipeline row is agentId-LESS but
  records an artifact (an orchestrator fallback note) is ABSENT from `computeActiveIds` and
  yields no lane. Jest exit 0.
- **AC-3 (direction 2 — true-live stays lit).** A ticket with a pipeline-role row carrying an
  agentId that has NO closedAt on any row of the ticket and NO recorded outcome, ts within the
  cap, IS in `computeActiveIds` and IS a `deriveLanes` lane. Jest exit 0.
- **AC-4 (direction 2 — held-out back-compat control).** A ticket whose only pipeline row is
  agentId-less AND outcome-less (a bare {role, ts} degraded spawn placeholder) STILL computes as
  a live lane — proves the fix discriminates on outcome evidence, not on agentId presence. Jest
  exit 0.
- **AC-5 (lockstep).** For the AC-1 fixture, `chainInFlight` is false and `openPunchInClock`
  returns undefined (no open-evidence rows ⇒ predicate and clock agree); for the AC-3 fixture
  both report the open unit. Jest exit 0.
- **AC-6 (non-regression).** The full existing suite passes: `npx jest` exits 0 with no existing
  test modified — except a test that PINS the buggy false-live behavior itself, which may be
  updated with a one-line justification naming this plan.

## Files

- `lib/active.ts` — `pipelineHasOpenPunchIn` + its mirrored individuation in `openPunchInClock`
  (consumed by `chainInFlight`, `pendingReviewInFlight`, `computeActiveIds`). The whole fix lives
  here.
- `__tests__/` — one new fixture test file for AC-1..AC-5.
- `lib/lanes.ts` — expected UNCHANGED (`deriveLanes` consumes `computeActiveIds` and
  `pendingReviewInFlight`; verify-only).

## Scope boundary

- Do NOT touch `lib/build-board.ts` — the separate `board-inprogress-recency` task owns
  toColumn/buildTicket at EXPORT time; different mechanism, different file, no ship conflict.
- No exporter, schema, board.json, or UI-component changes; no new exported fields.
- No writer-side (ai-brain ledger/hook) changes in this task.

Deferred-follow-ups: writer-side hygiene in ai-brain — orchestrator/reconcile bookkeeping appends
could stamp `closedAt` (or a non-pipeline marker role) at write time so they never resemble
punch-ins at the source; file as an ai-brain ticket if plan-review concurs.

## Review

(pending — the independent plan-review seat writes its verdict here; the planner never does)
