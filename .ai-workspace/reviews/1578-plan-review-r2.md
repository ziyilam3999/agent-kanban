# Plan review r2 — #1578 fail-closed publish guard (SEV-HIGH)

decision: PASS

- **Plan under review**: `.ai-workspace/plans/2026-07-11-1578-fixture-board-publish-guard.md` (r2, rewritten in place)
- **Round 1 review**: `.ai-workspace/reviews/1578-plan-review.md` (NEEDS-WORK, six blocking amendments)
- **Reviewer**: plan-review seat (did NOT author the plan). Re-verified cold against source, not against the planner's revision log.
- **Date**: 2026-07-11

cairn: matched (T1 2026-07-10) "A null result refutes a hypothesis only if the test could have come out the other way" and (T1 2026-06-21) "When adding a gate to one code path, audit ALL publish surfaces". Queried: `publish guard fixture board`, `power`, `vacuous`, `guard`.

## Verdict

**PASS. Ship it.** All six blocking amendments landed in substance, not just in the revision log. I verified each against the source rather than the plan's own narrative, and the load-bearing one — **AC-9 — has real power**: it is genuinely RED pre-fix, and a `main()`-only guard genuinely fails it. The AC POWER MAP's central claim is honest. The no-kill-switch discipline survives the rewrite. Seven non-blocking executor notes below; none of them justifies holding a live production leak for another round.

## Amendment-by-amendment: did it actually land?

| # | Amendment | Landed? | Verified against |
|---|---|---|---|
| B1 | Guard pinned inside `uploadBoard()`, not `main()`; false Context line replaced | **YES** | plan:37, 52, 82 vs `scripts/upload-board.ts:147, 175, 230, 275-283, 288-290` |
| B2 | Marker from process env; `UploadDeps` forbidden any authorizing field | **YES** | plan:53, 83 vs `scripts/upload-board.ts:57-64` |
| B3 | AC-9 added, RED-first, `put` spy never invoked | **YES — with real power** | plan:155-158 vs full trace of `uploadBoard()` |
| B4 | AC POWER MAP: AC-1…AC-8 blind, AC-9 the discriminator | **YES — and the claim is TRUE** | plan:112-114, independently re-derived |
| B5 | Collateral test files named; opt-in via test-process env, never DI | **YES — and the opt-in is unreachable from a real run** | plan:69-72, 95-96 vs `jest.config.js` |
| B6 | AC-3 preserves the hook smoke's locks; no drop to a single fence | **YES in substance** (prose overcounts — see N-G) | plan:73-76, 128-133 vs `__tests__/on-task-change-hook.test.ts:42-61` |

### B3 — AC-9 has REAL power (the whole ballgame)

I traced `uploadBoard()` line by line with AC-9's exact setup (floor-passing fixture, injected valid `oidc` auth, `jest.fn()` put spy, fresh temp `logPath`, `BOARD_PUBLISH` deleted):

- `:152` `existsSync(boardPath)` — passes (the fixture exists).
- `:175` `resolveAuth()` — returns the injected valid auth, so `:176` (`mode === "none"`) does NOT fire. No `skipped-no-token` escape.
- `:193` reads the body.
- `:198-217` content-hash dedup — a fresh temp log means `lastRemoteHash([])` returns `null` (`:139`), so the `skipped-unchanged` short-circuit does NOT fire. No second escape.
- `:230` **`put(...)` IS invoked.**

So assertion (a) `expect(put).not.toHaveBeenCalled()` **fails pre-fix**. AC-9 is genuinely RED, and it is RED for the right reason — the fixture and the valid auth strip every *other* reason `put` might not be called, exactly as the AC's own rationale claims.

**And it discriminates.** AC-9 calls `uploadBoard()` directly, so `main()` is never on the path. A `main()`-only guard leaves `put` firing → AC-9 stays RED post-"fix". That is a genuine, load-bearing discriminator, not a decorative one. It also polices the `NODE_ENV`-conditioning escape (a guard disabled under jest lets the spy fire).

### B4 — I re-derived the power map myself; it is honest

The planner asserts a `main()`-only guard passes AC-1…AC-8. I checked the three I was asked to, and they hold:

- **AC-1** (`npm run kanban:upload` → `main()`): a `main()`-only guard refuses before ever calling `uploadBoard()` → no `resolveAuth()` → `refused`=1, `publish-optin-missing`=1, `skipped-no-token`=0, non-zero exit. **Passes.**
- **AC-2** (same entry + `BOARD_PUBLISH=1` + incident board): a `main()`-only guard that reads and parses the board in `main()` fires the floor there → `synthetic-board`=1, `uploaded`=0, `skipped-no-token`=0. **Passes.**
- **AC-3** (`scripts/on-task-change.sh:52` → `npm run kanban:upload` → `main()`): (a) is a test-internal assertion → passes; (b) the hook sets the marker, `main()`'s floor refuses the tiny `#9999` board → `synthetic-board`, no `publish-optin-missing`, no `skipped-no-token` → passes; (c) the real-shaped board clears `main()`'s guards → `uploadBoard()` → `resolveAuth()` → `skipped-no-token` → passes. **Passes.**
- AC-4…AC-8 are evidence/suite/liveness. Note AC-5 in particular: a `main()`-only guard needs **no** test migrations at all (the 18 in-process sites never touch it), so `npx jest` stays green — which is precisely the path-of-least-resistance the plan names.

**"8 of 8" is a true statement, and AC-9 is genuinely the sole discriminator.** The power map is not a comfortable fiction.

### B5 — the opt-in really is unreachable from a real run

I interrogated this rather than accepting "test-process env" at face value:

- `jest.config.js` has **no `setupFiles`, no `setupFilesAfterEnv`, no `globalSetup`** — there is no shared setup surface today, so the opt-in stays per-file in `beforeEach`/`afterEach` as the plan specifies.
- Structurally, a production invocation is not a jest process and never executes a jest `beforeEach`. There is no path by which a real run inherits it.
- The one leak shape that *would* defang the guard — baking `BOARD_PUBLISH=1` into a `package.json` script or a `.env` — is **caught by AC-1**, which requires bare `npm run --silent kanban:upload` to exit non-zero and record `publish-optin-missing`. AC-1 has power against exactly that.

The `sync-failure-alert.test.ts:111` decision (migrate the 0-ticket fixture to floor-passing rather than re-base the streak tests on `refused`) is the right call and is stated explicitly.

### B6 — the hook smoke keeps its locks; only the *count* is overstated

AC-3 carries all three parts I demanded in r1: (a) the mandatory fence-integrity pre-assertion, (b) the marker-proof via a still-floor-REFUSED tiny-`#9999` run asserting `synthetic-board` and NOT `publish-optin-missing`, (c) the real-shaped traversal proof as an explicit regression arm with (a) in place. It does **not** relabel the problem — case (b) keeps the floor live as a real barrier, and the pre-assertion turns a fence regression into a RED test in both cases. This matches my r1 text, including my own instruction to keep the traversal run as a separate case with (a) in place.

Honest correction, non-blocking (N-G): on a **hook-driven** run the marker is never a lock — the hook *sets* it, by design. So case (b) carries 4 real barriers (3 credential arms + the floor) and case (c) carries 3 (credential arms only; both new guards are deliberately passed, which is the entire point of a traversal proof) plus the pre-assertion as a detector. "Five locks" is not literally true for case (c). The design is right — case (c) *cannot* retain the floor without ceasing to prove traversal — but the plan should not overstate its own safety count. That is the same family as the r1 false Context line, which is why I am naming it.

### No new kill-switch — re-verified CLEAN

No `*_OFF` / `*_OVERRIDE` / `*_BYPASS` / `*_SKIP` variable anywhere in the plan. `BOARD_PUBLISH=1` is a **required positive opt-in that enables** the dangerous action — the gate itself, not a bypass around it. DI-surface authorization is explicitly forbidden (plan:53) and policed by AC-6 arm 2 with a positive control (plan:144). `NODE_ENV`-conditioning of the guard is explicitly forbidden (plan:52) and policed by AC-9. The fresh-store open question explicitly declines to design an escape hatch (plan:162). Clean.

### RED-first honesty — 4 Pre-fix lines spot-checked against source, all TRUE

- **AC-1** "records `skipped-no-token`, no `refused` token exists" — VERIFIED. Nonexistent `OIDC_TOKEN_FILE` + deleted ambient creds ⇒ `blob-auth.ts` arm 1 misses (`:255-256`), arm 2 misses (file absent), arm 3 returns `{mode:"none"}` (`:268`) ⇒ `upload-board.ts:176-190` records `skipped-no-token` and returns 1. The `skipped-no-token == 0` clause is the real discriminator; the non-zero-exit clause is *not* discriminating (pre-fix also exits 1) — but the plan never claims it is.
- **AC-2** "traverses to auth, records `skipped-no-token`; `synthetic-board` grep prints 0" — VERIFIED, same trace.
- **AC-3(b)** "the tiny-fixture run records `skipped-no-token`, not `synthetic-board`" — VERIFIED: that is *exactly* what the existing `AC-HOOK-SMOKE` test asserts today (`__tests__/on-task-change-hook.test.ts:118-121`).
- **AC-9** "the `put` spy IS invoked" — VERIFIED by the full trace above.

### Collateral: the `refused` widening really is one line

`SyncResult` has **zero** exhaustive switches repo-wide (only `lib/sync-log.ts:15,24`). The only `.result` readers are `upload-board.ts:77` (`consecutiveTrailingFailures` — breaks only on `uploaded`/`skipped-unchanged`, so `refused` counts as failure automatically) and `:132` (`lastRemoteHash` — same break condition, so a `refused` record is skipped when scanning for the remote hash, failing safe toward uploading). Both already fail closed. See N-F.

## Non-blocking notes for the executor

**N-A — MUST READ. The vacuity trap on the two new script-path ACs.**
AC-1 and AC-2 spawn `npm run --silent kanban:upload` from *inside* a jest test. Jest sets `NODE_ENV=test`, and `scripts/upload-board.ts:288` runs `main()` **only** when `NODE_ENV !== "test"`. If the spawned child inherits `NODE_ENV=test`, `main()` never fires, the courier writes **nothing**, and both ACs are vacuous. This exact trap is already documented in this repo — `__tests__/on-task-change-hook.test.ts:56-59` deletes `NODE_ENV` from the child env with the comment *"else both scripts no-op and write nothing — the smoke would be vacuous."* The plan's Traps section does not name it. **Do `delete env.NODE_ENV` in the child env of every `spawnSync` script run in `__tests__/publish-guard.test.ts`, exactly as the hook smoke does.** It fails loudly rather than silently (AC-1's non-zero-exit clause and the `refused == 1` grep both break), so this costs a cycle rather than shipping a hole — but get it right the first time.

**N-B — AC-9's temp log MUST start empty.**
The `put` spy can also fail to fire for a reason that has nothing to do with the guard: the content-hash dedup at `upload-board.ts:198-217` returns `skipped-unchanged` and never calls `put` if the injected `logPath` already holds an `uploaded`/`skipped-unchanged` record whose `hash` equals the fixture's sha256. A fresh `mkdtemp` log gives `lastRemoteHash([]) === null` (`:139`) → no short-circuit → `put` fires, so the natural implementation is correct. But AC-9's text says only "a temp log file via `deps.logPath`". **Pin it: the temp log starts empty (no prior record whose hash matches the fixture)** — otherwise AC-9 goes green pre-fix for the wrong reason and its power evaporates. This is the plan's own Trap #4 turned on its own discriminator.

**N-C — Guard order vs the `existsSync` check at `:152`.**
The plan pins the guard "before `resolveAuth()` at `:175`" but is silent about the `existsSync(boardPath)` check at `:152`. **Keep `existsSync` first.** `__tests__/upload-board.test.ts:181` asserts an absent board yields `failed` / `board-not-found` with the resolver never consulted; if the shape floor runs before `:152`, a missing board (0 bytes) is refused as `synthetic-board` and that contract silently changes. AC-5 will catch the break — but do **not** "fix" it by accepting `synthetic-board`; preserve `board-not-found`.

**N-D — A stronger, complete fence-integrity pre-assertion (recommended, not required).**
AC-3(a) enumerates the three currently-known credential arms. That is what I asked for in r1 and it passes — but it is an *allowlist*, and a future fourth arm in `scripts/blob-auth.ts` would sit outside it at exactly the moment AC-3(c)'s new real-shaped fixture (which passes the floor by design) is the one live-publish-shaped run in the suite. A complete version is cheap: `defaultResolveBlobAuth` takes injectable deps (`scripts/blob-auth.ts:245` — `overrides: Partial<BlobAuthDeps>`, with `env` read at `:249`), so the pre-assertion can call the **real resolver with the child's env** and assert `mode === "none"` — covering every arm, present and future, with no `put` risk. **Caveat if you take this**: also inject a failing `pullEnv` (or the stub `PATH`), because the refresh arm execs the real `vercel` (`:110`) and the parent process's `PATH` is *not* the child's fenced `PATH`.

**N-E — AC-3(c)'s fixture must clear the floor on the EXPORTED artifact, not the inputs.**
The ≥20,000-byte arm applies to the board file the courier reads. Verify the fixture store's *exported* `board.json` actually exceeds 20,000 bytes (pad descriptions if needed) — ≥10 tickets alone does not guarantee it.

**N-F — N9's consumer list is over-inclusive (harmless).**
`lib/board-freshness.ts` and `scripts/board-freshness-watchdog.ts` never read `.result` at all. The real consumers are `upload-board.ts:77` and `:132`, both already fail-closed. The plan's instruction ("check explicitly, do not assume") is still the right posture — the answer is just "nothing to do".

**N-G — Restate the "five locks" headline honestly.**
See B6 above. Case (b) = 3 credential arms + the floor; case (c) = 3 credential arms + the pre-assertion detector. The marker is never a lock on a hook-driven run.

## Re-review scope: satisfied

My r1 re-review contract was: (i) guard position relative to `:175`/`:230`; (ii) no publish-authorizing `UploadDeps` field; (iii) AC-9 exists, is RED-first, asserts `put` was never invoked; (iv) the hook smoke carries a fence-integrity pre-assertion. **All four confirmed against source.** The mechanism, the floor, the no-kill-switch discipline, and the blind-instrument handling I was already satisfied with in r1 survive the rewrite intact.

Executor: build it. The notes above are precision, not gates.
