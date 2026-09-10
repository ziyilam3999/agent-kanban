#!/usr/bin/env node
// AC-0.2 validator for the S0 board-noise-triage shared fixture store.
//
// Usage: node tests/fixtures/task-kind-store/validate.mjs
//
// Asserts (verbatim from the plan's AC-0.2):
//   1. every file under tests/fixtures/task-kind-store/**/*.json parses;
//   2. every fixture ticket id has EXACTLY ONE EXPECTED.json entry (checked both directions: no
//      fixture without an EXPECTED entry, no EXPECTED entry without a fixture — an exact set match,
//      not a floor, per the "floor N is gameable" lesson);
//   3. every prefix in the contract's (docs/task-kind-contract.md §3.2) fallback table has >= 1
//      fixture whose subject matches it;
//   4. >= 1 OPEN fixture (status != completed) has bookkeeping.type == "quarantine-sweep" with an
//      EXPLICIT empty bookkeeping.quarantine_dirs array ([] present, not missing) whose EXPECTED
//      sweepAction is "untouched" (the B1 standing-marker guard).
//
// Additionally (stricter, not a weakening of the above): re-implements resolver steps 1-3 from
// docs/task-kind-contract.md §3.2 (never step 4 -- that post-rule is agent-kanban's board-only
// concern, exercised by S1's own AC, not by this shared contract validator) and cross-checks every
// fixture's EXPECTED.resolvedKind against it, plus checks every EXPECTED.resolvedKind/sweepAction
// value is drawn from the contract's closed enum/vocabulary. This catches an author error in
// EXPECTED.json itself, not just a malformed fixture.
//
// Exit 0 on success. Exit 1 with every failure printed (not just the first) on any assertion miss.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE_ROOT = HERE; // tests/fixtures/task-kind-store/

const KIND_ENUM = new Set(["work", "bookkeeping", "parked", "deferred"]);
const SWEEP_ACTION_VOCAB = new Set([
  "close", "due", "unchecked", "held", "untouched", "refuse", "never", "n/a",
]);

// docs/task-kind-contract.md §3.2 step 2 -- keep this list in lockstep with that doc.
const FALLBACK_PREFIXES = [
  { label: "^RESTORE:", re: /^RESTORE:/, kind: "bookkeeping" },
  { label: "^\\[reversible-op RESTORE\\]", re: /^\[reversible-op RESTORE\]/, kind: "bookkeeping" },
  { label: "^\\[hygiene\\]", re: /^\[hygiene\]/, kind: "bookkeeping" },
  { label: "^\\[SHELVED", re: /^\[SHELVED/, kind: "parked" },
  { label: "^\\[PARKED", re: /^\[PARKED/, kind: "parked" },
];

/** Resolver steps 1-3 only (docs/task-kind-contract.md §3.2). Step 4 is board-only, not part of this
 * shared/universal resolver -- deliberately NOT implemented here. */
function resolveKind(ticket) {
  const kind = ticket?.metadata?.kind;
  if (typeof kind === "string" && KIND_ENUM.has(kind)) return kind;
  const subject = typeof ticket?.subject === "string" ? ticket.subject : "";
  for (const { re, kind: k } of FALLBACK_PREFIXES) {
    if (re.test(subject)) return k;
  }
  return "work";
}

function findJsonFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...findJsonFiles(p));
    } else if (entry.endsWith(".json")) {
      out.push(p);
    }
  }
  return out;
}

const failures = [];
function fail(msg) {
  failures.push(msg);
}

// Discover all EXPECTED.json files (one per session dir) and all ticket fixture files (every other
// *.json under the store).
const allJsonFiles = findJsonFiles(STORE_ROOT);
const expectedFiles = allJsonFiles.filter((p) => p.endsWith("EXPECTED.json"));
const ticketFiles = allJsonFiles.filter((p) => !p.endsWith("EXPECTED.json"));

if (expectedFiles.length === 0) {
  fail(`no EXPECTED.json found under ${STORE_ROOT}`);
}
if (ticketFiles.length === 0) {
  fail(`no ticket fixture *.json found under ${STORE_ROOT}`);
}

// --- Assertion 1: every file parses ---------------------------------------------------------
const parsed = new Map(); // path -> parsed JSON (tickets only)
for (const p of ticketFiles) {
  try {
    parsed.set(p, JSON.parse(readFileSync(p, "utf8")));
  } catch (e) {
    fail(`PARSE: ${p} does not parse as JSON: ${e.message}`);
  }
}

let expected = {};
for (const p of expectedFiles) {
  try {
    const body = JSON.parse(readFileSync(p, "utf8"));
    expected = { ...expected, ...body };
  } catch (e) {
    fail(`PARSE: ${p} does not parse as JSON: ${e.message}`);
  }
}

// --- Assertion 2: exact 1:1 id <-> EXPECTED entry mapping ------------------------------------
const fixtureIds = new Set();
for (const [p, ticket] of parsed.entries()) {
  const id = ticket?.id;
  if (typeof id !== "string" || id.length === 0) {
    fail(`SHAPE: ${p} has no string "id" field`);
    continue;
  }
  if (fixtureIds.has(id)) {
    fail(`DUP-ID: ticket id "${id}" appears in more than one fixture file (path ${p})`);
  }
  fixtureIds.add(id);
}

const expectedIds = new Set(Object.keys(expected));
for (const id of fixtureIds) {
  if (!expectedIds.has(id)) {
    fail(`EXPECTED-MISSING: fixture id "${id}" has no EXPECTED.json entry`);
  }
}
for (const id of expectedIds) {
  if (!fixtureIds.has(id)) {
    fail(`EXPECTED-ORPHAN: EXPECTED.json entry "${id}" has no matching fixture file`);
  }
}

// --- Assertion 3: every fallback-table prefix has >= 1 matching fixture ----------------------
for (const { label, re } of FALLBACK_PREFIXES) {
  const matches = [...parsed.values()].filter(
    (t) => typeof t?.subject === "string" && re.test(t.subject)
  );
  if (matches.length === 0) {
    fail(`PREFIX-COVERAGE: no fixture's subject matches fallback prefix ${label}`);
  }
}

// --- Assertion 4: >= 1 OPEN quarantine-sweep fixture with an EXPLICIT empty quarantine_dirs
//     array whose EXPECTED sweepAction is "untouched" (the B1 guard) --------------------------
const b1Candidates = [...parsed.entries()].filter(([, t]) => {
  if (t?.status === "completed") return false; // must be OPEN
  const bk = t?.metadata?.bookkeeping;
  if (!bk || bk.type !== "quarantine-sweep") return false;
  if (!Array.isArray(bk.quarantine_dirs)) return false; // must be an EXPLICIT array, not missing
  return bk.quarantine_dirs.length === 0; // explicit empty array
});
if (b1Candidates.length === 0) {
  fail(
    "B1-FIXTURE: no OPEN fixture found with bookkeeping.type==\"quarantine-sweep\" and an explicit empty quarantine_dirs array"
  );
} else {
  const withUntouchedExpected = b1Candidates.filter(([, t]) => {
    const e = expected[t.id];
    return e && e.sweepAction === "untouched";
  });
  if (withUntouchedExpected.length === 0) {
    fail(
      `B1-EXPECTED: found ${b1Candidates.length} explicit-empty-quarantine_dirs OPEN fixture(s) but none has EXPECTED sweepAction == "untouched" (ids: ${b1Candidates
        .map(([, t]) => t.id)
        .join(", ")})`
    );
  }
}

// --- Extra (stricter, additive) checks --------------------------------------------------------
// 5. EXPECTED enum/vocab closure.
for (const [id, entry] of Object.entries(expected)) {
  if (!KIND_ENUM.has(entry?.resolvedKind)) {
    fail(`EXPECTED-SHAPE: id "${id}" has resolvedKind "${entry?.resolvedKind}" not in ${[...KIND_ENUM].join("/")}`);
  }
  if (!SWEEP_ACTION_VOCAB.has(entry?.sweepAction)) {
    fail(
      `EXPECTED-SHAPE: id "${id}" has sweepAction "${entry?.sweepAction}" not in ${[...SWEEP_ACTION_VOCAB].join("/")}`
    );
  }
}

// 6. Resolver steps 1-3 cross-check: EXPECTED.resolvedKind must equal what the documented resolver
//    actually computes for each fixture.
for (const [p, ticket] of parsed.entries()) {
  const id = ticket?.id;
  const entry = expected[id];
  if (!entry) continue; // already reported as EXPECTED-MISSING above
  const computed = resolveKind(ticket);
  if (computed !== entry.resolvedKind) {
    fail(
      `RESOLVER-MISMATCH: fixture id "${id}" (${p}) resolves to "${computed}" per docs/task-kind-contract.md §3.2 steps 1-3, but EXPECTED.json says "${entry.resolvedKind}"`
    );
  }
}

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} assertion(s) failed:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `OK: ${fixtureIds.size} fixtures parsed, 1:1 with EXPECTED.json entries; all ${FALLBACK_PREFIXES.length} fallback prefixes covered; B1 empty-array standing-marker fixture present and correctly EXPECTED "untouched"; resolver steps 1-3 cross-check passed for every fixture.`
);
process.exit(0);
