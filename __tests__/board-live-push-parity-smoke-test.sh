#!/usr/bin/env bash
# #3111 leg 2a parity smoke, rewritten for #3520 area 23 (2026-10-24): lane parity reads the 3-role
# ledger ONLY. The kanban selector parity input (the --kanban-json flag and the kanban-lanes.ts
# spawn behind laneSource 'kanban') is retired with the Vercel pause, so the frozen fixture now has
# exactly ONE right answer — the ledger one — and the retired seam must be REFUSED (unknown flag,
# fail closed). laneSource is DERIVED from where the lane rows came from (fix round 1, HIGH-1):
# 'board' on the --board fixture arm, 'ledger' on the no-board arm. A third arm proves the area-23
# live shape: with NO --board flag and the default board.json path absent, the feed builds its lanes
# FROM THE LEDGER (the fixture work pool, non-empty) and reports laneSource 'ledger'.
# Needs BOARD_AI_BRAIN -> an ai-brain checkout that carries tests/fixtures/board-truth.
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
NOBOARD="$(mktemp -d)"
trap 'rm -rf "$TMPBIN" "$NOBOARD"' EXIT
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
OUT="$(mktemp)"
run >"$OUT" 2>/dev/null || fail "ledger-parity run exited nonzero"

node - "$OUT" "$FX/expected-old.json" <<'NODECHECK' || exit 1
const fs = require('fs');
const [g, e] = process.argv.slice(2).map((p) => fs.readFileSync(p, 'utf8'));
const bad = [];
const chk = (name, ok) => { if (!ok) bad.push(name); };
let green;
try { green = JSON.parse(g); } catch { console.error('FAIL: output is not one JSON object'); process.exit(1); }
const exp = JSON.parse(e);
const lane = (o, id) => (o.lanes || []).find((l) => String(l.id) === id);
// #3520 area 23: the ONE answer is the ledger one — the fixture's wrong_answers are what must NOT
// come back (9410 was wrongly live, 9411 stuck at execution-review, 6 lanes published).
chk('laneSource == board (derived: the fixture seam supplied the rows)', green.laneSource === 'board');
chk('lane 9410 live == false (the ledger answer)', lane(green, '9410') === undefined || lane(green, '9410').live === false);
chk('lane 9411 flow has cur:ship-tail (the ledger answer)', lane(green, '9411') && String(lane(green, '9411').flow).includes('cur:ship-tail'));
chk('lanes.length == 7', (green.lanes || []).length === 7);
chk('the fixture still pins the old wrong answers', exp.wrong_answers['9410'].live === true && exp.wrong_answers['9411'].cur === 'execution-review');
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
console.log('parity smoke: laneSource ledger, the ledger answers reproduced');
NODECHECK

# the retired seam is refused fail-closed: --kanban-json is an unknown flag now
run --kanban-json "$FX/kanban.json" >/dev/null 2>"$TMPBIN/refused.err"; rc=$?
[ "$rc" = "2" ] || fail "--kanban-json exited $rc (must be refused with exit 2)"
command grep -q "unknown flag: --kanban-json" "$TMPBIN/refused.err" || fail "--kanban-json refusal is not the unknown-flag guard"

# the area-23 live shape: NO --board flag, the default board.json path absent -> still runs, ledger
HOME="$NOBOARD" node "$SCRIPT" --session "$SID" --ledger-dir "$FX/ledger" --events-dir "$FX/ledger" \
  --tasks-dir "$FX/tasks" --now "$NOW" --dry-run --json >"$NOBOARD/out.json" 2>"$NOBOARD/err.log" \
  || fail "no-board run exited nonzero: $(head -1 "$NOBOARD/err.log")"
[ ! -e "$NOBOARD/coding_projects/agent-kanban/data/board.json" ] || fail "the no-board HOME unexpectedly carries a board.json"
node - "$NOBOARD/out.json" <<'NODENOBOARD' || exit 1
const j = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
// #3520 area 23 fix round 1 (HIGH-1): with no board input the lanes come FROM THE LEDGER — the
// status-tables work pool on this fixture is exactly 9301/9412/9414/9415, all live. An empty or
// short lane list here is the round-1 bug (zeros with a lying laneSource label) coming back.
if (j.laneSource !== 'ledger') { console.error('FAIL: no-board laneSource=' + j.laneSource); process.exit(1); }
const ids = (j.lanes || []).map((l) => String(l.id)).sort();
const want = ['9301', '9412', '9414', '9415'];
if (ids.length !== want.length || ids.some((x, i) => x !== want[i])) { console.error('FAIL: no-board lanes=' + JSON.stringify(ids) + ' (want the fixture work pool ' + JSON.stringify(want) + ')'); process.exit(1); }
if (!(j.lanes || []).every((l) => l.live)) { console.error('FAIL: a no-board lane is not live'); process.exit(1); }
if (!j.counts || j.counts.in_progress !== want.length) { console.error('FAIL: no-board counts.in_progress=' + (j.counts && j.counts.in_progress)); process.exit(1); }
console.log('no-board run: exit 0, laneSource ledger, ' + ids.length + ' live lanes from the ledger, board.json never read');
NODENOBOARD

echo "parity smoke: all arms green"
