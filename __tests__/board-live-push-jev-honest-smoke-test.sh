#!/usr/bin/env bash
# #3121 honest-Jev feed smoke: the tracked board-live-push.mjs, fed a SYNTHETIC Jev store (--jev-dir,
# fake ids and marker strings under mktemp -d — never a real row), counts progress as judged-AND-labelled
# toward the prereg n_min, splits the not-judged backlog out, limits the Haiku agreement denominator to
# both-answered rows of the CURRENT trial version (3164-v3 by the plan's version-selection rule), renders
# superseded/concluded versions as ended states, and leaks no note name, row text or row id.
# Needs BOARD_AI_BRAIN -> an ai-brain checkout carrying tests/fixtures/board-truth (board/ledger/tasks)
# and the committed .ai-workspace/trials preregistrations (public, committed numbers).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../scripts/board-live-push.mjs"
fail() { echo "FAIL: $*" >&2; exit 1; }

AB="${BOARD_AI_BRAIN:-}"
[ -n "$AB" ] || fail "BOARD_AI_BRAIN is not set (path to the ai-brain checkout holding tests/fixtures/board-truth)"
FX="$AB/tests/fixtures/board-truth"
[ -d "$FX" ] || fail "fixture dir missing: $FX"

# gh must be absent from PATH: a dry run touches no network.
TMPBIN="$(mktemp -d)"
JFX="$(mktemp -d)"
trap 'rm -rf "$TMPBIN" "$JFX" "$TAB1" "$TAB2"' EXIT
ln -s "$(command -v node)" "$TMPBIN/node"
ln -s "$(command -v git)" "$TMPBIN/git"
export PATH="$TMPBIN:/usr/bin:/bin"
command -v gh >/dev/null 2>&1 && fail "gh is on PATH; the smoke needs it absent"

SID="4236cea4-95cc-455b-8763-1f4c84184b41"
NOW="2026-10-15T07:12:27Z"
export BOARD_AI_BRAIN="$AB"

# --- synthetic Jev stores (all ids fake, marker strings for the privacy arm) ---
node - "$JFX" <<'BUILDEOF' || fail "fixture build failed"
const fs = require('fs'); const path = require('path');
const root = process.argv[2];
const MARK_NOTE = 'NOTE-3121-MARK', MARK_TEXT = 'ROWTEXT-3121-MARK', MARK_ID = 'ROWID-3121-MARK';
const T3 = ['tools/board/page/index.html', 'scripts/demo-one.mjs', 'docs/demo-two.md'];
const T3B = ['scripts/demo-three.mjs', 'tools/board/page/index.html', 'docs/demo-four.md']; // top1 differs from T3
const research = { asOf: '2026-10-01', rule: 'fixture rule', testRule: 'fixture test rule', firstLive: null, wins: [], loses: [], model: { tested: 'fx', current: 'fx' }, calibration: { plain: 'fixture' }, costPerCall: '$0.0005', latency: '800 ms', road: [] };
const ts = (i) => '2026-10-14T0' + (i % 10) + ':0' + (i % 10) + ':00Z';
const mk = () => { let i = 0; return (arr, o) => arr.push(JSON.stringify({ note: MARK_NOTE + '-' + (++i), text: MARK_TEXT + '-' + i, id: MARK_ID + '-' + i, ts: ts(i), ...o })); };
const writeLm = (dir, rows) => { fs.mkdirSync(path.join(dir, 'lesson-merge-shadow'), { recursive: true }); fs.writeFileSync(path.join(dir, 'lesson-merge-shadow/rows.jsonl'), rows.join('\n') + (rows.length ? '\n' : '')); };
const writeFh = (dir, rows) => { fs.mkdirSync(path.join(dir, 'file-hint-shadow'), { recursive: true }); fs.writeFileSync(path.join(dir, 'file-hint-shadow/rows.jsonl'), rows.join('\n') + (rows.length ? '\n' : '')); };
const writeResearch = (dir) => fs.writeFileSync(path.join(dir, 'board-research.json'), JSON.stringify(research));
// lesson-merge mixed log (MF1): 12 judged+labelled / 25 judged-unlabelled / 3 labeller-UNSURE / 4 below-floor / 1 day-cap
// / 1 exact-skip / 1 privacy-refused (fix1: the terminal rows are never judged, so never in the backlog)
const lmMixed = []; { const p = mk();
  for (let i = 0; i < 12; i++) p(lmMixed, { jev_status: 'ok', label: 'duplicate', label_src: 'labeller', jev_pick: 'dup', base_pick: i < 6 ? 'dup' : 'new' });
  for (let i = 0; i < 25; i++) p(lmMixed, { jev_status: 'ok', label: null, label_src: null, jev_pick: 'new', base_pick: 'new' });
  for (let i = 0; i < 3; i++) p(lmMixed, { jev_status: 'ok', label: null, label_src: 'labeller', jev_pick: 'new', base_pick: 'new' });
  for (let i = 0; i < 4; i++) p(lmMixed, { jev_status: 'below_floor' });
  for (let i = 0; i < 1; i++) p(lmMixed, { jev_status: 'day_cap' });
  p(lmMixed, { jev_status: 'exact_skip', label: ['demo.md'], label_src: 'mechanical' });
  p(lmMixed, { jev_status: 'privacy_refused' });
}
// file-hint mixed log (MF3): v1 rows carry no prereg_version; v2 both-answered + haiku-unanswered; v3 current
const fhMixed = []; { const p = mk();
  for (let i = 0; i < 2; i++) p(fhMixed, { task: '9901', role: 'planner', jev_status: 'ok', jev_top3: T3, haiku_top3: T3 }); // v1 (no field)
  for (let i = 0; i < 5; i++) p(fhMixed, { task: '9902', role: 'planner', prereg_version: '3031-v2', jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_top3: T3, haiku_top3: T3 });
  for (let i = 0; i < 3; i++) p(fhMixed, { task: '9903', role: 'planner', prereg_version: '3031-v2', jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_top3: T3, haiku_top3: null });
  p(fhMixed, { task: '9410', role: 'planner', prereg_version: '3164-v3', jev_status: 'ok', label: 'ok', label_src: 'mechanical', jev_top3: T3, haiku_top3: T3 }); // both, agree (mechanical label counts)
  p(fhMixed, { task: '9420', role: 'planner', prereg_version: '3164-v3', jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_top3: T3, haiku_top3: T3 });
  p(fhMixed, { task: '9430', role: 'planner', prereg_version: '3164-v3', jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_top3: T3, haiku_top3: T3 });
  p(fhMixed, { task: '9440', role: 'planner', prereg_version: '3164-v3', jev_status: 'ok', label: null, label_src: null, jev_top3: T3B, haiku_top3: T3 }); // both, disagree, unlabelled
  p(fhMixed, { task: '9450', role: 'planner', prereg_version: '3164-v3', jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_top3: T3, haiku_top3: null }); // haiku-unanswered
  p(fhMixed, { task: '9460', role: 'planner', prereg_version: '3164-v3', jev_status: 'ok', label: null, label_src: 'labeller', jev_top3: T3, haiku_top3: null }); // UNSURE
  p(fhMixed, { task: '9470', role: 'planner', prereg_version: '3164-v3', jev_status: 'no_anchor' }); // terminal: never judged, never backlog
  p(fhMixed, { task: '9471', role: 'planner', prereg_version: '3164-v3', jev_status: 'cap' }); // day-cap: waiting, counts in the backlog
}
// v2only (MF5): only 3031-v2 rows, 120 judged+labelled (past v2's n_min 100); zero current-version rows
const fhV2 = []; { const p = mk(); for (let i = 0; i < 120; i++) p(fhV2, { task: '9904', role: 'planner', prereg_version: '3031-v2', jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_top3: T3, haiku_top3: T3 }); }
// fix1 (execution-review finding 2) version-rule arms, run against SYNTHETIC prereg overlays below:
// v4pre: a committed 3390-v4 prereg supersedes 3164-v3 (n_min 90) at ZERO v4 rows, 7 superseded v3 rows
const fhV4pre = []; { const p = mk(); for (let i = 0; i < 7; i++) p(fhV4pre, { task: '9910', role: 'planner', prereg_version: '3164-v3', jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_top3: T3, haiku_top3: T3 }); }
// v4rows: the same plus 3 v4 rows (2 judged+labelled agreeing, 1 day-cap)
const fhV4rows = fhV4pre.slice(); { const p = mk();
  for (let i = 0; i < 2; i++) p(fhV4rows, { task: '9911', role: 'planner', prereg_version: '3390-v4', jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_top3: T3, haiku_top3: T3 });
  p(fhV4rows, { task: '9912', role: 'planner', prereg_version: '3390-v4', jev_status: 'cap' });
}
// noprereg: rows tagged 3164-v3 with NO committed 3164 prereg (overlay omits its dir): rows never hide
const fhNoprereg = []; { const p = mk();
  for (let i = 0; i < 3; i++) p(fhNoprereg, { task: '9913', role: 'planner', prereg_version: '3164-v3', jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_top3: T3, haiku_top3: T3 });
  p(fhNoprereg, { task: '9914', role: 'planner', prereg_version: '3164-v3', jev_status: 'cap' });
  p(fhNoprereg, { task: '9915', role: 'planner', prereg_version: '3164-v3', jev_status: 'no_anchor' });
}
// alllabelled (MNF1)
const lmAll = []; { const p = mk(); for (let i = 0; i < 30; i++) p(lmAll, { jev_status: 'ok', label: 'duplicate', label_src: 'labeller', jev_pick: 'dup', base_pick: 'dup' }); }
const fhAll = []; { const p = mk(); for (let i = 0; i < 5; i++) p(fhAll, { task: '9905', role: 'planner', prereg_version: '3164-v3', jev_status: 'ok', label: 'ok', label_src: 'mechanical', jev_top3: T3, haiku_top3: T3 }); }
// capped (INPUT-BOUND): TRIAL_ROW_CAP+2 physical lines, both logs
const lmCapped = []; { const p = mk(); for (let i = 0; i < 20002; i++) p(lmCapped, { jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_pick: 'dup', base_pick: 'dup' }); }
const fhCapped = []; { const p = mk(); for (let i = 0; i < 20002; i++) p(fhCapped, { prereg_version: '3164-v3', jev_status: 'ok', label: 'ok', label_src: 'labeller', jev_top3: T3, haiku_top3: T3 }); }
for (const [name, lm, fh] of [['mixed', lmMixed, fhMixed], ['v2only', lmMixed, fhV2], ['alllabelled', lmAll, fhAll], ['empty', [], []], ['capped', lmCapped, fhCapped], ['v4pre', [], fhV4pre], ['v4rows', [], fhV4rows], ['noprereg', [], fhNoprereg]]) {
  const d = path.join(root, name); fs.mkdirSync(d, { recursive: true });
  writeLm(d, lm); writeFh(d, fh); writeResearch(d);
}
BUILDEOF

# --- fix1 synthetic PREREG overlays: throwaway BOARD_AI_BRAIN roots holding only skills (symlinked,
# the feed imports status-tables from it) and synthetic .ai-workspace/trials preregistrations. The
# committed numbers here are invented; no real prereg or row is copied.
TAB1="$(mktemp -d)"; TAB2="$(mktemp -d)"
for T in "$TAB1" "$TAB2"; do
  mkdir -p "$T/.ai-workspace/trials" "$T/tests/fixtures"
  ln -s "$AB/skills" "$T/skills"
  ln -s "$AB/tests/fixtures/board-truth" "$T/tests/fixtures/board-truth"
done
node - "$TAB1" "$TAB2" <<'BUILDEOF' || fail "prereg overlay build failed"
const fs = require('fs'); const path = require('path');
const write = (root, dir, j) => { const d = path.join(root, '.ai-workspace/trials', dir); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'preregistration.json'), JSON.stringify(j)); };
const root1 = process.argv[2], root2 = process.argv[3];
const V1 = { ticket: 2907, n_min: 20, frozen_at: '2026-10-04' }; // legacy: no prereg_version (dir map resolves it)
const V2 = { ticket: 3031, supersedes: 2907, n_min: 100, frozen_at: '2026-10-08' }; // legacy; supersedes as a number, like the real one
const V3 = { ticket: 3164, supersedes: '3031-v2', prereg_version: '3164-v3', design: { n_min: 100 }, frozen_at: '2026-10-16' }; // n_min under design, like the real one
const V4 = { ticket: 3390, supersedes: '3164-v3', prereg_version: '3390-v4', n_min: 90, frozen_at: '2026-10-19' };
for (const root of [root1, root2]) {
  write(root, '2907-jev-file-hint-shadow', V1);
  write(root, '3031-jev-2907-shadow-v2', V2);
}
write(root1, '3164-jev-file-hint-v3', V3);
write(root1, '3390-jev-file-hint-v4', V4);
// root2 (noprereg arm): NO 3164 prereg — rows tagged 3164-v3 must still count
BUILDEOF

run() {
  node "$SCRIPT" --board "$FX/board.json" --session "$SID" \
    --ledger-dir "$FX/ledger" --events-dir "$FX/ledger" --tasks-dir "$FX/tasks" \
    --now "$NOW" --jev-dir "$JFX/$1" --dry-run --json
}
# fix1 version-rule runs: the same feed over the same fixture board, but BOARD_AI_BRAIN redirected to
# the synthetic prereg overlays (the version rule must read the COMMITTED preregs, not a hardcoded list)
runab() {
  BOARD_AI_BRAIN="$2" node "$SCRIPT" --board "$FX/board.json" --session "$SID" \
    --ledger-dir "$FX/ledger" --events-dir "$FX/ledger" --tasks-dir "$FX/tasks" \
    --now "$NOW" --jev-dir "$JFX/$1" --dry-run --json
}
OUT_MIXED="$(mktemp)"; OUT_V2="$(mktemp)"; OUT_ALL="$(mktemp)"; OUT_EMPTY="$(mktemp)"; OUT_CAP="$(mktemp)"
OUT_V4P="$(mktemp)"; OUT_V4R="$(mktemp)"; OUT_NP="$(mktemp)"
run mixed >"$OUT_MIXED" 2>/dev/null || fail "mixed run exited nonzero"
run v2only >"$OUT_V2" 2>/dev/null || fail "v2only run exited nonzero"
run alllabelled >"$OUT_ALL" 2>/dev/null || fail "alllabelled run exited nonzero"
run empty >"$OUT_EMPTY" 2>/dev/null || fail "empty run exited nonzero"
run capped >"$OUT_CAP" 2>/dev/null || fail "capped run exited nonzero"
runab v4pre "$TAB1" >"$OUT_V4P" 2>/dev/null || fail "v4pre run exited nonzero"
runab v4rows "$TAB1" >"$OUT_V4R" 2>/dev/null || fail "v4rows run exited nonzero"
runab noprereg "$TAB2" >"$OUT_NP" 2>/dev/null || fail "noprereg run exited nonzero"

node - "$OUT_MIXED" "$OUT_V2" "$OUT_ALL" "$OUT_EMPTY" "$OUT_CAP" "$OUT_V4P" "$OUT_V4R" "$OUT_NP" <<'EOF' || exit 1
const fs = require('fs');
const [mixedS, v2S, allS, emptyS, capS, v4pS, v4rS, npS] = process.argv.slice(2).map((p) => fs.readFileSync(p, 'utf8'));
const bad = [];
const chk = (name, ok) => { if (!ok) bad.push(name); };
let mixed, v2, all, empty, cap, v4p, v4r, np;
for (const [s, n, o] of [[mixedS, 'mixed', (x) => mixed = x], [v2S, 'v2only', (x) => v2 = x], [allS, 'alllabelled', (x) => all = x], [emptyS, 'empty', (x) => empty = x], [capS, 'capped', (x) => cap = x], [v4pS, 'v4pre', (x) => v4p = x], [v4rS, 'v4rows', (x) => v4r = x], [npS, 'noprereg', (x) => np = x]]) {
  try { o(JSON.parse(s)); } catch { console.error('FAIL: ' + n + ' output is not one JSON object'); process.exit(1); }
}
const lm = mixed.jev.lessonMerge, fh = mixed.jev.fileHint, rs = mixed.jevResearch.shadows;
// MF1: progress basis = judged-AND-labelled only, target = prereg n_min
chk('MF1 lessonMerge.labelled == 12', lm.labelled === 12);
chk('MF1 lessonMerge.judged == 40 (UNSURE counts as judged)', lm.judged === 40);
chk('MF1 lessonMerge.nMin == 300', lm.nMin === 300);
chk('MF1 lessonMerge rows never appear as a progress number', !('rows' in lm) && lm.labelled !== 45 && lm.labelled !== 40);
// MF2: the not-judged backlog is its own number — and counts ONLY rows still waiting to be judged
chk('MF2 lessonMerge.notJudged == 5 (below-floor + day-cap; exact_skip/refused are terminal)', lm.notJudged === 5);
// MF3: current version by the rule; both-answered denominator only
chk('MF3 fileHint.version == 3164-v3', fh.version === '3164-v3');
chk('MF3 fileHint.nMin == 100', fh.nMin === 100);
chk('MF3 fileHint.bothAnswered == 4 (v1/v2/haiku-unanswered excluded)', fh.bothAnswered === 4);
chk('MF3 fileHint.agreeTop1 == 3', fh.agreeTop1 === 3);
chk('MF3 fileHint.labelled == 4 (mechanical label counts)', fh.labelled === 4);
chk('MF3 fileHint.judged == 6 / notJudged == 1 (day-cap only; no_anchor is terminal)', fh.judged === 6 && fh.notJudged === 1);
// superseded/concluded render, never progress
const endV = Object.fromEntries((fh.ended || []).map((e) => [e.version, e.state]));
chk('ended 3031-v2 == ended INCONCLUSIVE (#3080)', endV['3031-v2'] === 'ended INCONCLUSIVE (#3080)');
chk('ended 2907 == superseded', endV['2907'] === 'superseded');
chk('3164-v3 not in ended', !('3164-v3' in endV));
// MF4: no note name, row text or row id anywhere in the published summary
chk('MF4 marker note absent from summary JSON', !mixedS.includes('NOTE-3121-MARK'));
chk('MF4 marker row text absent from summary JSON', !mixedS.includes('ROWTEXT-3121-MARK'));
chk('MF4 marker row id absent from summary JSON', !mixedS.includes('ROWID-3121-MARK'));
// MNF4: lane cards keep their per-ticket Jev pick payload (AC7: lane picks unchanged)
const lane = (mixed.lanes || []).find((l) => String(l.id) === '9410');
chk('MNF4 lane 9410 keeps its jev pick payload', !!(lane && lane.jev && lane.jev.role === 'planner' && Array.isArray(lane.jev.top3) && lane.jev.top3.length === 3));
// research strip: same honest basis + the F2 labelled definition
chk('research lesson-merge labelled == 12 over nMin 300', rs[0].labelled === 12 && rs[0].nMin === 300 && rs[0].judged === 40 && rs[0].notJudged === 5);
chk('research lesson-merge note dropped (the progress line already carries the labelled count)', rs[0].note === '');
chk('research file-hints version/nMin/labelled', rs[1].version === '3164-v3' && rs[1].nMin === 100 && rs[1].labelled === 4 && rs[1].judged === 6);
chk('research file-hints carries the ended list', Object.fromEntries(rs[1].ended.map((e) => [e.version, e.state]))['3031-v2'] === 'ended INCONCLUSIVE (#3080)');
// MF5: superseded-only log — current version at 0/n_min quiet, ended line, no completion basis
chk('MF5 v2only fileHint.version == 3164-v3', v2.jev.fileHint.version === '3164-v3');
chk('MF5 v2only current counters all 0', v2.jev.fileHint.labelled === 0 && v2.jev.fileHint.judged === 0 && v2.jev.fileHint.notJudged === 0);
chk('MF5 v2only state == no rows yet', v2.jev.fileHint.state === 'no rows yet');
chk('MF5 v2only bothAnswered == 0 (v2 rows never in the denominator)', v2.jev.fileHint.bothAnswered === 0 && v2.jev.fileHint.agreeTop1 === 0);
chk('MF5 v2only ended still lists 3031-v2', Object.fromEntries(v2.jev.fileHint.ended.map((e) => [e.version, e.state]))['3031-v2'] === 'ended INCONCLUSIVE (#3080)');
// MNF1: all judged all labelled — progress == row count, backlog 0, no error
chk('MNF1 alllabelled labelled == rows', all.jev.lessonMerge.labelled === 30 && all.jev.lessonMerge.judged === 30 && all.jev.lessonMerge.notJudged === 0);
chk('MNF1 alllabelled fileHint labelled == 5', all.jev.fileHint.labelled === 5 && all.jev.fileHint.notJudged === 0);
// MNF2: absent logs — zeros and the quiet state, no crash (rc checked in bash)
chk('MNF2 empty lessonMerge zeros + no rows yet', empty.jev.lessonMerge.labelled === 0 && empty.jev.lessonMerge.state === 'no rows yet');
chk('MNF2 empty fileHint version still resolved + quiet', empty.jev.fileHint.version === '3164-v3' && empty.jev.fileHint.state === 'no rows yet' && empty.jev.fileHint.bothAnswered === 0);
// INPUT-BOUND: past the row cap the trial fails closed — no numbers at all
chk('INPUT-BOUND capped lessonMerge counts null + cap state', cap.jev.lessonMerge.labelled === null && /cap/.test(cap.jev.lessonMerge.state) && cap.jev.lessonMerge.judged === null);
chk('INPUT-BOUND capped fileHint counts null', cap.jev.fileHint.labelled === null && /cap/.test(cap.jev.fileHint.state));
// fix1 version rule (execution-review finding 2): committed preregs decide, rows never hide
const v4pEnd = Object.fromEntries((v4p.jev.fileHint.ended || []).map((e) => [e.version, e.state]));
chk('fix1 v4pre: the newer committed prereg is current at its own zero state', v4p.jev.fileHint.version === '3390-v4' && v4p.jev.fileHint.nMin === 90 && v4p.jev.fileHint.labelled === 0 && v4p.jev.fileHint.state === 'no rows yet');
chk('fix1 v4pre: the superseded 3164-v3 renders ended, never a live bar', v4pEnd['3164-v3'] === 'superseded' && v4pEnd['3031-v2'] === 'ended INCONCLUSIVE (#3080)');
chk('fix1 v4pre: superseded v3 rows never move the current counters', v4p.jev.fileHint.judged === 0 && v4p.jev.fileHint.bothAnswered === 0);
chk('fix1 v4rows: v4 rows count toward the COMMITTED v4 n_min', v4r.jev.fileHint.version === '3390-v4' && v4r.jev.fileHint.nMin === 90 && v4r.jev.fileHint.labelled === 2 && v4r.jev.fileHint.judged === 2 && v4r.jev.fileHint.bothAnswered === 2 && v4r.jev.fileHint.agreeTop1 === 2);
chk('fix1 v4rows: 3164-v3 stays in the ended list', Object.fromEntries(v4r.jev.fileHint.ended.map((e) => [e.version, e.state]))['3164-v3'] === 'superseded');
chk('fix1 v4rows: the research tag id follows the CURRENT version prereg', v4r.jevResearch.shadows[1].id === '3390');
chk('fix1 noprereg: rows of a version with no committed prereg still count', np.jev.fileHint.version === '3164-v3' && np.jev.fileHint.labelled === 3 && np.jev.fileHint.judged === 3 && np.jev.fileHint.nMin === null);
chk('fix1 noprereg: the state names it an unregistered version', np.jev.fileHint.state === 'unregistered version');
chk('fix1 noprereg: the older family still renders ended', Object.fromEntries(np.jev.fileHint.ended.map((e) => [e.version, e.state]))['3031-v2'] === 'ended INCONCLUSIVE (#3080)');
chk('fix1 noprereg: no prereg to tag, the research card carries no id', np.jevResearch.shadows[1].id == null);
chk('fix1 noprereg: notJudged == 1 (day-cap only; no_anchor is terminal)', np.jev.fileHint.notJudged === 1);
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
console.log('jev-honest smoke: 44 arms OK (MF1-5, MNF1/2/4, privacy, input bound, fix1 version rule + backlog basis)');
EOF
RC=$?
rm -f "$OUT_MIXED" "$OUT_V2" "$OUT_ALL" "$OUT_EMPTY" "$OUT_CAP" "$OUT_V4P" "$OUT_V4R" "$OUT_NP"
[ "$RC" -eq 0 ] || fail "jev-honest arms failed (rc=$RC)"
echo "jev-honest smoke: PASS"
