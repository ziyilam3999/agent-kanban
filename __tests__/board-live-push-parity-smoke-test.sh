#!/usr/bin/env bash
# #3111 leg 2a parity smoke (Amendment A4, AC21): the tracked board-live-push.mjs, fed the frozen
# fixture in the ai-brain checkout, reproduces the old wrong board answers by code. The red control
# re-runs it without --kanban-json and proves the ledger fallback does NOT reproduce them.
# Needs BOARD_AI_BRAIN -> an ai-brain checkout that carries tests/fixtures/board-truth/kanban.json.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/board-live-push.mjs"
fail() { echo "FAIL: $*" >&2; exit 1; }

AB="${BOARD_AI_BRAIN:-}"
[ -n "$AB" ] || fail "BOARD_AI_BRAIN is not set (path to the ai-brain checkout holding tests/fixtures/board-truth)"
FX="$AB/tests/fixtures/board-truth"
[ -d "$FX" ] || fail "fixture dir missing: $FX"
for f in board.json kanban.json expected-old.json; do
  [ -f "$FX/$f" ] || fail "fixture file missing: $FX/$f"
done

# gh must be absent from PATH: a dry run touches no network.
TMPBIN="$(mktemp -d)"
trap 'rm -rf "$TMPBIN"' EXIT
ln -s "$(command -v node)" "$TMPBIN/node"
ln -s "$(command -v git)" "$TMPBIN/git"
export PATH="$TMPBIN:/usr/bin:/bin"
command -v gh >/dev/null 2>&1 && fail "gh is on PATH; the smoke needs it absent"

SID="4236cea4-95cc-455b-8763-1f4c84184b41"
NOW="2026-10-15T07:12:27Z"
export BOARD_AI_BRAIN="$AB"
run() {
  node "$SCRIPT" --board "$FX/board.json" "$@" --session "$SID" \
    --ledger-dir "$FX/ledger" --events-dir "$FX/ledger" --tasks-dir "$FX/tasks" \
    --now "$NOW" --dry-run --json
}
OUT_GREEN="$(mktemp)"; OUT_RED="$(mktemp)"
run --kanban-json "$FX/kanban.json" >"$OUT_GREEN" 2>/dev/null || fail "green run exited nonzero"
run >"$OUT_RED" 2>/dev/null || fail "red-control run exited nonzero"

node - "$OUT_GREEN" "$OUT_RED" "$FX/expected-old.json" <<'EOF' || exit 1
const fs = require('fs');
const [g, r, e] = process.argv.slice(2).map((p) => fs.readFileSync(p, 'utf8'));
const bad = [];
const chk = (name, ok) => { if (!ok) bad.push(name); };
let green, red, exp;
try { green = JSON.parse(g); } catch { console.error('FAIL: green output is not one JSON object'); process.exit(1); }
try { red = JSON.parse(r); } catch { console.error('FAIL: red-control output is not one JSON object'); process.exit(1); }
exp = JSON.parse(e);
const lane = (o, id) => (o.lanes || []).find((l) => String(l.id) === id);
const ids = (o) => (o.lanes || []).map((l) => Number(l.id)).sort((a, b) => a - b);
// green: the old wrong answers reproduced by code
chk('green laneSource == kanban', green.laneSource === 'kanban');
chk('green lane 9410 live == true (expected-old)', lane(green, '9410') && lane(green, '9410').live === exp.wrong_answers['9410'].live);
chk('green lane 9411 flow has cur:execution-review (expected-old)', lane(green, '9411') && String(lane(green, '9411').flow).includes('cur:' + exp.wrong_answers['9411'].cur));
chk('green lanes ids == [9301,9410,9411,9412,9414,9415]', JSON.stringify(ids(green)) === JSON.stringify([9301, 9410, 9411, 9412, 9414, 9415]));
chk('green lane count == expected-old lanesPublished', (green.lanes || []).length === exp.wrong_answers.lanesPublished);
// red control: the ledger fallback must NOT reproduce them
chk('red laneSource == ledger', red.laneSource === 'ledger');
chk('red lane 9410 live == false', lane(red, '9410') && lane(red, '9410').live === false);
chk('red lane 9411 flow has cur:ship-tail', lane(red, '9411') && String(lane(red, '9411').flow).includes('cur:ship-tail'));
chk('red lanes.length == 7', (red.lanes || []).length === 7);
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
console.log('parity smoke: green reproduces expected-old.json; red control diverges (ledger fallback)');
EOF
RC=$?
rm -f "$OUT_GREEN" "$OUT_RED"
exit $RC
