# Execution review — #1578 fail-closed publish guard (SEV-HIGH)

decision: PASS

- **Reviewer**: execution-review seat (independent — did NOT write this code). Every claim below was re-verified against source and live behaviour, not against the executor's evidence table.
- **PR**: #61 (`1578-fixture-board-publish-guard`, base master) — reviewed at head `1ed7a22`. NOT merged by this review.
- **Plan**: `.ai-workspace/plans/2026-07-11-1578-fixture-board-publish-guard.md` (r2, plan-review PASS)
- **Date**: 2026-07-11
- Home paths in this file are written `<HOME>`; all greps below ran as `command grep -Ec` + numeric compare with positive controls in the same invocation shape, never through a `| head`/`| tail` pipe.

## The central question — guard placement (AC-9, the sole discriminator)

**VERIFIED at the pinned seam, by reading and by running.**

1. **Read the code.** The opt-in guard (`process.env.BOARD_PUBLISH !== "1"`) is at `scripts/upload-board.ts:268` and the fixture-shape floor at `:290` — both INSIDE `export async function uploadBoard(deps)` (`:234`), after `existsSync`/`stat`, BEFORE `resolveAuth()` (`:306`), on the only path to `put()` (`:359`). `main()` (`:404`) reaches `put()` only through `uploadBoard()`. The guard is NOT conditioned on `NODE_ENV` (the only `NODE_ENV` check is the pre-existing `main()` auto-run gate at `:417`, which is not on the guard path).
2. **AC-9 run MYSELF, both directions.**
   - **GREEN on PR head**: `npx jest __tests__/publish-guard.test.ts` — 3/3 pass (AC-1, AC-2, AC-9).
   - **RED on pre-fix code**: reverted ONLY `scripts/upload-board.ts` to the base commit `4f434af` (keeping the new tests + widened `SyncResult`), reran — **3/3 fail, and AC-9 fails at exactly the discriminating assertion** (`expect(put).not.toHaveBeenCalled()` — received 1 call, with valid injected oidc auth and a floor-passing fixture, temp log fresh per N-B). The test has genuine power against a `main()`-only guard; worktree restored clean afterwards (`git status` empty).
3. **Defeat attempts (all failed to reach `put()` without the marker):**
   - `UploadDeps` (`:68-75`) carries NO authorization field — read directly, not just grepped (the AC-6 arm-2 grep is an allowlist; the interface read is the real check). `put`/`resolveAuth`/`boardPath`/`logPath`/`notify` only.
   - No `NODE_ENV` special case on the guard (grep + read).
   - Export surface of the module: `defaultNotify`, `PutFn`, `UploadDeps`, `consecutiveTrailingFailures`, `shouldNotify`, `uploadBoard` — no re-exported internal reaches `put()` around the guard; `looksSynthetic`/`lastRemoteHash` are not exported.
   - `jest.config.js` + `package.json`: `setupFiles|setupFilesAfterEach|setupFilesAfterAll|globalSetup` count = 0 and 0 (positive control on planted text: 2). No setup file could plant the marker into a real run.
   - No dotenv/`--env-file`/`loadEnvConfig` auto-loading on the courier path (count 0); `scripts/blob-auth.ts` parses the token file itself and never assigns into `process.env`.
   - Only `scripts/upload-board.ts` imports `@vercel/blob` in product code (tests mock it).
   - The sanctioned test opt-in (`process.env.BOARD_PUBLISH = "1"` in `beforeEach`, save/restore in `afterEach` — `__tests__/upload-board.test.ts:83-103`, `__tests__/sync-failure-alert.test.ts:107-151`) lives in the TEST PROCESS'S OWN environment, unreachable from a real run.

## Binary AC — verified independently

- **AC-1 / AC-2**: PASS (ran in my own jest run, PR head); RED pre-fix in my own revert run (refused/synthetic-board counts 0 pre-fix, `skipped-no-token` ordering discriminator present).
- **AC-3**: PASS — all 3 hook-smoke cases (fence-integrity + marker-proof, traversal, export-fail) green in my full-suite run. The fence-integrity pre-assertion is STRONGER than the plan required: it calls the real `defaultResolveBlobAuth({ env: childEnv, pullEnv: () => false })` and asserts `mode === "none"` — a dynamic, all-arms check, with the parent-process `pullEnv` correctly neutralized.
- **AC-4**: PASS — evidence artifact ships in the PR; `grep -c '"result":"failed"'` = 2 (≥1), `grep -Ec 'FAIL|✕'` = 12 (≥2). Its verbatim pre-fix RED blocks match what I reproduced myself.
- **AC-5**: PASS — my own runs on PR head: `npx tsc --noEmit` exit 0; `npx jest` = 338/338 tests pass, 33/34 suites. The 1 failing suite (`lane-reveal.test.ts`) is the claimed pre-existing gap and I verified it on master directly: identical `jest-environment-jsdom cannot be found` failure on master's own copy (missing from the primary clone's `node_modules`; CI installs it via `npm ci`, hence green CI), and the branch diff touches that file 0 lines.
- **AC-6**: PASS — arm 1 over the FULL branch diff added lines: 0 (positive control 2); arm 2 over `scripts/upload-board.ts` added lines: 0 (positive control 1). The `f603f0f` docstring reword that cleared arm 2 is cosmetic — the interface genuinely has no such field (read, not trusted).
- **AC-7**: PASS — fetched the live production board MYSELF at review time: 669,795 bytes, **382 tickets** (≥50), `grep -Ec '"id": ?"9999"'` = 0 with a planted-fixture positive control = 1. Production intact NOW.
- **AC-8**: post-merge by design — not runnable pre-merge; the `refused`-streak + 3-strike alert is the over-closure detector. Deferred, correctly.
- **AC-9**: PASS — see the central question above. RED pre-fix / GREEN post-fix in MY runs.

## (A) Adjudication — the executor's live production probe (AC-4c)

**Verdict: justified and safe as executed; it is the strongest available reachability proof, and it was plan-mandated (AC-4c, plan-review r2 PASS), not freelancing. One lock deviation noted.**

- **Did it write anything?** No. The recorded outcome is `"result":"failed","reason":"BlobAccessError"` — Vercel rejected the garbage-signature JWT server-side before any write. Independently confirmed by content: the live board NOW is 669,795 bytes / 382 tickets / no id 9999; the probe's board was 190 bytes — had it landed, the board would be 190 bytes. It is not.
- **Could it have?** The credential was a crafted well-formed JWT with far-future `exp` and a garbage signature, plus a fake store id, in a temp `OIDC_TOKEN_FILE`; ambient `VERCEL_OIDC_TOKEN`/`BLOB_STORE_ID` were `env -u`-stripped. The blob pathname WAS the production `board.json` with `allowOverwrite: true` — so the sole barrier was the garbage credential, and the write would have succeeded only if Vercel accepted an invalid signature (outside our trust boundary). That is exactly the power the plan demanded: proof that PRE-FIX code traverses past auth to a real `put()` attempt, which no mocked test can show.
- **Deviation (note, non-blocking):** the plan's AC-4c specified a `vercel` stub failing on PATH as an additional lock; the evidence's command line shows no PATH stub. Compensating facts: the far-future `exp` means the refresh arm never fires, the token file EXISTS so the bootstrap-pull arm never fires, and the observed `BlobAccessError` proves the garbage token is what actually got used. Low residual risk, but the specified lock should have been visibly engaged.
- **Is the artifact a recipe for the failure being fixed?** No. Replayed against post-fix code the exact command is DOUBLY refused (`publish-optin-missing` — no `BOARD_PUBLISH`; and the 190-byte board trips `synthetic-board`). It contains no real credential; the blob URL it quotes is the already-public read URL. To publish for real, a future agent needs real creds + `BOARD_PUBLISH=1` + a floor-passing board — the documented deliberate manual path, not a leak.

## (B) Adjudication — stranded plan/review artifacts (#1509/#1544 class)

**CONFIRMED STRANDED, and FIXED by this review.** `git ls-files` oracle:
- PR branch tracked only `.ai-workspace/reviews/1578-execution-evidence.md`.
- The plan + both plan-reviews (`2026-07-11-1578-fixture-board-publish-guard.md`, `1578-plan-review.md`, `1578-plan-review-r2.md`) were tracked ONLY on the unmerged local branch `review/1578-plan-review-r2`; master tracks zero 1578 files.
- Fix applied: all three `git add -f`ed into PR #61 alongside this review file, same commit. The authoritative AC + the PASS verdicts now ship with the work they gate.

## Also verified

- **No kill-switch**: zero new `*_OVERRIDE|*_OFF|*_BYPASS|*_SKIP` env tokens in the full diff (control 2); no DI authorization field. `BOARD_PUBLISH=1` is a required positive opt-in, not a bypass — correct trust model.
- **Fail closed**: marker missing/unset ⇒ `refused`/`publish-optin-missing`, exit 1, before any credential resolution (`skipped-no-token` count 0 — verified in test assertions and in my RED/GREEN runs). Unparsable JSON is refused as synthetic (fail closed on can't-tell).
- **Hook marker containment**: `scripts/on-task-change.sh:58` sets `BOARD_PUBLISH=1` as a command-prefix on the single courier invocation — not `export`ed; it reaches only that command's own process tree, no child test process.
- **Privacy (public repo)**: full-diff added lines — `/Users/<name>` paths 0, personal-email tokens 0 (positive control 2). The evidence artifact uses `<tmp>` placeholders.
- **`refused` consumer**: `consecutiveTrailingFailures` breaks only on `uploaded`/`skipped-unchanged`, so `refused` counts as failure and feeds the 3-strike alert with no change — matches the plan's N9 enumeration.

## Notes for the record (non-blocking)

1. AC-4c's `vercel` PATH stub lock was not visibly engaged in the probe command (see (A)).
2. AC-6's greps are allowlists by construction; this review's guarantee rests on the interface/module reads above, with the greps as regression tripwires.
3. AC-8 (post-merge liveness) remains open by design — the first real task change after merge should append `uploaded`/`skipped-unchanged`; a `refused` streak there means the hook is not marker-bearing in production and must be treated as the over-closure signal.

decision: PASS
