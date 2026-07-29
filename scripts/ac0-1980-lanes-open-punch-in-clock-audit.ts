#!/usr/bin/env tsx
// ac0-1980-lanes-open-punch-in-clock-audit.ts — #1980 plan AC-0 (the load-bearing
// Rule-18 audit). Proves, on REAL production chain shapes captured ONCE, that:
//   (i)  a counterfactual bulk-touch re-arm (updatedAt = NOW on every armed
//        chain) lights the ENTIRE armed set under the MASTER clock (`updatedAt`),
//   (ii) the SAME re-arm lights ZERO of them under the FIX (the OPC clock), and
//   (iii) the fix has not merely darkened everything (direction guard + positive
//         control).
//
// The armed set A = tickets that are chainInFlight AND whose OPEN PUNCH-IN CLOCK
// (OPC) age exceeds the 6h cap — the dead-but-armed population the 2026-07-26
// incident is made of (measured 28-29 on 2026-07-29). The audit computes the OPC
// INDEPENDENTLY (this file's scriptOpenPunchInClock) from the Behavioral-contract
// definition; the fix's computeActiveIds uses its OWN openPunchInClock. AC-0 (ii)
// + (iii) together form a two-sided differential: if the implementation calls a
// script-armed ticket fresh, (ii) fails; if it calls a script-fresh ticket dead,
// (iii)/(iv) fails. The two OPC computations cannot diverge silently.
//
// NOT part of the jest suite. Exits with a DISTINCT SKIP code (75) when the live
// data directories are absent, so CI (which has no ~/.claude/tasks) is untouched —
// the synced-smoke-must-skip-not-fail doctrine.
//
// Two phases, one command:
//   1. CAPTURE: read the live task + ledger dirs exactly ONCE (the repo's real
//      build path via buildTicket), redact the two home-path-capable fields at
//      capture (Ticket.description and Ticket.comments[].artifact — N1; every
//      other field, including the output-relevant onHold, is copied verbatim),
//      and write ONE snapshot file { nowMs, sessionId, tickets }.
//   2. EVALUATE (hermetic): re-read the snapshot, then install the process's
//      file-read-primitive guard (AFTER module load and AFTER the snapshot read —
//      N3; a tsx/ESM process reads files to load modules at all, so instrumenting
//      before imports would brick the script). The guard throws on ANY file
//      read, with no "other than the snapshot" carve-out (the snapshot is
//      already in memory). The entire evaluate — computeActiveIds (fix) +
//      computeActiveIdsMaster (master) + the script OPC — runs under that guard
//      and must complete without a throw: computeActiveIds' transitive closure
//      (active → ui-meta → board-schema) is provably fs-free, so a live read
//      here is a real proof failure, not a missed enumeration.
//
// The serialize → JSON.stringify → JSON.parse boundary is lossless (N2): every
// Ticket / LedgerComment field is string / number / string[] / optional-string,
// and build-board's toComment assigns optional fields only when truthy, so
// "absent" survives as "absent" — no Date object, no NaN number, no
// undefined-vs-missing distinction any consumed predicate can observe.
//
// The master leg reimplements pre-fix computeActiveIds using the SAME exported
// helpers (chainInFlight, pendingReviewInFlight, isHeld, shippingAfterPass)
// plus a local hasAnyPipelineComment. That reimplementation is faithful because
// #1980 changes ONLY computeActiveIds' cap clock + disjunct conjunctions; the
// helpers are byte-identical on master and the fix.
//
// stdout is a public-PR-safe surface: ticket ids, ages, counts only — no
// agentIds, no artifact paths, no home paths.
//
// Env:
//   TASKS_DIR     default <homedir>/.claude/tasks
//   LEDGER_DIR    default <homedir>/.claude/3role-ledger
//   SNAPSHOT      default .ai-workspace/ac0-1980-snapshot.json
//   PHASE         capture | evaluate | all (default all)

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

// The CJS `fs` exports object (Node exposes `fs`/`node:fs` ESM named exports as
// live getters over THIS object), reached via createRequire so the evaluate
// phase can monkeypatch the read primitives at the one place the bindings
// actually delegate. (`import * as fs` gives a read-only getter namespace that
// cannot be reassigned; the underlying CJS exports object is a plain writable
// object.) Used ONLY by armFsGuard — capture reads via the ESM `fs` namespace.
const cjsRequire = createRequire(import.meta.url);

// fs-free closure only (active → ui-meta → board-schema). build-board (which
// imports fs) is dynamic-imported in CAPTURE so the EVALUATE phase never even
// loads the build path — "never invokes the build path" is structural.
import {
  ACTIVE_WINDOW_MS,
  INFLIGHT_LANE_CAP_MS,
  chainInFlight,
  computeActiveIds,
  pendingReviewInFlight,
} from "../lib/active";
import { isHeld, shippingAfterPass } from "../lib/ui-meta";
import type { Ticket } from "../lib/board-schema";
// Type-only (erased at runtime — does NOT load build-board's `fs` import):
// keeps the evaluate phase's closure provably fs-free.
import type { RawLedgerLine, RawTask } from "../lib/build-board";

const HOME = os.homedir();
const TASKS_DIR = process.env.TASKS_DIR || path.join(HOME, ".claude", "tasks");
const LEDGER_DIR = process.env.LEDGER_DIR || path.join(HOME, ".claude", "3role-ledger");
const SNAPSHOT =
  process.env.SNAPSHOT || path.join(".ai-workspace", "ac0-1980-snapshot.json");

/** Distinct SKIP exit code — CI (no live dirs) must SKIP, not FAIL. */
const SKIP_EXIT = 75;
/** Distinct REFUSE exit code — armed set A empty (no structural population). */
const REFUSE_EXIT = 72;
/** Distinct PROOF-FAILURE exit code — a live fs read survived the hermeticity guard. */
const PROOF_EXIT = 73;

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;

const PIPELINE_ROLES = new Set([
  "planner",
  "plan-review",
  "executor",
  "execution-review",
]);

// ───────────────────────── OPC (independent reimplementation) ─────────────────────────
// Mirrors the plan's Behavioral-contract definition (and lib/active.ts's
// openPunchInClock) but is intentionally local so the audit's OPC and the
// implementation's OPC are two independent computations (the two-sided
// differential). Per-agent and closedAt-aware, reusing chainInFlight's
// individuation: a unit is an agentId with ≥1 pipeline row and no closedAt on
// any of its rows, or each agentId-less open row; research branch for
// research-only tickets.

function scriptParseTs(ts: string | undefined): number | undefined {
  if (typeof ts !== "string") return undefined;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? undefined : ms;
}

function scriptOpenPunchInClock(t: Ticket): number | undefined {
  let hasPipeline = false;
  for (const c of t.comments) {
    if (PIPELINE_ROLES.has(c.role)) {
      hasPipeline = true;
      break;
    }
  }
  if (hasPipeline) {
    const agentClosed = new Map<string, boolean>();
    for (const c of t.comments) {
      if (!PIPELINE_ROLES.has(c.role)) continue;
      if (c.agentId) {
        agentClosed.set(
          c.agentId,
          (agentClosed.get(c.agentId) ?? false) || !!c.closedAt
        );
      }
    }
    let opc: number | undefined;
    for (const c of t.comments) {
      if (!PIPELINE_ROLES.has(c.role)) continue;
      const openUnit = c.agentId
        ? !(agentClosed.get(c.agentId) ?? false)
        : !c.closedAt;
      if (!openUnit) continue;
      const ms = scriptParseTs(c.ts);
      if (ms !== undefined && (opc === undefined || ms > opc)) opc = ms;
    }
    return opc;
  }
  let opc: number | undefined;
  for (const c of t.comments) {
    if (c.role !== "research" || c.closedAt) continue;
    const ms = scriptParseTs(c.ts);
    if (ms !== undefined && (opc === undefined || ms > opc)) opc = ms;
  }
  return opc;
}

/** The lane's cap age (ms), with the legacy `updatedAt` fallback when OPC is
 *  UNKNOWN — byte-identical to lib/active.ts's laneCapAgeMs. */
function scriptLaneCapAgeMs(t: Ticket, nowMs: number): number {
  const opc = scriptOpenPunchInClock(t);
  return opc !== undefined ? nowMs - opc : nowMs - t.updatedAt;
}

function hasAnyPipelineComment(t: Ticket): boolean {
  return t.comments.some((c) => PIPELINE_ROLES.has(c.role));
}

// ───────────────────────── master computeActiveIds (faithful reimplementation) ─────────────────────────
// Pre-fix disjunct logic: disjunct 1 cap reads `updatedAt`; disjuncts 2 + 3
// carry NO dead-beyond-cap conjunction. Uses the SAME exported helpers (which
// #1980 does not change), so only the disjunct logic differs from the fix.
function computeActiveIdsMaster(
  tickets: ReadonlyArray<Ticket>,
  isLive: boolean,
  nowMs: number,
  windowMs: number,
  inflightCapMs: number
): Set<string> {
  const active = new Set<string>();
  if (!isLive) return active;
  const inProgress = tickets.filter(
    (t) =>
      (t.column === "in_progress" ||
        shippingAfterPass(t) ||
        pendingReviewInFlight(t)) &&
      !isHeld(t)
  );
  if (inProgress.length === 0) return active;
  const inFlightIds = new Set<string>();
  for (const t of inProgress) {
    if (chainInFlight(t)) {
      inFlightIds.add(t.id);
      if (nowMs - t.updatedAt <= inflightCapMs) active.add(t.id);
    }
  }
  let focus = inProgress[0];
  for (const t of inProgress) {
    if (t.updatedAt > focus.updatedAt) focus = t;
  }
  if (
    inFlightIds.has(focus.id) ||
    (inFlightIds.size === 0 && !hasAnyPipelineComment(focus))
  ) {
    active.add(focus.id);
  }
  for (const t of inProgress) {
    if (nowMs - t.updatedAt <= windowMs) active.add(t.id);
  }
  return active;
}

// ───────────────────────── CAPTURE ─────────────────────────

interface Snapshot {
  nowMs: number;
  /** 8-char session id of the newest session (context only; evaluate is
   *  counterfactual-live across the captured population). */
  sessionId: string;
  tickets: Ticket[];
}

function isExcludedName(name: string): boolean {
  return name.startsWith("_quarantine") || name.startsWith("test-sess");
}

function readTaskFile(file: string): { id: string; raw: unknown; mtimeMs: number } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const mtimeMs = fs.statSync(file).mtimeMs;
    const id = (raw as { id?: string }).id ?? path.basename(file, ".json");
    return { id, raw, mtimeMs };
  } catch {
    return null;
  }
}

function readLedgerLines(sessionId: string, taskId: string): unknown[] {
  const file = path.join(LEDGER_DIR, sessionId, `${taskId}.jsonl`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

function ledgerMtimeByTaskId(sessionId: string): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const dir = path.join(LEDGER_DIR, sessionId);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        const st = fs.statSync(path.join(dir, f));
        if (!st.isFile()) continue;
        out.set(f.slice(0, -".jsonl".length), st.mtimeMs);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no ledger dir */
  }
  return out;
}

async function capture(): Promise<Snapshot> {
  // Dynamic import: build-board pulls `fs` into the module graph, so it is
  // imported HERE (capture) and never loaded by the evaluate phase.
  const { buildTicket } = await import("../lib/build-board");

  let sessionDirs: string[];
  try {
    sessionDirs = fs.readdirSync(TASKS_DIR);
  } catch {
    console.error(`ac0: SKIP — tasks dir not present: ${TASKS_DIR}`);
    process.exit(SKIP_EXIT);
  }

  const now = Date.now();
  const tickets: Ticket[] = [];
  let newestSession = "";
  let newestLastActive = -1;

  for (const name of sessionDirs) {
    if (isExcludedName(name)) continue;
    const dir = path.join(TASKS_DIR, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    let taskFiles: string[] = [];
    try {
      taskFiles = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(dir, f));
    } catch {
      continue;
    }
    if (taskFiles.length === 0) continue;

    let lastActive = 0;
    for (const f of taskFiles) {
      try {
        const m = fs.statSync(f).mtimeMs;
        if (m > lastActive) lastActive = m;
      } catch {
        /* ignore */
      }
    }
    const ledgerMtimes = ledgerMtimeByTaskId(name);
    for (const m of ledgerMtimes.values()) {
      if (m > lastActive) lastActive = m;
    }
    if (lastActive > newestLastActive) {
      newestLastActive = lastActive;
      newestSession = name;
    }

    const sid = name.slice(0, 8);
    for (const file of taskFiles) {
      const parsed = readTaskFile(file);
      if (!parsed) continue;
      const ledger = readLedgerLines(name, parsed.id) as RawLedgerLine[];
      const task = parsed.raw as RawTask;
      const ticket = buildTicket(
        task,
        ledger,
        parsed.mtimeMs,
        sid,
        ledgerMtimes.get(parsed.id)
      );
      // Capture-time redaction (N1, belt-and-braces — build-board already
      // redacts these in the production path): blank ONLY the two fields the
      // closure never reads and that can carry home paths. Every other field
      // (onHold included — output-relevant, drives isHeld) is copied verbatim.
      const redacted: Ticket = {
        ...ticket,
        description: "",
        comments: ticket.comments.map((c) => {
          const { artifact: _artifact, ...rest } = c;
          void _artifact;
          return rest as Ticket["comments"][number];
        }),
      };
      tickets.push(redacted);
    }
  }

  if (tickets.length === 0) {
    console.error("ac0: SKIP — no tickets found under the tasks dir");
    process.exit(SKIP_EXIT);
  }

  const snapshot: Snapshot = {
    nowMs: now,
    sessionId: newestSession.slice(0, 8),
    tickets,
  };

  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot), "utf8");
  return snapshot;
}

// ───────────────────────── EVALUATE (hermetic) ─────────────────────────

/** Install the file-read-primitive guard: every sync + async fs read method
 *  throws. Installed AFTER module load and AFTER the snapshot read (N3), so no
 *  "other than the snapshot" carve-out is needed — the snapshot is in memory.
 *  Patches the CJS `fs` exports object (the one place the ESM named-export
 *  bindings delegate to). Fails closed if the guard has no power (a control
 *  read did not throw after arming). */
function armFsGuard(): void {
  const fail = () => {
    throw new Error(
      "ac0: HERMETICITY BROKEN — a file read occurred during the evaluate phase"
    );
  };
  const cjsFs = cjsRequire("node:fs") as Record<string, unknown>;
  const methods = [
    "readFileSync",
    "openSync",
    "readSync",
    "statSync",
    "lstatSync",
    "readdirSync",
    "realpathSync",
    "accessSync",
    "existsSync",
    "createReadStream",
    "readFile",
    "stat",
    "lstat",
    "readdir",
    "open",
    "realpath",
    "access",
  ];
  for (const m of methods) {
    try {
      cjsFs[m] = fail;
    } catch {
      /* non-writable binding — skip */
    }
  }
  try {
    const p = cjsFs.promises as Record<string, unknown> | undefined;
    if (p) {
      for (const m of ["readFile", "stat", "lstat", "readdir", "open", "access", "realpath"]) {
        try {
          p[m] = fail;
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* skip */
  }
  // Positive control: confirm the guard actually throws on a real read (so a
  // silent no-op patch cannot masquerade as a hermeticity proof). The snapshot
  // exists on disk, so an un-patched readFileSync would NOT throw.
  let armed = false;
  try {
    (cjsFs.readFileSync as (p: string) => unknown)(SNAPSHOT);
  } catch {
    armed = true;
  }
  if (!armed) {
    throw new Error(
      "ac0: HERMETICITY guard has no power — readFileSync did not throw after arming"
    );
  }
}

function evaluate(snapshot: Snapshot): void {
  const { tickets, nowMs } = snapshot;
  const NOW = nowMs;
  const isLive = true; // the counterfactual LIVE-session scenario (the 2026-07-26 bug shape)
  const windowMs = ACTIVE_WINDOW_MS;
  const cap = INFLIGHT_LANE_CAP_MS;

  // ── Armed set A (independent OPC): lane-population AND chainInFlight AND
  //    OPC age > cap. The lane-population gate (the SAME filter
  //    computeActiveIds uses — in_progress ∪ shippingAfterPass ∪
  //    pendingReviewInFlight, minus held) is required: a chainInFlight ticket
  //    that is done/todo is NOT in the population and no clock can light it,
  //    so it is not "armed" in the operator-visible sense the 2026-07-26
  //    incident measured (the plan's 98 in-progress → 31 chainInFlight → 28
  //    armed, all in the lane population). ──
  const inLanePopulation = (t: Ticket) =>
    (t.column === "in_progress" ||
      shippingAfterPass(t) ||
      pendingReviewInFlight(t)) &&
    !isHeld(t);

  const A: Ticket[] = [];
  const withinCap: Ticket[] = [];
  for (const t of tickets) {
    if (!inLanePopulation(t) || !chainInFlight(t)) continue;
    const age = scriptLaneCapAgeMs(t, NOW);
    if (age > cap) A.push(t);
    else withinCap.push(t);
  }

  if (A.length === 0) {
    console.error(
      "ac0: REFUSE — armed set A is empty (no chainInFlight ticket with OPC beyond the cap); the defect is not reproduced on this data"
    );
    process.exit(REFUSE_EXIT);
  }

  const aIds = new Set(A.map((t) => t.id));

  // ── Re-arm: every A member's updatedAt → NOW (the bulk-touch effect) ──
  const reArmed: Ticket[] = tickets.map((t) =>
    aIds.has(t.id) ? { ...t, updatedAt: NOW } : t
  );

  // ── HERMETICITY: install the read guard, then never read a file again ──
  armFsGuard();

  const litMaster = computeActiveIdsMaster(reArmed, isLive, NOW, windowMs, cap);
  const litFix = computeActiveIds(reArmed, isLive, NOW, windowMs, cap);

  // (i) False-positive reproduction: every A member lit under MASTER.
  let iFail = 0;
  for (const t of A) if (!litMaster.has(t.id)) iFail++;

  // (ii) The fix removes them: zero A members lit under the FIX.
  let iiFail = 0;
  for (const t of A) if (litFix.has(t.id)) iiFail++;

  // (iii) Direction guard: every within-cap ticket lit under BOTH, and
  //       LitOnFix ⊆ LitOnMaster (the fix never lights something master doesn't).
  let iiiWithinFail = 0;
  for (const t of withinCap) {
    if (!litMaster.has(t.id) || !litFix.has(t.id)) iiiWithinFail++;
  }
  let iiiSubsetFail = 0;
  for (const id of litFix) if (!litMaster.has(id)) iiiSubsetFail++;

  // (iv) Positive control: take one A member, move its open punch-in ts to
  //      NOW−1min (leaving updatedAt untouched — its real stale value), and
  //      it becomes lit under the FIX. A darken-everything impl fails this.
  const ctl = A[0];
  const controlTicket: Ticket = {
    ...ctl,
    comments: ctl.comments.map((c) => ({
      ...c,
      ts: new Date(NOW - MIN_MS).toISOString(),
    })),
  };
  const litControl = computeActiveIds(
    [controlTicket],
    isLive,
    NOW,
    windowMs,
    cap
  );
  const ivPass = litControl.has(controlTicket.id);

  // ── Report (public-PR-safe: ticket ids, ages, counts only) ──────────
  const opcAgesH = A.map((t) => {
    const opc = scriptOpenPunchInClock(t);
    const age = opc !== undefined ? NOW - opc : NOW - t.updatedAt;
    return age / HOUR_MS;
  }).sort((a, b) => a - b);

  const fail = iFail > 0 || iiFail > 0 || iiiWithinFail > 0 || iiiSubsetFail > 0 || !ivPass;

  const lines: string[] = [];
  lines.push("ac0-1980-lanes-open-punch-in-clock-audit — RESULTS");
  lines.push(`  pinned now: ${new Date(NOW).toISOString()} (${NOW})`);
  lines.push(`  captured tickets: ${tickets.length} (newest session ${snapshot.sessionId})`);
  lines.push(`  chainInFlight & OPC-beyond-cap (armed set |A|): ${A.length}`);
  lines.push(`  OPC age distribution (hours, sorted): ${opcAgesH.map((h) => h.toFixed(2)).join(" ")}`);
  if (opcAgesH.length > 0) {
    const q = (p: number) => opcAgesH[Math.min(opcAgesH.length - 1, Math.floor(p * opcAgesH.length))];
    lines.push(`  OPC age quartiles (h): min=${opcAgesH[0].toFixed(2)} q1=${q(0.25).toFixed(2)} median=${q(0.5).toFixed(2)} q3=${q(0.75).toFixed(2)} max=${opcAgesH[opcAgesH.length - 1].toFixed(2)}`);
  }
  lines.push(`  armed ticket ids: ${A.map((t) => t.id).join(" ")}`);
  lines.push(`  re-armed leg — lit under MASTER: ${litMaster.size} | lit under FIX: ${litFix.size}`);
  lines.push(`  (i)  master lights EVERY armed member: ${iFail === 0 ? "PASS" : `FAIL (${iFail} not lit)`}`);
  lines.push(`  (ii) fix lights ZERO armed members:  ${iiFail === 0 ? "PASS" : `FAIL (${iiFail} lit)`}`);
  lines.push(`  (iii) within-cap lit under both: ${iiiWithinFail === 0 ? "PASS" : `FAIL (${iiiWithinFail})`} | LitOnFix⊆LitOnMaster: ${iiiSubsetFail === 0 ? "PASS" : `FAIL (${iiiSubsetFail})`}`);
  lines.push(`  (iv) positive control (punch-in→NOW−1min lights under fix): ${ivPass ? "PASS" : "FAIL"}`);
  lines.push(`  hermeticity: PASS (evaluate completed under the fs-read guard with no read)`);
  lines.push(`  VERDICT: ${fail ? "FAIL" : "PASS"}`);
  console.log(lines.join("\n"));

  if (fail) process.exit(1);
}

// ───────────────────────── entry ─────────────────────────

async function main(): Promise<void> {
  const phase = process.env.PHASE || "all";
  if (phase === "capture") {
    await capture();
    return;
  }
  if (phase === "evaluate") {
    let raw: string;
    try {
      raw = fs.readFileSync(SNAPSHOT, "utf8");
    } catch {
      console.error(`ac0: no snapshot at ${SNAPSHOT} — run PHASE=capture first`);
      process.exit(REFUSE_EXIT);
    }
    evaluate(JSON.parse(raw) as Snapshot);
    return;
  }
  // default: capture then evaluate in one process (hermeticity holds because
  // the fs-read guard is installed only inside evaluate(), after the snapshot
  // is re-read from disk).
  const snap = await capture();
  // Re-read from disk to prove the snapshot is self-sufficient (the evaluate
  // step reads the snapshot — not the in-memory capture object).
  const fromDisk = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")) as Snapshot;
  evaluate(fromDisk);
  void snap;
}

main().catch((e) => {
  if (e instanceof Error && e.message.startsWith("ac0: HERMETICITY BROKEN")) {
    console.error(e.message);
    process.exit(PROOF_EXIT);
  }
  console.error(e);
  process.exit(1);
});