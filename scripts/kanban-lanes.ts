// kanban-lanes.ts — the kanban's own live-lane verdicts (computeActiveIds + deriveLanes) as JSON.
// #3272 tracked port of the board-live selector shim: the timer runs this repo's board-live-push.mjs
// through a symlink, and the feed spawns the kanban-lanes.ts sitting beside its own realpath — this
// file — so the selectors answering the live board are exactly what git says, never a drifted copy.
// Reads the live board this checkout maintains (data/board.json; a fresh clone carries only
// data/board.sample.json and this script fails loudly rather than guessing). The extra `source` key
// names this script so which selector answered is provable from the output alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeActiveIds } from '../lib/active';
import { deriveLanes } from '../lib/lanes';

const here = path.dirname(fileURLToPath(import.meta.url));
const board = JSON.parse(fs.readFileSync(path.join(here, '../data/board.json'), 'utf8'));
const tickets = Object.values(board.tickets) as any[];
const session = (board.sessions || []).find((s: any) => s.id === board.sessionId);
const live = session?.live ?? true;
const ids = computeActiveIds(tickets, live, Date.now());
const lanes = deriveLanes(tickets, ids).map((l: any) => ({ id: l.id, stage: l.currentStageIndex, reworking: !!l.reworking, failedStage: l.failedStage ?? null, roles: [...(l.rolesSeen || [])] }));
const kinds: Record<string, number> = {};
let done = 0;
for (const t of tickets) { if (t.column === 'done') done++; else if (t.kind && t.kind !== 'work') kinds[t.kind] = (kinds[t.kind] || 0) + 1; }
console.log(JSON.stringify({ lanes, active: [...ids], shelf: kinds, done, sessionLabel: session?.label || '', source: 'agent-kanban/scripts/kanban-lanes.ts' }));
