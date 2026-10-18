#!/usr/bin/env bash
# #3272 size smoke (local, like the parity smoke — CI runs jest only): the board-live summary stays
# under the issue-body size cap WITH HEADROOM once the per-ticket focus lists move to their own pinned
# issue #4, and the merged size-weighted % rides the cards untouched. RED control built in: master's
# script on the same fixture must EXCEED 62000 — the live crash reproduced by code (SMOKE exits
# non-zero on master: every GREEN arm below fails there). Also proves the deploy join: the selector
# the feed spawns is the tracked scripts/kanban-lanes.ts of this checkout, and without --kanban-json
# the feed reports laneSource == 'kanban'.
# Needs BOARD_AI_BRAIN -> an ai-brain checkout carrying tests/fixtures/board-size (the FX fixture)
# and tools/board/fixtures (the focus stub generator). All fixture rows are synthesized (fake 99xx/90xx
# ids, made-up subjects); nothing is copied from real tickets, ledger rows or receipts.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KAN="$(cd "$HERE/.." && pwd)"
SCRIPT="$KAN/scripts/board-live-push.mjs"
SEL="$KAN/scripts/kanban-lanes.ts"
fail() { echo "FAIL: $*" >&2; exit 1; }

AB="${BOARD_AI_BRAIN:-}"
[ -n "$AB" ] || fail "BOARD_AI_BRAIN is not set (path to the ai-brain checkout holding tests/fixtures/board-size)"
FX="$AB/tests/fixtures/board-size"
for f in board.json kanban.json; do [ -f "$FX/$f" ] || fail "fixture file missing: $FX/$f"; done
[ -x "$SCRIPT" ] || [ -f "$SCRIPT" ] || fail "feed script missing: $SCRIPT"
[ -f "$SEL" ] || fail "selector missing: $SEL (A2 — the tracked kanban-lanes.ts)"

WORK="$(mktemp -d)"
CREATED_BOARD=0
cleanup() {
  [ "$CREATED_BOARD" = 1 ] && rm -f "$KAN/data/board.json"
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$WORK/ledger" "$WORK/tasks"

SID="fx-size-smoke"
NOW="2026-10-18T12:00:00Z"
export BOARD_AI_BRAIN="$AB"
FOCUS_DIR="$(node "$AB/tools/board/fixtures/make-focus-fixture.mjs" size)" || fail "focus stub build failed"
run() { # run the feed on FX; extra args appended (always --dry-run: no network, no state)
  node "$SCRIPT" --board "$FX/board.json" --session "$SID" \
    --ledger-dir "$WORK/ledger" --events-dir "$WORK/ledger" --tasks-dir "$WORK/tasks" \
    --now "$NOW" --focus-dir "$FOCUS_DIR" --dry-run --json "$@"
}

# --- RED control: master's script on the same fixture exceeds 62000 (the crash, by code)
MS="$WORK/master-feed.mjs"
git -C "$KAN" show master:scripts/board-live-push.mjs > "$MS" 2>/dev/null || fail "cannot read master:scripts/board-live-push.mjs"
node "$MS" --board "$FX/board.json" --kanban-json "$FX/kanban.json" --session "$SID" \
  --ledger-dir "$WORK/ledger" --events-dir "$WORK/ledger" --tasks-dir "$WORK/tasks" \
  --now "$NOW" --focus-dir "$FOCUS_DIR" --dry-run --json > "$WORK/red.json" 2>/dev/null \
  || fail "master dry-run exited nonzero"
RED_N="$(wc -c < "$WORK/red.json" | tr -d ' ')"
[ "$RED_N" -gt 62000 ] || fail "RED control: master's summary on FX is only $RED_N bytes (must exceed 62000 — recalibrate the fixture)"

# --- deploy join (A2): the tracked selector answers, both directly and through the feed's own spawn
node - "$SCRIPT" <<'NODE' || fail "A2: the selector the feed spawns is not the tracked one"
const fs = require('fs'); const path = require('path');
const feed = process.argv[2];
const joined = path.dirname(fs.realpathSync(feed)) + '/kanban-lanes.ts'; // the exact join the feed's spawn performs
if (!fs.existsSync(joined)) { console.error('missing: ' + joined); process.exit(1); }
NODE
# the feed (worktree copy) reads data/board.json through the selector: materialize a scratch board if
# the worktree has none (the file is untracked live state; only what this smoke created is removed)
if [ ! -f "$KAN/data/board.json" ]; then
  node - "$FX/board.json" "$KAN/data/board.json" <<'NODE' || fail "scratch board build failed"
const fs = require('fs');
const b = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const tickets = {};
for (const r of b.rows || []) tickets[String(r.id)] = { id: String(r.id), subject: r.title, column: r.column, status: r.column === 'done' ? 'completed' : r.column === 'in_progress' ? 'in_progress' : 'pending', kind: r.kind || 'work', blockedBy: r.blockedBy || [], updatedAt: r.updatedAt, comments: [] };
fs.writeFileSync(process.argv[3], JSON.stringify({ generatedAt: b.generatedAt, tickets }));
NODE
  CREATED_BOARD=1
fi
( cd "$KAN" && node node_modules/.bin/tsx scripts/kanban-lanes.ts ) > "$WORK/sel.json" 2>"$WORK/sel.err" \
  || fail "selector run exited nonzero: $(head -1 "$WORK/sel.err")"
node - "$WORK/sel.json" <<'NODE' || fail "selector output shape"
const j = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
if (!Array.isArray(j.lanes) || !Array.isArray(j.active) || !j.shelf || typeof j.done !== 'number' || j.source !== 'agent-kanban/scripts/kanban-lanes.ts') { console.error('bad selector payload'); process.exit(1); }
NODE
run > "$WORK/green-nokanban.json" 2>/dev/null || fail "green run without --kanban-json exited nonzero"
node - "$WORK/green-nokanban.json" <<'NODE' || fail "laneSource is not kanban (the tracked selector did not answer)"
const j = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
if (j.laneSource !== 'kanban') { console.error('laneSource=' + j.laneSource); process.exit(1); }
NODE

# --- GREEN: the worktree feed on FX — summary small, ticket lists in their own body, % on the cards
run --kanban-json "$FX/kanban.json" > "$WORK/green.json" 2>/dev/null || fail "green run exited nonzero"
node "$SCRIPT" --board "$FX/board.json" --session "$SID" --ledger-dir "$WORK/ledger" --events-dir "$WORK/ledger" \
  --tasks-dir "$WORK/tasks" --now "$NOW" --focus-dir "$FOCUS_DIR" --focuses-only > "$WORK/focuses.json" 2>/dev/null \
  || fail "--focuses-only exited nonzero"
node "$SCRIPT" --board "$FX/board.json" --session "$SID" --ledger-dir "$WORK/ledger" --events-dir "$WORK/ledger" \
  --tasks-dir "$WORK/tasks" --now "$NOW" --focus-dir "$FOCUS_DIR" --focus-body > "$WORK/focus-body.json" 2>/dev/null \
  || fail "--focus-body exited nonzero"
node - "$WORK/green.json" "$WORK/focuses.json" "$WORK/focus-body.json" "$FOCUS_DIR" "$RED_N" <<'NODE' || exit 1
const fs = require('fs');
const [greenPath, focusesPath, bodyPath, focusDir, redN] = process.argv.slice(2);
const bad = [];
const chk = (name, ok) => { if (!ok) bad.push(name); };
const green = JSON.parse(fs.readFileSync(greenPath, 'utf8'));
const focuses = JSON.parse(fs.readFileSync(focusesPath, 'utf8'));
const body = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
// AC-2: summary length
chk('green summary <= 48000 bytes (got ' + green.length + ')', JSON.stringify(green).length <= 48000);
// AC-2: no tickets on any card, no legacy focus key
chk('no card carries a tickets key', (green.focuses || []).every((f) => !('tickets' in f)));
chk('summary has no top-level focus key', !('focus' in green));
chk('summary keeps focusTotals', !!green.focusTotals);
// AC-2: every card carries integer wtdPct + unsized
for (const f of focuses) {
  chk(f.key + ' wtdPct integer', Number.isInteger(f.wtdPct));
  chk(f.key + ' unsized integer', Number.isInteger(f.unsized));
}
// AC-2: the #4 body mirrors the stub exactly (keys, counts, id order, kept ticket fields)
const stub = JSON.parse(require('child_process').execFileSync(process.execPath, [focusDir + '/focus-progress.mjs', '--json-full'], { encoding: 'utf8' }));
const ft = body.focusTickets;
chk('focusTickets keys == stub focus keys', JSON.stringify(Object.keys(ft).sort()) === JSON.stringify(stub.map((f) => f.name.toLowerCase()).sort()));
for (const f of stub) {
  const key = f.name.toLowerCase();
  const list = ft[key] || [];
  chk(key + ' ticket count == stub', list.length === f.rows.length);
  chk(key + ' id order == stub', list.map((t) => String(t.id)).join(',') === f.rows.map((r) => String(r.id)).join(','));
  list.forEach((t) => {
    for (const k of ['n', 'id', 'tag', 'subject', 'status', 'waits']) chk(key + ' #' + t.id + ' keeps ' + k, t[k] !== undefined);
    for (const k of ['step', 'model', 'effort']) if (k in t) chk(key + ' #' + t.id + ' ' + k + ' non-empty', String(t[k]).length > 0);
  });
}
chk('body carries generatedAt', typeof body.generatedAt === 'string' && body.generatedAt);
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
console.log('size smoke: summary ' + JSON.stringify(green).length + ' bytes (cap 48000); master on the same fixture ' + redN + ' bytes (>62000); ticket lists ride the #4 body; wtd fields integer on every card; tracked selector answers');
NODE
