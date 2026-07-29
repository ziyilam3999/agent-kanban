# #1980 — execution review (PR #69, `1980-lanes-wallclock` @ b4c7ea0)

**verdict: PASS**

Execution-review seat, 2026-07-29. Independent: I did NOT author the plan, did NOT author any of the
rounds 1-7 plan reviews, and did NOT write this code. I reviewed the PR branch in a **fresh clone**
checked out at `origin/1980-lanes-wallclock` — never the executor's worktree — so nothing below rests
on the executor's working directory or on the PR body's self-report.

Contract: `.ai-workspace/plans/2026-07-29-1980-lanes-wallclock-crosscheck.md` (AC-0 … AC-7, plus the
passed `## Review (Round 7)` section and its notes N1-N8).

cairn: searched `1980 lanes wallclock`, `punch`, `lanes live`. Load-bearing match, verbatim (T1
2026-07-26): *"Punch-out-gated liveness (board closedAt punch-ins) lies forever for abnormally-dead
agents: SubagentStop is the ONLY closedAt writer, stop_sequence-terminal deaths skip it,
reconcile-spawns never heals closedAt, and the 6h cap re-arms on unrelated touches — measured
2026-07-26: board claimed 9 LANES LIVE, ground truth 2."* Second match (T1 2026-07-28): *"When a
live-data proof keeps growing a new blocker every review round … "* — the round-3-to-6 pattern the r7
redesign closes.

---

## 1. What I ran myself

Every command below was executed by me in the fresh clone at `b4c7ea0`, not read off the PR body.

| check | command | result |
|---|---|---|
| typecheck (AC-7) | `npm run typecheck` | **exit 0** |
| full suite (AC-7) | `npm test` | **exit 0** — 43 suites / 429 tests, all green |
| new contract (AC-1…AC-6) | `npx jest __tests__/lane-open-punch-in-clock.test.ts --verbose` | **exit 0** — 19/19 named fixtures green |
| AC-0 live audit | `npx tsx scripts/ac0-1980-lanes-open-punch-in-clock-audit.ts` | **exit 0, VERDICT: PASS** (live data present — not a skip) |
| AC-0 skip path | `TASKS_DIR=/nonexistent-xyz npx tsx scripts/…-audit.ts` | **exit 75**, `ac0: SKIP — tasks dir not present` |
| anti-vacuity (fixtures vs master) | new test file re-pointed at a temp copy of `origin/master:lib/active.ts` | **9 failed / 10 passed** — every `[master: included]` AC is genuinely RED on master |
| AC-7 "unmodified" probe | `origin/master`'s `lane-inflight-undercount.test.ts` run against the fix | **2 failed** — the fixture migration was NECESSARY, not gratuitous |
| pinned-guard integrity | `sha256` of the other 4 named guard files vs `origin/master` | **byte-identical** |
| privacy | `bash scripts/privacy-scan.sh --working <5 changed paths>` | **CLEAN mode=working size=130168** |
| privacy positive control | same shape, scratch copy + seeded home-path needle | **DIRTY (home-path matches=1)** |
| CI | `gh pr checks 69` | build ubuntu ✔ · build windows ✔ · **privacy ✔** · Vercel ✔ |

### AC-0 — re-derived, not taken on trust

My own run of the audit script (pinned now `2026-07-29T01:19:44.026Z`):

```
captured tickets: 765 (newest session ee426cae)
chainInFlight & OPC-beyond-cap (armed set |A|): 28
OPC age quartiles (h): min=13.31 q1=81.50 median=213.60 q3=274.00 max=465.59
re-armed leg — lit under MASTER: 30 | lit under FIX: 2
(i)  master lights EVERY armed member: PASS
(ii) fix lights ZERO armed members:  PASS
(iii) within-cap lit under both: PASS | LitOnFix⊆LitOnMaster: PASS
(iv) positive control (punch-in→NOW−1min lights under fix): PASS
hermeticity: PASS
VERDICT: PASS
```

The PR body reports `|A| = 29`, `33 lit master / 4 lit fix`, `764 tickets`, `median 110.15h`. Mine
differ. The PR body **pre-declares** exactly this drift ("the lit counts vary ±1 run-to-run because
this very session appends ledger rows while the audit captures — the structural assertions hold
steady"), and my run confirms that: the four structural legs are identical, `|A|` and the max
(465.59h vs 465.07h) match, and the median moves because of the ~100h midpoint gap the r7 reviewer's
N4 already documented. Honest reporting, independently reproduced.

### An extra check the AC does not require

AC-0 (iii)'s `LitOnFix ⊆ LitOnMaster` runs only on the **re-armed** dataset. I ran the same
comparison on the **raw, un-re-armed** snapshot, which the AC never exercises:

```
lit master: 2  (1939 1980)
lit fix   : 2  (1939 1980)
LitOnFix \ LitOnMaster: EMPTY      darkened by the fix: (none)
```

On today's real, untouched data the fix and master agree exactly. No new false-positive class is
introduced, and nothing genuinely lit is darkened. This is the strongest available evidence for
accepted residual (b), and it is stronger than what the AC asked for.

I also independently re-derived residual (b)'s empty-band claim from the snapshot: the two within-cap
lanes sit at **0.10 h and 0.86 h**, the newest dead-armed lane at **13.31 h**. The 6 h cap falls
inside a ~12.4 h band with zero live population. The plan's stated figures (0.14 h / 0.15 h / 9.42 h)
are the r7 reviewer's, ~1 h older; the *claim* reproduces, the *numbers* are perishable.

---

## 2. AC-by-AC grading

- **AC-0 — PASS.** `scripts/ac0-1980-lanes-open-punch-in-clock-audit.ts` exists, is local-only, is
  not in the jest suite, captures once through the real build path, evaluates hermetically, carries
  the distinct SKIP (75) and REFUSE (72) codes, asserts `|A| ≥ 1`, and reports ticket-ids-only. All
  four legs PASS on live data under my own run. The hermeticity guard installs after module load and
  after the snapshot read (N3) and self-tests its own power before trusting itself.
- **AC-1 — PASS.** `AC-1: a recent unrelated punch-OUT (different agent) does NOT re-arm a dead
  chain` → green on the fix, **RED on master**.
- **AC-2 — PASS.** All three `updatedAt` sweeps (`now`, `now−5min`, `now−4h`) → EXCLUDED; all three
  **RED on master**.
- **AC-3 — PASS.** (a) focus grant and (b) 8-minute window both EXCLUDED on the fix, both **RED on
  master**. The N6 attribution caveat is folded into the plan text.
- **AC-4 — PASS.** Dead A + open B → INCLUDED; B close-stamped → EXCLUDED. The second half is **RED
  on master**; the first half passing on master is correct (the plan declares `[master: included in
  both halves]`).
- **AC-5 — PASS.** (a) 5 h silent leg, (b) #1867 pending review, (c) chain-less window work all
  INCLUDED and — correctly — **also green on master** (they are the no-regression pins). (d)'s
  research third case is **RED on master**, as declared.
- **AC-6 — PASS.** (a) all-unparseable → legacy clock, green on both (declared `[master: same]`);
  (b) mixed → parseable governs, **RED on master**.
- **AC-7 — PASS with a documented contract conflict (finding F1).** `npm run typecheck` exit 0,
  `npm test` exit 0. Four of the five named guard suites are byte-identical to `origin/master`;
  `lane-inflight-undercount.test.ts` was modified. See F1 — I proved the modification was necessary
  and intent-preserving.

**Every fixture the plan marks `[master: included]` is genuinely RED on master.** No AC is vacuous.
This is the single most important result in this review and it was measured, not assumed.

---

## 3. Implementation correctness

The mechanism is correct and matches the Behavioral contract.

`openPunchInClock` mirrors `pipelineHasOpenPunchIn`'s per-agentId individuation exactly: it
OR-accumulates `closedAt` per agentId (closed is absorbing), treats an agentId-less row as its own
unit open iff that same row has no `closedAt`, and folds the max parseable `ts` over open units only.
The research branch mirrors `chainInFlight`'s fallback. `parseTs` returns `undefined` on absent or
NaN — never zero, never now — so a degraded row is "no signal", which is what makes AC-6(b) hold and
what stops one bad row from immunising a lane.

`laneCapAgeMs` falls back to `nowMs − updatedAt` only when OPC is UNKNOWN, so R1's byte-identical
legacy behaviour is preserved.

### Monotonicity checklist (#1590)

1. **dead-beyond-cap vs every lit-disjunct.** Stronger = "this lane's own open punch-in is beyond the
   cap ⇒ dark". Weaker = "in-flight" / "is the focus" / "touched within 8 minutes". There are exactly
   **three** `active.add` sites in `computeActiveIds` and the stronger claim is a conjunct at all
   three (`else` on disjunct 1; `!deadBeyondCapIds.has(focus.id) && …` on disjunct 2;
   `!deadBeyondCapIds.has(t.id) && …` on disjunct 3). There is **no `active.delete`** anywhere, and
   `active` is only ever added to — so once a lane is in `deadBeyondCapIds` no later disjunct can
   erase the claim. **Stronger wins on every path. Safe.**
2. **OPC known vs UNKNOWN.** Stronger = "OPC beyond cap ⇒ dark"; weaker = "no parseable `ts` ⇒ legacy
   `updatedAt` clock". The weaker fires only where the stronger has no evidence at all, so it cannot
   overwrite it. **Safe.**
3. **Mixed parseable / unparseable in one ticket.** Stronger = "parseable open evidence governs";
   weaker = "an unknown-age unit reopens the `updatedAt` fallback". The implementation takes the max
   over parseable values and only returns `undefined` when *no* open row parses — the weaker branch
   is unreachable while any parseable open row exists. Pinned by AC-6(b), RED on master. **Stronger
   wins.**
4. **Punched-OUT vs punched-IN agent.** Stronger = "this agentId has a `closedAt` on any row ⇒
   DONE"; weaker = "this agentId has an open-looking row". `openPunchInClock`'s pass 1 OR-accumulates
   `closedAt`, so the closed claim is absorbing and a punched-out agent's recent `ts` can never
   re-arm the lane. The #1682-ghost monotonicity is preserved verbatim, and there is a dedicated test
   for it. **Safe.**
5. **`inFlightIds` vs `deadBeyondCapIds`.** A dead-beyond-cap chain is deliberately still recorded in
   `inFlightIds`. This is correct and load-bearing: `inFlightIds.size === 0` is what unlocks the
   chain-less-rider focus fallback, so removing the dead chain from `inFlightIds` would *widen* the
   fallback and resurrect a re-light path. The two sets are separate claims and neither erases the
   other. **Safe** — and it is the subtle thing a naive implementation would have got wrong.
6. **Held vs everything (#1816).** Untouched. The AC-0 capture copies `onHold` verbatim (N1), so the
   audit cannot silently move held tickets into the population. **Safe.**

### Scope discipline — no violation

Diff touches exactly five paths:

```
.ai-workspace/plans/2026-07-29-1980-lanes-wallclock-crosscheck.md
__tests__/lane-inflight-undercount.test.ts
__tests__/lane-open-punch-in-clock.test.ts
lib/active.ts
scripts/ac0-1980-lanes-open-punch-in-clock-audit.ts
```

Checked against the plan's Non-goals, one by one: **`build-board.ts`** untouched · **`deriveLanes` /
`lib/lanes.ts`** untouched · **components** untouched · **exporter** untouched · **board schema**
untouched · **ledger writers** untouched. Constants verified unchanged at source:
`INFLIGHT_LANE_CAP_MS = 6 * 60 * 60 * 1000`, `ACTIVE_WINDOW_MS = 8 * 60 * 1000`,
`LIVE_WINDOW_MS = 5 * 60 * 1000`; the diff contains no added line touching any of them, and the
session-level `isLive` early-return is unchanged. No #2072 / #2073 fold-in. `computeActiveIds`'
public signature is unchanged.

### UI-task gate — correctly does not apply

Neither `components/` nor `app/globals.css` appears in the diff. The gate's mechanical trigger is a
UI file path in the evidence; it is absent. The plan's own assessment ("if the executor finds itself
editing `components/` or `app/globals.css`, this assessment is void") was not tripped. **Not a
finding.**

---

## 4. Reviewer-note fold-in (N1-N8) — PROVEN, not claimed

I did not take the PR body's "folded in" list on trust. I recovered the **pre-review** plan blob from
the object store (a dangling blob, 24,346 bytes / 146 lines, containing **zero** `verdict: PASS`
occurrences — i.e. the version staged before the round-7 reviewer wrote its section) and diffed it
against the committed 408-line plan.

The diff contains the appended `## Review (Round 7)` section **and exactly six body edits, all of
them the notes**:

| note | landed | evidence in the diff |
|---|---|---|
| N1 exact redaction field list | yes | AC-0 capture bullet now names `Ticket.description` + `Ticket.comments[].artifact` and states every other field — `onHold` explicitly — is verbatim |
| N2 snapshot round-trip fidelity | yes | AC-0 hermetic bullet gains the lossless-serialization sentence |
| N3 instrumentation placement | yes | same bullet: "installed **AFTER module load and AFTER the snapshot read**" |
| N4 distribution not a lone median | yes | PR-body-recording bullet gains "as quartiles **or the full sorted list**"; the script emits both |
| N5 residual (b) measured | yes | Accepted-residuals paragraph gains the measured empty-gap sentence |
| N6 AC-3(b) wording | yes | AC-3(b)'s "via the window disjunct" attribution corrected in place |
| N7 third undercount mechanism | yes | new bullet citing the #1867 `pendingReviewInFlight` mechanism |
| N8 `git add -f` | yes | the plan is in the PR at all, and `.ai-workspace/` is gitignored |

**No other body change.** The Binary AC list is otherwise identical between the reviewed version and
the committed version — no AC weakened, deleted, or rewritten under cover of the fold-in. That was
the specific laundering risk here (the executor committed the contract file in the same commit as the
implementation), and it did not happen.

Chain provenance also checks out independently: the ledger's round-7 `plan-review` row carries
`verdict: PASS`, `self_authored: true`, and an agentId that **resolves to a real subagent transcript
on disk**, timestamped 32 minutes before the executor's completion row. The review section's own
text quotes the *pre*-fold-in wording (e.g. N1 quotes the old "free-text description fields" phrasing
that the committed body no longer contains) — a signature the executor could not have produced by
writing the review after the fact.

---

## 5. Findings (all NON-BLOCKING)

**F1 — AC-7's "unmodified" contradicts the plan's own Scope section; the executor followed Scope, and
did it faithfully.** AC-7 pins five guard suites "unmodified"; Scope §78 says "Existing
`__tests__/lane-*.test.ts` fixtures that lean on the `updatedAt`-keyed cap may need fixture
*timestamps* migrated … preserve every existing test's documented intent — adjust fixtures, never
weaken assertions." `lane-inflight-undercount.test.ts` matches both clauses. I resolved it by
measurement rather than by reading:

- *Necessary?* Yes. `origin/master`'s copy run against the fix **fails 2 tests** (AC-2 and AC-4(b')).
  Both master fixtures paired a **fresh** punch-in `ts` (~2 h) with a **stale** `updatedAt` (7 h) — a
  shape that is a LIVE lane under the new clock and is not realizable in production (the ledger file
  mtime that feeds `updatedAt` is bounded below by its own newest row's `ts`, so OPC ≤ `updatedAt`).
  The fixture, not the guard, was stale.
- *Intent preserved?* Yes, provably. Diffing every `expect` / `it` / `describe` line against master
  yields exactly **one** delta: `expect(7 * 60 * MIN)` → `expect(STALE_MIN * MIN)` where
  `const STALE_MIN = 7 * 60` — arithmetically identical. Every test name, every other assertion, and
  the assertion count are unchanged. In AC-4(b'), the 2 h arm resolves to offsets `130/125/122/120`,
  **byte-identical to master's**; only the 7 h arm moves.
- *Blast radius?* `sha256` confirms `lane-heartbeat-undercount`, `lane-mtime-undercount`,
  `lane-round-reuse-undercount` and `lane-pending-review-visibility` are byte-identical to master.
- *Disclosed?* Yes — the PR body has a dedicated "Fixture migration (intent-preserving)" section that
  states the reason and that assertions are unchanged.

Not blocking. **Action for the plan-owner, not the executor**: AC-7's "unmodified" and Scope §78's
migration licence cannot both be literally true; a future round should say "unmodified *except*
fixture timestamps, assertions and test names byte-identical" so the next executor is not forced to
pick a side.

**F2 — the audit script's armed set adds a gate the AC text does not have.** AC-0 defines
`A = chainInFlight AND OPC age > cap`; the script additionally requires lane-population membership
(`in_progress ∪ shippingAfterPass ∪ pendingReviewInFlight`, minus held). This **narrows** A and is
documented in the script with its reason (a ticket outside the population cannot be lit by any clock,
so it is not "armed" in the operator-visible sense). Strictly more honest than the AC text. Note it
so a future round does not read the two as disagreeing.

**F3 — AC-0 (i) is tautological under master, by construction.** The re-arm sets `updatedAt = NOW` on
every A member, so master's disjunct 1 (`NOW − NOW ≤ cap`) lights all of them regardless. That is
precisely the point being *demonstrated* (one bulk touch re-arms the whole armed set), but (i) is a
demonstration, not a discriminator — the falsification weight sits entirely on (ii), (iii) and (iv).
Worth stating so it is never cited as independent evidence of implementation correctness.

**F4 — the hermeticity guard's positive control proves less than it appears to.** It arms the CJS
`node:fs` exports object and then confirms `cjsFs.readFileSync` throws. That proves the *CJS surface*
is patched; it does not prove an ESM named-import binding held inside the closure would be
intercepted. Immaterial here, because I independently re-verified the structural claim that makes the
guard redundant: `lib/active.ts` imports only a type-only `./board-schema` and a value `./ui-meta`;
`ui-meta` imports only `./board-schema`; `board-schema` imports nothing; and a grep across all three
for `\bfs\b`, `node:`, `readFile`, `statSync`, `process.` and `import(` returns **zero hits**. The
structural argument is the proof; the guard is belt-and-braces. A future round should not upgrade the
guard's status to "the proof".

**F5 — AC-0 (iv)'s control is slightly broader than its spec.** The AC says "move its open punch-in
`ts` to `NOW − 1min`"; the implementation rewrites **every** comment's `ts`, including punched-out
rows. Harmless (closed rows never contribute to OPC, so the resulting OPC is the same), but a
surgical open-rows-only mutation would be a marginally sharper control.

**F6 — the task-1980 ledger will block the completion gate; it is a #2023 dangle, not a path-format
bug (not this PR's defect).** `3role-ledger.mjs check` currently reports
`BLOCK: planner artifact_path … not found (the plan file); plan-review artifact_path … not found`.
I initially read the `plan-review` row's leading `~` as the fault — it is not: the ledger tool writes
that tilde form itself (it normalized my own absolute `--artifact` argument into the same shape, and
`check` resolves my row fine). The real cause is that **the plan file does not exist at that path in
the primary clone** — it lives only in the executor's worktree and on the PR branch, because
`.ai-workspace/` is gitignored and the plan was force-added straight into the PR commit. The
`planner` row additionally stores a repo-relative path, which cannot resolve from the ai-brain
working directory at all. Both clear the moment PR #69 merges and the primary clone pulls; until
then the orchestrator should either merge first or repoint those two rows. Nothing to fix inside
PR #69. (My own row was written to a path that exists in the primary clone precisely so it does not
join this class.)

**F7 — the plan's residual-(b) figures are perishable.** The committed plan states "the two live
chains sit at 0.14 h and 0.15 h while the newest dead armed chain is at 9.42 h". At my measurement
those are 0.10 h / 0.86 h and 13.31 h. The structural claim (an empty band straddling the 6 h cap)
reproduces on my data; the specific numbers are wall-clock-dependent and should be read as
"measured at r7", not as invariants.

---

## 6. privacy-scan

Canonical `--working` invocation per `docs/privacy-scan-invocation-contract.md`, run AFTER this file
was written so it covers my own prose, not only the diff.

- **Paths scanned (diff, 5)**: `lib/active.ts`,
  `scripts/ac0-1980-lanes-open-punch-in-clock-audit.ts`,
  `__tests__/lane-open-punch-in-clock.test.ts`, `__tests__/lane-inflight-undercount.test.ts`,
  `.ai-workspace/plans/2026-07-29-1980-lanes-wallclock-crosscheck.md`.
  **Scanner's own verdict line**: `privacy-scan: CLEAN mode=working size=130168` — non-zero size, so
  this scanned real content, not nothing.
- **Path scanned (PR body)**: the rendered PR #69 body. **Verdict line**:
  `privacy-scan: CLEAN mode=working size=7631`.
- **Path scanned (this review file)**: `.ai-workspace/reviews/2026-07-29-1980-execution-review.md`.
  **Verdict line**: `privacy-scan: CLEAN mode=working size=23243`. A second positive control run
  against a scratch copy of *this file* with a home-path needle appended returned
  `privacy-scan: DIRTY (home-path matches=1, brand matches=0, email matches=0)`, so the CLEAN on my
  own prose is evidence too. This file is deliberately written with repo-relative paths only, because
  the repo's CI privacy leg fails the build on a home path in any tracked non-test file — a review
  that ships home paths would itself break the gate it is certifying.
- **Positive control**: the identical invocation shape against a scratch copy of `lib/active.ts` with
  one home-path needle appended returned `privacy-scan: DIRTY (home-path matches=1, brand matches=0,
  email matches=0)`. The instrument has demonstrated power against this artifact's own match class,
  so the CLEAN results above are evidence, not assertions.
- **CI privacy leg is NOT vacuous** (the #1457 concern, checked explicitly): `.github/workflows/ci.yml`'s
  `privacy` job wraps each `git grep` in a `fail_closed_grep` helper that treats rc 0 as "forbidden
  content found → fail", rc ≥ 2 as "the check could not RUN → fail closed", and only rc 1 as clean.
  It also carries the #1981 blob-hostname class with the same rc discipline. It is green on this PR
  because the tree is clean, not because the check is a no-op.

---

## 7. Verdict rationale

The mechanism is right, and it is right for the reason the plan gives: the cap now reads the lane's
own open punch-in, and "dead-beyond-cap" is a conjunct at all three lit-disjuncts with no delete path
that could erase it. Every AC is falsifiable and every `[master: included]` fixture is genuinely RED
on master — I ran that experiment rather than trusting the labels. AC-0 runs on real production data
under my own hand and passes all four legs, with an armed population of 28 and a counterfactual
re-arm that lights 30 under master and 2 under the fix. The direction guard holds on the raw
un-re-armed snapshot as well as the re-armed one, which the AC did not even require. Scope is clean
against every Non-goal, the constants are untouched, the UI gate correctly does not apply, and the
privacy surface is clean with a control that proves the instrument has power. The reviewer notes were
folded in for real — proven by diffing the pre-review plan blob, which also proves no AC was quietly
weakened in the same commit.

One contract conflict exists (F1) and the executor resolved it the defensible way, disclosed it, and
did not weaken a single assertion doing so — I verified that line by line and by hash. Six further
findings are documentation-and-hygiene grade. None is blocking.

**PASS.**
