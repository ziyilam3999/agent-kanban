#!/usr/bin/env bash
# #3290 feed fail-loud arms: when the inner status-tables run inside board-live-push.mjs fails, times
# out, or yields no focus scalars while focus-progress returned focuses, the push must ABORT before the
# first issue upsert, write no state hash, and print a named failure line (focus-join-failed:) to stderr
# with a non-zero exit. A healthy (or genuinely focus-less) run is unchanged: same upserts, same bodies.
# Everything is sandboxed: a synthetic ai-brain checkout (stub status-tables + stub focus-progress), a
# stub gh that only LOGS its calls, and HOME pointed at a scratch dir — no network, no live push, no
# live board-live state dir. The harness fails closed if gh does not resolve to its own stub.
# Optional env: BASE_MJS = a second board-live-push.mjs (e.g. pristine origin/master) for the
# byte-for-byte healthy-output equivalence arm.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/board-live-push.mjs"
fail() { echo "FAIL: $*" >&2; exit 1; }

SBX="$(mktemp -d)"
trap 'rm -rf "$SBX"' EXIT
TMPHOME="$SBX/home"; TMPBIN="$SBX/bin"; AB="$SBX/abrain"; FD="$SBX/focus"; DATA="$SBX/data"
mkdir -p "$TMPHOME" "$TMPBIN" "$AB/skills/progress-summary/bin" "$FD" "$DATA/empty"
SID="00000000-0000-4000-8000-000000000329"
NOW="2026-10-15T07:12:27Z"
GH_LOG="$SBX/gh-calls.log"
export GH_LOG

# --- sandbox PATH: node + git + OUR stub gh, nothing else that could touch the network
ln -s "$(command -v node)" "$TMPBIN/node"
ln -s "$(command -v git)" "$TMPBIN/git"
cat >"$TMPBIN/gh" <<'GH'
#!/bin/sh
printf 'gh %s\n' "$*" >>"$GH_LOG"
echo "https://github.com/ziyalam3999/agent-board-data/issues/9"
GH
chmod +x "$TMPBIN/gh"
# fail closed: if gh does not resolve to our stub, refuse to run anything push-shaped
GH_ON_PATH="$(PATH="$TMPBIN:/usr/bin:/bin" command -v gh || true)"
[ "$GH_ON_PATH" = "$TMPBIN/gh" ] || fail "gh is not the sandbox stub ($GH_ON_PATH); refusing to run push arms"

# --- synthetic ai-brain checkout: the status-tables stub is both the imported module (lastLedgerRow /
# ROLE_ORDER) and the child process board-live-push spawns; ST_MODE picks the flavour per arm.
cat >"$AB/skills/progress-summary/bin/status-tables.mjs" <<'ST'
import { pathToFileURL } from 'node:url';
export const ROLE_ORDER = ['research', 'planner', 'plan-review', 'executor', 'execution-review', 'ship-tail'];
export const lastLedgerRow = () => null;
const COST = { name: 'Cost', label: 'Cost', goal: 'fixture goal cost', lanes: 1, state: 'active', done: 1, open: 1, in_progress: 0, total: 2, wtdPct: 50, unsized: 0 };
const WIKI = { name: 'Wiki', label: 'Wiki', goal: 'fixture goal wiki', lanes: 0, state: 'active', done: 0, open: 1, in_progress: 0, total: 1, wtdPct: 100, unsized: 0 };
const MODES = { ok: [COST, WIKI], partial: [COST], nofoci: [], fail: [], hang: [] };
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mode = process.env.ST_MODE || 'ok';
  if (mode === 'fail') { console.error('stub status-tables: boom'); process.exit(3); }
  if (mode === 'hang') { setTimeout(() => {}, 30000); } // killed by execFileSync's 20 s timeout -> run() swallows
  else process.stdout.write(JSON.stringify({
    lanes: { rows: [{ id: '7001', pool: 'work', stage: 'executor running', seat: 'fable (Agent tool)', effort: 'high (assigned)', model: 'fable' }] },
    focus: { foci: MODES[mode] ?? MODES.ok },
  }));
}
ST
# --- stub focus SSOT (the script board-live-push runs directly for FF); FF_MODE picks its flavour
cat >"$FD/focus-progress.mjs" <<'FF'
const focuses = process.env.FF_MODE === 'empty' ? [] : [
  { name: 'Cost', goal: 'fixture goal cost', total: 2, done: 1, open: 1, in_progress: 0, rows: [
    { n: 1, id: 9901, subject: 'fixture cost row one', status: 'done', blockedBy: [], done: true },
    { n: 2, id: 9902, subject: 'fixture cost row two', status: 'pending', blockedBy: [], done: false } ] },
  { name: 'Wiki', goal: 'fixture goal wiki', total: 1, done: 0, open: 1, in_progress: 0, rows: [
    { n: 1, id: 9903, subject: 'fixture wiki row one', status: 'in_progress', blockedBy: [], done: false } ] },
];
process.stdout.write(JSON.stringify(focuses));
FF
# --- frozen board fixture (DEMO ids only) + a quiet kanban selector state (no tsx spawn)
cat >"$DATA/board.json" <<'BOARD'
{ "generatedAt": "2026-10-15T07:00:00Z", "rows": [
  { "id": 7001, "title": "DEMO lane one", "column": "in_progress", "updatedAt": "2026-10-15T06:00:00Z" },
  { "id": 7002, "title": "DEMO todo one", "column": "todo", "updatedAt": "2026-10-15T06:30:00Z" } ] }
BOARD
printf '{ "active": [], "lanes": [], "shelf": {} }' >"$DATA/kanban.json"

# run_push <st_mode> <ff_mode> [extra flags...] — a FULL push (no --dry-run) against the sandbox
run_push() {
  local st="$1" ff="$2"; shift 2
  : >"$GH_LOG"; mkdir -p "$TMPHOME/.claude/board-live"; rm -f "$TMPHOME/.claude/board-live/state.json"
  HOME="$TMPHOME" ST_MODE="$st" FF_MODE="$ff" BOARD_AI_BRAIN="$AB" \
    PATH="$TMPBIN:/usr/bin:/bin" node "$SCRIPT" --board "$DATA/board.json" --focus-dir "$FD" \
    --kanban-json "$DATA/kanban.json" --session "$SID" --ledger-dir "$DATA/empty" --events-dir "$DATA/empty" \
    --tasks-dir "$DATA/empty" --now "$NOW" "$@"
}
upserts() { [ -f "$GH_LOG" ] && wc -l <"$GH_LOG" | tr -d ' ' || echo 0; }

# --- must-fire arms: the dead join aborts the push (non-zero exit, named stderr line, zero upserts,
# no state hash). The 20 s budget is the script's own execFileSync timeout killing the hung stub.
must_fire() {
  local name="$1" st="$2" out err rc
  out="$(mktemp)"; err="$(mktemp)"
  run_push "$st" ok >"$out" 2>"$err"; rc=$?
  [ "$rc" -ne 0 ] || fail "$name: exited 0 (the hollow push shipped)"
  command grep -q 'focus-join-failed:' "$err" || fail "$name: no named failure line on stderr"
  [ "$(upserts)" = "0" ] || fail "$name: $(upserts) upsert(s) happened"
  [ ! -e "$TMPHOME/.claude/board-live/state.json" ] || fail "$name: state hash was written"
  echo "ok must-fire $name (rc=$rc: $(command grep -m1 'focus-join-failed:' "$err"))"
  rm -f "$out" "$err"
}
must_fire "inner-run-exits-nonzero" "fail"
must_fire "inner-run-returns-empty-foci" "nofoci"
must_fire "inner-run-times-out" "hang"

# --- must-not-fire arms
must_not_fire() {
  local name="$1" st="$2" ff="$3" out err rc
  out="$(mktemp)"; err="$(mktemp)"
  run_push "$st" "$ff" >"$out" 2>"$err"; rc=$?
  [ "$rc" -eq 0 ] || fail "$name: exited $rc"
  command grep -q 'focus-join-failed:' "$err" && fail "$name: false abort" || true
  [ "$(upserts)" = "4" ] || fail "$name: expected 4 upserts, saw $(upserts)"
  [ -f "$TMPHOME/.claude/board-live/state.json" ] || fail "$name: state hash not written"
  echo "ok must-not-fire $name (4 upserts, state hash written)"
  rm -f "$out" "$err"
}
must_not_fire "healthy-fixture" "ok" "ok"
must_not_fire "focus-progress-empty-and-foci-empty" "nofoci" "empty"

# a single focus missing its scalars (Wiki absent from foci) passes through: no abort, wtdPct null
OUT_P="$(mktemp)"
run_push partial ok --focuses-only >"$OUT_P" 2>/dev/null || fail "partial-scalars --focuses-only exited nonzero"
node - "$OUT_P" <<'PEOF' || fail "partial-scalars arm failed"
const fs = require('fs');
const cards = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const wiki = cards.find((f) => f.key === 'wiki');
if (!wiki || wiki.wtdPct !== null) { console.error('FAIL: wiki card missing or wtdPct not null'); process.exit(1); }
const cost = cards.find((f) => f.key === 'cost');
if (!cost || cost.wtdPct !== 50) { console.error('FAIL: cost card missing or wtdPct not 50'); process.exit(1); }
PEOF
rm -f "$OUT_P"
echo "ok must-not-fire single-focus-missing-scalars (wtdPct passes through as null)"

# --- healthy equivalence: the #4 body and the dry-run summary are byte-for-byte what the base script
# produces from the same fixtures (a healthy run is unchanged).
if [ -n "${BASE_MJS:-}" ]; then
  BODY_H="$(mktemp)"; BODY_B="$(mktemp)"; DRY_H="$(mktemp)"; DRY_B="$(mktemp)"
  run_push ok ok --focus-body >"$BODY_H" 2>/dev/null || fail "healthy --focus-body (head) exited nonzero"
  HOME="$TMPHOME" ST_MODE=ok FF_MODE=ok BOARD_AI_BRAIN="$AB" PATH="$TMPBIN:/usr/bin:/bin" \
    node "$BASE_MJS" --board "$DATA/board.json" --focus-dir "$FD" --kanban-json "$DATA/kanban.json" \
    --session "$SID" --ledger-dir "$DATA/empty" --events-dir "$DATA/empty" --tasks-dir "$DATA/empty" \
    --now "$NOW" --focus-body >"$BODY_B" 2>/dev/null || fail "healthy --focus-body (base) exited nonzero"
  cmp -s "$BODY_H" "$BODY_B" || fail "healthy #4 body differs from base"
  run_push ok ok --dry-run --json >"$DRY_H" 2>/dev/null || fail "healthy --dry-run (head) exited nonzero"
  HOME="$TMPHOME" ST_MODE=ok FF_MODE=ok BOARD_AI_BRAIN="$AB" PATH="$TMPBIN:/usr/bin:/bin" \
    node "$BASE_MJS" --board "$DATA/board.json" --focus-dir "$FD" --kanban-json "$DATA/kanban.json" \
    --session "$SID" --ledger-dir "$DATA/empty" --events-dir "$DATA/empty" --tasks-dir "$DATA/empty" \
    --now "$NOW" --dry-run --json >"$DRY_B" 2>/dev/null || fail "healthy --dry-run (base) exited nonzero"
  cmp -s "$DRY_H" "$DRY_B" || fail "healthy dry-run summary differs from base"
  rm -f "$BODY_H" "$BODY_B" "$DRY_H" "$DRY_B"
  echo "ok healthy-equivalence (#4 body + dry-run summary byte-identical to base)"
else
  echo "skip healthy-equivalence (BASE_MJS unset)"
fi

echo "fail-loud smoke: all arms green"
