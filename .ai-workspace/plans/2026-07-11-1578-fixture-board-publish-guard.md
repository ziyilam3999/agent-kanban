# Plan: Fail-closed publish guard for the live-board courier (#1578, SEV-HIGH)

- **Task**: agent-kanban #1578 — a test/verification run published a fixture board (`#9999 smoke ticket`) to the LIVE production blob; it self-healed only by luck on the next real task change.
- **Date**: 2026-07-11
- **Status**: REVISED r2 (all six blocking amendments from plan-review folded) — awaiting plan re-review
- **Repo**: agent-kanban (PUBLIC — no employer tokens, no personal emails, home paths written as `<HOME>` in any prose that could ship)

cairn: matched (T1 2026-07-10) "A null result refutes a hypothesis only if the test could have come out the other way" and "A negative/disconfirming test only refutes a hypothesis if it had power to come out the other way" — queried `fixture`, `blob`, `vacuous`, `power`, `guard`; revision round also matched (T1 2026-07-11) "A service with one production endpoint that reads ambient credentials from disk" — queried `seam`, `power`, `in-process`.

## Execution model

**subagent (delegate)** — 3-role chain: this plan → independent plan-review → executor in an isolated worktree → execution-review. Rationale: the change spans 8 files (courier, hook script, sync-log type, one new + three migrated test files, README), touches a SEV-HIGH production write path, and carries a red-first test protocol — well above the trivial-skip threshold and cleanly briefable as a single coherent surface (knob-A `delegate`, knob-B `both`: test oracle + independent reviewer).

## ELI5

Our public Kanban web page shows a board file that lives in one cloud mailbox slot. Every time a real task changes, a little robot (the "hook") re-writes that slot with the true board. The problem: ANY program on this machine that runs the uploader — including a test playing with fake data — writes to that SAME slot, because the keys are sitting on the desk (a credentials file on disk). One test run did exactly that, and for a few minutes the public page showed one fake ticket instead of 214 real ones.

The fix flips the default: the uploader now says NO unless it is explicitly told "this is a real publish" — and the only thing that says that is the real installed hook. Crucially, the lock goes on the ENGINE, not the ignition button: the uploader's core function itself refuses, so a program that hot-wires around the normal start switch (calling the function directly instead of running the script) hits the same lock. As a second lock, the uploader also refuses any board that looks like test data (absurdly tiny, or carrying the reserved test ticket #9999, or a test-named session). A test that forgets its safety fence now does NOTHING instead of overwriting production. We prove it with tests that fail on today's code (showing the hole is real) and pass after the fix (showing the door is now locked) — including one that hot-wires past the start switch on purpose, because that is the door the first draft of this plan forgot to test.

## Revision log (r2 — response to plan-review NEEDS-WORK)

All six blocking amendments applied; non-blocking notes 7-12 folded in place:

1. Guard placement pinned INSIDE `uploadBoard()` (before `resolveAuth()`), not `main()`; false Context claim ("all surfaces funnel through the script entry") corrected; ambiguous "courier entry" wording removed. [B1]
2. Marker read from the process environment inside `uploadBoard()`; `UploadDeps` explicitly forbidden from gaining any publish-authorizing field; docstring exception documented. [B2]
3. AC-9 added — the in-process RED-first test with a `put` spy; the only AC with power against the misplacement. [B3]
4. "AC power map" section added stating AC-1…AC-8 cannot distinguish a `main()`-only guard from the real fix; AC-9 is the discriminator. [B4]
5. Collateral test files (`__tests__/upload-board.test.ts`, 15 call sites; `__tests__/sync-failure-alert.test.ts`, 3 call sites at :131/:140/:152) named in Critical files + behavior contract, with the legitimate opt-in mechanism (test-process env, never DI) and per-file fixture decisions, including the 0-ticket `{"schema":1,"tickets":[]}` board at sync-failure-alert :111. [B5]
6. AC-3 redesigned: mandatory fence-integrity pre-assertion + marker-proof via a still-floor-REFUSED run; the hook smoke keeps five locks, never drops to one. [B6]
7. Notes folded: AC-1 gains the `skipped-no-token == 0` ordering discriminator (N7); AC-6 gains a DI-bypass grep arm with positive control (N8); `refused`-consumer list enumerated (N9); fresh-store and id-9999 open questions closed as reviewer-confirmed (N10, N11); #1579 cited in Traps (N12).
8. Per the RED-first hard constraint, every AC now carries an explicit **Pre-fix:** line stating its pre-fix result and what its power is against.

## Context (what is already proven — do not re-derive)

- `#9999 smoke ticket` exists only in test fixtures (`__tests__/on-task-change-hook.test.ts` creates it at runtime). Never in the real task store.
- `scripts/upload-board.ts` (the courier) writes ONE stable blob pathname, `board.json`, overwrite-in-place. Anything uploaded IS production. Verified at `scripts/upload-board.ts:230`.
- **The write-surface set is FIVE, not four** (corrected in r2; the r1 claim "all publish surfaces funnel through the courier's single script entry" was FALSE). Four script-entry surfaces all reach `main()` (`scripts/upload-board.ts:275-283`, gated `NODE_ENV !== "test"` at `:288-290`): `npm run kanban:upload`, `npm run kanban:sync`, direct `tsx scripts/upload-board.ts`, and `scripts/on-task-change.sh:52` (the installed PostToolUse hook). The FIFTH surface is **in-process**: `uploadBoard()` is `export`ed at `:147` and reachable WITHOUT `main()` — 18 call sites today (`__tests__/upload-board.test.ts` 15, `__tests__/sync-failure-alert.test.ts` 3 at :131/:140/:152). All 18 currently inject a mock `put`, so none reaches the live blob today — but nothing structurally stops a future in-process caller from passing the real `put`, and a live-fire test of exactly that shape is the probable cause of the incident.
- **No sixth surface** (verified by plan-review against `920dd29`): `scripts/upload-board.ts` is the only module reaching the Blob SDK; `.github/workflows/sync-live.yml` only merges master→live (no blob token); CI carries no blob token; `scripts/handoff-session.ts` only exports. Do not re-enumerate.
- Credentials are ambient: `scripts/blob-auth.ts` resolves a real OIDC token from the repo-root token file by default. Any ad-hoc run inherits them.
- The jest fence is correct but OPT-IN PER INVOCATION — instruction-class protection, which is the class that fails.
- The exporter ships tickets for ALL sessions (`scripts/export-board.ts:259-267`, v0.2.0 #3 fix) — the production board is whole-store-sized (214 tickets, ~634 KB today; historical minimum ~240 KB). A brand-new single SESSION does not shrink the board; only a fresh/wiped whole STORE does.

## Intent (what and why — never how)

**What**: Invert the courier's default from "publish unless fenced" to "inert unless explicitly told to publish", and add a content floor that refuses synthetic-smelling boards even when publishing is authorized. Both guards live at the ONE seam every path to the network write shares.

**Why**: The root cause is that the production write path has no environment separation — one blob key, ambient credentials, and protection that depends on every future test remembering to fence itself. A fail-closed default converts the whole class of "forgot the fence" mistakes from *production incident* into *no-op with a loud, distinct log record*. Entrypoint-class protection (a guard in `main()`) would be the same design class as the jest fence this plan rejects: it protects the door people usually use while leaving the exported function open.

### The two mechanisms

1. **Publish opt-in (the root fix).** The courier refuses to do anything credentialed unless an explicit publish marker is present in its environment: `BOARD_PUBLISH=1` (exact contract value). The ONLY code path that sets it is the installed hook (`scripts/on-task-change.sh`). Every ad-hoc / manual / test / verification invocation is inert BY DEFAULT — it returns/exits non-zero, performs no credential resolution and no network write, and records a distinct refusal in its sync log.
   - **Placement is pinned (B1)**: the opt-in check and the shape floor both execute INSIDE `export async function uploadBoard(deps)` (`scripts/upload-board.ts:147`), on the code path that reaches `put(...)` (`:230`), and BEFORE the `resolveAuth()` call (`:175`). A guard in `main()` (`:275-283`) is FORBIDDEN as the sole guard — it leaves the exported `put` path open to every in-process caller. (An additional early check in `main()` for nicer CLI messaging is permitted but never sufficient; AC-9 is what polices this.) The guard must also NOT be conditioned on `NODE_ENV` — a jest-only disable would defeat AC-9 and reopen the in-process door.
   - **Marker source is pinned (B2)**: `uploadBoard()` reads the marker from the PROCESS ENVIRONMENT. It MUST NOT be added to `UploadDeps` (`scripts/upload-board.ts:57-64`) — no `allowPublish` / `skipGuard` / `force` / any caller-supplied authorization field. A gate you can inject is not a gate; caller-supplied authorization is the exact trust model that just failed. `put` / `resolveAuth` / `boardPath` / `logPath` / `notify` stay injectable; the gate does not. The docstring at `:143-146` (which currently promises a purely dep-driven function) is updated to document this one deliberate ambient-env exception.
   - *Constraint compliance*: this is NOT a kill-switch. There is no env var that turns the guard OFF. `BOARD_PUBLISH=1` is a positive opt-in that enables the dangerous action; the guard itself has no bypass. It defeats the ACCIDENT class (unfenced runs). It cannot defeat deliberate misuse — nothing can while the credential file is on disk — and that is out of scope.
2. **Fixture-shape floor (defense in depth — INCLUDED in v1, reasons below).** Even with the marker present, the courier refuses a board that smells synthetic. Contract arms (any one trips refusal):
   - board file smaller than 20,000 bytes (incident fixture ~2 KB; `board.sample.json` 6.8 KB; real boards ≥240 KB historically — >10x margin both ways), OR
   - fewer than 10 tickets total (incident board had 1; real board 214 — whole-store count per the Context note above), OR
   - any ticket id equal to the reserved test id `9999`, OR
   - `board.sessionId` or any session summary id matching `/^(demo|test|smoke)/` (real ids are hex — `m`, `t`, `s`, `o`, `k` cannot appear in a hex prefix, so zero false-positive risk on this arm).

   **Why the floor is not redundant given the opt-in** (argued, not dropped silently): the opt-in only proves *who invoked* the courier; it says nothing about *what content* is being published. The floor covers the surfaces the opt-in cannot: (a) a marker-present run pointed at fixture data (e.g. a future "live-fire test of the real hook path" — exactly the shape of run that probably caused this incident); (b) an exporter bug producing an empty/near-empty board on the genuine hook path; (c) the hook fired in an environment where `TASKS_DIR`/`OUT` were overridden to fixture paths. The two guards protect different axes (invocation provenance vs content shape), and the incident's actual harm was content-shaped. Cost asymmetry favors inclusion: a false positive = honest stale board + the existing 3-strike failure alert (`refused` is a non-success record, so `consecutiveTrailingFailures` counts it); a false negative = fake production data served to the operator, which is what just happened. Plan-review's finding on the hook smoke (see AC-3) makes the floor MORE load-bearing, not less: it is one of the five locks keeping the production-wired smoke test from ever publishing.

### Behavior contract (observable, pinned for the ACs)

- The opt-in check and the shape floor both run INSIDE `uploadBoard()`, BEFORE credential resolution (`resolveAuth()` at `:175`) and before any network attempt. A run that is not allowed to publish must never touch credentials. (Consequence, used as an AC discriminator: a refused run's log NEVER contains a `skipped-no-token` record — a post-auth guard would hit `auth.mode === "none"` first and record that instead.)
- Every refusal writes exactly one sync-log record with `result: "refused"` and a stable reason token distinguishing the arm: `publish-optin-missing` or `synthetic-board`, then returns/exits non-zero. Refusal output never contains a credential (existing discipline).
- The hook (`scripts/on-task-change.sh`) sets the marker only for its own courier invocation and keeps its PostToolUse exit-0 contract.
- `SyncRecord.result` gains the `refused` value. Full consumer list (N9 — enumerated, not left as an exercise): `lib/sync-log.ts:15-19` (the closed `SyncResult` union — one-line widening), `scripts/upload-board.ts:72-82` (`consecutiveTrailingFailures` — already fails closed: it breaks only on `uploaded`/`skipped-unchanged`, so `refused` counts as failure with no change), `lib/board-freshness.ts` (check explicitly, do not assume), `scripts/board-freshness-watchdog.ts`, `__tests__/sync-failure-alert.test.ts:57` (already proves fail-closed on an out-of-union value). `refused` must count as non-success everywhere.
- **Collateral test migration (B5).** The 18 in-process call sites legitimately opt in by setting the marker in the TEST PROCESS'S OWN environment (e.g. `process.env.BOARD_PUBLISH` in `beforeEach`, restored in `afterEach`) — an opt-in unreachable from a real run, because a real run's environment is not a jest process's environment. NOT via any DI flag (forbidden above). Per file:
  - `__tests__/upload-board.test.ts` (15 sites): tests that assert the `put` path is reached get floor-PASSING fixtures (≥10 tickets, ≥20,000 bytes, no id 9999, hex session); tests that exercise the floor deliberately keep synthetic fixtures.
  - `__tests__/sync-failure-alert.test.ts` (3 sites, :131/:140/:152): its shared fixture at `:111` is `{"schema":1,"tickets":[]}` — 0 tickets, ~26 bytes — which the floor would refuse BEFORE the injected failing `put`, silently changing what the alert-streak tests prove. **Decision: migrate that fixture to floor-passing**, preserving the tests' existing semantics (`failed` records from a reached-`put` drive `consecutiveTrailingFailures`). Do NOT re-base them on `refused` records — their job is to prove the failure-streak alert on the network-failure path.
  - Exclusive-fixture discipline: test fixtures that must PASS the floor use non-reserved ids and hex-prefix session names; id `9999` remains exclusively the refused-fixture signature (one token, one meaning).
- **The hook smoke keeps five locks (B6).** `__tests__/on-task-change-hook.test.ts` deliberately strips `NODE_ENV` (`:59`) so the REAL hook → REAL `main()` → REAL `put` → REAL auth resolver fire — it is the one test wired to production. Its existing 3-part credential fence (`:42-61`) stays, and the plan adds, never removes, locks:
  - (a) MANDATORY fence-integrity pre-assertion: before spawning the hook, the test asserts all three credential locks are engaged — `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID` absent from the child env; `OIDC_TOKEN_FILE` pointing at a path for which `fs.existsSync(...) === false`; the `vercel` stub resolving FIRST on the child `PATH`. A fence regression now fails RED instead of publishing.
  - (b) Marker-proof via a still-floor-REFUSED run: the existing tiny `#9999` fixture runs through the real hook and the test asserts refusal reason `synthetic-board` and NOT `publish-optin-missing` — power-bearing (only a marker-setting hook can produce `synthetic-board`), and it proves the hook sets the marker while BOTH new locks stay engaged and the courier never reaches auth or `put`.
  - (c) The traversal proof (real-shaped fixture reaching `skipped-no-token`) runs as a separate case WITH lock (a) in place. The migrated real-shaped fixture keeps the #1158 Layer-B contract (`skipped-no-token` end-to-end proof) alive.
- README documents the new default (bare `kanban:upload` / `kanban:sync` are inert), the deliberate manual publish recipe (`BOARD_PUBLISH=1 npm run kanban:upload`), and the id-9999 reservation.
- Reserved-id note: id `9999` is formally reserved for tests. If the real store ever reaches a genuine task #9999 (~months away at current numbering), the refusal is loud and diagnosable (`synthetic-board` in sync.log) and the recovery is renaming that one task — documented, accepted (reviewer-confirmed, N11).

## Alternatives considered (and why not)

- **Guard in `main()` (entrypoint-class)** — REJECTED (B1). Passes every script-driven AC while leaving the exported `uploadBoard()` → `put` path open to all in-process callers; same design class as the jest fence. AC-9 exists specifically to make this placement fail.
- **`allowPublish` / `skipGuard` field on `UploadDeps` (DI-surface authorization)** — REJECTED (B2). A kill-switch by another name: relocates the gate from "the process environment declared publish intent" to "whatever the caller passed", the exact caller-trust model that failed; a refactor defaulting it `true` reopens the hole with zero env involvement; and AC-6's token grep would sail past it. AC-6 arm 2 polices this.
- **Separate staging/dev blob key for non-opted-in runs (ticket sketch c)** — NOT in v1 (see Deferred-follow-ups). Redirect-instead-of-refuse still burns a metered put, still exercises real credentials from test code, and creates a second live artifact that can confuse consumers. Refusal is strictly safer and simpler for v1.
- **Hide/relocate the credential file so ad-hoc runs can't find it** — REJECTED. Obscurity, not a guard; breaks the self-refreshing OIDC bootstrap (`blob-auth.ts` resolves the file relative to the script on purpose); any run could still point at it.
- **Guard only inside jest (extend the fence)** — REJECTED. That is the failed instruction-class design; the incident was an ad-hoc run, not a jest run.
- **Argv flag (`--publish`) instead of env marker** — considered equivalent in safety at the script surface, but INFERIOR at the pinned seam: an argv flag cannot gate the exported in-process function. Env marker chosen; the executor may NOT weaken the contract (the default invocation of every npm script surface AND every direct `uploadBoard()` call must be inert).

## Critical files (expected surfaces — executor owns the how)

- `scripts/upload-board.ts` — opt-in + shape floor INSIDE `uploadBoard()` (before `resolveAuth()` at `:175`, on the path to `put` at `:230`); `refused` record; docstring exception at `:143-146`; NO new `UploadDeps` field.
- `scripts/on-task-change.sh` — the one place that sets `BOARD_PUBLISH=1`.
- `lib/sync-log.ts` — `SyncRecord.result` union gains `refused`.
- `__tests__/publish-guard.test.ts` (new) — the script-path RED-control tests (spawnSync pattern, fully hermetic) AND the in-process AC-9 test.
- `__tests__/upload-board.test.ts` — 15 call sites: test-env marker opt-in; fixtures split floor-passing vs deliberately-synthetic per contract.
- `__tests__/sync-failure-alert.test.ts` — 3 call sites (:131/:140/:152): test-env marker opt-in; `:111` fixture migrated to floor-passing to preserve `failed`-streak semantics.
- `__tests__/on-task-change-hook.test.ts` — fence-integrity pre-assertion added; marker-proof floor-refused case added; traversal fixture migrated to real-shaped; contract assertions preserved.
- `README.md` — inert-by-default + manual publish recipe + 9999 reservation.

## Traps this plan designs around (do not regress them)

1. `data/sync.log` absence is NEVER evidence — a run overriding `SYNC_LOG` leaves no trace there. Every AC below checks PRESENCE of a record in a log path the test itself controls, or live-blob CONTENT; none cites absence in the default log.
2. `data/board.json` is gitignored (`.gitignore:10`) — `git status` can never see it change (this ban is tracked as #1579, cited here per review N12). All "production untouched" evidence below is content-based (fetched bytes, ticket count, id scan), never VCS status.
3. A grep that returns 0 matches proves nothing without a positive control — every zero-match AC below pairs with a planted-token control run.
4. The RED control must have POWER: pre-fix evidence must show the courier actually traversing past auth toward an upload attempt (not merely a different log token), per the power lesson cited in the cairn receipt.
5. **Script-driven ACs cannot see guard placement.** Every check that drives the courier via npm scripts or the hook exercises `main()`; only an in-process call (AC-9) can distinguish a guard inside `uploadBoard()` from a guard in `main()`. Never accept a suite for this fix that lacks the in-process discriminator.

## Red-first requirement

Every NEW test must be demonstrated FAILING on pre-fix code before the fix lands, with the failing output captured verbatim in the execution evidence artifact (AC-4). Each AC below carries a **Pre-fix:** line stating its pre-fix result. ACs whose pre-fix result is PASS are explicitly classified as regression/invariant locks (their power is against a DIFFERENT defect — guard overreach or fence regression — and the AC states which); every fix-detecting AC is RED pre-fix. A fix-detecting AC that passes both before and after has no power and is not acceptable.

## AC power map (B4 — read this before trusting any single AC)

**AC-1, AC-2, AC-3 drive the courier via `npm run kanban:upload` / `kanban:sync` / `bash scripts/on-task-change.sh` — all of which are the `main()` path. AC-4 through AC-8 are evidence/suite/liveness checks. A guard installed ONLY in `main()` therefore passes AC-1 … AC-8 — 8 of 8 — while the vulnerable in-process `put` path survives untouched.** That blindness is the same class of error as the two original "proofs of safety" (a `git status` on a gitignored path; a `sync.log` null on an env-overridable path): instruments structurally incapable of detecting the thing they were cited to rule out. **AC-9 is the single discriminator between the safe fix and the defanged one.** Executor: if migrating the 18 call sites feels avoidable by moving the guard to `main()`, that move is the defect this plan exists to prevent — AC-9 will fail. Execution-review: treat AC-9 as the gate; a PASS on AC-1…AC-8 with a missing or green-before-fix AC-9 is a FAIL.

### Binary AC

All commands run from the agent-kanban repo root on the fix branch unless stated. "Temp log" means a `SYNC_LOG` file path (script runs) or injected `logPath` file (in-process runs) created by the check itself — every grep below reads a concrete file or a terminated command's captured output, never an unbounded stream.

- **AC-1 — Inert by default (opt-in missing → refused before credentials).**
  With a FLOOR-PASSING fixture board at `OUT` (≥10 tickets, ≥20,000 bytes, no id 9999, hex session — so the refusal isolates the opt-in arm), a temp `SYNC_LOG`, `OIDC_TOKEN_FILE` pointed at a nonexistent path, and NO `BOARD_PUBLISH` in the environment: `npm run --silent kanban:upload` exits NON-ZERO, and `grep -c '"result":"refused"' "$TMPLOG"` prints `1`, and `grep -c '"reason":"publish-optin-missing"' "$TMPLOG"` prints `1`, and `grep -c '"result":"skipped-no-token"' "$TMPLOG"` prints `0`. The last grep is the ordering discriminator (N7): a guard placed AFTER `resolveAuth()` would hit `auth.mode === "none"` at `:176` and record `skipped-no-token` first.
  **Pre-fix**: RED — the run records `skipped-no-token` (that grep prints `1`, violating the required `0`) and no `refused` token exists anywhere (the `refused` greps print `0`). Power: against the missing opt-in default AND against post-auth guard placement.

- **AC-2 — Shape floor refuses synthetic content even when publishing is authorized.**
  Same hermetic setup as AC-1 (nonexistent `OIDC_TOKEN_FILE` — no reachable credentials) but WITH `BOARD_PUBLISH=1` and the incident-shaped board (single ticket id `9999`, session id prefixed `smoke`, ~2 KB): courier exits NON-ZERO, `grep -c '"reason":"synthetic-board"' "$TMPLOG"` prints `1`, `grep -c '"result":"uploaded"' "$TMPLOG"` prints `0`, and `grep -c '"result":"skipped-no-token"' "$TMPLOG"` prints `0` (the floor also fires before auth).
  **Pre-fix**: RED — `BOARD_PUBLISH` is inert, no floor exists; the run traverses to auth and records `skipped-no-token` (the `synthetic-board` grep prints `0`). Power: against a missing/never-reached content floor.

- **AC-3 — The real hook path still publishes, WITHOUT disarming the hook smoke (five locks stay).**
  `npx jest __tests__/on-task-change-hook.test.ts --verbose 2>&1 | tee /tmp/ac3.out` exits `0` (jest's exit code, preserved via `set -o pipefail`), and `grep -c 'fence-integrity' /tmp/ac3.out`, `grep -c 'marker-proof' /tmp/ac3.out`, `grep -c 'traversal' /tmp/ac3.out` each print ≥`1` — the three contract cases exist by name and passed. The three cases, per the behavior contract:
  (a) *fence-integrity* — pre-assertion that all three credential locks are engaged before the hook is spawned (creds absent from child env; `OIDC_TOKEN_FILE` target `existsSync === false`; `vercel` stub first on child `PATH`).
  (b) *marker-proof* — the REAL `bash scripts/on-task-change.sh` run against the EXISTING tiny `#9999` fixture under the hermetic fence: asserts one `refused` record with reason `synthetic-board` and asserts `publish-optin-missing` count is `0` and `skipped-no-token` count is `0` — proving the hook set the marker while both new locks stayed engaged and the courier never reached auth.
  (c) *traversal* — the REAL hook with a REAL-SHAPED fixture store (≥10 tickets, exported board ≥20,000 bytes, hex-prefix session, no id 9999): hook exits `0`, `skipped-no-token` count ≥`1`, `refused` count `0` — the hook-invoked courier passed BOTH guards and reached credential resolution.
  **Pre-fix**: (b) is RED — no floor and no marker exist, so the tiny-fixture run records `skipped-no-token`, not `synthetic-board`. (a) is GREEN pre- and post-fix by design — it is a LOCK, not a fix detector; its power is against a future fence regression (it goes RED the moment any credential lock disengages, converting a silent live publish into a failing test). (c) is GREEN pre-fix by design — it is the regression arm; its power is against guard OVERREACH (a hook that fails to set the marker, or a floor that false-positives a real-shaped board, flips it RED post-fix).

- **AC-4 — RED controls ran red first (power-bearing evidence on file).**
  The execution evidence artifact `.ai-workspace/reviews/1578-execution-evidence.md` exists and contains, verbatim: (a) the new script-path guard tests failing against PRE-FIX code (expected `refused`, observed `skipped-no-token`/`failed` — jest failure output naming the assertions); (b) the AC-9 in-process test failing against PRE-FIX code (the `put` spy WAS called); (c) a pre-fix probe with fake-but-RESOLVABLE credentials (crafted token file: well-formed JWT, far-future `exp`, garbage signature; fake store id; `vercel` stubbed to fail on PATH) whose sync record is `"result":"failed"` with an SDK/network error class — proving pre-fix code traversed past auth to an actual upload attempt and only fake credentials prevented a publish. Checkable: `grep -c '"result":"failed"' .ai-workspace/reviews/1578-execution-evidence.md` prints ≥`1` and `grep -Ec 'FAIL|✕' .ai-workspace/reviews/1578-execution-evidence.md` prints ≥`2` (the two pre-fix jest FAIL blocks).
  **Pre-fix**: N/A as a runtime check (the artifact is the executor's deliverable) — its CONTENT is the captured pre-fix RED evidence for AC-1/2/3(b)/9.

- **AC-5 — Full suite and types green, WITH the named collateral migrated (never defanged).**
  `npx jest` exits `0` and `npx tsc --noEmit` exits `0`; PR CI green. This is only meaningful given the behavior contract's named migrations: the 18 in-process call sites in `__tests__/upload-board.test.ts` and `__tests__/sync-failure-alert.test.ts` opt in via test-process env, and the `:111` empty-board fixture is floor-passing so the alert-streak tests still prove `failed`-driven streaks from a reached `put`.
  **Pre-fix**: GREEN (the suite is green today) — this is a suite-integrity invariant, not a fix detector. Its power is against collateral breakage; AC-6 arm 2 and AC-9 are what prevent the "fix the suite by defanging the guard" path.

- **AC-6 — No new bypass introduced, on BOTH surfaces (with positive controls).**
  Arm 1 (env-var kill-switch): over the added lines of the branch diff, `git diff origin/master...HEAD | grep '^+' | grep -Ec '(_OVERRIDE|_OFF|_BYPASS|_SKIP)[=_"]'` prints `0`. Arm 2 (DI-surface authorization, N8): `git diff origin/master...HEAD -- scripts/upload-board.ts | grep '^+' | grep -Ec '(allowPublish|skipGuard|forcePublish|bypass)'` prints `0`. Positive controls recorded first for BOTH arms: the same greps over planted scratch lines containing `GUARD_OFF=1` and `allowPublish: true` each print ≥`1`. All four outputs in the evidence artifact.
  **Pre-fix**: vacuously GREEN on an empty diff — controls-plus-diff make it meaningful only on the fix branch; power is against bypass introduction in THIS change.

- **AC-7 — Live production board proven intact by CONTENT (never VCS status, never default-log absence).**
  After the executor's final verification runs: fetching the live board URL (from the newest `uploaded` record's `url` field or the deployed site's data route) into a file yields JSON where `jq '.tickets | length'` prints ≥ `50` and `grep -Ec '"id": ?"9999"'` over the fetched file prints `0` (positive control: the same grep over the incident fixture file prints ≥`1`).
  **Pre-fix**: GREEN today (the board self-healed) — this is a production-safety invariant; its power is against contamination BY the executor's own verification runs.

- **AC-8 — Post-merge production liveness (the marker-present path publishes for real).**
  After merge and a primary-clone pull, the next real task change appends a NEW record with `"result":"uploaded"` or `"result":"skipped-unchanged"` and a post-merge timestamp to `data/sync.log` (presence evidence in the default log is valid; only absence is not). Checkable: `grep -c '"result":"uploaded"\|"result":"skipped-unchanged"' data/sync.log` printed against the tail record's timestamp being post-merge. This closes the loop that the installed hook, now marker-bearing, still publishes in production.
  **Pre-fix**: not runnable pre-merge — it is the over-closure detector: a guard that fails closed TOO aggressively (hook not actually setting the marker in production) shows up here as a `refused` streak instead of `uploaded`, plus the 3-strike alert.

- **AC-9 — `uploadBoard()` refuses IN-PROCESS with the marker unset; the `put` spy is never invoked (THE placement discriminator).**
  A jest test (name contains `AC-9`, in `__tests__/publish-guard.test.ts`) calls `uploadBoard(...)` DIRECTLY, in-process, with: a `jest.fn()` spy as the injected `put`; an injected `resolveAuth` returning a VALID `oidc` auth; a FLOOR-PASSING board fixture (≥10 tickets, ≥20,000 bytes, no id 9999, hex session); a temp log file via `deps.logPath`; and `BOARD_PUBLISH` DELETED from `process.env` for the test's duration. Asserts: (a) `expect(put).not.toHaveBeenCalled()`, (b) the returned code is non-zero, (c) exactly one `refused` / `publish-optin-missing` record in the temp log. Checkable: `npx jest __tests__/publish-guard.test.ts --verbose 2>&1 | tee /tmp/ac9.out` exits `0` (pipefail) and `grep -c 'AC-9' /tmp/ac9.out` prints ≥`1`.
  The floor-passing fixture and the valid auth are load-bearing: they strip every OTHER reason the courier might not call `put`, so the assertion isolates the opt-in guard at the pinned seam. A tiny fixture would pass post-fix via the shape floor and prove nothing about opt-in placement. This AC also polices `NODE_ENV`-conditioning: a guard disabled under jest would let the spy fire and fail (a).
  **Pre-fix**: RED — pre-fix `uploadBoard()` reaches `:230` with a valid auth and a valid board, so the `put` spy IS invoked and assertion (a) fails. The verbatim pre-fix failure goes in the evidence artifact (AC-4b). A `main()`-only guard leaves this AC RED post-"fix" — that is its entire purpose.

## Open questions — both closed by plan-review

1. **Fresh/wiped whole store** (<10 total tickets ⇒ refused until it grows past the floor): reviewer CONFIRMED (N10) — stale truth beats fresh fake, the refusal is loud (`synthetic-board` + 3-strike alert), and no env-var escape hatch is to be designed. Executor: do not "helpfully" add one.
2. **Reserved id 9999**: reviewer ACCEPTED (N11) — documented reservation, loud diagnosable failure, proportionate recovery (rename one task).

## Deferred-follow-ups:

- **Staging/dev blob key for live-fire courier testing (ticket sketch c)** — NOT in v1; refusal beats redirect for safety and cost (see Alternatives). → file-when-triggered: only if live-fire courier testing becomes a recurring need after this guard lands.
- **Deliberate small-board publish mechanism** (fresh/wiped-store scenario, Open question 1) — no mechanism designed here by standing constraint. → file-when-triggered: only if the operator actually hits the fresh-store refusal in practice (loud via the 3-strike alert).
- **Real task id reaching 9999** (Open question 2) — documented reservation; recovery is renaming the one colliding task. → none (documentation is the mitigation; no task to file now).

## Review

### r2 (current) — plan-review seat, 2026-07-11

decision: PASS

- **Reviewer**: plan-review seat (independent — did NOT author this plan). Re-verified cold against source, not against the revision log.
- **Full review**: `.ai-workspace/reviews/1578-plan-review-r2.md`

**All six blocking amendments landed in substance.** Verified each against the source:
- **B1/B2** — guard pinned inside `uploadBoard()` (`:147`), before `resolveAuth()` (`:175`), on the path to `put` (`:230`); `main()`-only named as a rejected alternative; the false five-surface Context line corrected; `UploadDeps` (`:57-64`) forbidden any authorizing field.
- **B3 — AC-9 HAS REAL POWER** (the whole ballgame). Traced `uploadBoard()` with AC-9's exact setup: `:152` existsSync passes → `:175` injected valid auth means `:176` does not fire → `:198-217` a fresh temp log makes `lastRemoteHash([]) === null` (`:139`) so the `skipped-unchanged` short-circuit does not fire → **`:230` `put(...)` IS invoked**. Genuinely RED pre-fix, and RED for the right reason. A `main()`-only guard is never on this path, so it stays RED post-"fix". Genuine discriminator.
- **B4 — the AC POWER MAP's claim is TRUE.** Independently re-derived AC-1/AC-2/AC-3 against a hypothetical `main()`-only guard: all pass (AC-5 too — a `main()`-only guard needs no test migrations at all). "8 of 8" is honest; AC-9 is the sole discriminator.
- **B5 — the opt-in is genuinely unreachable from a real run.** `jest.config.js` has no `setupFiles`/`setupFilesAfterEnv`/`globalSetup`, so the opt-in stays per-file; a production run is not a jest process. The one leak shape that would defang it (baking the marker into a `package.json` script or `.env`) is caught by AC-1.
- **B6 — the hook smoke keeps its locks**; the redesign does not relabel the problem. (Prose overcounts: on a hook-driven run the marker is never a lock — see note N-G.)

**No new kill-switch — re-verified clean.** `BOARD_PUBLISH=1` is a required positive opt-in that ENABLES the dangerous action, not a bypass. DI-surface authorization and `NODE_ENV`-conditioning both explicitly forbidden and policed (AC-6 arm 2, AC-9).

**RED-first honesty**: spot-checked AC-1, AC-2, AC-3(b), AC-9 `Pre-fix:` lines against source — all four true.

**Non-blocking executor notes (full text in the review file).** N-A **MUST READ**: AC-1/AC-2 spawn the courier from inside jest, and `upload-board.ts:288` only runs `main()` when `NODE_ENV !== "test"` — `delete env.NODE_ENV` in the child env or both ACs are vacuous (the trap `on-task-change-hook.test.ts:56-59` already documents). N-B: AC-9's temp log must start EMPTY (else the `:198-217` hash-dedup, not the guard, is why `put` isn't called). N-C: keep `existsSync` (`:152`) ahead of the floor so `board-not-found` survives. N-D: a complete fence-integrity pre-assertion is available cheaply — call the real `defaultResolveBlobAuth({ env: childEnv })` and assert `mode === "none"`. N-E: verify the EXPORTED fixture board clears 20,000 bytes. N-F: `refused` widening really is one line (zero exhaustive `SyncResult` switches). N-G: restate the "five locks" count honestly.

---

### r1 (superseded) — plan-review seat, 2026-07-11

> Review below is of r1 of this plan. All six blocking amendments were folded in r2 (see `## Revision log`) and CONFIRMED landed by the r2 review above. Retained as history.

r1-decision: NEEDS-WORK

- **Reviewer**: plan-review seat (independent — did NOT author this plan). Reviewed against source at `920dd29`.
- **Date**: 2026-07-11
- **Full review**: `.ai-workspace/reviews/1578-plan-review.md`

**Verdict rationale.** The diagnosis, the mechanism (opt-in marker + shape floor + `refused` record), the fail-closed default, and the no-kill-switch discipline are all correct — keep them. The plan places the guard at the wrong seam, and, decisively, **its Binary AC suite has no power to detect that.** AC-1 … AC-8 all drive the courier through the `main()` script-entry path, so a guard installed only in `main()` passes 8 of 8 while the vulnerable `put` path survives. That is the same class of error as the two original "proofs of safety" — instruments structurally incapable of detecting the thing they were cited to rule out (Rule 18).

**Verified independently against source (not taken on faith):**
- `uploadBoard()` is `export`ed at `scripts/upload-board.ts:147`, calls `put(...)` at `:230`, and is reachable **in-process without `main()`** (`main()` at `:275-283`, gated `NODE_ENV !== "test"` at `:288-290`). **18** in-process call sites: `__tests__/upload-board.test.ts` (15) + `__tests__/sync-failure-alert.test.ts` (3). Context line 24 ("All publish surfaces funnel through the courier's single script entry") is **false as written**.
- **No sixth surface.** `scripts/upload-board.ts` is the only module reaching the Blob SDK; `sync-live.yml` merges branches (no blob write); CI has no blob token; `handoff-session.ts` exports only.
- **The hook smoke is wired to production.** `__tests__/on-task-change-hook.test.ts:59` strips `NODE_ENV` on purpose so the real `main()` → real `put` → real auth resolver fire. Its only barrier is a 3-part credential fence. **AC-3 as written disarms both new guards in that one test**, taking it from five locks to one.

**Blocking amendments (full text + evidence in the review file):**
1. Pin the guard **inside `uploadBoard()`** (before `resolveAuth()` at `:175`, on the path to `put` at `:230`) — not in `main()`. Fix the ambiguous "courier entry" wording and the false Context line 24.
2. Read the marker from the **process environment inside `uploadBoard()`**; do **NOT** add `allowPublish`/`skipGuard` to `UploadDeps` — a caller-supplied authorization flag is a bypass by another name.
3. Add **AC-9**: a RED-first test calling `uploadBoard()` **directly, in-process**, marker unset, valid auth, floor-passing board, spy `put` ⇒ assert `put` **never invoked** + non-zero + one `publish-optin-missing` record. Must fail pre-fix. This is the only AC with power against the actual vulnerability.
4. State explicitly that AC-1 … AC-8 cannot distinguish the safe fix from the unsafe one, and that AC-9 is the discriminator.
5. Name the collateral test files (`__tests__/upload-board.test.ts`, `__tests__/sync-failure-alert.test.ts` — neither appears in the plan) and pin how their 18 call sites legitimately opt in (test-process env, not a DI flag). Note `sync-failure-alert.test.ts:111`'s `{"schema":1,"tickets":[]}` fixture (0 tickets, ~26 bytes) will be refused by the floor and short-circuit before its injected failing `put`.
6. Do not let AC-3 reduce the hook smoke to a single lock: **(a)** mandatory fence-integrity pre-assertion (all three credential locks engaged, else RED); **(b)** recommended — prove the marker is set via a still-floor-REFUSED run asserting reason `synthetic-board` and NOT `publish-optin-missing`.

Non-blocking notes 7-12 (AC-1's ordering claim is unprovable as written; AC-6's grep misses a DI-surface bypass; the `refused` consumer list; #1579 cross-reference) are in the review file.

## Executor deliverables

Code + tests per contract (including the new `__tests__/publish-guard.test.ts` with both the script-path RED controls and the AC-9 in-process discriminator, and the three migrated test files), README update, execution evidence artifact at `.ai-workspace/reviews/1578-execution-evidence.md` (AC-4/6/7 outputs, incl. both pre-fix jest FAIL blocks), PR via worktree (never primary clone), and the executor's own ledger self-append. Implementation placement/naming beyond the pinned contract tokens (`BOARD_PUBLISH`, `refused`, `publish-optin-missing`, `synthetic-board`, the four floor arms, the inside-`uploadBoard()`-before-`resolveAuth()` placement, the no-`UploadDeps`-gate rule) is the executor's choice.
