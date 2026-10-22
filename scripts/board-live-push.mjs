// Spike (#3072): export a slim board snapshot and PUT it to the private repo via the GitHub contents API.
// Zero Claude tokens: plain node + gh. Usage: node board-live-push.mjs [session] [flags]
// Tracked in agent-kanban (#3111 leg 2a) with the OLD lane rules intact. Seams (all default to today's live paths):
//   --board <file>       board json (tickets map, or a rows array as the frozen fixtures use)
//   --session <sid>      session id (also: first positional, BOARD_SESSION, newest ledger dir)
//   --ledger-dir <dir>   3-role ledger root (default ~/.claude/3role-ledger); status-tables reads it too
//   --events-dir <dir>   step-log events root (default: the ledger dir; the old rules do not read events yet)
//   --tasks-dir <dir>    task-store root (default ~/.claude/tasks); status-tables reads it too
//   --kanban-json <file> frozen kanban selector state ({active, lanes}) fed to the parity block instead of spawning the selectors
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
const VALUE_FLAGS = ['--focus-dir', '--board', '--session', '--ledger-dir', '--events-dir', '--tasks-dir', '--now', '--kanban-json', '--wiki-hub'];
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
const { lastLedgerRow, ROLE_ORDER } = await import(path.join(AB, 'skills/progress-summary/bin/status-tables.mjs'));
// stageOf left status-tables' exports in ai-brain cfc0bfba04 (#3111 leg 1b); local copy of its last version.
function stageOf(row) {
  if (!row) return null;
  const role = String(row.role);
  if (row.pending === true || !row.closedAt) return `${role} running`;
  const hasVerdict = row.verdict != null && String(row.verdict) !== '';
  const idx = ROLE_ORDER.indexOf(role);
  const next = idx >= 0 && idx + 1 < ROLE_ORDER.length ? ROLE_ORDER[idx + 1] : null;
  const reviewNoVerdict = !hasVerdict || String(row.verdict).trim() === '';
  if (reviewNoVerdict && (role === 'plan-review' || role === 'execution-review')) {
    return next ? `${role} stopped (no verdict) → re-run ${role}` : `${role} stopped (no verdict)`;
  }
  const verdict = hasVerdict ? String(row.verdict) : 'recorded';
  return next ? `${role} done (${verdict}) → next ${next}` : `${role} done (${verdict})`;
}
let live = new Set(); const stRow = new Map(); let stJson = null;
try { const st = stJson = JSON.parse(run(['skills/progress-summary/bin/status-tables.mjs', '--session', SID, '--repo', AB, '--json', ...(NOW_ISO ? ['--now', NOW_ISO] : [])])); for (const x of (st.lanes?.rows || []).filter((x) => x.pool === 'work')) { live.add(String(x.id)); stRow.set(String(x.id), x); } } catch {}
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const tkey = (r) => Date.parse(r.closedAt || r.ts || r.openedAt || 0) || 0;
const ledger = (id) => SID ? lines(path.join(LEDGER_DIR, SID, id + '.jsonl')).filter((r) => r && r.role).sort((x, y) => tkey(x) - tkey(y)) : [];
const JEV = path.join(os.homedir(), '.claude/jev');
const hint = lines(path.join(JEV, 'file-hint-shadow/rows.jsonl'));
const FLOW = ['research', 'planner', 'plan-review', 'executor', 'execution-review', 'ship-tail'];
const flowOf = (id, isLive) => {
  const rows = ledger(id);
  const last = {};
  for (const r of rows) last[String(r.role)] = r;
  const lastRole = rows.length ? String(rows[rows.length - 1].role) : '';
  return FLOW.map((role) => {
    const r = last[role];
    if (!r) return role + ':none';
    // an open row (e.g. a z.ai OR-NONCE pin that never closes) is not running once a LATER step has a newer closed row
    const later = FLOW.slice(FLOW.indexOf(role) + 1).some((x) => last[x] && last[x].closedAt && tkey(last[x]) >= tkey(r));
    if ((r.pending === true || !r.closedAt) && later) return role + ':done';
    if (r.pending === true || !r.closedAt) return role + ':' + (isLive ? 'running' : 'stopped');
    if (role === 'plan-review' || role === 'execution-review') {
      const v = String(r.verdict ?? '').trim().toUpperCase();
      if (!v) return role + ':stopped';
      return role + ':' + (/FAIL|NEEDS/.test(v) ? 'fail' : 'pass');
    }
    return role + ':done';
  }).concat(lastRole ? ['cur:' + lastRole] : []).join(',');
};
// z.ai rows carry no modelVersion while pending (#3087): resolve the model the dispatcher really uses
// from the ticket's own plan (size-L -> full glm-5.3) via resolve-route --plan, never the seat default.
const planFor = (id) => {
  try {
    const wt = path.join(AB, '.claude/worktrees');
    for (const d of fs.readdirSync(wt)) {
      if (!d.startsWith(id + '-')) continue;
      const pd = path.join(wt, d, '.ai-workspace/plans');
      if (!fs.existsSync(pd)) continue;
      for (const p of fs.readdirSync(pd)) if (p.includes('-' + id + '-') && p.endsWith('.md')) return path.join(pd, p);
    }
  } catch {}
  return null;
};
const zaiModelCache = new Map();
const zaiModel = (id, role) => {
  const k = id + ':' + role;
  if (zaiModelCache.has(k)) return zaiModelCache.get(k);
  let m = null;
  const p = planFor(id);
  if (p) { try { const j = JSON.parse(run(['hooks/3role-ledger.mjs', 'resolve-route', '--seat', role, '--plan', p, '--task', id, '--json']) || '{}'); if (j.effective_dispatch === 'subprocess-zai' && j.effective_model) m = String(j.effective_model); } catch {} }
  zaiModelCache.set(k, m);
  return m;
};
const lanes = tickets.filter((t) => t.column === 'in_progress' || t.column === 'in_review').map((t) => {
  // Stage = the furthest pipeline step that has a row (a late bookkeeping append to an earlier role, e.g. an
  // executor artifact re-pin after execution-review, must not move the lane backwards).
  const all = ledger(t.id);
  const lastPer = {};
  for (const r of all) lastPer[String(r.role)] = r;
  const furthest = [...FLOW].reverse().find((role) => lastPer[role]);
  const row = furthest ? lastPer[furthest] : (SID ? lastLedgerRow(t.id, SID) : null);
  const seat = row ? seats.find((s) => s.role === String(row.role)) : null;
  const h = hint.filter((x) => String(x.task) === t.id).at(-1);
  return {
    id: t.id, subject: t.subject.slice(0, 220), blockedBy: t.blockedBy || '', column: t.column, live: live.has(t.id), flow: flowOf(t.id, live.has(t.id)),
    stage: row ? scrub(stageOf(row)).replace(/done \((FAIL|NEEDS-WORK)\) → next .*/, 'said $1 → fix round') : 'no ledger rows', role: row ? String(row.role) : null,
    seat: row && row.modelVersion ? `${row.dispatch === 'subprocess-zai' || row.provider === 'zai' ? 'z.ai' : 'Claude'} ${String(row.modelVersion).replace(/^claude-/, '')}` : (row && row.dispatch === 'subprocess-zai' && zaiModel(t.id, String(row.role)) ? `z.ai ${zaiModel(t.id, String(row.role))}` : (seat ? `${seat.where} ${seat.model}` : null)),
    effort: row && row.effort && row.provider !== 'zai' ? String(row.effort) : (seat ? seat.effort : null),
    execModel: zaiModel(t.id, 'executor') ? 'z.ai ' + zaiModel(t.id, 'executor') : null,
    since: row ? (row.closedAt || row.ts || row.openedAt || null) : null,
    jev: h ? { role: h.role, status: h.jev_status, top3: (h.jev_top3 || []).map(scrub), haikuTop3: (h.haiku_top3 || []).map(scrub), ts: h.ts } : null,
  };
});
// Kanban parity (operator 2026-10-09): lanes, liveness and current stage come from the kanban's OWN
// selectors (lib/active computeActiveIds + lib/lanes deriveLanes), so the two boards never disagree.
let kb = null;
const KANBAN_JSON = flagVal('--kanban-json');
if (KANBAN_JSON) { try { kb = JSON.parse(fs.readFileSync(path.resolve(KANBAN_JSON), 'utf8')); } catch (e) { console.error('bad --kanban-json: ' + e.message); process.exit(2); } }
else try { kb = JSON.parse(execFileSync(path.join(os.homedir(), 'coding_projects/agent-kanban/node_modules/.bin/tsx'), [path.join(path.dirname(new URL(import.meta.url).pathname), 'kanban-lanes.ts')], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { kb = null; }
const PIPE = ['planner', 'plan-review', 'executor', 'execution-review'];
if (kb) {
  const byId = new Map(kb.lanes.map((x) => [String(x.id), x]));
  const act = new Set(kb.active.map(String));
  for (const l of lanes) {
    const k = byId.get(l.id);
    l.recent = !!k;
    l.live = act.has(l.id);
    if (k && k.stage != null) {
      let cur = PIPE[k.stage];
      const parts = l.flow.split(',').filter((x) => !x.startsWith('cur:'));
      const st = Object.fromEntries(parts.map((x) => x.split(':')));
      const lastRow = SID ? lastLedgerRow(l.id, SID) : null;
      const open = lastRow && String(lastRow.role) === cur && (lastRow.pending === true || !lastRow.closedAt);
      if (l.live && (st[cur] === 'none' || open)) st[cur] = 'running';
      // A newer round wins over the kanban's remembered failure: only mark a step failed when that step's
      // latest ledger row really is a FAIL/NEEDS-WORK, and move the current step forward when the next step
      // has a row newer than the current step's latest row (e.g. plan-review round 2 after a planner fold).
      const rowsL = ledger(l.id);
      const lastOf = {}; for (const r of rowsL) lastOf[String(r.role)] = r;
      const tsOf = (r) => Date.parse(r && (r.ts || r.openedAt || r.closedAt) || 0) || 0;
      const isFail = (r) => !!r && /FAIL|NEEDS/.test(String(r.verdict ?? '').toUpperCase());
      if (k.reworking && k.failedStage != null && isFail(lastOf[PIPE[k.failedStage]])) st[PIPE[k.failedStage]] = 'fail';
      let ci = PIPE.indexOf(cur);
      while (ci >= 0 && ci + 1 < PIPE.length && lastOf[PIPE[ci + 1]] && tsOf(lastOf[PIPE[ci + 1]]) > tsOf(lastOf[PIPE[ci]])) ci++;
      if (ci >= 0 && PIPE[ci] !== cur) { st[cur] = st[cur] === 'running' ? 'done' : (st[cur] || 'done'); cur = PIPE[ci]; const r = lastOf[cur]; st[cur] = (r.pending === true || !r.closedAt) ? (l.live ? 'running' : 'stopped') : (isFail(r) ? 'fail' : (/review/.test(cur) ? 'pass' : 'done')); }
      l.flow = FLOW.map((r) => r + ':' + (st[r] || 'none')).concat(['cur:' + cur]).join(',');
    }
  }
} else for (const l of lanes) l.recent = l.live || (l.since && NOW_MS - Date.parse(l.since) < 12 * 3600 * 1000);
// Stopgap until #3098 (step log): status-tables sees Agent-tool spawns and orchestrator-held steps that the kanban
// misses (no ledger row until a seat finishes), so a ticket it lists as a live work lane is a lane, running its stage.
for (const l of lanes) {
  const x = stRow.get(l.id); if (!x) continue;
  l.recent = true; l.live = true;
  const m = /^(planner|plan-review|executor|execution-review|research) running/.exec(String(x.stage || ''));
  if (m) {
    const parts = Object.fromEntries(l.flow.split(',').filter((y) => !y.startsWith('cur:')).map((y) => y.split(':')));
    for (const r of FLOW.slice(0, FLOW.indexOf(m[1]))) if (!parts[r] || parts[r] === 'running') parts[r] = parts[r] === 'running' ? 'done' : (parts[r] || 'none');
    parts[m[1]] = 'running';
    l.flow = FLOW.map((r) => r + ':' + (parts[r] || 'none')).concat(['cur:' + m[1]]).join(',');
    l.stage = m[1] + ' running'; l.role = m[1];
    l.seat = String(x.seat || '').replace(/ \(Agent tool\)/, '').replace(/^(fable|opus|sonnet|haiku)$/, 'Claude $1') || l.seat;
    l.effort = String(x.effort || '').replace(/ \(assigned\)/, '') || l.effort;
  }
}
// Orchestrator-run lanes (operator 2026-10-10: the 4th lane is GetSpace setup, worked by the main session with
// no 3-role seat, so no ledger row ever marks it live). A ticket file with metadata.lane === "orchestrator" and
// status in_progress counts as a live work lane; stage = metadata.lane_stage or "orchestrator working".
for (const l of lanes) {
  let t = null;
  try { t = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, SID || "", l.id + ".json"), "utf8")); } catch { t = null; }
  if (!t || t.status !== "in_progress" || !t.metadata || t.metadata.lane !== "orchestrator") continue;
  l.recent = true; l.live = true;
  l.stage = scrub(String(t.metadata.lane_stage || "orchestrator working")); l.role = "orchestrator";
  l.seat = "Claude (main session)"; l.effort = l.effort || null;
}
const merge = lines(path.join(JEV, 'lesson-merge-shadow/rows.jsonl'));
const both = merge.filter((r) => r.jev_pick != null && r.base_pick != null);
const hintOk = hint.filter((r) => r.jev_status === 'ok');
const jev = {
  fileHint: { rows: hint.length, ok: hintOk.length, target: 100, agreeTop1: hintOk.filter((r) => (r.jev_top3 || [])[0] && (r.jev_top3 || [])[0] === (r.haiku_top3 || [])[0]).length, last: hint.at(-1)?.ts || null },
  lessonMerge: { rows: merge.length, scored: both.length, agree: both.filter((r) => r.jev_pick === r.base_pick).length, target: 400, last: merge.at(-1)?.ts || null },
};
const shelf = kb ? kb.shelf : {};
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
// per-section row cap: every recent lane plus at most 24 of the most-recently-updated active
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
for (const l of lanes.filter((x) => x.recent)) details[l.id] = { d: descTrim(descOf.get(l.id) || ''), tl: tlTrimOf(l.id) };
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
// Lane cap = the mode SSOT work_ceiling (operator 2026-10-10: 4 lanes = 3 focus + 1 GetSpace); 4 if unreadable.
// Rework resets later steps (2026-10-10, #3073 merge-conflict round): when the current step has a ledger row
// newer than a later step's latest row, that later step's old result (an earlier review PASS, a failed ship-tail
// attempt) no longer applies, so it renders as not reached instead of done.
for (const l of lanes) {
  if (!l.flow || l.role === 'orchestrator') continue;
  const parts = l.flow.split(',');
  const curM = parts.find((x) => x.startsWith('cur:'));
  if (!curM) continue;
  const cur = curM.slice(4); const ci = FLOW.indexOf(cur); if (ci < 0) continue;
  const rows = ledger(l.id); const lastOf = {}; for (const r of rows) lastOf[String(r.role)] = r;
  const tsOf = (r) => Date.parse(r && (r.ts || r.openedAt || r.closedAt) || 0) || 0;
  const curTs = tsOf(lastOf[cur]); if (!curTs) continue;
  const st = Object.fromEntries(parts.filter((x) => !x.startsWith('cur:')).map((x) => x.split(':')));
  for (const r of FLOW.slice(ci + 1)) if (st[r] && st[r] !== 'none' && tsOf(lastOf[r]) < curTs) st[r] = 'none';
  l.flow = FLOW.map((r) => r + ':' + (st[r] || 'none')).concat(['cur:' + cur]).join(',');
}
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
const laneCap = (() => { const m = /^work_ceiling=(\d+)$/m.exec(run(["hooks/3role-ledger.mjs", "resolve-mode"])); return m ? Number(m[1]) : 4; })();
const summary = JSON.stringify({ focuses, focusTotals, jevResearch, generatedAt: snap.generatedAt, counts, rows: active, shelfRows, seats, lanes: lanes.filter((l) => l.recent), laneCap, jev, shelf, laneSource: kb ? 'kanban' : 'ledger' });
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
