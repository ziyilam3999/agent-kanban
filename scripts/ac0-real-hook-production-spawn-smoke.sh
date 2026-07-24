#!/usr/bin/env bash
# ac0-real-hook-production-spawn-smoke.sh — #1852 plan AC-0 (the load-bearing
# Rule-18 smoke). Drives the REAL ai-brain writer hooks (never a hand-injected
# fixture) to prove a genuinely-running pipeline role is observably
# punched-in-not-out for the WHOLE time it runs, and darkens only at its real
# stop — then feeds the resulting ledger through agent-kanban's REAL exporter
# + lib/active.ts computeActiveIds.
#
# PRODUCTION SPAWN MODE (r3, load-bearing per the plan's AC-0 pin): this smoke
# exercises the BACKGROUND spawn edge — the doctrine default for a long-silent
# pipeline role (CLAUDE.md "Sequential != foreground; default = background
# subagent for ALL chained reviewers", and "background-agent completion
# discipline"). For a BACKGROUND spawn, three-role-spawn-ledger.sh's
# PostToolUse(Agent|Task) edge fires the instant the launch call RETURNS
# (dispatch time, not actual task completion) — see the hook's own header doc
# ("For a FOREGROUND spawn that is COMPLETION ... the 'early' win is realized
# only for a run_in_background spawn, where PostToolUse fires at DISPATCH").
# So step 1 below (a PostToolUse payload carrying an agentId, fired BEFORE any
# SubagentStop) is the faithful production shape of what a background-spawned
# long-silent role's ledger looks like MID-RUN — not a synthetic shortcut.
#
# Steps:
#   1. Fire three-role-spawn-ledger.sh (PostToolUse, agentId present) for a
#      pipeline role -> writes an OPEN row (no closedAt, no verdict).
#   2. Run agent-kanban's REAL exporter against that ledger + a matching
#      in_progress task file; compute liveness -> assert live-count == 1.
#   3. Fabricate the role's SubagentStop transcript (3ROLE_TASK/ROLE tagged)
#      and fire three-role-subagent-ledger.sh -> overlay-merges closedAt onto
#      the SAME row (same agentId, same role -> merges per overlayAppend's
#      per-key "provided" discipline, verified at 3role-ledger.mjs:1440-1451).
#   4. Re-run the exporter + liveness computation -> assert live-count == 0.
#
# AC-6 SCOPE DECISION (r3): if step 2 shows the row IS visible mid-flight
# (live-count 1) in this PRODUCTION (background) spawn mode, AC-6 needs NO
# ai-brain change — the punch-in visibility gap AC-6 exists to close only
# bites a FOREGROUND long-silent role (three-role-spawn-ledger.sh:121
# excludes chain roles from the PreToolUse edge; PostToolUse-at-dispatch is
# what a BACKGROUND spawn gets instead, and that IS visible).
#
# N1 (plan-review r3 non-blocking note): also asserts that this dispatch-time
# open row does NOT, by itself, satisfy ai-brain's gate-plan-review completion
# gate (three-role-transition-gate.sh / 3role-ledger.mjs gate-plan-review,
# #1575) — proving AC-0's mid-flight visibility win does not accidentally
# regress the fail-closed completion gate for plan-review admission.
#
# Env: AI_BRAIN_DIR (default $HOME/coding_projects/ai-brain). Exit 0 = PASS.
set -uo pipefail

AI_BRAIN_DIR="${AI_BRAIN_DIR:-$HOME/coding_projects/ai-brain}"
SPAWN_HOOK="$AI_BRAIN_DIR/hooks/three-role-spawn-ledger.sh"
STOP_HOOK="$AI_BRAIN_DIR/hooks/three-role-subagent-ledger.sh"
LED="$AI_BRAIN_DIR/hooks/3role-ledger.mjs"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$SPAWN_HOOK" ] || [ ! -f "$STOP_HOOK" ] || [ ! -f "$LED" ]; then
  echo "AC-0 SMOKE: SKIP — ai-brain hooks not found at AI_BRAIN_DIR=$AI_BRAIN_DIR (this smoke is a cross-repo verifier; it needs ai-brain checked out as a sibling)." >&2
  exit 0
fi

fail=0
ok()  { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; fail=1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
LEDGERDIR="$TMP/ledger"; TASKSDIR="$TMP/tasks"; PROJROOT="$TMP/projects"; OUT="$TMP/board.json"
SID="ac0smoke1"
TASKID="9200"
ROLE="executor"
AGENTID="ac0-bg-agent-1"

mkdir -p "$TASKSDIR/$SID" "$LEDGERDIR" "$PROJROOT"
cat > "$TASKSDIR/$SID/$TASKID.json" <<EOF
{"id":"$TASKID","subject":"AC-0 production-spawn-mode smoke","description":"","status":"in_progress","blocks":[],"blockedBy":[]}
EOF

compute_live_count() {
  # $1 = ms to ADVANCE "now" past Date.now() when evaluating computeActiveIds
  # (default 0). Used to step PAST disjunct-3's separate, pre-existing,
  # accepted ACTIVE_WINDOW_MS (8min) recency transient after a fresh
  # ledger-file touch (a just-close-stamped row is, correctly, ALSO
  # "recently touched" — that is not a grace window on the punch-out signal,
  # it is the same WINDOW transient every ticket gets; see
  # lane-role-handoff-gap.test.ts AC-7(c') for the identical, unit-tested
  # nuance). Isolating the punch-out predicate's OWN verdict (not disjunct-3)
  # requires evaluating past that window, exactly like the jest fixtures do.
  local now_offset_ms="${1:-0}"
  ( cd "$REPO_ROOT" && \
    TASKS_DIR="$TASKSDIR" LEDGER_DIR="$LEDGERDIR" OUT="$OUT" SESSION_ID="$SID" NODE_ENV=development \
    npx tsx scripts/export-board.ts >/dev/null 2>&1 )
  [ -f "$OUT" ] || { echo "-1"; return; }
  ( cd "$REPO_ROOT" && OUT_FILE="$OUT" SID_ENV="$SID" NOW_OFFSET_MS="$now_offset_ms" npx tsx -e '
    import fs from "fs";
    import { computeActiveIds } from "./lib/active";
    const board = JSON.parse(fs.readFileSync(process.env.OUT_FILE as string, "utf8"));
    const session = (board.sessions || []).find((s: any) => s.id === (process.env.SID_ENV as string).slice(0, 8));
    const isLive = session ? session.live : true;
    const nowMs = Date.now() + Number(process.env.NOW_OFFSET_MS || "0");
    const active = computeActiveIds(board.tickets, isLive, nowMs);
    process.stdout.write(String(active.size));
  ' 2>/dev/null )
}

# ---- Step 1: PostToolUse (production BACKGROUND spawn edge) for the pipeline role -> OPEN row. ----
PAYLOAD=$(printf '{"session_id":"%s","tool_input":{"prompt":"3ROLE_TASK:%s ROLE:%s\\nImplement it."},"tool_response":{"agentId":"%s"}}' "$SID" "$TASKID" "$ROLE" "$AGENTID")
printf '%s' "$PAYLOAD" | THREE_ROLE_LEDGER_DIR="$LEDGERDIR" THREE_ROLE_PROJECTS_ROOT="$PROJROOT" KANBAN_SYNC_DRYRUN=1 KANBAN_AUTOSYNC_OFF_FILE="$TMP/none-kanban" bash "$SPAWN_HOOK" >/dev/null 2>&1

LEDGER_FILE="$LEDGERDIR/$SID/$TASKID.jsonl"
if [ -f "$LEDGER_FILE" ] && grep -q "\"agentId\":\"$AGENTID\"" "$LEDGER_FILE" 2>/dev/null; then
  ok "step 1: real three-role-spawn-ledger.sh wrote an open row for the pipeline role (background/PostToolUse-at-dispatch shape)"
else
  bad "step 1: expected an open ledger row for agentId=$AGENTID at $LEDGER_FILE"
fi
has_closed_at_1=$(grep -c '"closedAt"' "$LEDGER_FILE" 2>/dev/null); [ -n "$has_closed_at_1" ] || has_closed_at_1=0
{ [ "$has_closed_at_1" = "0" ]; } && ok "step 1: row carries NO closedAt (genuinely open mid-flight)" || bad "step 1: row should carry no closedAt yet (has_closed_at=$has_closed_at_1)"

# ---- N1: the dispatch-time open row does NOT by itself satisfy gate-plan-review (completion gate stays fail-closed). ----
GATE_OUT=$(THREE_ROLE_LEDGER_DIR="$LEDGERDIR" THREE_ROLE_PROJECTS_ROOT="$PROJROOT" node "$LED" gate-plan-review --session "$SID" --task "$TASKID" 2>&1); GATE_RC=$?
{ [ "$GATE_RC" != "0" ]; } && ok "N1: dispatch-time open row does NOT satisfy gate-plan-review (still BLOCK, rc=$GATE_RC) — no completion-gate regression" || bad "N1: gate-plan-review unexpectedly ALLOWed on a dispatch-time-only row (rc=$GATE_RC out=$GATE_OUT)"

# ---- Step 2: real exporter + real computeActiveIds, MID-RUN -> live-count == 1. ----
mid_count=$(compute_live_count)
{ [ "$mid_count" = "1" ]; } && ok "step 2: mid-run (open punch-in, no SubagentStop yet) -> live-count == 1 (AC-6 needs NO ai-brain change in production/background spawn mode)" || bad "step 2: expected live-count 1 mid-run, got '$mid_count'"

# ---- Step 3: fabricate the real SubagentStop transcript + fire the close hook -> overlay-merges closedAt. ----
SUBDIR="$PROJROOT/proj/$SID/subagents"; mkdir -p "$SUBDIR"
SUBFILE="$SUBDIR/agent-$AGENTID.jsonl"
node -e '
  const fs=require("fs");
  const line=JSON.stringify({isSidechain:true,agentId:process.argv[1],sessionId:process.argv[2],type:"user",message:{role:"user",content:"3ROLE_TASK:"+process.argv[3]+" ROLE:"+process.argv[4]+"\nImplement it."}});
  fs.writeFileSync(process.argv[5], line+"\n");
' "$AGENTID" "$SID" "$TASKID" "$ROLE" "$SUBFILE"
MAINFILE="$TMP/main-$SID.jsonl"
printf '{"type":"user","message":{"role":"user","content":"main-session work, no tags"}}\n' > "$MAINFILE"
STOP_PAYLOAD=$(printf '{"session_id":"%s","transcript_path":"%s","agent_transcript_path":"%s","agent_id":"%s"}' "$SID" "$MAINFILE" "$SUBFILE" "$AGENTID")
printf '%s' "$STOP_PAYLOAD" | THREE_ROLE_LEDGER_DIR="$LEDGERDIR" THREE_ROLE_PROJECTS_ROOT="$PROJROOT" bash "$STOP_HOOK" >/dev/null 2>&1

has_closed_at_2=$(grep -c '"closedAt"' "$LEDGER_FILE" 2>/dev/null); [ -n "$has_closed_at_2" ] || has_closed_at_2=0
line_count=$(grep -c "\"role\":\"$ROLE\"" "$LEDGER_FILE" 2>/dev/null); [ -n "$line_count" ] || line_count=0
{ [ "$has_closed_at_2" = "1" ] && [ "$line_count" = "1" ]; } && ok "step 3: real SubagentStop hook overlay-merged closedAt onto the SAME row (ONE line, not a new zombie duplicate)" || bad "step 3: expected exactly one $ROLE row carrying closedAt (has_closed_at=$has_closed_at_2 line_count=$line_count)"

# ---- Step 4: real exporter + real computeActiveIds, POST-STOP -> live-count == 0.
#      Evaluated 9 min past "now" (past ACTIVE_WINDOW_MS=8min) so disjunct-3's
#      separate recency transient (lit by the fresh close-stamp TOUCH itself,
#      not by the punch-out predicate) cannot mask the punch-out verdict —
#      the SAME isolation lane-role-handoff-gap.test.ts AC-7(c') uses. ----
post_count=$(compute_live_count $((9 * 60 * 1000)))
{ [ "$post_count" = "0" ]; } && ok "step 4: post-SubagentStop (closedAt present), past the recency window -> live-count == 0 (darkens on the punch-out signal, not '\''within 6h'\'')" || bad "step 4: expected live-count 0 post-stop (past the recency window), got '$post_count'"

[ "$fail" = "0" ] && { echo "AC-0 SMOKE: ALL PASS"; exit 0; } || { echo "AC-0 SMOKE: FAILED"; exit 1; }
