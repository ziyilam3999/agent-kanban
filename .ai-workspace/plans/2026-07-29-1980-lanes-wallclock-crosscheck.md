# #1980 — LANES LIVE: bind the dead-lane cap to the lane's OWN open punch-in, and close the two uncapped re-light paths

- **Task**: 1980 ([BUG][agent-kanban][#1852 sibling, new mechanism]) — status `in_progress`
- **Date**: r7 2026-07-29 (planner round 7; see `## Relationship to rounds 1-6` — supersedes the untracked r6 draft)
- **Branch**: `1980-lanes-wallclock` (off `origin/master` @ 879cffa)
- **Surface**: `lib/active.ts` (pure module) + jest fixtures + ONE new local-only audit script. No component, exporter or schema change — `deriveLanes` and the "N LANES LIVE" pill both derive from `computeActiveIds`' returned set (`lib/lanes.ts:67`, `components/BoardView.tsx:217`), so they inherit the fix for free.

cairn: hits on `punch`, `lane liveness`, `LANES LIVE`, `wall clock`; zero hits on `zombie`. Load-bearing match, verbatim (T1 2026-07-26): *"Punch-out-gated liveness (board closedAt punch-ins) lies forever for abnormally-dead agents: SubagentStop is the ONLY closedAt writer, stop_sequence-terminal deaths skip it, reconcile-spawns never heals closedAt, and the 6h cap re-arms on unrelated touches — measured 2026-07-26: board claimed 9 LANES LIVE, ground truth 2."* Second match, verbatim (T1 2026-07-23), which governs the scope split below: *"Board 'N LANES LIVE' keys off 3-role-ledger FILE mtime in an 8-min window, NOT actual subagent running-state. A dropped spawn-ledger row makes an IN-FLIGHT lane INVISIBLE (file only written at completion self-append) while a JUST-FINISHED lane still counts 'live' (fresh completion write). ... the numbers legitimately disagree in BOTH directions. ... Underlying fix = #1229 reconcile-spawns backfill."*

## Execution model

**subagent (delegate)** — 3-role chain: this plan → independent plan-review → `cc-executor` in this existing worktree → independent execution-review. Rationale: an architectural decision (which timestamp is the liveness clock, and which disjuncts it binds), >10 LOC across `lib/active.ts` + a new test file + fixture migrations + a new audit script, guarding the operator's primary trust surface. Fully briefable as one coherent surface ⇒ no inline carve-out (knob-A `delegate`, knob-B `both`: jest oracle + independent reviewer). **This is round 7 of a contested ticket — the plan-review leg is not optional and must be a fresh, independent reviewer.**

---

## Relationship to rounds 1-6 (read this before reviewing)

A prior planner took this ticket through six revisions against six independent plan-review rounds. That draft is **untracked** and lives outside this worktree; it never reached PASS. Its record is honored here:

- **The MECHANISM has been confirmed sound since r2** and was independently re-verified by rounds 3, 4, 5 and 6. This plan carries it forward unchanged (the "open punch-in clock" below is r2's OPC, including per-agent `closedAt`-aware individuation and the mixed/unparseable fail-direction rules).
- **Every blocker from rounds 2-6 (B1-B7) landed on AC-0's PROOF apparatus, never on the fix.** Round 6 returned NEEDS-WORK on a single blocker, B7, about whether a "poison-canary" control had census-independent power.
- **r7 does not patch B7 — it removes the apparatus that generated it.** Rounds 3-6 each closed one hole in a proof that re-ran `lib/build-board.ts` inside the evaluation step; because that build path performs filesystem reads (`readArtifactHead`, `statSync`), each round had to prove those reads inert, and each proof grew a new hole. **`computeActiveIds` does not need the build path at all.** Its entire import closure — `lib/active.ts` → `lib/ui-meta.ts` → `lib/board-schema.ts` — contains zero `fs`, `require` or `process.env` references (verified at source 2026-07-29). Snapshotting the **built `Ticket[]`** instead of the raw rows makes evaluation filesystem-free *by construction*, so B7, the poison canary, the sentinel rewrite, the round-trip fidelity control and the fingerprint carve-out all cease to have a subject. This is the "stop patching, redesign" call after five same-class rounds; it is a planner decision, it has **not** been reviewed, and round 7 must adjudicate it.
- Context for that call: `git log` shows this one surface has taken ten successive targeted patches — #1295 → #1305 → #1317 → #1403/#1405 → #1449 → #1791 → #1852 → #1867 → #1901 → #1980 — each narrowing a different false-positive or false-negative without a redesign.

---

## Intent (what + why — never how)

**What**: a lane must stop counting as live when the only evidence arguing it is alive — its own still-open punch-in — is itself older than the dead-lane cap. No path may re-light such a lane, and no *other* activity (a different agent's rows, orchestrator notes, sweeps, bulk file touches) may extend its life.

**Why — measured on live production data 2026-07-29** (98 in-progress tickets, current session):

| quantity | value |
|---|---|
| in-progress, not held | 98 |
| `chainInFlight` | 31 |
| lit by current code | 2 (both genuinely live — open punch-ins ~0.13h old) |
| **in-flight chains whose open punch-in is beyond the 6h cap** | **28** |
| those chains' open-punch-in age | min 9.1h · median 212h (8.8 days) · max 464h (19 days) |

Those 28 chains are agents that died without a `closedAt` (the only writer is SubagentStop; abnormal terminations skip it). They are **dark right now purely by accident** — nothing has touched their files in six hours. Two defects, one contract:

1. **The cap's clock reads the wrong signal.** The cap is `nowMs - t.updatedAt` (`lib/active.ts:343`), and `updatedAt = Math.max(task-file mtime, ledger-file mtime)` (`lib/build-board.ts:347`). It therefore measures *activity by anyone on the ticket* — a sweep, a status flip, another agent's row, a reconcile pass — not activity by the agent whose punch-in is the thing claiming liveness. **A single bulk touch across those 28 files re-arms all 28 at once.** That is the recorded 2026-07-26 incident (9 lit, ~2 real). The `:38-41` F4 caveat ("bounded and rare, accepted") is falsified by the measurement above: the armed population is 28 and grows with every abnormally-terminated agent.
2. **Two of the three disjuncts have no cap at all.** `:342` adds a `chainInFlight` ticket to `inFlightIds` *unconditionally* — the cap gates only `active.add` on `:343`. The focus disjunct then re-lights it with no time bound (`:363`, `inFlightIds.has(focus.id)`), and the 8-minute window disjunct is a second uncapped re-light path (`:372`). A chain dead 19 days that happens to be max-`updatedAt` is lit regardless of the cap.

**Why it matters**: the headline liveness pill is the one number the operator glances at to detect stalls. A pill reading "9 live" when 2 are real hides exactly the silent-freeze class the board exists to expose.

## ELI5

The board has a row of lights, one per worker, meaning "this worker is on the floor right now". Workers punch IN when they start; workers whose shift crashes never punch OUT. Today a light stays on as long as *anything* on that worker's job folder was touched recently — and clerks, auditors and nightly sweeps scribble on folders constantly. So a worker who vanished last week still gets a glowing light because someone filed paperwork about them an hour ago.

We counted the real rack today: 28 punch-cards are still sticking out for workers who left between 9 hours and 19 days ago. All 28 lights happen to be off this second — but only because nobody touched those folders lately. One filing sweep and all 28 light up at once, which is exactly what happened on the 26th when the board claimed 9 workers were in and only 2 were.

The fix: a light may only stay on while the *un-punched-out punch-card itself* was stamped within the last 6 hours — the worker's own card, not the folder, not anybody else's paperwork. If a second worker genuinely punches in on the same job, the light rightly stays on for them. And two side doors that could switch a light back on without checking the clock at all ("this is the most recently touched job" and "this job was touched in the last 8 minutes") get the same clock check.

To prove it, we don't wait around hoping to catch a stale light glowing. We photograph today's real rack, then *simulate the filing sweep* on all 28 dead cards — the exact thing that triggers the bug — and check that the old rule lights all 28 while the new rule lights none, and that both rules still light the workers who are genuinely in.

## Behavioral contract (the outcome the executor must make true)

Define, per ticket, the **open punch-in clock (OPC)** = the newest parseable `ts` among the rows that constitute the ticket's CURRENT open in-flight evidence — exactly the rows whose existence makes `chainInFlight` true:

- **Pipeline branch**: for each still-punched-IN pipeline agent (per-agent and `closedAt`-aware, reusing `pipelineHasOpenPunchIn`'s existing individuation verbatim — an agentId with ≥1 pipeline row and no `closedAt` on any of its rows; each agentId-less open row is its own unit), that unit's own parseable row `ts` values.
- **Research branch** (research-only tickets): each still-OPEN research row's parseable `ts`.

Rows from punched-OUT agents, orchestrator/free-form roles, `closedAt` values and file mtimes NEVER contribute to OPC. If SOME open-evidence rows carry a parseable `ts` and others do not, the parseable ones govern. If NO open-evidence row carries a parseable `ts`, OPC is UNKNOWN.

- **R1 — cap clock**: wherever the dead-lane cap bounds an in-flight lane it reads `nowMs − OPC` when OPC is known. `updatedAt` may then move freely, any agent may punch out, and any non-evidence row may land, without ever extending an in-flight lane's life. When OPC is UNKNOWN the cap falls back to today's `updatedAt` clock — byte-identical legacy behaviour, mirroring the module's existing agentId-less back-compat doctrine.
- **R2 — conjunction on every path**: a ticket whose chain is in-flight but whose OPC exceeds the cap appears in NO returned active set — not via the in-flight disjunct, not via the unconditional focus grant, not via the 8-minute window. Chain evidence saying *dead-beyond-cap* beats recency, the same precedence #1852 established for evidence-beats-recency on the focus disjunct.
- **R3 — non-regression**: everything whose open punch-in evidence is within the cap behaves exactly as today. Specifically preserved: long silent executor legs (a 5h-open punch-in stays lit); #1867 pending-review lanes; #1516 research instant-dark on `closedAt`; #1852 punched-out instant-dark and its cap-immunity; #1816 held-ticket exclusion; #1791 fresh-round supersession; #1901 zero-ledger planner behaviour; PASS-complete instant-dark; chain-less riders' focus/window behaviour; `computeActiveIds`' public signature.

**Accepted residuals** (weighed, not missed): (a) the cap VALUE stays 6h — this ticket changes the clock, not the magnitude, so a lane dead <6h still shows live until its OPC ages out; (b) a genuinely-alive silent leg longer than the cap now darkens at cap age — this is the cap finally meaning what its own doc comment always claimed ("time since its last observable event" *of the chain itself*); previously such legs were kept lit only by incidental touches, i.e. by the bug. **This residual is MEASURED, not merely weighed (N5)**: on 2026-07-29 the two live chains sit at 0.14h and 0.15h while the newest dead armed chain is at 9.42h, so the 6h cap falls inside a real ~9.27-hour empty gap with ZERO live population in that band — no genuinely-alive leg is darkened by this change; (c) a still-open agent's NEWEST same-role row can still be re-stamped by routine ledger bookkeeping, and a backfill carrying a new `agentId` can still mint a fresh open row — both generator-side (ai-brain), tracked as #1858, and the remaining board-side spoof surface. Superseded (non-last) rows retain their values and can never be re-armed, which is the frozen-history class the measured incident is actually made of.

## Scope

- `lib/active.ts` — both defects. The F4 caveat comment at `:38-41` must not survive the change it excuses.
- A new jest file pinning the contract (AC-1…AC-6).
- ONE new local-only audit script for AC-0. Not part of the jest suite; exits with a distinct SKIP code when the live data directories are absent, so CI is untouched (synced-smoke-must-skip-not-fail doctrine).
- Existing `__tests__/lane-*.test.ts` fixtures that lean on the `updatedAt`-keyed cap may need fixture *timestamps* migrated (give open punch-in rows genuine `ts` values). **Guardrail: preserve every existing test's documented intent — adjust fixtures, never weaken assertions.** The only assertions that may legitimately flip are ones pinning the F4 caveat itself.

## Non-goals

- No change to the cap value (6h), `ACTIVE_WINDOW_MS`, `LIVE_WINDOW_MS`, or the session-level `isLive` gate.
- No change to `deriveLanes`, components, exporter, board schema, or any ledger writer.
- No new liveness mechanism (no process probes, no heartbeat schema field).
- The 8-minute window stays for chain-less tickets exactly as documented — recency is inline (non-3-role) work's only signal.

## Two premises in the ticket text that do NOT survive verification

Stated explicitly because the filed ticket offers them as AC candidates, so a reviewer will otherwise expect them:

1. **"The swimlane surface gains the same wall-clock cross-check the card list already has."** The card list's #1449 signal is `sessionLastActive` — the owning **session's** `lastActive` epoch (`lib/ui-meta.ts:323-333`, `:405-408`; supplied per-card from `currentSession?.lastActive`, `components/BoardView.tsx:388`). It is a **per-session constant**: identical for all 98 cards in one live session. It therefore cannot discriminate one lane from another *within* a live session, which is the entire failure mode here — it would darken all lanes at once or none. It is not the fix. (The lane surface already carries a session-level gate: `computeActiveIds` returns empty when `!isLive`, `lib/active.ts:304`.)
2. **A narrower, real defect hides behind that premise, and is split out rather than folded in.** The lane gate reads `isLive = !!currentSession?.live` (`components/BoardView.tsx:169`) — a **server-provided boolean** — whereas #1449 deliberately derives liveness from the client-side epoch precisely because "a server-side decay would freeze exactly when an orchestrator dies" (`lib/ui-meta.ts:321`, `:332-333`). On a frozen snapshot the lane surface keeps believing the session is live. That is a genuine #1449-parity gap, it lives in a **component**, and it triggers the UI-task gate — so it is a separate ticket.

## The operator's reported symptom is the OPPOSITE direction — split, do not conflate

The live report that triggered this round was **"1 LANE LIVE, the parallel lanes should be 3"** — an **undercount**. #1980 as filed, and this plan, fix an **overcount**. A correct #1980 makes the count go DOWN; it cannot raise 1 to 3 and must not be shipped as an answer to that complaint.

Two independent lines of evidence place the undercount outside this file:

- **Measured 2026-07-29** (same probe as the Why table): the lane math currently computes **2 lit, both with open punch-ins ~8 minutes old**, and **zero** tickets have a genuinely-fresh open punch-in while being dark. No undercount is reproducible in `lib/active.ts` at measurement time.
- **The cairn stone quoted above names the actual mechanism**: *"A dropped spawn-ledger row makes an IN-FLIGHT lane INVISIBLE (file only written at completion self-append)"* — a lane that never got its spawn-time row is invisible to the board no matter what `computeActiveIds` does, and the stone's own named remedy is **#1229 reconcile-spawns backfill**, not this file.
- **A THIRD, already-fixed board-side undercount mechanism (N7)** sits alongside these two (so the "two lines" framing is not exhaustive): cairn T1 2026-07-25 records that a PENDING execution-review moves the ticket to `in_review` and OUT of the lane population, so the genuinely-running reviewer was invisible — the #1867 recurring "1-LANE-LIVE" class. It is already fixed board-side (`pendingReviewInFlight`, `active.ts:229`) and is defended by this plan (AC-5(b), AC-7's `lane-pending-review-visibility`); the only remaining live undercount mechanism is the #2072 spawn-ledger row above.

This plan's AC-0 direction-guard (AC-0 iii/iv) exists so that #1980 cannot silently make an undercount worse.

## Deferred-follow-ups:

- **Undercount ticket** — "1 LANE LIVE while ≥3 dispatches concurrently active": diagnose against the spawn-ledger row-write path, #1229 reconcile-spawns backfill, and the exported board artifact — NOT `lib/active.ts`. → **file now**; likely higher operator priority than #1980 itself, since it is the live complaint.
- **Freeze-safe session gate** — bring the lane surface's `isLive` to #1449 parity (client-derived epoch, not the server `live` boolean). Component surface ⇒ the UI-task gate's two legs apply. → **file now**.
- **#1858 (ai-brain), PRIMARY upstream sibling** — generator-side `closedAt` healing for abnormally-dead agents, plus the backfill/re-stamp vectors in residual (c). After this board-side fix that is the only remaining board-side blind spot; it is the other half of this incident. → already tracked as #1858.
- **#1859 (ai-brain), forward pointer only** — the same stale-mtime-as-liveness-proxy pattern gates a *different* decision (whether to launch a 2nd lane) in `hooks/sole-lane-parallelization-gate.sh`'s `live_lane_count`. Port whatever event-based signal lands here into that gate NEXT. Explicitly **not** in this plan's scope. → already tracked as #1859.
- **Cap-value recalibration** — is 6h right once it cannot re-arm? → file-when-triggered, only if post-ship observation shows the operator misled in practice.

## UI-task gate — assessed, and it does not apply (Rule 13)

This change alters what the "N LANES LIVE" pill *counts*, which is user-visible, so the gate is assessed rather than skipped silently. It does **not** apply: the diff touches `lib/active.ts` and `__tests__/` only — no component, no CSS, no new visual element, no layout or styling change. The gate's mechanical trigger is a UI **file path** in the evidence, which this diff does not contain; and its two legs (a design POV, a vision-judged screenshot verdict) have nothing to judge, because no rendered element changes shape or colour — only an integer's value changes, and its correctness is pinned by AC-0 and the jest suite, a strictly stronger oracle than a vision judge for this class. **If the executor finds itself editing `components/` or `app/globals.css`, this assessment is void and both legs are required.**

### Binary AC

All checkable from outside the diff. "master:" states the expected baseline so the delta is explicit.

- **AC-0 (Rule 18 — live production data, counterfactual re-arm).** A local-only audit script, two steps, distinct SKIP exit when the live data dirs are absent.
  - **Capture (ONE pass)**: read the live task + ledger dirs exactly once into memory; from that one dataset build the `Ticket[]` through the repo's real build path and write ONE snapshot file containing the built tickets, a pinned `NOW_MS` and the session id. At capture the **only** redacted fields are `Ticket.description` and `Ticket.comments[].artifact` (the only fields the consumed closure never reads and that can carry home paths) — every other field, including the output-relevant `onHold` (which drives `isHeld` → lane-population exclusion), is copied **verbatim**. Blanking `onHold` would silently move held tickets INTO the population and inflate the armed set in the wrong direction. (`build-board.ts` already redacts `description`/`onHold`/`artifact` basename/`verdict` in the production build path, so this capture-time pass is belt-and-braces, not the only defense.)
  - **Hermetic evaluation, structurally**: the evaluate step reads the snapshot and calls the exported `computeActiveIds`. It never invokes the build path, so no filesystem read exists to police. **Proof**: the evaluate leg installs the process's file-read-primitive guard to throw on ANY file read, and must still produce its answer. The guard is installed **AFTER module load and AFTER the snapshot read** (a `tsx`/ESM process reads files to load modules at all; instrumenting before imports bricks the script) — installed at that point, no "other than the snapshot" carve-out is needed (the snapshot is already in memory). This fails on ANY live read, enumerated or not, with no dependence on what happens to exist on disk. The serialize → `JSON.stringify` → `JSON.parse` boundary the redesign introduces is **lossless** (N2): every `Ticket` / `LedgerComment` field is `string` / `number` / `string[]` / optional-string, `toComment` assigns optional fields only when truthy (so "absent" survives as "absent"), and the documented NaN-`ts` tolerance is a `Date.parse` concern, never a serialization one — no `Date` object, no `NaN` number, no `undefined`-vs-missing distinction any consumed predicate can observe.
  - **Armed set**: A = tickets that are `chainInFlight` AND whose OPC age exceeds the cap. **Assert |A| ≥ 1** — a structural population (28 at 2026-07-29), not a momentary witness. If A is empty the script refuses with a distinct code rather than passing.
  - **(i) False-positive reproduction on real data**: re-arm every member of A by setting its `updatedAt` to `NOW_MS` — the exact effect of the bulk touch this bug turns on — and evaluate under **master**: **every** member of A is lit. This is the operator-class overcount, reproduced deterministically on production chain shapes rather than waited for.
  - **(ii) The fix removes them**: same snapshot, same pinned now, same re-arm, evaluated under the fix: **zero** members of A are lit.
  - **(iii) Direction guard — the fix has not merely darkened everything**: every ticket whose OPC age is within the cap is lit under BOTH master and the fix; and `LitOnFix ⊆ LitOnMaster`.
  - **(iv) Positive control — the new clock has power in the LIT direction too**: take one member of A, move its open punch-in `ts` to `NOW_MS − 1min` (leaving `updatedAt` untouched); it becomes lit **under the fix**. A darken-everything implementation fails this.
  - Recorded in the PR body: |A|, the OPC age distribution (as quartiles **or the full sorted list** — a lone median is index-unstable ~2× on this population shape, where a single added member shifts `sorted[floor(n/2)]` across a ~100h gap, N4), both legs' lit counts, the pinned now. Ticket ids only — no agentIds, no artifact paths, no home paths. The snapshot file is gitignored and never committed.
- **AC-1 (re-arm killed)**: in-progress ticket, open executor punch-in `ts = now−7h`, PLUS a punched-out row from a *different* agent with `ts` and `closedAt = now−10min`, `updatedAt = now−10min` → EXCLUDED. Kills both re-arm vectors in one fixture. [master: included]
- **AC-2 (monotone death)**: same chain, `updatedAt` swept across {now, now−5min, now−4h} → EXCLUDED in all three. [master: included in all three]
- **AC-3 (both uncapped re-light paths closed)**: (a) the same dead chain as the max-`updatedAt` in-progress ticket alongside one other in-progress ticket → EXCLUDED [master: included via the unconditional focus grant]; (b) the same dead chain with `updatedAt = now`, inside the 8-minute window → EXCLUDED [master: included — note (N6) master actually lights this via disjunct 1 too since `updatedAt = now`; the load-bearing assertion is the fix-side EXCLUDED, which a partial fix that closes only disjuncts 1 + 2 (omitting the window disjunct) still fails].
- **AC-4 (a second live agent is truth, not re-arming)**: dead agent A open punch-in `ts = now−7h` PLUS open agent B punch-in `ts = now−30min` → INCLUDED; then B's rows close-stamped → EXCLUDED. [master: included in both halves]
- **AC-5 (no regression)**: (a) open punch-in `ts = now−5h`, `updatedAt = now−5h` → INCLUDED (long silent executor leg); (b) `in_review`+`in_progress` pending-review ticket, open reviewer punch-in `ts = now−30min` → INCLUDED (#1867); (c) chain-less ticket, zero comments, `updatedAt = now` → INCLUDED (window/focus unchanged for inline work); (d) research-only lane: open research row `ts = now−30min` → INCLUDED, `closedAt` stamped → EXCLUDED instantly, open research row `ts = now−7h` with `updatedAt = now` → EXCLUDED. [master: (a)-(c) included and must stay so]
- **AC-6 (degraded-timestamp edges)**: (a) open punch-in rows ALL carrying unparseable `ts`: `updatedAt = now−1h` → INCLUDED, `updatedAt = now−7h` → EXCLUDED (OPC UNKNOWN ⇒ byte-identical legacy clock) [master: same]; (b) mixed — one open unit with unparseable `ts` alongside an open unit with parseable `ts = now−7h`, `updatedAt = now` → EXCLUDED (parseable evidence governs; an unknown-age unit must not re-open the `updatedAt` fallback, or a single degraded row would immunise a lane against ever darkening) [master: included].
- **AC-7 (whole system holds)**: `npm run typecheck` exits 0 AND `npm test` exits 0 — **including `lane-heartbeat-undercount`, `lane-inflight-undercount`, `lane-mtime-undercount`, `lane-round-reuse-undercount` and `lane-pending-review-visibility`, unmodified**. Those are the codebase's standing guard against the opposite-direction regression and the cheapest external check that this darkening fix has not overshot. [master: green today; must stay green]

Verifier for AC-1…AC-6: the new jest file, exit 0 post-fix. "Open punch-in" = a pipeline-role comment with an `agentId` and no `closedAt`. Session live throughout unless stated.

## Executor notes (intent-level)

- **Run AC-0 first.** If any fixture AC marked "[master: included]" already passes on master, STOP and report — the defect model, not the AC, is what must be corrected.
- Stop-and-report rather than falling back to fixtures-only green if: the armed set A comes back empty; the master leg fails to light a re-armed member of A; or the hermeticity proof fails (a live read survives somewhere).
- `Ticket.comments` arrive oldest-first with documented NaN-`ts` tolerance (see `chainInFlight`'s header) — the OPC fold must never throw on an absent or NaN `ts`. AC-6 is the witness.
- **`.ai-workspace/` is gitignored (`.gitignore:18`)** — shipping this plan with the PR needs `git add -f`, and the privacy scan runs BEFORE the force-add (gate what ships, not what you happened to grep). A plain `git add` silently ships a PR with no plan.
- The audit script's stdout is a public-PR-safe surface: ticket ids, ages, counts only.

---

## Review (Round 7)

**verdict: PASS**

Plan-review, round 7, 2026-07-29. Fresh independent reviewer: did NOT author this plan and did NOT
author any of the rounds 1-6 reviews. Every load-bearing claim below was re-derived from source
(`lib/active.ts`, `lib/ui-meta.ts`, `lib/board-schema.ts`, `lib/build-board.ts`, `lib/lanes.ts`,
`components/BoardView.tsx`, `scripts/export-board.ts`) or from an independent live measurement I ran
myself. Nothing in the plan's prose was taken on trust.

cairn: hits on `lanes live`, `punch`, `wall clock`. Both stones the plan quotes exist verbatim in T1
(2026-07-26 punch-out-gated-liveness; 2026-07-23 ledger-mtime-in-both-directions). One further
relevant stone the plan does not cite — see N7.

### The four contested claims — independently re-verified

**Claim 1 (the filed symptom and the root cause point in opposite directions) — VERIFIED, and the
plan stays honest about it.** §94-103 states outright that a correct #1980 makes the count go DOWN
and "must not be shipped as an answer to that complaint." The AC backs the prose rather than merely
asserting it: AC-0 (iii) is a `LitOnFix ⊆ LitOnMaster` direction guard, AC-0 (iv) is a positive
control in the LIT direction, and AC-7 pins `lane-heartbeat-undercount`, `lane-inflight-undercount`,
`lane-mtime-undercount`, `lane-round-reuse-undercount` and `lane-pending-review-visibility`
**unmodified** — all five files exist, and I ran the suite on this branch: **42 suites / 410 tests,
all green**, so AC-7's "[master: green today]" baseline is real. Both follow-on tickets are already
FILED (#2072 undercount, #2073 freeze-safe session gate — both present and `pending`), so those
bullets are not phantom forward references. My own measurement (below) independently reproduces the
plan's finding: **zero** in-flight tickets have a within-cap OPC while being dark. No undercount is
reproducible in `lib/active.ts` at measurement time.

**Claim 2 (the ticket's AC candidate #1 is refuted) — VERIFIED at source.** `components/BoardView.tsx:388`
passes `sessionLastActive={currentSession?.lastActive}` to **every** card in the render loop — one
value for the whole session, so it is structurally incapable of discriminating lane-from-lane inside
a live session. `lib/ui-meta.ts:323-333` and `:405-408` confirm the semantic (STALE is a conjunction
gated on `nowMs - sessionLastActive > LIVE_WINDOW_MS`). The refutation is correct and rests on the
right reason. The split-out defect is also real: `BoardView.tsx:169` is
`const isLive = !!currentSession?.live` — a server-provided boolean — against `ui-meta.ts:321`'s
explicit "a server-side decay would freeze exactly when an orchestrator dies." Component surface ⇒
UI-task gate applies ⇒ a separate ticket is the correct call, not scope-avoidance.

**Claim 3 (the live measurement) — REPRODUCED independently.** I ran the repo's REAL export path
over the live dirs and called the REAL exported `computeActiveIds`, then recomputed OPC from the
plan's own Behavioral-contract definition:

| quantity | plan (r7) | my independent re-measure |
|---|---|---|
| `chainInFlight` | 31 | **31** (exact) |
| lit by current code | 2 | **2** (exact) |
| in-flight chains with OPC beyond the 6h cap | 28 | **29** |
| min OPC age | 9.1 h | 9.34 h |
| max OPC age | 464 h | 464.45 h |
| in-flight tickets with UNKNOWN OPC | — | **0** |
| in-flight tickets with within-cap OPC but DARK | 0 | **0** |

And the decisive one, run as a counterfactual rather than taken on trust: setting `updatedAt = NOW`
on every armed member and re-evaluating **master** lights **29 of 29**. AC-0 (i) reproduces on
today's real data, deterministically. Order of magnitude is confirmed on every figure; the one
number that does not reproduce is the median, and it is an index artifact — see N4.

**Claim 4 (the unreviewed redesign call) — ADJUDICATED: the redesign is correct, and it dissolves B7
rather than relocating it.**

(a) *The import closure is fs-free — verified by my own grep, not the plan's.* `lib/active.ts`
imports exactly two modules: a **type-only** import of `./board-schema` and a value import of
`./ui-meta`. `lib/ui-meta.ts` imports only `./board-schema`. `lib/board-schema.ts` imports
**nothing** (its own header says so: "board-schema has no runtime imports"). A grep across all three
for `\bfs\b`, `node:`, `readFile`, `statSync`, `import(` and `process.` returns **zero hits**. The
claim holds, including against the dynamic-import escape the plan does not mention.

(b) *B7 is dissolved, not relocated.* B7 — and B6, B5, B4, B3 before it — are all controls policing
`lib/build-board.ts`'s filesystem reads (`readArtifactHead` via `resolveVerdict`, and the
`statSync`-derived mtimes) **inside the evaluation step**. The poison canary exists specifically to
give the artifact-PRESENCE dimension census-independent power. Remove `build-board.ts` from
evaluation and that dimension has no subject: no `readArtifactHead` to fire, no artifact path to
poison, no absence/presence pair to cover. I tried to construct a residual instance of the class
against the r7 shape and could not — the evaluate step is a function call over an in-memory
`Ticket[]` whose entire transitive code closure provably cannot touch a file. This is a genuine
class-closure, and the right response to five same-class rounds.

(c) *Snapshotting `Ticket[]` is a SOUND methodology and does not bypass the code path that matters* —
but the plan omits the reason that makes it airtight: **the fix's Scope excludes `build-board.ts`
entirely** (Scope names `lib/active.ts`, tests and the audit script; Non-goals excludes the exporter
and board schema), so `build-board.ts` is byte-identical code on the master leg and the fix leg.
Running it inside evaluation would therefore produce the *same* `Ticket[]` on both legs by
construction. Factoring it out to capture time cannot change the value of the differential AC-0
measures. The methodology hides nothing, because the only thing it removes from the evaluated
surface is code the diff does not touch.

Two further checks I ran on (c), because "the snapshot faithfully carries the computation's inputs"
is exactly where B3 and B4 lived:

- *The consumed-field set.* `computeActiveIds` and its whole closure read exactly: `Ticket.id`,
  `.column`, `.status`, `.updatedAt`, `.onHold`, and per-comment `.role`, `.agentId`, `.closedAt`,
  `.verdict`, plus (newly, under this contract) `.ts`. It never reads `.description` or
  `comments[].artifact`. The plan's redaction claim is therefore output-neutral for the two fields
  it names — but the wording needs one pin, see N1.
- *The JSON round trip is lossless.* Every `Ticket` field is `string` / `number` / `string[]` /
  optional-string. `LedgerComment.ts` is an **ISO 8601 string**, so the documented NaN tolerance the
  executor notes flag is a `Date.parse` concern and never a serialization one. `toComment`
  (`build-board.ts:248-261`) assigns optional fields only when truthy, so "absent" survives as
  "absent" through `JSON.stringify`/`parse`. No `Date` object, no `NaN` number, no
  `undefined`-vs-missing distinction any consumed predicate can observe. Worth stating — see N2.

**A strength the plan does not claim and should.** AC-0 (ii) and (iii) together constitute a
complete two-sided differential between the audit script's OPC and the shipped implementation's OPC,
recovering r4's separate OPC-differential oracle for free: if the implementation calls a
script-armed ticket fresh, it is lit under the fix and (ii) fails; if it calls a script-fresh ticket
dead, it is dark under the fix and (iii) fails. The two OPC computations cannot diverge silently.
That is a real property of the AC as written and it deserves a sentence.

### AC falsifiability

Every fixture AC carries an explicit `[master: …]` baseline, and the executor note orders "Run AC-0
first. If any fixture AC marked '[master: included]' already passes on master, STOP and report — the
defect model, not the AC, is what must be corrected." That is the strongest anti-vacuity discipline
available for this shape and it is present. AC-0's armed set carries an explicit `|A| ≥ 1` floor
with a distinct refusal code rather than a silent pass. AC-0 (iii)'s "every within-cap ticket is lit
under both" quantifier could in principle range over an empty set, but AC-0 (iv) backstops it with a
constructed positive control a darken-everything implementation cannot survive — and (iv) is a
genuine two-sided discriminator, because moving an armed ticket's punch-in `ts` to `NOW − 1min`
while leaving `updatedAt` stale is lit ONLY under the new clock. Every armed member has a parseable
OPC today (measured: 0 unknown), so a constructible target for (iv) is guaranteed to exist.

### Monotonicity checklist (#1590)

1. **OPC known vs UNKNOWN (R1).** Stronger = "the lane's own open punch-in is beyond the cap ⇒
   dark"; weaker = "no parseable `ts` among open-evidence rows ⇒ legacy `updatedAt` clock". The
   weaker fires only where the stronger has *no evidence at all*, so it cannot erase it. **Safe.**
   Live check: **0 of 31** in-flight chains have UNKNOWN OPC — the fallback is pure back-compat with
   no live population, exactly as the plan claims.
2. **Mixed parseable/unparseable within one ticket (AC-6b).** Stronger = "parseable open evidence
   governs"; weaker = "an unknown-age unit re-opens the `updatedAt` fallback". The plan explicitly
   kills the weaker and names the reason (one degraded row would otherwise immunise a lane against
   ever darkening). **Stronger wins.**
3. **Punched-OUT vs punched-IN agent (OPC individuation).** Stronger = "this agent is DONE
   (`closedAt` on any of its rows)"; weaker = "this agent has an open-looking row".
   `lib/active.ts:187-196` OR-accumulates `closedAt` per agentId, making the closed claim absorbing,
   and OPC reuses that individuation verbatim — so a punched-out agent's `ts` values can never
   re-arm the lane. This is the #1682-ghost monotonicity, preserved rather than re-derived. **Safe.**
4. **Chain evidence vs recency (R2).** Stronger = "OPC beyond cap ⇒ dead"; weaker = "this is the
   focus" / "touched within 8 minutes". R2 makes the stronger a conjunct on *all three* disjuncts,
   so neither re-light path can erase it. Verified at source that both are currently unbounded:
   `:342` adds to `inFlightIds` unconditionally, `:363` grants the focus off that set, `:372` is the
   window. The plan's reading of the defect is exactly right. **Stronger wins on every path.**
5. **Held vs everything (#1816).** Stronger = "held ⇒ never in the population" (`ui-meta.ts:133`,
   consumed at `active.ts:329-336`). Untouched by this plan — the only thing that could accidentally
   erase it is capture-time redaction of `onHold`. **Flagged as N1.**
6. **Superseded vs newest row (residual (c)).** Non-last rows retain their values and can never
   re-arm. Correct against `chainInFlight`'s newest-exec-review fold (`active.ts:118-127`). **Safe.**

### Non-blocking notes for the executor

**N1 — pin the capture-time redaction to an exact field list.** AC-0's capture bullet says
"`artifact_path` and free-text description fields are redacted at capture … they are the only fields
that can carry home paths." Two corrections, neither fatal:
(a) the justification is wrong about the snapshot's own data — the snapshot records the **built**
`Ticket[]`, and `build-board.ts` already applies `redact()` to `description` (`:342`), `onHold`
(`:357`), the `artifact` basename (`:250`) and `verdict` (`:268`), so the captured tickets are
already home-path-redacted by the production build path; the capture-time pass is belt-and-braces,
not the only line of defence.
(b) "free-text description fields" (plural, unnamed) is loose enough to sweep in `onHold`, which IS
output-relevant — `isHeld` is `Boolean(ticket.onHold) && column === "in_progress"`, and held tickets
are excluded from the lane population. Blanking it at capture would silently move held tickets INTO
the population and inflate `|A|` in the more-lit direction: the same "capture mutation silently
changes a consumed dimension" shape as B3/B4. Live exposure today is nil (I measured **0 held
tickets** in the captured session) but that is luck, not design.
**Fix:** name the exact two fields — `Ticket.description` and `Ticket.comments[].artifact` — and
state that every other field is copied verbatim. Those two are provably the only ones the closure
never reads (consumed set enumerated above).

**N2 — claim the serialization fidelity the redesign removes but still relies on.** r5/r6 carried an
explicit round-trip fidelity control precisely because "the snapshot faithfully represents the
inputs" is where B3/B4 lived. r7 correctly drops it (there is no rebuild left to compare against),
but a serialize→JSON→parse boundary remains. I verified it is lossless (evidence in (c) above); put
that one line in the plan rather than leaving it as the round-8 hole.

**N3 — say WHERE the read-primitive instrumentation is installed.** AC-0's hermeticity proof
("file-read primitives instrumented to throw on any path other than the snapshot") is implementable
only if installed AFTER module load and AFTER the snapshot read — a `tsx`/ESM process reads files to
load modules at all, so instrumenting before imports bricks the script. Installed at that point it
proves exactly the right thing (the evaluate call itself reads nothing) and the "other than the
snapshot" carve-out becomes unnecessary. Left unstated, this is precisely the shape that produced a
fresh blocker in each of rounds 3-6.

**N4 — record the OPC distribution, not a lone median.** The Why table's "median 212h" does not
reproduce: my measurement over the same population returns 109.5h. This is an index artifact, not a
data disagreement. Today's sorted armed ages (hours) are
`9.42 12.17 56.79 60.22 61.64 61.96 62.07 62.26 80.35 80.36 80.37 86.60 86.72 86.74 109.53 212.46 237.10 256.74 260.22 264.49 264.49 264.49 272.85 272.92 272.92 272.93 416.41 430.66 464.45`
— there is a ~100 h gap straddling the midpoint, so `sorted[floor(n/2)]` jumps from 212.46 (n=28) to
109.53 (n=29) on a single added member. Min and max reproduce to within 0.3%, so the underlying data
agrees. Since AC-0 records "the OPC age distribution" in the PR body, record quartiles or the sorted
list; a lone median on this shape is unstable by ~2×.

**N5 — the distribution gap is the missing evidence for accepted residual (b).** Residual (b) ("a
genuinely-alive silent leg longer than the cap now darkens at cap age") is the plan's one
un-evidenced judgment call, and it is the residual that could plausibly worsen the operator's actual
complaint. Today's data answers it: the two live chains sit at **0.14 h and 0.15 h**; the newest dead
one at **9.42 h**. Nothing occupies the band between. The 6 h cap falls inside a 9.27-hour empty gap,
so residual (b) has no live population at all. One sentence converts "weighed, accepted" into
"measured".

**N6 — AC-3(b)'s master-side attribution is imprecise (harmless).** With `updatedAt = now`, master
lights that ticket via disjunct 1 as well (`:343`, `now − now = 0 ≤ cap`), so the fixture cannot
isolate the window path *on master*. This does not weaken the AC — the load-bearing assertion is the
fix-side EXCLUDED, and there `:372` genuinely is the last remaining path (an implementation that
fixes only `:343` and `:363` still fails it). Reword or drop the "via the window disjunct"
attribution.

**N7 — cite the third undercount mechanism alongside the two you quoted.** cairn T1 2026-07-25
records: *"1-LANE-LIVE 2026-07-25 = #1867 recurring, live-confirmed: a PENDING execution-review moves
the ticket to `in_review` and OUT of the lane population, so the genuinely-running reviewer is
invisible while an agentless window-lit ticket shows as the only lane."* That is a distinct mechanism
from #2072's dropped spawn-ledger row. It is already fixed board-side (`pendingReviewInFlight`,
`active.ts:229`) and this plan already defends it (AC-5(b), AC-7's `lane-pending-review-visibility`),
so nothing changes — but §98's "two independent lines of evidence place the undercount outside this
file" currently reads as if #2072 were the only mechanism. One clause keeps it honest.

**N8 — `.ai-workspace/` is gitignored at `.gitignore:18` as a whole directory**, so the executor note
is right that the plan needs `git add -f`. Confirmed: the plan file is already staged in this
worktree, so that step has been done; the audit script's snapshot output stays ignored for free.

### Deferred-follow-ups: (this review's own accounting)

- **N1-N8 above** — handed to the executor as non-blocking guidance; no new ticket filed, by
  design. N1 is the one to action first. → executor, this PR.
- **Undercount mechanism (#2072)** and **freeze-safe lane `isLive` gate (#2073)** — DEFERRED out of
  this plan and verified already filed and `pending`, not phantom forward references. → #2072, #2073.
- **Generator-side `closedAt` healing** and **the hook-side same-proxy class** — DEFERRED, out of
  this repo entirely. → #1858, #1859 (both already tracked).
- **Cap-value recalibration (is 6h right once it cannot re-arm?)** — DEFERRED. → file-when-triggered,
  only if post-ship observation shows the operator misled in practice. No ticket now, correctly.

### Verdict rationale

Round 6 called r6 "one clause from a PASS" and conditioned the PASS solely on B7. Round 7 does not
write that clause — it removes the apparatus that generated it, and I verified the removal is
legitimate rather than evasive: the entire B3→B7 family polices filesystem reads performed by
`build-board.ts` inside the evaluation step, and `computeActiveIds`' transitive closure provably
cannot perform one. The differential remains valid because the diff does not touch `build-board.ts`,
so factoring it to capture time is value-preserving by construction. The mechanism (OPC, per-agent,
`closedAt`-aware, conjoined onto all three disjuncts) has been confirmed sound since r2 and I
re-derived both defects at source (`:342`/`:343` and `:363`/`:372`). The measurement reproduces,
including the counterfactual re-arm at 29/29. The ACs are falsifiable, baselined against master, and
carry an explicit non-emptiness floor plus a two-sided positive control. Nothing above rises to
blocking. **PASS.** N1 is the note the executor should action first.

### privacy-scan (round 7)

Canonical `--working` invocation per `docs/privacy-scan-invocation-contract.md`, run AFTER this
section was written so it covers my own prose (not only the plan's).

- **Path scanned**: `.ai-workspace/plans/2026-07-29-1980-lanes-wallclock-crosscheck.md` (this file,
  in this worktree).
- **Scanner's own verdict line**: `privacy-scan: CLEAN mode=working size=42592` — non-zero size, so
  this is a scan of real content, not of nothing.
- **Positive control**: the identical invocation shape against a scratch copy of this same file with
  one home-path needle appended returned `privacy-scan: DIRTY (home-path matches=1, brand matches=0,
  email matches=0)`. The instrument therefore has demonstrated power against this artifact's own
  match class; the CLEAN above is evidence, not an assertion.
