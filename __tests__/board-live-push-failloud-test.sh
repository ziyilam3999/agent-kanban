#!/usr/bin/env bash
# #3290 feed fail-loud arms: when ANY input the focus join depends on dies — the inner status-tables
# run inside board-live-push.mjs (fails, times out, yields no focus scalars, or yields foci whose
# names match none of focus-progress's), or focus-progress itself (crashes, prints garbled JSON, or
# is missing) — the push must ABORT before the first issue upsert, write no state hash, and print a
# named failure line (focus-join-failed:) to stderr with a non-zero exit. A healthy (or genuinely
# focus-less) run is unchanged: same upserts, same bodies; a focus with zero tickets but a matching
# name publishes, and focus names that differ only in surrounding whitespace still join.
# Everything is sandboxed: a synthetic ai-brain checkout (stub status-tables + stub focus-progress), a
# STRICT stub gh (accepts only the two real invocation shapes the script makes and rejects anything
# else with real-gh-style stderr), and HOME pointed at a scratch dir — no network, no live push, no
# live board-live state dir. The harness fails closed if gh does not resolve to its own stub.
# Optional env: BASE_MJS = a second board-live-push.mjs (e.g. pristine origin/master) for the
# byte-for-byte healthy-output equivalence arm.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/board-live-push.mjs"
fail() { echo "FAIL: $*" >&2; exit 1; }

SBX="$(mktemp -d)"
trap 'rm -rf "$SBX"' EXIT
TMPHOME="$SBX/home"; TMPBIN="$SBX/bin"; AB="$SBX/abrain"; FD="$SBX/focus"; FD_NONE="$SBX/focus-none"; DATA="$SBX/data"
mkdir -p "$TMPHOME" "$TMPBIN" "$AB/skills/progress-summary/bin" "$FD" "$FD_NONE" "$DATA/empty"
SID="00000000-0000-4000-8000-000000000329"
NOW="2026-10-15T07:12:27Z"
GH_LOG="$SBX/gh-calls.log"
export GH_LOG

# --- sandbox PATH: node + git + OUR stub gh, nothing else that could touch the network
ln -s "$(command -v node)" "$TMPBIN/node"
ln -s "$(command -v git)" "$TMPBIN/git"
# strict stub gh (#3290 review finding 3, the #3312 fake-CLI class): it accepts ONLY the two real
# invocation shapes board-live-push.mjs makes —
#   gh issue edit <number> -R <repo> --body-file <file>
#   gh issue create -R <repo> --title <title> --body-file <file>
# — and rejects anything else (unknown flag, missing/duplicate arg, wrong subcommand) with
# real-gh-style stderr and exit 1, so a later change that breaks the script's argument shape
# cannot pass the must-not-fire arms unnoticed. It still only LOGS; it never touches the network.
cat >"$TMPBIN/gh" <<'GH'
#!/bin/sh
bad() { echo "gh: $1" >&2; echo 'Usage: gh issue edit <number> -R <repo> --body-file <file> | gh issue create -R <repo> --title <title> --body-file <file>' >&2; exit 1; }
[ "${1:-}" = issue ] || bad "unsupported command: ${1:-<none>}"
sub="${2:-}"; shift 2 || bad "missing subcommand after 'issue'"
number=''; repo=''; title=''; body=''
case "$sub" in edit|create) ;; *) bad "unknown subcommand: $sub" ;; esac
while [ $# -gt 0 ]; do
  case "$1" in
    -R)
      [ -n "${2:-}" ] || bad "flag needs an argument: $1"
      [ -z "$repo" ] || bad "duplicate flag: $1"
      repo="$2"; shift 2 ;;
    --body-file)
      [ -n "${2:-}" ] || bad "flag needs an argument: $1"
      [ -z "$body" ] || bad "duplicate flag: $1"
      body="$2"; shift 2 ;;
    --title)
      [ "$sub" = create ] || bad "unknown flag: $1"   # the edit shape the script uses carries no title
      [ -n "${2:-}" ] || bad "flag needs an argument: $1"
      [ -z "$title" ] || bad "duplicate flag: $1"
      title="$2"; shift 2 ;;
    -*) bad "unknown flag: $1" ;;
    *)
      [ "$sub" = edit ] && [ -z "$number" ] || bad "unexpected argument: $1"
      case "$1" in ''|*[!0-9]*) bad "invalid issue number: $1" ;; esac
      number="$1"; shift ;;
  esac
done
[ -n "$repo" ] || bad "missing -R <repo>"
[ -n "$body" ] || bad "missing --body-file <file>"
[ "$sub" = edit ] && { [ -n "$number" ] || bad "edit: missing issue number"; }
[ "$sub" = create ] && { [ -n "$title" ] || bad "create: missing --title <title>"; }
[ -r "$body" ] || bad "cannot read body file"
printf 'gh issue %s %s-R %s %s--body-file %s\n' "$sub" "${number:+$number }" "$repo" "${title:+--title \"$title\" }" "$body" >>"$GH_LOG"
[ "$sub" = create ] && echo "https://github.com/ziyilam3999/agent-board-data/issues/9"
exit 0
GH
chmod +x "$TMPBIN/gh"
# fail closed: if gh does not resolve to our stub, refuse to run anything push-shaped
GH_ON_PATH="$(PATH="$TMPBIN:/usr/bin:/bin" command -v gh || true)"
[ "$GH_ON_PATH" = "$TMPBIN/gh" ] || fail "gh is not the sandbox stub ($GH_ON_PATH); refusing to run push arms"

# --- strictness spot-check of the stub itself: the two real shapes pass, unknown flags are rejected
"$TMPBIN/gh" issue edit 9 -R ziyilam3999/agent-board-data --body-file /dev/null >/dev/null 2>&1 || fail "gh stub rejected the real edit shape"
B="$(mktemp)"; "$TMPBIN/gh" issue create -R ziyilam3999/agent-board-data --title t --body-file /dev/null >"$B" 2>/dev/null || fail "gh stub rejected the real create shape"
command grep -q 'issues/9$' "$B" || fail "gh stub create did not echo the issue url"
if "$TMPBIN/gh" issue edit 9 -R ziyilam3999/agent-board-data --body /dev/null >/dev/null 2>&1; then fail "gh stub accepted an unknown flag (--body)"; fi
if "$TMPBIN/gh" issue edit 9 -R ziyilam3999/agent-board-data --body-file /dev/null extra >/dev/null 2>&1; then fail "gh stub accepted an unexpected positional (extra)"; fi
if "$TMPBIN/gh" issue create -R ziyilam3999/agent-board-data --body-file /dev/null >/dev/null 2>&1; then fail "gh stub accepted create without --title"; fi
"$TMPBIN/gh" issue edit 9 -R ziyilam3999/agent-board-data --bogus x 2>"$SBX/gh-err.txt" >/dev/null || command grep -q "^gh: " "$SBX/gh-err.txt" || fail "gh stub stderr is not real-style (no gh: line)"
rm -f "$B"

# --- synthetic ai-brain checkout: the status-tables stub is both the imported module (lastLedgerRow /
# ROLE_ORDER) and the child process board-live-push spawns; ST_MODE picks the flavour per arm.
# drift = foci whose names match NONE of focus-progress's (the wholesale keying-broken shape);
# ws = the same names as ok but padded with surrounding whitespace (must still join).
cat >"$AB/skills/progress-summary/bin/status-tables.mjs" <<'ST'
import { pathToFileURL } from 'node:url';
export const ROLE_ORDER = ['research', 'planner', 'plan-review', 'executor', 'execution-review', 'ship-tail'];
export const lastLedgerRow = () => null;
const COST = { name: 'Cost', label: 'Cost', goal: 'fixture goal cost', lanes: 1, state: 'active', done: 1, open: 1, in_progress: 0, total: 2, wtdPct: 50, unsized: 0 };
const WIKI = { name: 'Wiki', label: 'Wiki', goal: 'fixture goal wiki', lanes: 0, state: 'active', done: 0, open: 1, in_progress: 0, total: 1, wtdPct: 100, unsized: 0 };
const MODES = {
  ok: [COST, WIKI],
  partial: [COST],
  nofoci: [],
  fail: [],
  hang: [],
  drift: [{ ...COST, name: 'Kost' }, { ...WIKI, name: 'Vyki' }],
  ws: [{ ...COST, name: ' Cost ' }, { ...WIKI, name: ' Wiki ' }],
};
// #3520 area 23 fix2 (LOW-D): cap200/cap201 emit a work-pool lane set of exactly that size, so the
// LEDGER_LANE_CAP boundary is testable: 200 publishes, 201 refuses loud.
const laneRows = (n) => Array.from({ length: n }, (_, i) => ({ id: String(8000 + i), pool: 'work', stage: 'executor running', seat: 'fable (Agent tool)', effort: 'high (assigned)', model: 'fable' }));
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mode = process.env.ST_MODE || 'ok';
  if (mode === 'fail') { console.error('stub status-tables: boom'); process.exit(3); }
  if (mode === 'hang') { setTimeout(() => {}, 30000); } // killed by execFileSync's 20 s timeout -> run() swallows
  else if (mode === 'cap200' || mode === 'cap201') process.stdout.write(JSON.stringify({
    lanes: { rows: laneRows(mode === 'cap200' ? 200 : 201) },
    focus: { foci: MODES.ok },
  }));
  else process.stdout.write(JSON.stringify({
    lanes: { rows: [{ id: '7001', pool: 'work', stage: 'executor running', seat: 'fable (Agent tool)', effort: 'high (assigned)', model: 'fable' }] },
    focus: { foci: MODES[mode] ?? MODES.ok },
  }));
}
ST
# --- stub focus SSOT (the script board-live-push runs directly for FF); FF_MODE picks its flavour:
# crash = exits non-zero; garbled = truncated JSON on stdout; zerotickets = one matching name, no rows.
cat >"$FD/focus-progress.mjs" <<'FF'
const COST = { name: 'Cost', goal: 'fixture goal cost', total: 2, done: 1, open: 1, in_progress: 0, rows: [
  { n: 1, id: 9901, subject: 'fixture cost row one', status: 'done', blockedBy: [], done: true },
  { n: 2, id: 9902, subject: 'fixture cost row two', status: 'pending', blockedBy: [], done: false } ] };
const WIKI = { name: 'Wiki', goal: 'fixture goal wiki', total: 1, done: 0, open: 1, in_progress: 0, rows: [
  { n: 1, id: 9903, subject: 'fixture wiki row one', status: 'in_progress', blockedBy: [], done: false } ] };
const mode = process.env.FF_MODE || 'ok';
if (mode === 'crash') { console.error('stub focus-progress: boom'); process.exitCode = 9; }
else if (mode === 'garbled') { process.stdout.write('{"focuses":[{"name":"Cost","rows":[{'); }
else {
  const focuses = mode === 'empty' ? [] : mode === 'zerotickets'
    ? [{ name: 'Cost', goal: 'fixture goal cost', total: 0, done: 0, open: 0, in_progress: 0, rows: [] }]
    : [COST, WIKI];
  process.stdout.write(JSON.stringify(focuses));
}
FF
# --- frozen board fixture (DEMO ids only); the --board seam stays (#3520 area 23: the LIVE
# data/board.json is no longer an input, the fixture flag is) and no kanban selector state is read.
cat >"$DATA/board.json" <<'BOARD'
{ "generatedAt": "2026-10-15T07:00:00Z", "rows": [
  { "id": 7001, "title": "DEMO lane one", "column": "in_progress", "updatedAt": "2026-10-15T06:00:00Z" },
  { "id": 7002, "title": "DEMO todo one", "column": "todo", "updatedAt": "2026-10-15T06:30:00Z" } ] }
BOARD

# run_push <st_mode> <ff_mode> [extra flags...] — a FULL push (no --dry-run) against the sandbox.
# FF_DIR (optional) overrides the focus dir, e.g. $FD_NONE for the missing-script arm.
run_push() {
  local st="$1" ff="$2"; shift 2
  : >"$GH_LOG"; mkdir -p "$TMPHOME/.claude/board-live"; rm -f "$TMPHOME/.claude/board-live/state.json"
  HOME="$TMPHOME" ST_MODE="$st" FF_MODE="$ff" BOARD_AI_BRAIN="$AB" \
    PATH="$TMPBIN:/usr/bin:/bin" node "$SCRIPT" --board "$DATA/board.json" --focus-dir "${FF_DIR:-$FD}" \
    --session "$SID" --ledger-dir "$DATA/empty" --events-dir "$DATA/empty" \
    --tasks-dir "$DATA/empty" --now "$NOW" "$@"
}
upserts() { [ -f "$GH_LOG" ] && wc -l <"$GH_LOG" | tr -d ' ' || echo 0; }

# run_ledger <st_mode> [extra flags...] — same sandbox but NO --board flag: the ledger lane pool
# (the status-tables stub) is the lane source, so the LEDGER_LANE_CAP arms hit the real gate.
run_ledger() {
  local st="$1"; shift
  : >"$GH_LOG"; mkdir -p "$TMPHOME/.claude/board-live"; rm -f "$TMPHOME/.claude/board-live/state.json"
  HOME="$TMPHOME" ST_MODE="$st" FF_MODE=ok BOARD_AI_BRAIN="$AB"     PATH="$TMPBIN:/usr/bin:/bin" node "$SCRIPT" --focus-dir "${FF_DIR:-$FD}"     --session "$SID" --ledger-dir "$DATA/empty" --events-dir "$DATA/empty"     --tasks-dir "$DATA/empty" --now "$NOW" "$@"
}

# --- must-fire arms: the dead join aborts the push (non-zero exit, named stderr line, zero upserts,
# no state hash). The 20 s budget is the script's own execFileSync timeout killing the hung stub.
must_fire() {
  local name="$1" st="$2" ff="$3" out err rc
  out="$(mktemp)"; err="$(mktemp)"
  run_push "$st" "$ff" >"$out" 2>"$err"; rc=$?
  [ "$rc" -ne 0 ] || fail "$name: exited 0 (the hollow push shipped)"
  command grep -q 'focus-join-failed:' "$err" || fail "$name: no named failure line on stderr"
  [ "$(upserts)" = "0" ] || fail "$name: $(upserts) upsert(s) happened"
  [ ! -e "$TMPHOME/.claude/board-live/state.json" ] || fail "$name: state hash was written"
  echo "ok must-fire $name (rc=$rc: $(command grep -m1 'focus-join-failed:' "$err"))"
  rm -f "$out" "$err"
}
# inner status-tables dead while focus-progress is healthy
must_fire "inner-run-exits-nonzero" "fail" "ok"
must_fire "inner-run-returns-empty-foci" "nofoci" "ok"
must_fire "inner-run-times-out" "hang" "ok"
# focus-progress itself dead while status-tables is healthy
must_fire "focus-progress-exits-nonzero" "ok" "crash"
must_fire "focus-progress-prints-garbled-json" "ok" "garbled"
FF_DIR="$FD_NONE" must_fire "focus-progress-script-missing" "ok" "ok"
# both alive but the name join is wholesale-broken (no focus name matches its scalars)
must_fire "all-focus-names-unmatched" "drift" "ok"

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
must_not_fire "focus-zero-tickets-matching-name" "ok" "zerotickets"
must_not_fire "focus-name-whitespace-drift" "ws" "ok"

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
    node "$BASE_MJS" --board "$DATA/board.json" --focus-dir "$FD" \
    --session "$SID" --ledger-dir "$DATA/empty" --events-dir "$DATA/empty" --tasks-dir "$DATA/empty" \
    --now "$NOW" --focus-body >"$BODY_B" 2>/dev/null || fail "healthy --focus-body (base) exited nonzero"
  cmp -s "$BODY_H" "$BODY_B" || fail "healthy #4 body differs from base"
  run_push ok ok --dry-run --json >"$DRY_H" 2>/dev/null || fail "healthy --dry-run (head) exited nonzero"
  HOME="$TMPHOME" ST_MODE=ok FF_MODE=ok BOARD_AI_BRAIN="$AB" PATH="$TMPBIN:/usr/bin:/bin" \
    node "$BASE_MJS" --board "$DATA/board.json" --focus-dir "$FD" \
    --session "$SID" --ledger-dir "$DATA/empty" --events-dir "$DATA/empty" --tasks-dir "$DATA/empty" \
    --now "$NOW" --dry-run --json >"$DRY_B" 2>/dev/null || fail "healthy --dry-run (base) exited nonzero"
  cmp -s "$DRY_H" "$DRY_B" || fail "healthy dry-run summary differs from base"
  rm -f "$BODY_H" "$BODY_B" "$DRY_H" "$DRY_B"
  echo "ok healthy-equivalence (#4 body + dry-run summary byte-identical to base)"
else
  echo "skip healthy-equivalence (BASE_MJS unset)"
fi

# --- #3520 area 23 fix2 (LOW-D): the LEDGER_LANE_CAP gate is fail-closed AND loud — 201 lanes
# aborts the push (non-zero exit, named reason on stderr, nothing published), 200 publishes.
OUT_C="$(mktemp)"; ERR_C="$(mktemp)"
run_ledger cap201 >"$OUT_C" 2>"$ERR_C"; RC=$?
[ "$RC" -ne 0 ] || fail "ledger-lane-cap-201: exited 0 (the over-cap board published)"
command grep -q 'LEDGER_LANE_CAP' "$ERR_C" || fail "ledger-lane-cap-201: no named cap reason on stderr"
command grep -q 'refusing to publish' "$ERR_C" || fail "ledger-lane-cap-201: no refusing-to-publish line on stderr"
[ "$(upserts)" = "0" ] || fail "ledger-lane-cap-201: $(upserts) upsert(s) happened"
[ ! -e "$TMPHOME/.claude/board-live/state.json" ] || fail "ledger-lane-cap-201: state hash was written"
echo "ok must-fire ledger-lane-cap-201 (rc=$RC: $(command grep -m1 'refusing to publish' "$ERR_C" | cut -c1-120))"
rm -f "$OUT_C" "$ERR_C"

DRY_C="$(mktemp)"
run_ledger cap200 --dry-run --json >"$DRY_C" 2>/dev/null || fail "ledger-lane-cap-200: dry run exited nonzero (at the cap it must still publish)"
node - "$DRY_C" <<'CAP200' || fail "ledger-lane-cap-200 arm failed"
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (j.laneSource !== 'ledger') { console.error('FAIL: cap200 laneSource=' + j.laneSource); process.exit(1); }
if (!j.counts || j.counts.in_progress !== 200) { console.error('FAIL: cap200 counts.in_progress=' + (j.counts && j.counts.in_progress)); process.exit(1); }
CAP200
echo "ok must-not-fire ledger-lane-cap-200 (exactly at the cap: exit 0, 200 lanes published)"
rm -f "$DRY_C"

echo "fail-loud smoke: all arms green"
