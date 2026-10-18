#!/usr/bin/env bash
# #3272 size smoke (local, like the parity smoke — CI runs jest only): the board-live summary stays
# under the issue-body size cap WITH HEADROOM once the per-ticket focus lists move to their own pinned
# issue #4, and the merged size-weighted % rides the cards untouched. RED control built in: the pinned
# PRE-FIX blob (398cbca) on the same fixture must EXCEED 62000 — the live crash reproduced by code (SMOKE exits
# non-zero on master: every GREEN arm below fails there). Also proves the deploy join: the selector
# the feed spawns is the tracked scripts/kanban-lanes.ts of this checkout, and without --kanban-json
# the feed reports laneSource == 'kanban'. #3278 adds the details arm: the #2 body (per-ticket
# description + timeline) <= 50000 with headroom, its own pinned RED control (blob 0555ad2) and a
# doubled-board growth bound.
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
  rm -rf "$WORK" "${BIG:-}"
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

# --- RED control: the PRE-FIX script on the same fixture exceeds 62000 (the crash, by code).
# #3272 F2: pinned to the pre-fix BLOB 398cbca, never the moving master ref — once the fix merges,
# master IS the fixed script (45.5K on FX) and a master-reading control goes permanently red.
MS="$WORK/prefix-feed.mjs"
git -C "$KAN" show 398cbca:scripts/board-live-push.mjs > "$MS" 2>/dev/null || fail "cannot read the pinned pre-fix blob 398cbca:scripts/board-live-push.mjs"
node "$MS" --board "$FX/board.json" --kanban-json "$FX/kanban.json" --session "$SID" \
  --ledger-dir "$WORK/ledger" --events-dir "$WORK/ledger" --tasks-dir "$WORK/tasks" \
  --now "$NOW" --focus-dir "$FOCUS_DIR" --dry-run --json > "$WORK/red.json" 2>/dev/null \
  || fail "pre-fix blob dry-run exited nonzero"
RED_N="$(wc -c < "$WORK/red.json" | tr -d ' ')"
[ "$RED_N" -gt 62000 ] || fail "RED control: the pre-fix blob's summary on FX is only $RED_N bytes (must exceed 62000 — recalibrate the fixture)"

# --- #3272 F3: an over-cap #4 body aborts the WHOLE push before any upsert (all-or-nothing), and #4
# is checked and pushed before #1, so a #4 failure can never leave a fresh #1 beside a stale #4.
# gh is deliberately ABSENT from PATH: if any upsert were reached, the run would die on missing gh
# instead of the size guard — the arm asserts the abort IS the pre-push size check naming #4 first.
BIG="$(mktemp -d)"
cp -R "$FOCUS_DIR/." "$BIG/"
node - "$BIG" <<'NODE' || fail "F3: over-cap focus stub build failed"
const fs = require('fs'); const d = process.argv[2];
const cfg = JSON.parse(fs.readFileSync(d + '/focus-lists.json', 'utf8'));
cfg.tasks_dir = d + '/tasks'; // the copied stub points at the ORIGINAL mktemp tasks dir — repoint it here
cfg.focus[Object.keys(cfg.focus)[0]].push('9999');
fs.writeFileSync(d + '/focus-lists.json', JSON.stringify(cfg, null, 1) + '\n');
// one synthesized ticket whose waits list alone pushes the #4 body past the 60000 cap (subjects are
// capped at 140 chars by the feed, but waits ride focusTickets unsliced)
const t = { id: '9999', subject: 'fixture over-cap arm (synthesized)', status: 'pending', blockedBy: Array.from({ length: 6000 }, (_, i) => String(800000 + i)) };
fs.writeFileSync(d + '/tasks/9999.json', JSON.stringify(t, null, 1) + '\n');
NODE
mkdir -p "$BIG/bin"; ln -sf "$(command -v node)" "$BIG/bin/node"
env PATH="$BIG/bin" "$BIG/bin/node" "$SCRIPT" --board "$FX/board.json" --kanban-json "$FX/kanban.json" \
  --session "$SID" --ledger-dir "$WORK/ledger" --events-dir "$WORK/ledger" --tasks-dir "$WORK/tasks" \
  --now "$NOW" --focus-dir "$BIG" > "$WORK/bigcap.out" 2> "$WORK/bigcap.err"; rc_big=$?
[ "$rc_big" != 0 ] || fail "F3: an over-cap #4 body did not abort the push (rc=0)"
if ! command grep -q "board-live focus details (auto) too large" "$WORK/bigcap.err"; then
  head -1 "$WORK/bigcap.err" >&2
  fail "F3: the abort is not the pre-push size guard naming #4 first (rc=$rc_big)"
fi

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
console.log('size smoke: summary ' + JSON.stringify(green).length + ' bytes (cap 48000); the pre-fix blob on the same fixture ' + redN + ' bytes (>62000); ticket lists ride the #4 body; wtd fields integer on every card; tracked selector answers');
NODE

# --- #3278 details arm: the #2 body (per-ticket description + step timeline) under the cap WITH
# HEADROOM — target <= 50000 on today's shape (hard cap 60000), by construction: per-entry trim
# (description + most-recent timeline rows) and a per-section row cap (recent lanes + the N
# most-recently-updated active tickets), so a bigger board cannot grow the body. Fixture is fully
# synthesized at today's shape (fake 96xx ids, made-up text; descriptions at today's 420-char cap,
# 12-row ledger timelines) — nothing copied from real tickets, ledger rows or receipts. Every feed
# invocation below is a no-network print except the RED control, which crosses the pre-push size
# guard with gh deliberately ABSENT from PATH (nothing can reach the network even if the guard
# were bypassed) and must abort ON the size check naming the details body.
DX="$WORK/dx"
node - "$DX" 1 <<'NODE' || fail "details fixture build failed"
const fs = require('fs'); const path = require('path'); const outDir = process.argv[2];
fs.mkdirSync(path.join(outDir, 'ledger', 'fx-dx'), { recursive: true }); fs.mkdirSync(path.join(outDir, 'tasks'), { recursive: true });
const WORDS = 'keep the ticket detail sheet small with headroom under the issue body cap so the whole live push cannot be refused by one over cap parcel'.split(' ');
const desc = (n) => { let s = `fixture detail description ${n} for the size cap calibration`; let i = n % WORDS.length; while (s.length < 420) s += ' ' + WORDS[i++ % WORDS.length]; return s.slice(0, 420); };
const stamp = (n, k) => new Date(Date.parse('2026-10-18T12:00:00Z') - (n % 40) * 3600000 - (11 - k) * 300000).toISOString();
const ROLES = ['research', 'planner', 'plan-review', 'executor', 'execution-review', 'ship-tail'];
const rows = [];
for (let i = 0; i < 40; i++) {
  const id = 9601 + i;
  rows.push({ id: String(id), title: `fixture detail row ${id} hold the board detail sheet under the issue size cap`, column: 'in_progress', kind: 'work', blockedBy: [], updatedAt: stamp(i, 0), description: desc(id) });
  const lines = [];
  for (let k = 0; k < 12; k++) {
    const role = ROLES[k % ROLES.length];
    lines.push(JSON.stringify({ role, session_id: 'fx-dx', ts: stamp(i, k), closedAt: stamp(i, k), modelVersion: k % 2 ? 'claude-sonnet-5' : 'claude-opus-5', provider: 'claude', effort: 'high', verdict: /review/.test(role) ? 'PASS' : '', artifact_path: `plans/2026-10-1${k}-3${id}-plan.md` }));
  }
  fs.writeFileSync(path.join(outDir, 'ledger', 'fx-dx', id + '.jsonl'), lines.join('\n') + '\n');
}
fs.writeFileSync(path.join(outDir, 'board.json'), JSON.stringify({ generatedAt: '2026-10-18T12:00:00Z', note: '#3278 details-arm fixture — synthesized, never copied from the live store', rows }, null, 1) + '\n');
fs.writeFileSync(path.join(outDir, 'kanban.json'), JSON.stringify({ captured_from: { source: 'synthesized for the #3278 details arm' }, active: ['9601', '9602', '9603', '9604'], lanes: [0, 1, 2, 3].map((i) => ({ id: String(9601 + i), stage: i % 4, reworking: false, failedStage: null })) }, null, 1) + '\n');
NODE
DXGROW="$WORK/dx-grow" # growth arm: the SAME fixture with the active rows doubled (40 -> 80)
node - "$DX" "$DXGROW" <<'NODE' || fail "doubled details fixture build failed"
const fs = require('fs'); const path = require('path'); const [src, outDir] = process.argv.slice(2);
fs.mkdirSync(path.join(outDir, 'ledger', 'fx-dx'), { recursive: true }); fs.mkdirSync(path.join(outDir, 'tasks'), { recursive: true });
const board = JSON.parse(fs.readFileSync(path.join(src, 'board.json'), 'utf8'));
const rows = board.rows.map((r) => ({ ...r, id: String(Number(r.id) + 40), title: r.title.replace(/row \d+/, 'row ' + (Number(r.id) + 40)), description: r.description.replace(/description \d+/, 'description ' + (Number(r.id) + 40)) }));
fs.writeFileSync(path.join(outDir, 'board.json'), JSON.stringify({ ...board, rows: board.rows.concat(rows) }, null, 1) + '\n');
fs.writeFileSync(path.join(outDir, 'kanban.json'), fs.readFileSync(path.join(src, 'kanban.json'), 'utf8'));
for (let i = 0; i < 80; i++) { const from = path.join(src, 'ledger', 'fx-dx', (9601 + (i % 40)) + '.jsonl'); const to = path.join(outDir, 'ledger', 'fx-dx', (9601 + i) + '.jsonl'); fs.writeFileSync(to, fs.readFileSync(from, 'utf8')); }
NODE

# RED control (#3272 F2 rule): pinned to the PRE-FIX blob 0555ad2, never the moving master. The old
# feed on the same fixture must abort the WHOLE push on the pre-push size guard naming the #2 body,
# with the guard's own message carrying a byte count > 60000 — today's live refusal, by code.
MS2="$WORK/prefix-feed-3278.mjs"
git -C "$KAN" show 0555ad2:scripts/board-live-push.mjs > "$MS2" 2>/dev/null || fail "cannot read the pinned pre-fix blob 0555ad2:scripts/board-live-push.mjs"
DXBIN="$WORK/dx-bin"; mkdir -p "$DXBIN"; ln -sf "$(command -v node)" "$DXBIN/node" # gh absent: only node resolves
env PATH="$DXBIN" "$DXBIN/node" "$MS2" --board "$DX/board.json" --kanban-json "$DX/kanban.json" \
  --session fx-dx --ledger-dir "$DX/ledger" --events-dir "$DX/ledger" --tasks-dir "$DX/tasks" \
  --now "$NOW" --focus-dir "$FOCUS_DIR" > "$WORK/dxred.out" 2> "$WORK/dxred.err"; rc_dxred=$?
[ "$rc_dxred" != 0 ] || fail "#3278 RED: the pre-fix blob did not abort on the fixture (rc=0)"
if ! command grep -q "board-live details (auto) too large" "$WORK/dxred.err"; then
  head -1 "$WORK/dxred.err" >&2
  fail "#3278 RED: the abort is not the pre-push size guard naming the #2 body (rc=$rc_dxred)"
fi
RED_DXLARGE="$(command grep -o 'board-live details (auto) too large: [0-9]*' "$WORK/dxred.err" | tail -1 | command grep -o '[0-9]*$')"
[ -n "$RED_DXLARGE" ] && [ "$RED_DXLARGE" -gt 60000 ] || fail "#3278 RED: the guard's byte count is $RED_DXLARGE (must exceed 60000 — recalibrate the fixture)"

# GREEN + growth bound + field coverage: the fixed feed prints the #2 body through --details-body
# (no network, no state write — the same print-and-exit pattern as --focus-body) on the today-shaped
# fixture and on the doubled one; both must measure <= 50000 (headroom under the 60000 cap).
dxrun() { # $1 = fixture dir; prints the #2 body on stdout
  node "$SCRIPT" --board "$1/board.json" --kanban-json "$1/kanban.json" --session fx-dx \
    --ledger-dir "$1/ledger" --events-dir "$1/ledger" --tasks-dir "$1/tasks" \
    --now "$NOW" --focus-dir "$FOCUS_DIR" --details-body
}
dxrun "$DX" > "$WORK/dxgreen.json" 2>"$WORK/dxgreen.err" || fail "#3278 GREEN: --details-body exited nonzero: $(head -1 "$WORK/dxgreen.err")"
dxrun "$DXGROW" > "$WORK/dxgrow.json" 2>"$WORK/dxgrow.err" || fail "#3278 growth: --details-body exited nonzero: $(head -1 "$WORK/dxgrow.err")"
DXG_N="$(wc -c < "$WORK/dxgreen.json" | tr -d ' ')"
DXR_N="$(wc -c < "$WORK/dxgrow.json" | tr -d ' ')"
[ "$DXG_N" -le 50000 ] || fail "#3278 GREEN: the #2 body is $DXG_N bytes (must be <= 50000)"
[ "$DXR_N" -le 50000 ] || fail "#3278 growth: the doubled-board #2 body is $DXR_N bytes (must be <= 50000 — the row cap is not bounding)"
node - "$WORK/dxgreen.json" <<'NODE' || exit 1
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const bad = [];
const chk = (name, ok) => { if (!ok) bad.push(name); };
// the body's top-level keys are exactly the loader's read set (details); unread generatedAt is gone
chk('top-level keys == [details]', JSON.stringify(Object.keys(body)) === '["details"]');
const ids = Object.keys(body.details);
// per-section row cap: 40 active rows exist, so the oldest non-lane ids must fall outside the cap
chk('row cap: oldest non-lane active ids absent', ['9638', '9639', '9640'].every((x) => !(x in body.details)));
for (const [id, e] of Object.entries(body.details)) {
  chk('#' + id + ' d is a string', typeof e.d === 'string');
  if (typeof e.tl !== 'string') { bad.push('#' + id + ' tl is not a string'); continue; }
  let steps; try { steps = JSON.parse(e.tl); } catch { bad.push('#' + id + ' tl does not parse as JSON'); continue; }
  chk('#' + id + ' tl is an array', Array.isArray(steps));
  // the page's openSheet renders r/t/c/v/m/e/a per step — every step keeps all seven
  for (const s of (Array.isArray(steps) ? steps : [])) for (const k of ['r', 't', 'c', 'v', 'm', 'e', 'a']) chk('#' + id + ' step keeps ' + k, k in s);
}
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
NODE
echo "size smoke: details body $DXG_N bytes on today's shape, $DXR_N on the doubled board (target <= 50000, cap 60000); pre-fix blob refused the whole push at $RED_DXLARGE bytes"
