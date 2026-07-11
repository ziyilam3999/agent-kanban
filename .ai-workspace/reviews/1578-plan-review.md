# Plan review — #1578 fail-closed publish guard (SEV-HIGH)

decision: NEEDS-WORK

- **Plan under review**: `.ai-workspace/plans/2026-07-11-1578-fixture-board-publish-guard.md`
- **Reviewer**: plan-review seat (did NOT author the plan). Reviewed cold + adversarially against source at `920dd29`.
- **Date**: 2026-07-11

cairn: matched (T1 2026-07-11) "Never use `*_OVERRIDE`/`*_OFF`-style kill-switch env vars to bypass a blocking guard"; also matched (T1 2026-06-29) "When verifying an empty-default env-var guard, explicitly UNSET the var and show the refusal". Queried: `publish`, `guard`, `fail closed`, `env var`, `fixture`.

## Summary

The plan's *diagnosis* is right, its *mechanism* is right, and it is clean on the no-kill-switch constraint. But it places the guard at the wrong seam, and — the decisive problem — **its Binary AC suite has no power to detect that it placed the guard at the wrong seam.** Every one of AC-1 … AC-8 drives the courier through the `main()` script-entry path, so a guard installed only in `main()` passes the entire suite while the vulnerable code path survives untouched. Per Rule 18, a check that cannot come out the other way proves nothing; that is precisely the failure mode that let the original hole ship behind two "proofs of safety."

Six blocking amendments below. The mechanism (opt-in marker + shape floor + `refused` record) survives intact — this is a placement + AC-power correction, not a redesign.

## What I verified myself (and where the plan is wrong)

### The fifth write surface — HOLDS, with one correction to the brief

I read the source rather than taking the hand-off on faith. The structural claim holds; the call-site count in the brief I was given was an undercount.

| Claim | Verdict | Evidence |
|---|---|---|
| `main()` at ~275-282 | CONFIRMED | `scripts/upload-board.ts:275-283` |
| gated by `NODE_ENV !== "test"` at ~289 | CONFIRMED | `scripts/upload-board.ts:288-290` |
| `export async function uploadBoard(deps)` at ~147 | CONFIRMED | `scripts/upload-board.ts:147` |
| `uploadBoard()` is what actually calls `put(...)` | CONFIRMED | `scripts/upload-board.ts:230` — `const { url } = await put("board.json", body, {...})` |
| `uploadBoard()` reachable in-process WITHOUT `main()` | CONFIRMED | it is `export`ed; `main()` is the only caller inside the module |
| 13 + 3 = 16 in-process call sites | **UNDERCOUNT — actually 18** | `__tests__/upload-board.test.ts` = **15** (not 13); `__tests__/sync-failure-alert.test.ts` = **3** (lines 131, 140, 152) — confirmed |

**Honest scoping of the risk (I will not overclaim — overclaiming is how we got here).** All 18 in-process callers inject a *mock* `put` through `UploadDeps`, so none of them can reach the live blob **today**. The fifth surface is therefore not a currently-exploited live-publish path. It is two other things, and both are load-bearing:

1. **An unguarded code path to `put`.** Nothing structurally stops any future in-process caller from importing the real `put` from `@vercel/blob` and passing it — and the plan itself names that exact shape as the probable cause of the incident ("a future *live-fire test of the real hook path* — exactly the shape of run that probably caused this incident", plan line 45).
2. **The reason the AC suite is blind.** This is the decisive one. See BLOCKING-4.

The plan's Context line 24 — *"All publish surfaces funnel through the courier's single script entry … No other call site invokes the blob `put`"* — is **false as written**. It is true that no other call site invokes `put` *with the real `put`*; it is false that all paths to the `put` call funnel through the script entry. That false premise is what produces Critical-files line 66 (`scripts/upload-board.ts — courier entry: …`), and **"courier entry" most naturally reads as `main()`**. An executor given this plan, who then discovers that guarding inside `uploadBoard()` breaks 18 tests, will take the path of least resistance and move the guard to `main()` — where every AC still passes. That is exactly how a guard gets defanged.

### Write-surface enumeration — I found NO sixth surface

I did not assume the plan's list or the brief's list was complete. Enumerated from source:

- `grep -rn "@vercel/blob"` (excluding `node_modules`, `.next`, lockfile) → `package.json:19`, `scripts/upload-board.ts:23`, `__tests__/upload-board.test.ts` (mock). **`scripts/upload-board.ts` is the ONLY module in the repo that can reach the Blob SDK's `put`.**
- No `vercel blob` CLI invocation anywhere; no raw `curl -X PUT` / `fetch(..., {method:"PUT"})` to a blob host. The only blob `fetch` is a **read**: `lib/load-board.ts:64`.
- `.github/workflows/sync-live.yml` — name is alarming, content is benign: it merges `master` into the `live` branch to force a Vercel rebuild. **No blob token, no upload step.** `.github/workflows/ci.yml` has zero `upload|blob|token|kanban|sync` matches. CI cannot publish.
- `scripts/handoff-session.ts:269` runs `export:board` only, and documents at line 6 that uploads stay opt-in via `kanban:upload`. Not a write surface.
- `scripts/board-freshness-watchdog.ts` / `lib/board-freshness.ts` read the sync log. Not write surfaces.

**Conclusion: the surface set is exactly** `{ npm run kanban:upload, npm run kanban:sync, tsx scripts/upload-board.ts, scripts/on-task-change.sh:52 }` — all four of which are `main()` — **∪ `{ in-process uploadBoard() }`**. Five, not four, not six. The plan's four are all one seam; the fifth is the one it misses.

### The hook smoke is the incident's own shape — and AC-3 disarms it

This is the finding I did not expect and it is the sharpest one.

`__tests__/on-task-change-hook.test.ts:59` does `delete env.NODE_ENV` **on purpose** (its own comment: *"the REAL hook runs with it unset. Strip it so the export + courier `if (NODE_ENV !== "test") main()` guards actually fire (else both scripts no-op and write nothing — the smoke would be vacuous)"*).

So this test spawns the **real** hook → real `main()` → real `put` from `@vercel/blob` → real `defaultResolveBlobAuth`. It is the one test in the suite that is genuinely wired to production. The **only** thing standing between it and a live publish today is a three-part credential fence (`__tests__/on-task-change-hook.test.ts:42-61`):

1. `delete env.VERCEL_OIDC_TOKEN` + `delete env.BLOB_STORE_ID` → kills resolver arm 1 (`scripts/blob-auth.ts:257-259`)
2. `OIDC_TOKEN_FILE` → a **nonexistent** temp path → arm 2 misses the real repo-root token file, which **exists with a live token** (`scripts/blob-auth.ts:249`, `:170`)
3. a `vercel` PATH stub that exits 1 → the bootstrap/refresh `vercel env pull` arm is inert (`scripts/blob-auth.ts:172`)

Today, that test's fixture is a **1-ticket `#9999`, ~2 KB** board — so **post-fix, both new guards would independently stop it too**. Five locks.

**AC-3 deliberately removes two of them.** It requires the hook to set `BOARD_PUBLISH=1` *and* requires a "REAL-SHAPED fixture store (≥10 tickets, exported board ≥20,000 bytes, hex-prefix session, no id 9999)" — i.e. a board engineered to **pass** the shape floor, run by a hook that **self-authorizes** publishing, in the one test wired to the real blob SDK. The plan takes the single most dangerous test in the repo from five locks down to **one**: the credential fence. If that fence ever silently regresses (a new resolver arm, a changed default, an env leak), the result is a fixture board published to production that **passes the shape floor** — a strictly worse incident than the one being fixed, because the content-shape backstop would no longer catch it.

This does not mean "don't prove the hook still publishes" — that proof is necessary. It means the proof must not be bought by disarming the guards. See BLOCKING-6 for two ways to keep the proof and the locks.

### Collateral the plan does not account for at all

`__tests__/upload-board.test.ts` and `__tests__/sync-failure-alert.test.ts` **appear nowhere in the plan** — not in Critical files, not in the behavior contract, not in any AC. Both will be hit hard:

- All 18 in-process callers hit the new opt-in guard.
- Most will *also* hit the shape floor. Concretely, `sync-failure-alert.test.ts:111` writes its fixture board as `{"schema":1,"tickets":[]}` — **0 tickets, ~26 bytes**. Under the floor that is a `refused` / `synthetic-board`, returning **before** the injected failing `put` — which changes the semantics of all three alert-streak tests (they exist to prove `failed` records drive `consecutiveTrailingFailures`; they would now be driving it with `refused` records instead).

A plan whose AC-5 says "`npx jest` exits 0" but which never mentions the two test files that the change breaks is handing the executor a landmine with a strong incentive to defuse it the wrong way.

## What the plan gets RIGHT (keep all of this)

- **No kill-switch. Clean.** There is no `*_OVERRIDE` / `*_OFF` / `*_BYPASS` var anywhere in the plan. `BOARD_PUBLISH=1` is a *required opt-in that enables* the dangerous action — the gate itself, the opposite of a bypass. The plan argues this explicitly (line 38) and backs it with a mechanically-checked AC-6 *with a positive control*. Correct on the constraint and correct on the proof.
- **Fail-closed by construction.** Missing/unset marker ⇒ REFUSE. Not "refuse only if explicitly disabled." Correct.
- **The shape floor is correctly argued, not hand-waved.** The "invocation provenance vs content shape are different axes" argument (line 45) is sound, and the cost asymmetry reasoning is right. Keep it — and note that my BLOCKING-6 finding makes the floor *more* load-bearing, not less.
- **Both blind instruments are handled.** Traps §1 (never cite `data/sync.log` absence — `SYNC_LOG` is env-overridable, `lib/sync-log.ts:33-35`) and §2 (never cite `git status` on the gitignored `data/board.json`) are correctly identified, and AC-7 is content-based rather than VCS-based. AC-8 correctly uses *presence* in the default log (valid) rather than absence (not valid). This is the right discipline. *(Cross-check: #1579 covers the `git status`-on-gitignored-path ban. Ask: cite #1579 explicitly in the plan so the deferral is visible rather than implicit.)*
- **Positive controls on every zero-match grep** (Traps §3, AC-6, AC-7). Correct.
- **`refused` as a non-success result is nearly free.** `consecutiveTrailingFailures` (`scripts/upload-board.ts:72-82`) already fails **closed** — it breaks only on `uploaded` / `skipped-unchanged`, so any new value counts as a failure automatically. `sync-failure-alert.test.ts:57` already proves this with an out-of-union `"export-failed"` value. The union widening in `lib/sync-log.ts:15-19` is a one-line change. Low risk — but see NOTE-8 for the consumer list.

## BLOCKING amendments

**1. Pin the guard INSIDE `uploadBoard()`, not in `main()` — and say so in words the executor cannot misread.**
Replace the ambiguous Critical-files phrase *"courier entry"* (line 66). The publish opt-in check and the shape floor MUST execute inside `export async function uploadBoard(deps)` (`scripts/upload-board.ts:147`), on the code path that reaches `put(...)` (`:230`), and — per the plan's own before-credentials contract — **before the `resolveAuth()` call at `:175`**. A guard in `main()` (`:275-283`) leaves the `put` path open to every in-process caller and is entrypoint-class protection: the same design class as the jest fence that the plan itself correctly rejects as the failure mode. Also correct Context line 24, which is false as written.

**2. The marker MUST be read from the process environment inside `uploadBoard()`. It MUST NOT be added to `UploadDeps`.**
Do not add an `allowPublish` / `skipGuard` / `force` field to the `UploadDeps` interface (`scripts/upload-board.ts:57-64`). A caller-supplied authorization flag is a bypass by another name: it relocates the gate from "the process environment declared publish intent" back to "whatever the caller passed" — the exact caller-trust model that just failed — and any future in-process caller (or a refactor that defaults it `true`) reopens the hole with zero env involvement. `put` / `resolveAuth` / `boardPath` / `logPath` / `notify` stay injectable; **the gate does not.** (Update the `uploadBoard` docstring at `:143-146`, which currently promises a purely dep-driven function — a safety gate reading ambient env is a deliberate, documented exception, because a gate you can inject is not a gate.)

**3. Add AC-9 — the in-process RED-first test. This is the only AC with power against the actual vulnerability.**
> **AC-9 — `uploadBoard()` refuses in-process with the marker unset (the `put` is never invoked).**
> A jest test calls `uploadBoard(...)` **DIRECTLY, in-process**, with: a `jest.fn()` spy as the injected `put`, an injected `resolveAuth` returning a **valid** `oidc` auth, a **floor-PASSING** board fixture (≥10 tickets, ≥20,000 bytes, no id 9999, hex session), a temp `SYNC_LOG`, and `BOARD_PUBLISH` **deleted from `process.env`**. Asserts: (a) `expect(put).not.toHaveBeenCalled()`, (b) the returned code is non-zero, (c) exactly one `refused` / `publish-optin-missing` record in the temp log.
> **RED-first mandatory**: on PRE-FIX code this test FAILS because `put` *is* invoked (pre-fix `uploadBoard` reaches `:230` with a valid auth and a valid board). The verbatim pre-fix failure output goes in the evidence artifact alongside AC-4's.

The floor-passing fixture and the valid auth are load-bearing: they strip every *other* reason the courier might not call `put`, so the assertion isolates the opt-in guard. A test using a tiny fixture would pass post-fix via the shape floor and prove nothing about the opt-in.

**4. State explicitly in the plan that AC-1 … AC-8 have NO POWER against the misplacement, and that AC-9 is the discriminator.**
AC-1, AC-2, AC-3 drive the courier via `npm run kanban:upload` / `npm run kanban:sync` / `bash scripts/on-task-change.sh` — **all four of which are the `main()` path**. AC-4 through AC-8 are evidence/suite/liveness checks. **A `main()`-only guard passes 8 of 8.** An AC suite that cannot distinguish the safe fix from the unsafe one is the plan's central defect, and it is the same class of error as the two original "proofs of safety" (a `git status` on a gitignored path; a `sync.log` null on an env-overridable path) — instruments structurally incapable of detecting the thing they were cited to rule out. Name this in the plan so the executor and the execution-reviewer both know which AC is the real gate.

**5. Name the collateral test files and pin the opt-in mechanism.**
Add `__tests__/upload-board.test.ts` (15 in-process call sites) and `__tests__/sync-failure-alert.test.ts` (3 call sites, lines 131/140/152) to Critical files, and specify in the behavior contract:
- **How the existing tests legitimately opt in**: by setting the marker in the **test process's own environment** (e.g. a `beforeEach` that sets `process.env.BOARD_PUBLISH`, restored in `afterEach`) — an opt-in that is *not reachable from a real run*, because a real run's environment is not a jest process's environment. **Not** via a DI flag (BLOCKING-2).
- **Which fixtures must be migrated to real-shaped** (those whose tests assert the `put` path is reached), and **which deliberately stay synthetic** (those that exercise the floor). Call out `sync-failure-alert.test.ts:111`'s `{"schema":1,"tickets":[]}` board explicitly: 0 tickets / ~26 bytes will be `refused` by the floor and will **short-circuit before the injected failing `put`**, changing what the three alert-streak tests actually exercise. Decide and state whether those tests get a floor-passing fixture (preserving `failed`-driven streak semantics) or are re-based on `refused` records.
- Keep the exclusive-fixture discipline the plan already states: id `9999` remains exclusively the refused-fixture signature.

**6. Do not let AC-3 disarm the hook smoke down to a single lock.**
`__tests__/on-task-change-hook.test.ts` runs the REAL courier with the REAL `put` and the REAL auth resolver (it strips `NODE_ENV` at line 59 on purpose). AC-3 as written makes that test marker-authorized AND floor-passing, leaving the credential fence as the sole barrier to a live publish. Required:
- **(a) MANDATORY — a fence-integrity pre-assertion** in that test, so a fence regression fails RED instead of publishing. Before spawning the hook, assert all three locks are engaged: `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID` are absent from the child env; `OIDC_TOKEN_FILE` points at a path that does **not** exist (`fs.existsSync(...) === false`); the `vercel` stub resolves **first** on the child `PATH`. This is cheap, mechanical, and converts a silent catastrophic failure into a red test.
- **(b) STRONGLY RECOMMENDED — prove the marker is set with a run that is still floor-REFUSED.** Run the hook against the **existing tiny `#9999` fixture** and assert the refusal reason is **`synthetic-board`** and **NOT `publish-optin-missing`**. That is power-bearing (only a marker-setting hook can produce `synthetic-board`) and it proves the hook sets the marker while **both** new locks stay engaged and the courier never reaches auth or `put`. Keep AC-3's real-shaped traversal-to-auth run (`skipped-no-token` ≥ 1, `refused` == 0) as the separate traversal proof — but with (a) in place.

## Non-blocking notes for the executor

**7. AC-1's second half does not prove what it claims.** The fake-but-resolvable-credentials variant is said to prove "refusal happens before credential use" — it cannot. A guard placed *after* `resolveAuth()` but *before* `put` yields a byte-identical `refused` / `publish-optin-missing` record. The ordering claim is actually proven by AC-1's **first** half (nonexistent `OIDC_TOKEN_FILE` + no marker ⇒ `refused`), because a post-auth guard would hit `auth.mode === "none"` at `scripts/upload-board.ts:176` and return **`skipped-no-token`** first. Make that discriminator explicit: **add to AC-1 — `grep -c '"result":"skipped-no-token"' <temp log>` prints `0`.** The fake-credential probe keeps its real power where the plan already uses it well (AC-4's pre-fix control, where it proves the pre-fix courier traversed past auth to a genuine upload attempt).

**8. AC-6's bypass grep will not catch a DI-surface bypass.** `grep -Ec '(_OVERRIDE|_OFF|_BYPASS|_SKIP)[=_"]'` is token-shaped and would sail right past an `allowPublish: true` field on `UploadDeps`. Add a second arm: over the added lines of `scripts/upload-board.ts`, `grep -Ec '(allowPublish|skipGuard|forcePublish|bypass)'` prints `0`. Same positive-control discipline as the first arm.

**9. `refused` consumers — the full list, so "enumerate every consumer" is not left as an exercise.** `lib/sync-log.ts:15-19` (the closed `SyncResult` union), `scripts/upload-board.ts:72-82` (`consecutiveTrailingFailures` — already fails closed, no change needed), `lib/board-freshness.ts`, `scripts/board-freshness-watchdog.ts`, and `__tests__/sync-failure-alert.test.ts:57` (already asserts fail-closed on an out-of-union value). Low risk, but check `lib/board-freshness.ts` explicitly rather than assuming.

**10. Open question 1 (fresh/wiped store < 10 tickets ⇒ refused) — I confirm the plan's judgment.** Stale-truth beats fresh-fake, the refusal is loud (`synthetic-board` + the 3-strike alert), and declining to design an env-var escape hatch for it is exactly right. Do not let the executor "helpfully" add one.

**11. Open question 2 (reserved id `9999`) — accepted.** The reservation is documented, the failure is loud and diagnosable, and the recovery (rename one task) is proportionate. No change requested.

**12. Cite #1579 explicitly** in the Traps section, so the `git status`-on-gitignored-path ban reads as a tracked, deferred cross-reference rather than an implicit assumption.

## Re-review scope

Amendments 1-6 are blocking; 7-12 are notes the executor should fold in. On re-submission I will re-check, specifically: (i) the guard's position relative to `scripts/upload-board.ts:175` (`resolveAuth`) and `:230` (`put`); (ii) that `UploadDeps` gained no publish-authorizing field; (iii) that AC-9 exists, is RED-first, and asserts `put` was never invoked; (iv) that the hook smoke carries a fence-integrity pre-assertion. Everything else in the plan — mechanism, floor, no-kill-switch discipline, blind-instrument handling — I am satisfied with as written.
