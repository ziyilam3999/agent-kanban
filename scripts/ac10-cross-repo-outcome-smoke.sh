#!/usr/bin/env bash
# ac10-cross-repo-outcome-smoke.sh — #1852 plan AC-10 (r3 — the cross-repo
# OUTCOME verifier over tonight's three ACTUAL zombie shapes; JOINT with
# #1858; does NOT block #1852's own board-side merge).
#
# Synthesizes the three measured zombie ledger shapes on disk (WM
# `1852-punch-clock-stream-pollution.md`), runs the REAL
# `hooks/3role-ledger.mjs reconcile-spawns` sweep + the REAL
# scripts/export-board.ts exporter, then computes a fresh liveness verdict:
#   #1497 — backfilled OPEN research row for an agent whose transcript ended
#           weeks earlier, `closedAt` NEVER stamped by the backfill.
#   #1682 — ghost: ONE pipeline agentId carrying an open row AND a later
#           closed row (the #1852 AC-9 shape).
#   #1696 — killed mid-turn: a genuinely-open pipeline row whose transcript
#           shows a self-authored spawn append; reconcile-spawns' self_authored
#           backfill touches the row and re-arms its ts (the Root Cause item 3
#           "sweep re-arms the cap" defect).
#
# HONEST SPLIT (this is the point of the smoke, not a bug in the smoke): with
# #1852 ALONE, this must be GREEN for #1682 (AC-9 closes it board-side) but
# RED for #1497 and #1696 (their open punch-ins are indistinguishable from a
# live agent, and #1858's writer defects — never-closes-on-backfill, sweep
# re-arms the cap — are what keeps them lit; #1852 cannot fix a WRITER defect
# from the board's consumption side). That RED is the PROOF #1858 is a real,
# unmet dependency — not a phantom forward reference. This script therefore
# reports PARTIAL as its expected, PASSING outcome — flip to "0 live lanes"
# only after #1858 also ships (do not "fix" this script to force a false
# GREEN; see the plan's Deferred-follow-ups + AC-10 text).
#
# Env: AI_BRAIN_DIR (default $HOME/coding_projects/ai-brain). Exit 0 whenever
# the OBSERVED verdict matches the EXPECTED honest split (partial); exit 1 on
# any mismatch (over- OR under-claiming).
set -uo pipefail

AI_BRAIN_DIR="${AI_BRAIN_DIR:-$HOME/coding_projects/ai-brain}"
LED="$AI_BRAIN_DIR/hooks/3role-ledger.mjs"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$LED" ]; then
  echo "AC-10 SMOKE: SKIP — ai-brain hooks not found at AI_BRAIN_DIR=$AI_BRAIN_DIR." >&2
  exit 0
fi

fail=0
ok()  { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; fail=1; }
info() { echo "INFO: $1"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
LEDGERDIR="$TMP/ledger"; TASKSDIR="$TMP/tasks"; PROJROOT="$TMP/projects"; OUT="$TMP/board.json"
SID="ac10smoke1"
SLUG="proj"
DAY=$((24 * 60 * 60))

mkdir -p "$TASKSDIR/$SID" "$LEDGERDIR/$SID" "$PROJROOT/$SLUG/$SID/subagents"

write_task() {
  local id="$1" subj="$2"
  cat > "$TASKSDIR/$SID/$id.json" <<EOF
{"id":"$id","subject":"$subj","description":"","status":"in_progress","blocks":[],"blockedBy":[]}
EOF
}

mk_transcript() {
  # mk_transcript <agentId> <taskId> <role> [selfAuthored 0|1]
  local aid="$1" task="$2" role="$3" selfauth="${4:-0}"
  local f="$PROJROOT/$SLUG/$SID/subagents/agent-$aid.jsonl"
  if [ "$selfauth" = "1" ]; then
    node -e '
      const fs=require("fs");
      const [aid,sess,task,role,f]=process.argv.slice(1);
      const userLine=JSON.stringify({isSidechain:true,agentId:aid,sessionId:sess,type:"user",message:{role:"user",content:"3ROLE_TASK:"+task+" ROLE:"+role+"\nImplement it."}});
      const asstLine=JSON.stringify({type:"assistant",message:{role:"assistant",content:[{type:"tool_use",name:"Bash",input:{command:"node hooks/3role-ledger.mjs append --session "+sess+" --task "+task+" --role "+role+" --agent "+aid}}]}});
      fs.writeFileSync(f, userLine+"\n"+asstLine+"\n");
    ' "$aid" "$SID" "$task" "$role" "$f"
  else
    node -e '
      const fs=require("fs");
      const [aid,sess,task,role,f]=process.argv.slice(1);
      const line=JSON.stringify({isSidechain:true,agentId:aid,sessionId:sess,type:"user",message:{role:"user",content:"3ROLE_TASK:"+task+" ROLE:"+role+"\nDo the work."}});
      fs.writeFileSync(f, line+"\n");
    ' "$aid" "$SID" "$task" "$role" "$f"
  fi
  printf '%s' "$f"
}

touch_secs_ago() {
  local p="$1" secs="$2"
  local t=$(( $(date -u +%s) - secs ))
  local ts
  if date -u -j -f %s "$t" +%Y%m%d%H%M.%S >/dev/null 2>&1; then
    ts=$(date -u -j -f %s "$t" +%Y%m%d%H%M.%S) # BSD/macOS date
  else
    ts=$(date -u -d "@$t" +%Y%m%d%H%M.%S)       # GNU date
  fi
  touch -t "$ts" "$p"
}

# ============ #1497 shape: backfilled open row, transcript ended weeks earlier ============
T1497="9401"
write_task "$T1497" "AC-10 #1497 shape — backfilled open research row"
AID_1497="ac10-1497-agent"
F1497=$(mk_transcript "$AID_1497" "$T1497" research 0)
touch_secs_ago "$F1497" $((20 * DAY)) # transcript ended ~20 days ago

# ============ #1682 shape: ghost — same agentId, open row THEN a later closed row ============
T1682="9402"
write_task "$T1682" "AC-10 #1682 shape — ghost open+closed pair"
AID_1682="ac10-1682-agent"
cat > "$LEDGERDIR/$SID/$T1682.jsonl" <<EOF
{"role":"planner","ts":"2026-07-19T11:06:00Z","agentId":"$AID_1682","session_id":"$SID"}
{"role":"executor","ts":"2026-07-19T11:18:00Z","agentId":"$AID_1682","session_id":"$SID","closedAt":"2026-07-19T11:18:00Z"}
EOF
touch_secs_ago "$LEDGERDIR/$SID/$T1682.jsonl" $((5 * DAY)) # a genuinely OLD file — no sweep touches this one (no matching transcript is created for it)
# Task-file mtime must ALSO be old — updatedAt = max(taskFileMtime, ledgerFileMtime)
# (build-board.ts), so a freshly-created task file would rescue this ticket via
# disjunct-3's separate, pre-existing recency WINDOW regardless of chain state
# (the same nuance lane-role-handoff-gap.test.ts AC-7(c') isolates). #1682 must
# be OLD on both files to isolate the per-agentId punch-out predicate itself.
touch_secs_ago "$TASKSDIR/$SID/$T1682.json" $((5 * DAY))

# ============ #1696 shape: killed mid-turn, legitimately open, sweep re-arms the ledger mtime ============
T1696="9403"
write_task "$T1696" "AC-10 #1696 shape — killed mid-turn, sweep re-arms cap"
AID_1696="ac10-1696-agent"
THREE_ROLE_LEDGER_DIR="$LEDGERDIR" THREE_ROLE_PROJECTS_ROOT="$PROJROOT" node "$LED" append --session "$SID" --task "$T1696" --role executor --agent "$AID_1696" >/dev/null 2>&1
# Back-date the row's own `ts` field (the AGENT's real last event was days ago) without going
# through the hook again — this is fixture construction, not a second real write.
python3 - "$LEDGERDIR/$SID/$T1696.jsonl" <<'PYEOF'
import sys, json, datetime
p = sys.argv[1]
lines = [l for l in open(p).read().split("\n") if l.strip()]
out = []
old_ts = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
for l in lines:
    j = json.loads(l)
    j["ts"] = old_ts
    out.append(json.dumps(j))
open(p, "w").write("\n".join(out) + "\n")
PYEOF
touch_secs_ago "$LEDGERDIR/$SID/$T1696.jsonl" $((3 * DAY))
F1696=$(mk_transcript "$AID_1696" "$T1696" executor 1) # self-authored spawn append -> reconcile-spawns' self_authored backfill will re-arm ts
touch_secs_ago "$F1696" $((3 * DAY))

# ============ Run the REAL reconcile-spawns sweep. ============
SWEEP_OUT=$(THREE_ROLE_LEDGER_DIR="$LEDGERDIR" THREE_ROLE_PROJECTS_ROOT="$PROJROOT" node "$LED" reconcile-spawns --session "$SID" 2>&1); SWEEP_RC=$?
{ [ "$SWEEP_RC" = "0" ]; } && ok "real reconcile-spawns sweep ran (rc=0): $SWEEP_OUT" || bad "reconcile-spawns did not exit 0 (rc=$SWEEP_RC out=$SWEEP_OUT)"

grep -q "\"agentId\":\"$AID_1497\"" "$LEDGERDIR/$SID/$T1497.jsonl" 2>/dev/null \
  && ok "#1497: reconcile-spawns backfilled the missing row (agentId now present)" \
  || bad "#1497: expected the sweep to backfill agentId=$AID_1497"
has_closed_1497=$(grep -c '"closedAt"' "$LEDGERDIR/$SID/$T1497.jsonl" 2>/dev/null); [ -n "$has_closed_1497" ] || has_closed_1497=0
{ [ "$has_closed_1497" = "0" ]; } && ok "#1497: backfill NEVER stamped closedAt (confirms 3role-ledger.mjs:160's documented limit)" || bad "#1497: backfill unexpectedly stamped closedAt"

# ============ Real exporter + real computeActiveIds. ============
( cd "$REPO_ROOT" && TASKS_DIR="$TASKSDIR" LEDGER_DIR="$LEDGERDIR" OUT="$OUT" SESSION_ID="$SID" NODE_ENV=development npx tsx scripts/export-board.ts >/dev/null 2>&1 )
if [ ! -f "$OUT" ]; then bad "real exporter did not produce $OUT"; fi

RESULT=$( cd "$REPO_ROOT" && OUT_FILE="$OUT" SID_ENV="$SID" npx tsx -e '
  import fs from "fs";
  import { computeActiveIds } from "./lib/active";
  const board = JSON.parse(fs.readFileSync(process.env.OUT_FILE as string, "utf8"));
  const session = (board.sessions || []).find((s: any) => s.id === (process.env.SID_ENV as string).slice(0, 8));
  const isLive = session ? session.live : true;
  const active = computeActiveIds(board.tickets, isLive, Date.now());
  process.stdout.write(JSON.stringify({
    liveCount: active.size,
    t1497: active.has("9401"),
    t1682: active.has("9402"),
    t1696: active.has("9403"),
  }));
' 2>/dev/null )
info "computeActiveIds verdict: $RESULT"

T1497_LIVE=$(printf '%s' "$RESULT" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(d).t1497)}catch(e){console.log("ERR")}})')
T1682_LIVE=$(printf '%s' "$RESULT" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(d).t1682)}catch(e){console.log("ERR")}})')
T1696_LIVE=$(printf '%s' "$RESULT" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(d).t1696)}catch(e){console.log("ERR")}})')

# ---- The honest split: #1852 alone closes #1682 (GREEN) but NOT #1497/#1696 (RED — proves #1858 is real). ----
{ [ "$T1682_LIVE" = "false" ]; } && ok "#1682 (ghost): DARK — closed by #1852 alone (AC-9 per-agentId dedup)" || bad "#1682 should be DARK under #1852 alone (got live=$T1682_LIVE) — AC-9 regression"
{ [ "$T1497_LIVE" = "true" ]; } && ok "#1497 (backfilled open, never closed): RED as expected — #1852 alone CANNOT close this (proves #1858 is a real, unmet dependency, not a phantom forward-reference)" || bad "#1497 unexpectedly DARK under #1852 alone (got live=$T1497_LIVE) — this would be a false #1858-not-needed claim"
{ [ "$T1696_LIVE" = "true" ]; } && ok "#1696 (killed mid-turn, sweep re-armed the cap): RED as expected — same #1858 dependency" || bad "#1696 unexpectedly DARK under #1852 alone (got live=$T1696_LIVE)"

echo "----"
if [ "$fail" = "0" ]; then
  echo "AC-10 SMOKE: HONEST PARTIAL — #1852 alone closes #1682, stays RED for #1497/#1696 pending #1858 (matches outcome_eval=partial). ALL EXPECTED ASSERTIONS PASS."
  exit 0
else
  echo "AC-10 SMOKE: FAILED — the observed split did not match the expected honest partial outcome."
  exit 1
fi
