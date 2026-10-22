#!/usr/bin/env bash
# #3111 leg 2b referee smoke (re-pointed from the leg 2a parity smoke — the 2a proof, that the
# tracked script with its OLD rules reproduced the captured wrong answers, stays in this file's git
# history): the push script now reads ONLY the lane referee (ai-brain status-tables --json + its
# lane-state reader) — the four overlay blocks and the "newer round wins" pass are deleted (AC7) —
# so the frozen Fixture A board answers are the referee's answers: 4 work lanes {9301, 9412, 9414,
# 9415}, ship-tail {9302, 9411}, 9410 a merged leg in NEITHER list, laneSource "lane-state" (AC3/AC4);
# the cadence Fixture B answers 2 of 4 + 0 of 2 with 9303 merged (AC20); and the committed synthetic
# seam fixture deep-equals its expected summary, with the referee's failure shapes failing closed.
# Needs BOARD_AI_BRAIN -> an ai-brain checkout carrying tests/fixtures/board-truth (frozen synthetic
# fixtures, read at RUN time only — this repo's diff owns none of them).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KAN="$(cd "$HERE/.." && pwd)"
SCRIPT="$KAN/scripts/board-live-push.mjs"
RFIX="$HERE/fixtures/board-live-referee"
fail() { echo "FAIL: $*" >&2; exit 1; }

AB="${BOARD_AI_BRAIN:-}"
[ -n "$AB" ] || fail "BOARD_AI_BRAIN is not set (path to the ai-brain checkout holding tests/fixtures/board-truth)"
FX="$AB/tests/fixtures/board-truth"
[ -d "$FX" ] || fail "fixture dir missing: $FX"
[ -f "$FX/board.json" ] || fail "fixture file missing: $FX/board.json"
[ -d "$FX/cadence/ledger" ] || fail "cadence fixture dir missing: $FX/cadence"
for f in board.json status-tables.json lane-state.json expected-summary.json focus/focus-progress.mjs cadence-board.json; do
  [ -f "$RFIX/$f" ] || fail "committed referee fixture missing: $RFIX/$f"
done

# gh must be absent from PATH: every run below is a dry run and touches no network.
TMPBIN="$(mktemp -d)"
EHOME="$(mktemp -d)"
trap 'rm -rf "$TMPBIN" "$EHOME" "${WORK:-}"' EXIT
ln -s "$(command -v node)" "$TMPBIN/node"
ln -s "$(command -v git)" "$TMPBIN/git"
export PATH="$TMPBIN:/usr/bin:/bin"
command -v gh >/dev/null 2>&1 && fail "gh is on PATH; the smoke needs it absent"

SID="4236cea4-95cc-455b-8763-1f4c84184b41"
NOW="2026-10-15T07:12:27Z"
export BOARD_AI_BRAIN="$AB"
# AC7: every deleted rule's name is gone from the tracked script (count 0).
N_AC7="$(command grep -c 'flowOf\|A newer round wins\|kanban-lanes\|computeActiveIds\|lastPer\[' "$SCRIPT")"
[ "$N_AC7" = "0" ] || fail "AC7: $N_AC7 banned lane-rule trace(s) still in $SCRIPT"

# --- Arm A: the referee chain on the frozen ai-brain Fixture A (spawn path — AC3's command).
WORK="$(mktemp -d)"
mkdir -p "$WORK/focus"
cat >"$WORK/focus/focus-progress.mjs" <<'STUB'
process.stdout.write(JSON.stringify([
  { name: 'Cost', goal: 'fixture goal cost', total: 1, done: 0, open: 1, in_progress: 0, rows: [
    { n: 1, id: 9412, subject: 'fixture cost row one', status: 'in_progress', blockedBy: [], done: false } ] },
]));
STUB
runA() {
  HOME="$EHOME" node "$SCRIPT" --board "$FX/board.json" --focus-dir "$WORK/focus" --session "$SID" \
    --ledger-dir "$FX/ledger" --events-dir "$FX/ledger" --tasks-dir "$FX/tasks" \
    --now "$NOW" --dry-run --json
}
runA >"$WORK/a.json" 2>"$WORK/a.err" || fail "fixture A dry-run exited nonzero: $(head -1 "$WORK/a.err")"
node - "$WORK/a.json" <<'EOF' || exit 1
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const bad = [];
const chk = (name, ok) => { if (!ok) bad.push(name); };
const ids = (list) => (list || []).map((l) => Number(l.id)).sort((a, b) => a - b);
const rowOf = (id) => (j.rows || []).find((r) => String(r.id) === String(id));
// AC4: lanes == the reader's held set; the counts agree; laneSource names the referee
chk('laneSource == lane-state', j.laneSource === 'lane-state');
chk('lanes ids == [9301,9412,9414,9415]', JSON.stringify(ids(j.lanes)) === JSON.stringify([9301, 9412, 9414, 9415]));
chk('shipTail ids == [9302,9411]', JSON.stringify(ids(j.shipTail)) === JSON.stringify([9302, 9411]));
chk('every shipTail stage begins ship-tail', (j.shipTail || []).every((l) => String(l.stage).startsWith('ship-tail')));
chk('no id in both lanes and shipTail', (j.lanes || []).every((l) => !(j.shipTail || []).some((t) => t.id === l.id)));
chk('laneCounts {work:4,workCap:4,shipTail:2,shipTailCap:2}', JSON.stringify(j.laneCounts) === JSON.stringify({ work: 4, workCap: 4, shipTail: 2, shipTailCap: 2 }));
chk('laneCounts.work == lanes.length', j.laneCounts.work === j.lanes.length);
chk('laneCounts.shipTail == shipTail.length', j.laneCounts.shipTail === j.shipTail.length);
chk('lanes.length <= laneCap', j.lanes.length <= j.laneCap);
// D4: 9410 (the merged leg, the OLD wrong answer's live:true ticket) is in NEITHER list, labelled
chk('9410 in neither lanes nor shipTail', !(j.lanes || []).some((l) => l.id === '9410') && !(j.shipTail || []).some((l) => l.id === '9410'));
chk('9410 rows entry legMerged true', rowOf('9410') && rowOf('9410').legMerged === true);
chk('9410 rows entry sits In-progress', rowOf('9410') && rowOf('9410').column === 'in_progress');
// D6: 9301 runs a suite although board.json says in_review; 9411's open tail sits Review
const l9301 = (j.lanes || []).find((l) => l.id === '9301');
chk('9301 lane stage == suite running', l9301 && l9301.stage === 'suite running');
chk('9301 rows entry In-progress not Review', rowOf('9301') && rowOf('9301').column === 'in_progress' && rowOf('9301').state === 'running');
chk('9411 rows entry Review (open tail)', rowOf('9411') && rowOf('9411').column === 'in_review');
chk('9413 rows entry failed-back-to, no legMerged key', rowOf('9413') && rowOf('9413').state === 'failed-back-to' && !('legMerged' in rowOf('9413')));
chk('every lane row carries state', (j.lanes || []).every((l) => typeof l.state === 'string' && l.state));
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
console.log('arm A (fixture A, referee chain): 4 work lanes, 2 ship-tail, 9410 merged, 9301 In-progress, laneSource lane-state');
EOF
[ $? -eq 0 ] || fail "fixture A arms failed"

# --- Arm B: cadence Fixture B (AC20) — the frozen cadence ledger/tasks in ai-brain at RUN time,
# the synthetic cadence board rows committed here (ai-brain carries no cadence board.json).
runB() {
  HOME="$EHOME" node "$SCRIPT" --board "$RFIX/cadence-board.json" --focus-dir "$WORK/focus" --session "$SID" \
    --ledger-dir "$FX/cadence/ledger" --events-dir "$FX/cadence/ledger" --tasks-dir "$FX/cadence/tasks" \
    --now "$NOW" --dry-run --json
}
runB >"$WORK/b.json" 2>"$WORK/b.err" || fail "cadence dry-run exited nonzero: $(head -1 "$WORK/b.err")"
node - "$WORK/b.json" <<'EOF' || exit 1
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const bad = [];
const chk = (name, ok) => { if (!ok) bad.push(name); };
const ids = (list) => (list || []).map((l) => Number(l.id)).sort((a, b) => a - b);
const rowOf = (id) => (j.rows || []).find((r) => String(r.id) === String(id));
chk('lanes ids == [9304,9305]', JSON.stringify(ids(j.lanes)) === JSON.stringify([9304, 9305]));
chk('shipTail empty', (j.shipTail || []).length === 0);
chk('laneCounts {work:2,workCap:4,shipTail:0,shipTailCap:2}', JSON.stringify(j.laneCounts) === JSON.stringify({ work: 2, workCap: 4, shipTail: 0, shipTailCap: 2 }));
chk('9303 rows entry legMerged true, in neither list', rowOf('9303') && rowOf('9303').legMerged === true && !(j.lanes || []).some((l) => l.id === '9303') && !(j.shipTail || []).some((l) => l.id === '9303'));
for (const id of ['9304', '9305']) {
  chk(id + ' rows entry no legMerged key, In-progress', rowOf(id) && !('legMerged' in rowOf(id)) && rowOf(id).column === 'in_progress');
}
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
console.log('arm B (fixture B cadence): 2 of 4 work + 0 of 2 ship-tail, 9303 merged leg');
EOF
[ $? -eq 0 ] || fail "cadence arms failed"

# --- Arm C: the committed synthetic seam fixture (never the live store): both referee payloads fed
# through the file seams, HOME and BOARD_AI_BRAIN pinned away from anything live (the fixture dir
# carries no hooks/ or skills/, so every cross-repo spawn degrades deterministically), and the whole
# summary deep-equals the committed expected-summary.json.
HOME="$EHOME" BOARD_AI_BRAIN="$RFIX" node "$SCRIPT" --board "$RFIX/board.json" --status-tables-json "$RFIX/status-tables.json" \
  --lane-state-json "$RFIX/lane-state.json" --focus-dir "$RFIX/focus" --session fx \
  --ledger-dir "$RFIX" --events-dir "$RFIX" --tasks-dir "$RFIX" --now "$NOW" --dry-run --json \
  >"$WORK/c.json" 2>"$WORK/c.err" || fail "seam fixture dry-run exited nonzero: $(head -1 "$WORK/c.err")"
node - "$WORK/c.json" "$RFIX/expected-summary.json" <<'EOF' || exit 1
const fs = require('fs');
const deepEq = (a, b) => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return JSON.stringify(ka) === JSON.stringify(kb) && ka.every((k) => deepEq(a[k], b[k]));
};
const got = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const exp = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
if (!deepEq(got, exp)) { console.error('FAIL: seam-fixture summary differs from expected-summary.json'); process.exit(1); }
console.log('arm C (committed synthetic seam fixture): summary deep-equals expected-summary.json');
EOF
[ $? -eq 0 ] || fail "seam fixture deep-equal failed"

# --- Arm D: the referee fails closed (held-out must-fire shapes — none used above). A missing,
# garbled, malformed, over-bound or self-inconsistent referee aborts the push LOUDLY (exit != 0,
# named lane-referee-failed line on stderr, nothing on stdout) — there is no fallback rule set.
must_fire() { # $1 name, $2.. extra flags
  local name="$1"; shift
  HOME="$EHOME" node "$SCRIPT" --board "$RFIX/board.json" --focus-dir "$RFIX/focus" --session fx \
    --ledger-dir "$RFIX" --events-dir "$RFIX" --tasks-dir "$RFIX" --now "$NOW" --dry-run --json \
    "$@" >"$WORK/mf.out" 2>"$WORK/mf.err"
  local rc=$?
  [ "$rc" -ne 0 ] || fail "must-fire $name: exited 0 (a fallback rule set answered)"
  command grep -q 'lane-referee-failed:' "$WORK/mf.err" || fail "must-fire $name: no named failure line ($(head -1 "$WORK/mf.err"))"
  [ ! -s "$WORK/mf.out" ] || fail "must-fire $name: printed a summary despite the dead referee"
  echo "ok must-fire $name (rc=$rc: $(command grep -m1 'lane-referee-failed:' "$WORK/mf.err" | cut -c1-120))"
}
must_fire "status-tables seam file missing" --status-tables-json "$WORK/nope.json" --lane-state-json "$RFIX/lane-state.json"
printf '{' >"$WORK/garbled.json"
must_fire "status-tables seam file garbled" --status-tables-json "$WORK/garbled.json" --lane-state-json "$RFIX/lane-state.json"
printf '{"focus":{}}' >"$WORK/nolanes.json"
must_fire "payload without lanes.rows" --status-tables-json "$WORK/nolanes.json" --lane-state-json "$RFIX/lane-state.json"
node - "$WORK/overbound.json" <<'EOF'
const fs = require('fs');
fs.writeFileSync(process.argv[2], JSON.stringify({ lanes: { rows: [{ id: '1', pool: 'work', stage: 'x', pad: 'z'.repeat(5 * 1024 * 1024) }] } }));
EOF
must_fire "seam file over the 4 MiB bound" --status-tables-json "$WORK/overbound.json" --lane-state-json "$RFIX/lane-state.json"
printf '{"lanes":{"work":{"n":2,"ceiling":4},"ship_tail":{"n":0,"ceiling":2},"rows":[{"id":"9803","pool":"work","stage":"executor running"}]}}' >"$WORK/disagree.json"
must_fire "referee counts disagree with its rows" --status-tables-json "$WORK/disagree.json" --lane-state-json "$RFIX/lane-state.json"
printf '{"lanes":{"work":{"n":1,"ceiling":4},"ship_tail":{"n":1,"ceiling":2},"rows":[{"id":"9803","pool":"work","stage":"x"},{"id":"9803","pool":"ship_tail","stage":"y"}]}}' >"$WORK/both.json"
must_fire "ticket in both pools" --status-tables-json "$WORK/both.json" --lane-state-json "$RFIX/lane-state.json"
must_fire "lane-state seam file missing" --status-tables-json "$RFIX/status-tables.json" --lane-state-json "$WORK/nope.json"
printf '{"held":[]}' >"$WORK/rd-notickets.json"
must_fire "reader payload without tickets" --status-tables-json "$RFIX/status-tables.json" --lane-state-json "$WORK/rd-notickets.json"

# --- Arm E: quiet shapes stay legal (must-not-fire) — an EMPTY referee is a quiet board, not a
# dead one: exit 0, empty lane lists, zero counts, no legMerged invented anywhere.
printf '{"lanes":{"work":{"n":0,"ceiling":4},"ship_tail":{"n":0,"ceiling":2},"rows":[]},"focus":{"foci":[]}}' >"$WORK/quiet-st.json"
printf '{"tickets":{}}' >"$WORK/quiet-rd.json"
HOME="$EHOME" node "$SCRIPT" --board "$RFIX/board.json" --status-tables-json "$WORK/quiet-st.json" \
  --lane-state-json "$WORK/quiet-rd.json" --focus-dir "$RFIX/focus" --session fx \
  --ledger-dir "$RFIX" --events-dir "$RFIX" --tasks-dir "$RFIX" --now "$NOW" --dry-run --json \
  >"$WORK/q.json" 2>"$WORK/q.err" || fail "quiet-board dry-run exited nonzero: $(head -1 "$WORK/q.err")"
node - "$WORK/q.json" <<'EOF' || exit 1
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const bad = [];
const chk = (name, ok) => { if (!ok) bad.push(name); };
chk('quiet: laneSource lane-state', j.laneSource === 'lane-state');
chk('quiet: lanes empty, counts zero', j.lanes.length === 0 && JSON.stringify(j.laneCounts) === JSON.stringify({ work: 0, workCap: 4, shipTail: 0, shipTailCap: 2 }));
chk('quiet: no row invented legMerged', (j.rows || []).every((r) => !('legMerged' in r)));
chk('quiet: every row state null (no reader state)', (j.rows || []).every((r) => r.state === null));
chk('quiet: columns pass through untouched', (j.rows || []).every((r) => ['in_progress', 'in_review', 'todo'].includes(r.column)));
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
console.log('arm E (quiet board): empty referee is legal — no lane, no invented state');
EOF
[ $? -eq 0 ] || fail "quiet-board arms failed"

# --- #3244 group C arms (AC-C1..AC-C3): focus cards link their wiki pages via the wiki-hub registry.
# All data under the fixture focus dir and hub dirs is synthesized (fake ticket ids 990x, fake remote);
# no real ticket rows, ledger rows or receipts are copied in.
FD="$(mktemp -d)"          # fixture focus SSOT dir (focus-progress.mjs stub)
HUB="$(mktemp -d)"         # registry maps ziyilam3999/ai-brain -> a child wiki WITH a remote
HUB2="$(mktemp -d)"        # twin: same entry, no remote -> fail-open
HUB3="$(mktemp -d)"        # empty dir, no registry.json -> fail-open
trap 'rm -rf "$TMPBIN" "$EHOME" "$WORK" "$FD" "$HUB" "$HUB2" "$HUB3"' EXIT
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
  HOME="$EHOME" node "$SCRIPT" --board "$FX/board.json" --focus-dir "$FD" --wiki-hub "$1" \
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
