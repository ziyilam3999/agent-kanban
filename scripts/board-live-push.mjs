// Spike (#3072): export a slim board snapshot and PUT it to the private repo via the GitHub contents API.
// Zero Claude tokens: plain node + gh. Usage: node board-live-push.mjs [session] [flags]
// Tracked in agent-kanban; #3111 leg 2b: lanes/shipTail/counts/stage/seat come ONLY from the lane
// referee (ai-brain status-tables --json + its lane-state reader) — every board-side lane rule is
// deleted, and a missing/unreadable referee aborts the push (no fallback rules, plan D1/D4/D6).
// Seams (all default to today's live paths):
//   --board <file>              board json (tickets map, or a rows array as the frozen fixtures use)
//   --session <sid>             session id (also: first positional, BOARD_SESSION, newest ledger dir)
//   --ledger-dir <dir>          3-role ledger root (default ~/.claude/3role-ledger); status-tables reads it too
//   --events-dir <dir>          step-log events root (default: the ledger dir)
//   --tasks-dir <dir>           task-store root (default ~/.claude/tasks); status-tables reads it too
//   --status-tables-json <file> referee payload read from a file instead of spawning status-tables
//   --lane-state-json <file>    reader payload (per-ticket state) read from a file instead of spawning lane-state
//   --wiki-hub <dir>     wiki-hub checkout whose registry maps this repo to the child wiki hosting the focus pages (#3244)
//   --now <iso>          pin the clock (generatedAt, recency windows, status-tables --now)
//   --dry-run [--json]   build the summary, print it as one JSON object, touch no network, no state file
//   --focus-body         print the #4 focus-details body (per-ticket focus lists) and exit; no network, no state
//   --details-body       print the #2 details body (per-ticket description + timeline) and exit; no network, no state
//   BOARD_AI_BRAIN       ai-brain checkout (default ~/coding_projects/ai-brain)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// #3123: --focuses-only prints the focuses JSON and exits (no network); --focus-dir <dir> reads the focus SSOT
// from another folder (focus-progress.mjs + focus-lists.json inside) and redirects the whole chain through
// PROGRESS_FOCUS_PROGRESS, which status-tables honours.
const ARGV = process.argv.slice(2);
const flagVal = (name) => { const i = ARGV.indexOf(name); return i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith('--') ? ARGV[i + 1] : null; };
const VALUE_FLAGS = ['--focus-dir', '--board', '--session', '--ledger-dir', '--events-dir', '--tasks-dir', '--now', '--status-tables-json', '--lane-state-json', '--wiki-hub'];
// #3272 F1: refuse any flag we do not know, BEFORE any data read or network call — an unknown flag must
// never fall through to the real push (the pre-fix live copy honoured --focus-dir, ignored the new print
// flags and pushed fixture data to the live board). The one legacy bare positional [session] id is kept.
const BOOL_FLAGS = ['--dry-run', '--json', '--force', '--focuses-only', '--focus-body', '--details-body'];
for (let ai = 0; ai < ARGV.length; ai++) {
  const a = ARGV[ai];
  if (VALUE_FLAGS.includes(a)) { ai += 1; continue; } // its value is consumed, whatever it looks like
  if (BOOL_FLAGS.includes(a) || !a.startsWith('--')) continue; // a known flag, or the positional session id
  console.error(`unknown flag: ${a} (known: ${[...VALUE_FLAGS, ...BOOL_FLAGS].join(' ')} [session])`);
  process.exit(2);
}
const DRY = ARGV.includes('--dry-run');
const HOME = os.homedir();
const LEDGER_DIR = path.resolve(flagVal('--ledger-dir') || path.join(HOME, '.claude/3role-ledger'));
const EVENTS_DIR = path.resolve(flagVal('--events-dir') || LEDGER_DIR);
const TASKS_DIR = path.resolve(flagVal('--tasks-dir') || path.join(HOME, '.claude/tasks'));
const NOW_ISO = flagVal('--now');
if (NOW_ISO && !Number.isFinite(Date.parse(NOW_ISO))) { console.error('bad --now: ' + NOW_ISO); process.exit(2); }
const NOW_MS = NOW_ISO ? Date.parse(NOW_ISO) : Date.now();
const FOCUS_DIR = flagVal('--focus-dir');
if (FOCUS_DIR) process.env.PROGRESS_FOCUS_PROGRESS = path.join(path.resolve(FOCUS_DIR), 'focus-progress.mjs');
const FOCUS_SCRIPT = process.env.PROGRESS_FOCUS_PROGRESS || path.join(os.homedir(), '.claude/focus/focus-progress.mjs');
// #3244 group C: focus cards link their wiki pages. The hub is the flag, else the pointer file the wiki
// skill documents (~/.claude/wiki-hub/root) -- nothing else is guessed (#3263 comment fix).
// Registry entry whose `covers` names ziyilam3999/ai-brain must carry a `remote`; hub, entry or remote
// missing -> WIKI_BASE stays null and the cards are byte-identical to today (fail-open: the board never
// depends on the wiki existing).
const WIKI_HUB = flagVal('--wiki-hub') || (() => { try { return fs.readFileSync(path.join(HOME, '.claude/wiki-hub/root'), 'utf8').trim(); } catch { return ''; } })();
let WIKI_BASE = null;
if (WIKI_HUB) {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(path.resolve(WIKI_HUB), 'registry.json'), 'utf8'));
    const e = (reg.entries || []).find((x) => (Array.isArray(x.covers) ? x.covers : [x.covers]).includes('ziyilam3999/ai-brain'));
    if (e && e.remote) WIKI_BASE = 'https://github.com/' + String(e.remote).replace(/^github\.com\//, '') + '/blob/main/';
  } catch {}
}
const REPO = 'ziyilam3999/agent-board-data';
const FILE = 'board-live.json';
const BOARD_FILE = path.resolve(flagVal('--board') || path.join(HOME, 'coding_projects/agent-kanban/data/board.json'));
const board = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
// Frozen fixtures carry a rows array (id/title/column/stage/updatedAt); the live board carries a tickets map.
if (!board.tickets && Array.isArray(board.rows)) {
  board.tickets = Object.fromEntries(board.rows.map((r) => [String(r.id), { id: r.id, subject: r.title || r.subject || '', column: r.column, status: r.column === 'done' ? 'completed' : (r.status || (r.column === 'todo' ? 'pending' : 'in_progress')), kind: r.kind || 'work', blockedBy: r.blockedBy || [], updatedAt: r.updatedAt, description: r.description || '' }]));
}
const doneIds = new Set(Object.values(board.tickets).filter((t) => t.status === 'completed').map((t) => String(t.id)));
const tickets = Object.values(board.tickets)
  .filter((t) => t.status !== 'completed')
  .map((t) => ({ id: String(t.id), subject: t.subject, column: t.column, status: t.status, kind: t.kind || 'work', blockedBy: (t.blockedBy || []).map(String).filter((x) => !doneIds.has(x)).join(' '), doneBlockers: (t.blockedBy || []).map(String).filter((x) => doneIds.has(x)).join(' '), updatedAt: new Date(Number(t.updatedAt) || Date.parse(t.updatedAt)).toISOString() }));
const snap = { generatedAt: new Date(NOW_MS).toISOString(), boardGeneratedAt: board.generatedAt, count: tickets.length, rows: tickets };

// #3072 option A: slim summary into one private issue body (the built-in Dashboard reads it via issue_read).
const isWork = (t) => (t.kind || "work") === "work";
const counts = {
  in_progress: tickets.filter((t) => t.column === 'in_progress' && isWork(t)).length,
  in_review: tickets.filter((t) => t.column === 'in_review' && isWork(t)).length,
  blocked: tickets.filter((t) => t.column === 'todo' && t.blockedBy && isWork(t)).length,
  todo_work: tickets.filter((t) => t.column === 'todo' && t.kind === 'work').length,
  parked: tickets.filter((t) => t.kind === 'parked').length,
  bookkeeping: tickets.filter((t) => t.kind === 'bookkeeping').length,
};
const active = tickets.filter((t) => isWork(t) && (t.column === 'in_progress' || t.column === 'in_review' || (t.column === 'todo' && t.blockedBy)))
  .map((t) => ({ id: t.id, subject: t.subject.slice(0, 220), column: t.column, kind: t.kind, blockedBy: t.blockedBy, updatedAt: t.updatedAt }));

// Lanes, seats and Jev (operator ask 2026-10-09). Session = argv[2] or BOARD_SESSION.
const AB = path.resolve(process.env.BOARD_AI_BRAIN || path.join(HOME, 'coding_projects/ai-brain'));
const SID = flagVal('--session') || ARGV.filter((x, i, a) => !x.startsWith('--') && !VALUE_FLAGS.includes(a[i - 1])).find(Boolean) || process.env.BOARD_SESSION || (() => { try { const d = LEDGER_DIR; return fs.readdirSync(d).filter((n) => /^[0-9a-f-]{36}$/.test(n)).map((n) => [n, fs.statSync(path.join(d, n)).mtimeMs]).sort((x, y) => y[1] - x[1])[0][0]; } catch { return ''; } })();
const run = (args) => { try { return execFileSync(process.execPath, args, { cwd: AB, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, THREE_ROLE_LEDGER_DIR: LEDGER_DIR, PROGRESS_TASKS_DIR: TASKS_DIR } }); } catch { return ''; } };
const scrub = (s) => String(s ?? '').replace(/\/(Users|home)\/[^\s"']*/g, '<path>');
let ROUTES = {}; try { ROUTES = JSON.parse(fs.readFileSync(path.join(AB, 'config/cc-routes.json'), 'utf8')); } catch {}
const SEAT_ROLES = ['planner', 'plan-review', 'executor', 'execution-review', 'ship-tail', 'research'];
const seats = SEAT_ROLES.map((role) => {
  let r = {}; try { r = JSON.parse(run(['hooks/3role-ledger.mjs', 'resolve-route', '--seat', role, '--json']) || '{}'); } catch {}
  const fb = run(['hooks/3role-ledger.mjs', 'resolve-role-model', '--role', role, '--with-effort']).trim().split('\n').pop() || '';
  const zai = r.dispatch === 'subprocess-zai';
  // Notes come from the routes SSOT (size overrides + Claude fallback), never hardcoded (2026-10-16).
  const cfg = ROUTES.seats?.[role] || {};
  const bits = Object.entries(cfg.size_models || {}).map(([k, v]) => `size ${k} uses ${String(v).replace(/^claude-/, '')}`);
  if (cfg.agent_tool_fallback) bits.push(`fallback ${String(cfg.agent_tool_fallback).replace(/^claude-/, '')}`);
  return { role, note: bits.join('; '), where: zai ? 'z.ai' : 'Claude', model: String(r.model || fb.split(' ')[0] || 'unknown').replace(/^claude-/, ''), effort: String(r.effort || fb.split(' ')[1] || 'unknown') };
});
// #3111 leg 2b: the lane referee is the ONLY source of lane truth. Lane membership, ship-tail,
// the counts/caps and every per-lane stage/seat/model/effort come from ai-brain's status-tables
// --json (itself reader-driven — board == status tables by construction, D1); the per-ticket state
// (running / waiting-to-merge / merged leg / failed-back-to, D4) comes from the reader itself.
// The board-side rules that used to sit here — the flow pass, the kanban-parity block with its
// "newer round wins" clamp, the status-tables stopgap, the orchestrator-lane override — are deleted
// (AC7). A missing, unreadable, over-bound or self-inconsistent referee aborts the push loudly:
// there is NO fallback set of rules on this side.
const SEAM_MAX_BYTES = 4 * 1024 * 1024; // a referee payload over this is refused, never read
const ROWS_MAX = 1000; // lanes.rows bound; a referee past this is malformed for board use
const TICKETS_MAX = 5000; // reader tickets bound
const refereeAbort = (why) => { console.error(`lane-referee-failed: ${why}; aborting before any upsert, state hash unwritten`); process.exit(1); };
const readSeamFile = (f, what) => {
  let size = 0;
  try { size = fs.statSync(f).size; } catch (e) { refereeAbort(`${what} seam unreadable: ${e.code || 'stat failed'}`); }
  if (size > SEAM_MAX_BYTES) refereeAbort(`${what} seam file is ${size} bytes (bound ${SEAM_MAX_BYTES})`);
  try { return fs.readFileSync(f, 'utf8'); } catch (e) { refereeAbort(`${what} seam unreadable: ${e.code || 'read failed'}`); }
};
let stJson = null;
{
  const seam = flagVal('--status-tables-json');
  const txt = seam ? readSeamFile(path.resolve(seam), '--status-tables-json')
    : run(['skills/progress-summary/bin/status-tables.mjs', '--session', SID, '--repo', AB, '--json', ...(NOW_ISO ? ['--now', NOW_ISO] : [])]);
  if (!txt) refereeAbort('the status-tables run returned nothing (spawn failed or timed out)');
  try { stJson = JSON.parse(txt); } catch { refereeAbort('the status-tables payload is not valid JSON'); }
  if (!stJson || typeof stJson !== 'object' || !Array.isArray(stJson.lanes?.rows)) refereeAbort('the status-tables payload has no lanes.rows');
  if (stJson.lanes.unavailable) refereeAbort('the status-tables lanes surface is unavailable: ' + scrub(String(stJson.lanes.unavailable)));
  if (stJson.lanes.rows.length > ROWS_MAX) refereeAbort(`the status-tables payload carries ${stJson.lanes.rows.length} lane rows (bound ${ROWS_MAX})`);
}
let rdJson = null;
{
  const seam = flagVal('--lane-state-json');
  const txt = seam ? readSeamFile(path.resolve(seam), '--lane-state-json')
    : run(['hooks/lane-state.mjs', '--session', SID, '--ledger-dir', LEDGER_DIR, '--tasks-dir', TASKS_DIR, '--json', ...(NOW_ISO ? ['--now', NOW_ISO] : [])]);
  if (!txt) refereeAbort('the lane-state reader run returned nothing (spawn failed or timed out)');
  try { rdJson = JSON.parse(txt); } catch { refereeAbort('the lane-state reader payload is not valid JSON'); }
  if (!rdJson || typeof rdJson !== 'object' || !rdJson.tickets || typeof rdJson.tickets !== 'object') refereeAbort('the lane-state reader payload has no tickets map');
  if (Object.keys(rdJson.tickets).length > TICKETS_MAX) refereeAbort(`the lane-state reader payload carries ${Object.keys(rdJson.tickets).length} tickets (bound ${TICKETS_MAX})`);
}
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const tkey = (r) => Date.parse(r.closedAt || r.ts || r.openedAt || 0) || 0;
const ledger = (id) => SID ? lines(path.join(LEDGER_DIR, SID, id + '.jsonl')).filter((r) => r && r.role).sort((x, y) => tkey(x) - tkey(y)) : [];
const JEV = path.join(os.homedir(), '.claude/jev');
const hint = lines(path.join(JEV, 'file-hint-shadow/rows.jsonl'));
const refRows = stJson.lanes.rows;
const workRows = refRows.filter((r) => String(r.pool) === 'work');
const tailRows = refRows.filter((r) => String(r.pool) === 'ship_tail');
const rdT = rdJson.tickets;
const rdOf = (id) => rdT[String(id)] || null;
// a referee that disagrees with itself must never be rendered: its pool counts must match its rows
// and no ticket may sit in both pools (AC10's no-overlap rule, enforced at the source).
const nWork = stJson.lanes.work && Number.isFinite(stJson.lanes.work.n) ? stJson.lanes.work.n : workRows.length;
const nTail = stJson.lanes.ship_tail && Number.isFinite(stJson.lanes.ship_tail.n) ? stJson.lanes.ship_tail.n : tailRows.length;
if (nWork !== workRows.length || nTail !== tailRows.length) refereeAbort(`the referee's counts (${nWork} work, ${nTail} ship-tail) disagree with its rows (${workRows.length}, ${tailRows.length})`);
const workIds = new Set(workRows.map((r) => String(r.id)));
for (const r of tailRows) if (workIds.has(String(r.id))) refereeAbort(`ticket ${r.id} is in both the work and the ship-tail pool`);
const laneCounts = { work: nWork, workCap: stJson.lanes.work && stJson.lanes.work.ceiling != null ? stJson.lanes.work.ceiling : null, shipTail: nTail, shipTailCap: stJson.lanes.ship_tail && stJson.lanes.ship_tail.ceiling != null ? stJson.lanes.ship_tail.ceiling : null };
const stRow = new Map(workRows.map((r) => [String(r.id), r])); // focus-card step facts read the referee's WORK-pool rows (ship-tail rows never leak into a card)
const boardById = new Map(tickets.map((t) => [t.id, t]));
const mergedLeg = (id) => { const s = rdOf(id); return !!s && s.state === 'waiting-to-merge' && s.tailOpen === false; };
// D6: the list column follows the referee, never board.json.column (export-board flips to in_review
// the moment any execution-review row lands). Open tail -> Review; merged leg, running and
// between-steps holds -> In progress. D4: a merged leg (waiting-to-merge, tail closed) is labelled
// `legMerged` and idles out of both lane lists; the key is present only when true.
const columnOfRef = (t) => {
  const s = rdOf(t.id);
  if (!s) return t.column;
  if (s.state === 'waiting-to-merge') return s.tailOpen === false ? 'in_progress' : 'in_review';
  if (s.state === 'running' || s.state === 'waiting-on-orchestrator' || s.state === 'failed-back-to') return 'in_progress';
  return t.column;
};
const laneEntry = (r) => {
  const t = boardById.get(String(r.id));
  const rt = rdOf(r.id);
  const h = hint.filter((x) => String(x.task) === String(r.id)).at(-1);
  return {
    id: String(r.id), subject: String((t && t.subject) || r.what || '').slice(0, 220), blockedBy: (t && t.blockedBy) || '', column: t ? columnOfRef(t) : '',
    live: workIds.has(String(r.id)), stage: scrub(String(r.stage || '')) || null,
    seat: scrub(String(r.seat || '')) || null, model: scrub(String(r.model || '')) || null, effort: scrub(String(r.effort || '')) || null,
    state: rt ? String(rt.state) : null, since: rt && rt.since ? String(rt.since) : null,
    jev: h ? { role: h.role, status: h.jev_status, top3: (h.jev_top3 || []).map(scrub), haikuTop3: (h.haiku_top3 || []).map(scrub), ts: h.ts } : null,
  };
};
const lanes = workRows.map(laneEntry);
const shipTail = tailRows.map(laneEntry);
const rows = active.map((t) => {
  const s = rdOf(t.id);
  const r = { ...t, column: columnOfRef(t), state: s ? String(s.state) : null };
  if (mergedLeg(t.id)) r.legMerged = true;
  return r;
});
const merge = lines(path.join(JEV, 'lesson-merge-shadow/rows.jsonl'));
const both = merge.filter((r) => r.jev_pick != null && r.base_pick != null);
const hintOk = hint.filter((r) => r.jev_status === 'ok');
const jev = {
  fileHint: { rows: hint.length, ok: hintOk.length, target: 100, agreeTop1: hintOk.filter((r) => (r.jev_top3 || [])[0] && (r.jev_top3 || [])[0] === (r.haiku_top3 || [])[0]).length, last: hint.at(-1)?.ts || null },
  lessonMerge: { rows: merge.length, scored: both.length, agree: both.filter((r) => r.jev_pick === r.base_pick).length, target: 400, last: merge.at(-1)?.ts || null },
};
// #3111 leg 2b: shelf kinds come from the board's own ticket kinds (a board statistic, the same
// shape the deleted selector emitted) — never from a lane rule.
const shelf = {};
for (const t of Object.values(board.tickets)) { if (t.column === 'done') continue; if (t.kind && t.kind !== 'work') shelf[t.kind] = (shelf[t.kind] || 0) + 1; }
// Detail sheet (kanban Drawer parity): description + black-box timeline, JSON-encoded strings so the
// Dashboard's cell flattening cannot mangle them. Timeline only for lane / in-progress / in-review rows.
const descOf = new Map(Object.values(board.tickets).map((t) => [String(t.id), ((d) => d.length > 420 ? d.slice(0, 419).replace(/\s+\S*$/, '') + '…' : d)(scrub(String(t.description || '')))]));
const tlOf = (id) => {
  if (!SID) return '';
  const rows = lines(path.join(LEDGER_DIR, SID, id + '.jsonl')).filter((r) => r && r.role && r.ts);
  return JSON.stringify(rows.sort((x, y) => String(x.ts).localeCompare(String(y.ts))).slice(-10).map((r) => ({ r: String(r.role), t: r.ts, c: r.closedAt || null, v: r.verdict ? String(r.verdict).slice(0, 20) : '', m: r.modelVersion ? (r.provider === 'zai' || r.dispatch === 'subprocess-zai' ? 'z.ai ' : '') + String(r.modelVersion).replace(/^claude-/, '') : '', e: r.effort ? String(r.effort) : '', a: r.artifact_path ? scrub(String(r.artifact_path)).split('/').pop() : '' })));
};
// #3278: the #2 body back under the 60000 cap WITH headroom (target ≤ 50000 on today's shape), by
// construction — per-entry trim (description ≤ 240, the 6 MOST RECENT timeline rows) plus a
// per-section row cap: every referee lane plus at most 24 of the most-recently-updated active
// tickets (worst case then (laneCap + 24) × the per-entry bound, a constant). Tickets outside the
// cap still ride #1; their sheet falls back to the page's existing no-entry rendering. Separate
// trimmed helpers, NOT descOf/tlOf: the shelf body (#3, under cap, untouched by this ticket) keeps
// the 420/10 shape byte-identical.
const DETAIL_DESC_MAX = 240;
const DETAIL_TL_MAX = 6;
const DETAIL_ACTIVE_MAX = 24;
const descTrim = (d) => d.length > DETAIL_DESC_MAX ? d.slice(0, DETAIL_DESC_MAX - 1).replace(/\s+\S*$/, '') + '…' : d;
const tlTrimOf = (id) => {
  if (!SID) return '';
  const rows = lines(path.join(LEDGER_DIR, SID, id + '.jsonl')).filter((r) => r && r.role && r.ts);
  return JSON.stringify(rows.sort((x, y) => String(x.ts).localeCompare(String(y.ts))).slice(-DETAIL_TL_MAX).map((r) => ({ r: String(r.role), t: r.ts, c: r.closedAt || null, v: r.verdict ? String(r.verdict).slice(0, 20) : '', m: r.modelVersion ? (r.provider === 'zai' || r.dispatch === 'subprocess-zai' ? 'z.ai ' : '') + String(r.modelVersion).replace(/^claude-/, '') : '', e: r.effort ? String(r.effort) : '', a: r.artifact_path ? scrub(String(r.artifact_path)).split('/').pop() : '' })));
};
const details = {};
for (const r of [...active].sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt))).slice(0, DETAIL_ACTIVE_MAX)) details[r.id] = { d: descTrim(descOf.get(r.id) || ''), tl: r.column !== 'todo' ? tlTrimOf(r.id) : '' };
for (const l of lanes) details[l.id] = { d: descTrim(descOf.get(l.id) || ''), tl: tlTrimOf(l.id) };
// Shelf (kanban Shelf parity): open non-work tickets grouped by kind; their detail lives in a third issue.
const shelfT = Object.values(board.tickets).filter((t) => t.status !== 'completed' && t.column !== 'done' && t.kind && t.kind !== 'work');
const shelfRows = shelfT.map((t) => ({ id: String(t.id), subject: scrub(String(t.subject)).slice(0, 160), kind: t.kind, type: t.bookkeeping?.type || '', column: t.column, updatedAt: new Date(Number(t.updatedAt) || Date.parse(t.updatedAt)).toISOString() }));
const shelfDetails = {};
for (const t of shelfT) {
  const meta = [['kind', t.kind], ['bookkeeping.type', t.bookkeeping?.type], ['bookkeeping.state', t.bookkeeping?.state], ['parked under', t.parkedUnder ? '#' + t.parkedUnder : ''], ['blocked reason', t.blockedReason], ['disposition', t.disposition]].filter(([, v]) => v).map(([k, v]) => k + '=' + scrub(String(v)).slice(0, 120)).join('\n');
  shelfDetails[String(t.id)] = { d: descOf.get(String(t.id)) || '', tl: tlOf(String(t.id)), meta };
}
// #3272: the legacy single-focus block (page-unread since #3123) is gone from the summary —
// the dashboard's focus surface reads `focuses` + the #4 focus-details issue.
// #3111 leg 2b: the #3073 "rework resets later steps" pass (a ledger-order rule that rewrote each
// lane's flow) is deleted with the flow pass itself — step facts come only from the referee.
// Three-focus progress + Jev research (operator 2026-10-16; brief .ai-workspace/plans/2026-10-16-board-three-focus-design-brief.md).
// Focus lists, goals and lane shares come from ~/.claude/focus (SSOT); live step/seat/effort from the lane rows above.
const cleanSubj = (s) => scrub(String(s || '').replace(/^(\s*\[[^\]]*\])+\s*/, '')).slice(0, 140);
let focuses = []; let focusTotals = null;
// #3290 fix r1: the old catch just logged here and the push shipped with focuses=[] — no focus cards,
// the #4 focus lists wiped. focusFail carries the cause CLASS only (never the raw error message,
// which embeds the focus-script path) and the guard below turns it into a pre-upsert abort.
let focusFail = null;
try {
  // One derivation (#3123): focus-level values come from status-tables focus.foci (never recomputed here), the ordered
  // tickets from focus-progress --json-full (the same script status-tables spawns), the live step/model/effort from
  // status-tables lanes.rows of the WORK pool (ship-tail rows never leak into a focus card).
  const FF = JSON.parse(execFileSync(process.execPath, [FOCUS_SCRIPT, '--json-full'], { encoding: 'utf8', timeout: 20000, cwd: path.dirname(FOCUS_SCRIPT) }));
  // #3290 fix r1: names are joined on their trimmed form — whitespace-only drift between the two
  // readers of the same focus SSOT must not read as a broken join.
  const foci = new Map((stJson && stJson.focus && stJson.focus.foci || []).map((x) => [String(x.name ?? '').trim(), x]));
  focuses = FF.map((f) => {
    const o = foci.get(String(f.name ?? '').trim()) || {};
    const label = o.label || f.name;
    const total = o.total ?? f.total;
    const tickets = f.rows.map((r) => {
      const x = stRow.get(String(r.id));
      const waits = (r.blockedBy || []).filter(Boolean);
      const running = x && / running\b/.test(String(x.stage || ''));
      const status = r.done ? 'done' : running ? 'live' : x ? 'started' : waits.length ? 'waiting' : r.status === 'in_progress' ? 'started' : 'todo';
      const t = { n: r.n, id: String(r.id), tag: label + ' ' + r.n + '/' + total, subject: cleanSubj(r.subject), status, waits };
      if (x) {
        t.step = scrub(String(x.stage || '')).replace(/execution-review said NEEDS-WORK → fix round/, 'fix round after review').slice(0, 80);
        t.model = String(x.model || '');
        t.effort = String(x.effort || '');
      }
      return t;
    });
    const key = f.name.toLowerCase();
    // #3244: the two wiki links are derived, never state — same filename contract the ai-brain
    // generator writes (focus-<key>.md + focus-<key>-progress.md in the covering child wiki).
    const card = { key, name: f.name, label, goal: o.goal ?? (f.goal || ''), lanes: o.lanes ?? f.lanes, state: o.state || (f.open === 0 ? 'done' : 'active'), pausedReason: o.pausedReason ?? null, done: o.done ?? f.done, open: o.open ?? f.open, in_progress: o.in_progress ?? f.in_progress, total, wtdPct: o.wtdPct ?? null, unsized: o.unsized ?? null, tickets };
    if (WIKI_BASE) { card.wiki = WIKI_BASE + 'focus-' + key + '.md'; card.wikiProgress = WIKI_BASE + 'focus-' + key + '-progress.md'; }
    return card;
  });
  focusTotals = focuses.reduce((a, f) => ({ done: a.done + f.done, open: a.open + f.open, total: a.total + f.total, active: a.active + (f.state === 'active' ? 1 : 0), paused: a.paused + (f.state === 'paused' ? 1 : 0), finished: a.finished + (f.state === 'done' ? 1 : 0) }), { done: 0, open: 0, total: 0, active: 0, paused: 0, finished: 0 });
} catch (e) {
  focusFail = e && e.code === 'ENOENT' ? 'focus-progress script missing'
    : e instanceof SyntaxError ? 'focus-progress output not valid JSON'
    : 'focus-progress run failed (non-zero exit or timeout)';
}
// #3272: the per-ticket focus lists move wholesale to their OWN pinned issue (#4) — the forever-growing
// mass (all focus tickets ever, done included) leaves the summary, which keeps one slim card per focus
// (every scalar, plus the merged size-weighted % passed through untouched: one derivation, in status-tables).
const focusTickets = Object.fromEntries(focuses.map((f) => [f.key, f.tickets]));
for (const f of focuses) delete f.tickets;
const focusBody = JSON.stringify({ generatedAt: snap.generatedAt, focusTickets });
if (process.argv.includes('--focuses-only')) { process.stdout.write(JSON.stringify(focuses)); process.exit(0); }
if (process.argv.includes('--focus-body')) { process.stdout.write(focusBody + '\n'); process.exit(0); }
let jevResearch = null;
try {
  const R = JSON.parse(fs.readFileSync(path.join(JEV, 'board-research.json'), 'utf8'));
  const taskStatus = (id) => { try { const t = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, SID || '', id + '.json'), 'utf8')); return t.status === 'completed' ? 'done' : (laneOf2.get(String(id))?.live ? 'live' : t.status === 'in_progress' ? 'started' : (t.blockedBy || []).length ? 'waiting' : 'todo'); } catch { return 'unknown'; } };
  const laneOf2 = new Map(lanes.map((l) => [String(l.id), l]));
  const subjOf = (id) => { try { return cleanSubj(JSON.parse(fs.readFileSync(path.join(TASKS_DIR, SID || '', id + '.json'), 'utf8')).subject); } catch { return ''; } };
  const liveLog = lines(path.join(JEV, 'live-judgements.jsonl'));
  const today = new Date(NOW_MS).toISOString().slice(0, 10);
  const mergeStatus = merge.reduce((o, r) => { o[r.jev_status] = (o[r.jev_status] || 0) + 1; return o; }, {});
  const labelled = merge.filter((r) => r.label_src === 'labeller').length;
  jevResearch = {
    asOf: R.asOf, rule: R.rule, testRule: R.testRule,
    liveToday: liveLog.filter((r) => String(r.ts || '').startsWith(today)).length, liveTotal: liveLog.length,
    firstLive: R.firstLive, wins: R.wins, loses: R.loses, model: R.model, calibration: R.calibration, costPerCall: R.costPerCall, latency: R.latency,
    road: (R.road || []).map((id) => ({ id: String(id), status: taskStatus(id), subject: subjOf(id) })),
    shadows: [
      { name: 'Lesson merge', id: '2886', rows: merge.length, target: 400, answered: mergeStatus.ok || 0, note: labelled ? labelled + ' rows labelled' : 'collected; waiting for the blind labeller' },
      { name: 'File hints', id: '2907', rows: hint.length, target: 100, answered: hintOk.length, note: hint.length ? '' : 'no rows yet' },
    ],
  };
} catch (e) { console.error('jevResearch: ' + (e && e.message)); }
// #3111 leg 2b: laneCap IS the referee's work ceiling (the mode SSOT status-tables already read);
// no resolve-mode spawn and no literal fallback on this side. Null when the mode pin is unreadable.
const laneCap = laneCounts.workCap;
const summary = JSON.stringify({ focuses, focusTotals, jevResearch, generatedAt: snap.generatedAt, counts, rows, shelfRows, seats, lanes, shipTail, laneCounts, laneCap, jev, shelf, laneSource: 'lane-state' });
// #3278: the #2 body carries ONLY the loader's read set — the page's details loader reads v.details
// (per entry d/tl) and never the top-level generatedAt (the stale-body check compares #1's against
// #4's; the render harness fixture already omits it), so it is dropped for headroom.
const detailBody = JSON.stringify({ details });
if (process.argv.includes('--details-body')) { process.stdout.write(detailBody + '\n'); process.exit(0); }
const PINNED = { 'board-live summary (auto)': '1', 'board-live focus details (auto)': '4', 'board-live details (auto)': '2', 'board-live shelf details (auto)': '3' };
function upsertIssue(title, text) {
  if (text.length > 60000) throw new Error(`${title} too large: ${text.length}`);
  let n = PINNED[title] || '';
  const f = path.join(os.tmpdir(), `board-live-issue-${process.pid}.md`);
  fs.writeFileSync(f, text);
  try {
    if (n) execFileSync('gh', ['issue', 'edit', n, '-R', REPO, '--body-file', f], { stdio: ['ignore', 'ignore', 'inherit'] });
    else n = execFileSync('gh', ['issue', 'create', '-R', REPO, '--title', title, '--body-file', f], { encoding: 'utf8' }).trim().split('/').pop();
  } finally { fs.unlinkSync(f); }
  console.log(`issue #${n} ${title} bytes=${text.length}`);
}
if (DRY) { process.stdout.write(JSON.stringify(JSON.parse(summary)) + '\n'); process.exit(0); }
// #3290: fail-loud focus join. The card scalars (wtdPct) and every per-ticket step fact come ONLY from
// the inner status-tables run, whose failure `run`'s empty catch used to swallow: the push still shipped
// with counts from focus-progress, % null and steps blank — the 2026-10-19 incident, shipped silently.
// status-tables derives focus.foci by spawning the SAME focus script we read FF from, so foci empty while
// FF is not means that inner run died (crash, throw or timeout — every flavor lands in the same swallow).
// Abort BEFORE the first upsert with the state hash unwritten: the watchdog's next tick retries and the
// board keeps the last good bodies (the page's "as of HH:MM" line shows the staleness, not silence).
// The step-row half (stRow) alone is NOT an abort signal: a board with no running work lanes is a legal
// quiet board; foci is the one field that separates "dead join" from "nothing running".
const stFoci = (stJson && stJson.focus && stJson.focus.foci) || [];
// #3290 fix r1 (execution review finding 1): a dead focus-progress (crash, garbled output, script
// missing) used to fall through this block with focuses=[] and ship — the same silently-degraded
// push class: no focus cards, #4 overwritten with an empty map. The catch now marks focusFail and
// the push aborts here instead.
if (focusFail) {
  console.error(`focus-join-failed: ${focusFail}; aborting before any upsert, state hash unwritten`);
  process.exit(1);
}
if (focuses.length > 0 && stFoci.length === 0) {
  console.error(`focus-join-failed: status-tables gave ${stJson ? 'no focus scalars (focus.foci empty)' : 'no output (run failed or timed out)'} while focus-progress returned ${focuses.length} focus(es); aborting before any upsert, state hash unwritten`);
  process.exit(1);
}
// #3290 fix r1 (execution review finding 2): foci.length is a proxy, not the join's outcome. If
// status-tables returns foci whose names match NONE of focus-progress's names (label/name drift),
// every card ships with wtdPct null — the incident's exact symptom — so decide on the joined result:
// abort when focus-progress returned focuses and none of them found its status-tables scalars. A
// PARTIAL miss (one focus unmatched) stays legal: that one card degrades visibly (null %) while the
// rest of the board stays truthful; only the total miss is the wholesale-keying-broken incident
// shape. Names only in the abort line — no ticket text, no paths.
const fociNames = new Set(stFoci.map((x) => String(x.name ?? '').trim()));
if (focuses.length > 0 && fociNames.size > 0) {
  const unmatched = focuses.filter((f) => !fociNames.has(String(f.name ?? '').trim())).map((f) => f.name);
  if (unmatched.length === focuses.length) {
    console.error(`focus-join-failed: none of focus-progress's ${focuses.length} focus(es) matched its status-tables scalars (unmatched: ${unmatched.join(', ')}); aborting before any upsert, state hash unwritten`);
    process.exit(1);
  }
}
const STATE = path.join(os.homedir(), '.claude/board-live/state.json');
const hash = (await import('node:crypto')).createHash('sha256').update([summary, focusBody, detailBody, JSON.stringify({ generatedAt: snap.generatedAt, details: shelfDetails })].join('\n').split(snap.generatedAt).join('')).digest('hex'); // #3272: the change-skip hash covers the #4 body too
let prev = {}; try { prev = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
if (!process.argv.includes('--force') && prev.hash === hash && Date.now() - (prev.at || 0) < 10 * 60 * 1000) { console.log('skip: unchanged since ' + new Date(prev.at).toISOString()); process.exit(0); }
// #3272 F3: size-check EVERY body before the first upsert — an over-cap body aborts the whole push
// (all-or-nothing: no issue is left fresh while another stays stale) — and #4 goes before #1, so a
// #4 failure can never leave a fresh #1 beside a stale #4 (the page joins the ticket lists from #4).
const BODIES = [
  ['board-live focus details (auto)', focusBody],
  ['board-live summary (auto)', summary],
  ['board-live details (auto)', detailBody],
  ['board-live shelf details (auto)', JSON.stringify({ generatedAt: snap.generatedAt, details: shelfDetails })],
];
for (const [bt, bb] of BODIES) if (bb.length > 60000) throw new Error(`${bt} too large: ${bb.length}`);
for (const [bt, bb] of BODIES) upsertIssue(bt, bb);
fs.writeFileSync(STATE, JSON.stringify({ hash, at: Date.now() }));
console.log('pushed at ' + snap.generatedAt);
