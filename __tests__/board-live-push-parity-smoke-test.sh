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
[ "$RC" -eq 0 ] || fail "lane parity arms failed (rc=$RC)"

# --- #3244 group C arms (AC-C1..AC-C3): focus cards link their wiki pages via the wiki-hub registry.
# All data under the fixture focus dir and hub dirs is synthesized (fake ticket ids 990x, fake remote);
# no real ticket rows, ledger rows or receipts are copied in.
FD="$(mktemp -d)"          # fixture focus SSOT dir (focus-progress.mjs stub)
HUB="$(mktemp -d)"         # registry maps ziyilam3999/ai-brain -> a child wiki WITH a remote
HUB2="$(mktemp -d)"        # twin: same entry, no remote -> fail-open
HUB3="$(mktemp -d)"        # empty dir, no registry.json -> fail-open
trap 'rm -rf "$TMPBIN" "$FD" "$HUB" "$HUB2" "$HUB3"' EXIT
mkdir -p "$HUB/child"
cat >"$FD/focus-progress.mjs" <<'STUB'
process.stdout.write(JSON.stringify([
  { name: 'Cost', goal: 'fixture goal cost', total: 2, done: 1, open: 1, in_progress: 0, rows: [
    { n: 1, id: 9901, subject: 'fixture cost row one', status: 'done', blockedBy: [], done: true },
    { n: 2, id: 9902, subject: 'fixture cost row two', status: 'pending', blockedBy: [], done: false } ] },
  { name: 'Wiki', goal: 'fixture goal wiki', total: 1, done: 0, open: 1, in_progress: 0, rows: [
    { n: 1, id: 9903, subject: 'fixture wiki row one', status: 'in_progress', blockedBy: [], done: false } ] },
]));
STUB
cat >"$HUB/registry.json" <<'REG'
{ "entries": [ { "alias": "ai-brain-wiki", "kind": "wiki", "local": "child",
  "remote": "ziyilam3999/fixture-wiki", "covers": ["ziyilam3999/ai-brain"] } ] }
REG
cat >"$HUB2/registry.json" <<'REG2'
{ "entries": [ { "alias": "ai-brain-wiki", "kind": "wiki", "local": "child",
  "covers": ["ziyilam3999/ai-brain"] } ] }
REG2
for k in cost wiki; do
  printf '# fixture WHY page %s\n' "$k" >"$HUB/child/focus-$k.md"
  printf '# fixture progress page %s\n' "$k" >"$HUB/child/focus-$k-progress.md"
done
runf() { # --focuses-only against a fixture hub; $1 = hub dir
  node "$SCRIPT" --board "$FX/board.json" --focus-dir "$FD" --wiki-hub "$1" \
    --session "$SID" --ledger-dir "$FX/ledger" --events-dir "$FX/ledger" \
    --tasks-dir "$FX/tasks" --now "$NOW" --focuses-only
}
OUT_W="$(mktemp)"; OUT_T="$(mktemp)"; OUT_E="$(mktemp)"
runf "$HUB" >"$OUT_W" 2>/dev/null || fail "AC-C1 linked run exited nonzero"
runf "$HUB2" >"$OUT_T" 2>/dev/null || fail "AC-C1 fail-open twin (no remote) exited nonzero"
runf "$HUB3" >"$OUT_E" 2>/dev/null || fail "AC-C3 frozen-green run (no registry) exited nonzero"
node - "$OUT_W" "$OUT_T" "$OUT_E" "$HUB" <<'WEOF' || fail "wiki arms failed (AC-C1..AC-C3)"
const fs = require('fs');
const [w, t, e, hub] = process.argv.slice(2);
const bad = [];
const chk = (name, ok) => { if (!ok) bad.push(name); };
const parse = (p, tag) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { console.error('FAIL: ' + tag + ' output is not one JSON object'); process.exit(1); } };
const linked = parse(w, 'AC-C1 linked'), twin = parse(t, 'AC-C1 twin'), frozen = parse(e, 'AC-C3');
const BASE = 'https://github.com/ziyilam3999/fixture-wiki/blob/main/';
// AC-C1: one card per focus, each carrying the two blob URLs off its own key
chk('AC-C1 two focus cards', Array.isArray(linked) && linked.length === 2);
for (const f of linked) {
  chk('AC-C1 ' + f.key + ' wiki url', f.wiki === BASE + 'focus-' + f.key + '.md');
  chk('AC-C1 ' + f.key + ' wikiProgress url', f.wikiProgress === BASE + 'focus-' + f.key + '-progress.md');
}
// AC-C1 fail-open parity: no remote -> both fields omitted, every OTHER field unchanged
chk('AC-C1 twin card count', Array.isArray(twin) && twin.length === linked.length);
const strip = (f) => { const c = { ...f }; delete c.wiki; delete c.wikiProgress; return c; };
for (let i = 0; i < linked.length; i++) {
  chk('AC-C1 twin ' + linked[i].key + ' omits wiki fields', !('wiki' in twin[i]) && !('wikiProgress' in twin[i]));
  chk('AC-C1 twin ' + linked[i].key + ' identical otherwise', JSON.stringify(strip(linked[i])) === JSON.stringify(twin[i]));
}
// AC-C2: both ends of the filename contract agree — every emitted key has its pages on disk
for (const f of linked) {
  chk('AC-C2 focus-' + f.key + '.md exists in child wiki', fs.existsSync(hub + '/child/focus-' + f.key + '.md'));
  chk('AC-C2 focus-' + f.key + '-progress.md exists in child wiki', fs.existsSync(hub + '/child/focus-' + f.key + '-progress.md'));
}
// AC-C3 frozen-green: hub unresolvable -> no wiki fields, cards byte-identical to the twin
chk('AC-C3 same card count', Array.isArray(frozen) && frozen.length === twin.length);
for (let i = 0; i < twin.length; i++) {
  chk('AC-C3 ' + twin[i].key + ' omits wiki fields', !('wiki' in frozen[i]) && !('wikiProgress' in frozen[i]));
  chk('AC-C3 ' + twin[i].key + ' byte-identical cards', JSON.stringify(frozen[i]) === JSON.stringify(twin[i]));
}
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
console.log('wiki arms: AC-C1 linked+fail-open, AC-C2 pages exist, AC-C3 frozen-green');
WEOF
RC=$?
rm -f "$OUT_W" "$OUT_T" "$OUT_E"
exit $RC
