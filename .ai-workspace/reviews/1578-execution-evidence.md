# Execution evidence — #1578 fail-closed publish guard (SEV-HIGH)

- **Plan**: `.ai-workspace/plans/2026-07-11-1578-fixture-board-publish-guard.md` (r2, PASS)
- **Executor**: cc-executor, worktree `1578-fixture-board-publish-guard`
- **Date**: 2026-07-11

This artifact is the RED-first evidence for AC-1, AC-2, AC-3(b), and AC-9, plus
the AC-4(c) fake-but-resolvable-credentials probe, plus the AC-6/AC-7 shell
checks — captured per the plan's hard RED-first constraint.

## Guard placement (the one thing that matters most)

The publish opt-in guard and the fixture-shape floor both live INSIDE
`export async function uploadBoard(deps)` at `scripts/upload-board.ts:233`,
after the `existsSync`/`stat` block, and BEFORE `resolveAuth()`:

- Opt-in guard: `scripts/upload-board.ts:267` (`if (process.env.BOARD_PUBLISH !== PUBLISH_MARKER_VALUE)`)
- Shape floor: `scripts/upload-board.ts:289` (`if (looksSynthetic(boardBytes, body))`)
- `resolveAuth()` call: `scripts/upload-board.ts:305`

Both guards run BEFORE any credential resolution, on the path to `put()` at
`scripts/upload-board.ts:358`, and are NOT conditioned on `NODE_ENV`. There is
no publish-authorizing field on `UploadDeps` (`scripts/upload-board.ts:57-74`
explicitly documents the exclusion) — the marker is read straight from
`process.env.BOARD_PUBLISH` inside `uploadBoard()`.

## Pre-fix RED capture (verbatim)

Captured by `git stash push -- scripts/upload-board.ts scripts/on-task-change.sh`
(reverting ONLY the guard logic; `lib/sync-log.ts`'s widened `SyncResult` type
stayed in place so the new/modified tests still compiled), then:

```
npx jest __tests__/publish-guard.test.ts __tests__/on-task-change-hook.test.ts --verbose
```

Result: **4 failed, 2 passed, 6 total** — exactly the split the plan's AC
power map predicts (AC-1/AC-2/AC-9/AC-3b RED; AC-3c/AC-EXPORT-FAIL GREEN by
design as regression arms). Verbatim output:

```
  console.error
    upload-board: upload failed — Cannot destructure property 'url' of '(intermediate value)' as it is undefined.

      254 |     // only the error CLASS (not the message/stack) so no request internals leak.
      255 |     const msg = err instanceof Error ? err.message : String(err);
    > 256 |     console.error(`upload-board: upload failed — ${msg}`);
          |             ^
      257 |     const errClass =
      258 |       err instanceof Error ? err.constructor.name || "Error" : "unknown-error";
      259 |     appendSyncRecord(

      at uploadBoard (scripts/upload-board.ts:256:13)
      at Object.<anonymous> (__tests__/publish-guard.test.ts:228:20)

FAIL __tests__/publish-guard.test.ts
  publish-guard — script-path RED controls (#1578 AC-1, AC-2)
    ✕ AC-1: inert by default — opt-in missing → refused before credentials (569 ms)
    ✕ AC-2: shape floor refuses synthetic content even when publishing is authorized (553 ms)
  publish-guard — AC-9 in-process discriminator (#1578, THE placement gate)
    ✕ AC-9: uploadBoard() refuses IN-PROCESS with the marker unset; the put spy is never invoked (14 ms)

  ● publish-guard — script-path RED controls (#1578 AC-1, AC-2) › AC-1: inert by default — opt-in missing → refused before credentials

    expect(received).toBe(expected) // Object.is equality

    Expected: 1
    Received: 0

      174 |     expect(res.status).not.toBe(0);
      175 |     const raw = readFileSync(logPath, "utf8");
    > 176 |     expect(countMatches(raw, '"result":"refused"')).toBe(1);
          |                                                     ^
      177 |     expect(countMatches(raw, '"reason":"publish-optin-missing"')).toBe(1);
      178 |     // The ordering discriminator (N7, r1 note 7): a guard placed AFTER
      179 |     // resolveAuth() would hit auth.mode === "none" first and record

      at Object.<anonymous> (__tests__/publish-guard.test.ts:176:53)

  ● publish-guard — script-path RED controls (#1578 AC-1, AC-2) › AC-2: shape floor refuses synthetic content even when publishing is authorized

    expect(received).toBe(expected) // Object.is equality

    Expected: 1
    Received: 0

      194 |     expect(res.status).not.toBe(0);
      195 |     const raw = readFileSync(logPath, "utf8");
    > 196 |     expect(countMatches(raw, '"reason":"synthetic-board"')).toBe(1);
          |                                                             ^
      197 |     expect(countMatches(raw, '"result":"uploaded"')).toBe(0);
      198 |     // The floor also fires before auth — same ordering discriminator as AC-1.
      199 |     expect(countMatches(raw, '"result":"skipped-no-token"')).toBe(0);

      at Object.<anonymous> (__tests__/publish-guard.test.ts:196:61)

  ● publish-guard — AC-9 in-process discriminator (#1578, THE placement gate) › AC-9: uploadBoard() refuses IN-PROCESS with the marker unset; the put spy is never invoked

    expect(jest.fn()).not.toHaveBeenCalled()

    Expected number of calls: 0
    Received number of calls: 1

    1: "board.json", {"data": [123, 34, 115, 99, 104, 101, 109, 97, 34, 58, …], "type": "Buffer"}, {"access": "public", "addRandomSuffix": false, "allowOverwrite": true, "cacheControlMaxAge": 0, "contentType": "application/json", "oidcToken": "synthetic.oidc.jwt", "storeId": "store_test123"}

      229 |
      230 |       // (a) the placement discriminator itself.
    > 231 |       expect(put).not.toHaveBeenCalled();
          |                       ^
      232 |       // (b) non-zero exit.
      233 |       expect(code).not.toBe(0);
      234 |       // (c) exactly one refused/publish-optin-missing record.

      at Object.<anonymous> (__tests__/publish-guard.test.ts:231:23)

FAIL __tests__/on-task-change-hook.test.ts
  on-task-change.sh — #1158 Layer B / #1578 AC-3 mandatory hook smoke
    ✕ AC-3 fence-integrity + marker-proof: hook sets BOARD_PUBLISH, tiny #9999 fixture stays floor-REFUSED (synthetic-board) (985 ms)
    ✓ AC-3 traversal: real hook + real-shaped fixture clears BOTH guards, reaches credential resolution (skipped-no-token) (725 ms)
    ✓ AC-EXPORT-FAIL: export:board failure → hook still exits 0 AND logs `export-failed` (586 ms)

  ● on-task-change.sh — #1158 Layer B / #1578 AC-3 mandatory hook smoke › AC-3 fence-integrity + marker-proof: hook sets BOARD_PUBLISH, tiny #9999 fixture stays floor-REFUSED (synthetic-board)

    expect(received).toBeGreaterThanOrEqual(expected)

    Expected: >= 1
    Received:    0

      170 |       (r) => r.result === "refused" && r.reason === "synthetic-board"
      171 |     );
    > 172 |     expect(refusedSynthetic.length).toBeGreaterThanOrEqual(1);
          |                                     ^
      173 |     expect(
      174 |       recs.filter((r) => r.reason === "publish-optin-missing")
      175 |     ).toHaveLength(0);

      at Object.<anonymous> (__tests__/on-task-change-hook.test.ts:172:37)

Test Suites: 2 failed, 2 total
Tests:       4 failed, 2 passed, 6 total
Snapshots:   0 total
Time:        3.524 s
Ran all test suites matching /__tests__\/publish-guard.test.ts|__tests__\/on-task-change-hook.test.ts/i.
```

Why each RED result is the RIGHT red (power, not noise):
- **AC-1** RED because `refused`/`publish-optin-missing` never appear (count 0 vs expected 1) — pre-fix code has no opt-in check at all.
- **AC-2** RED because `synthetic-board` never appears — pre-fix code has no shape floor.
- **AC-9** RED because the `put` spy WAS called (received 1, expected 0) — pre-fix `uploadBoard()` reaches `put()` in-process with a valid injected auth and a floor-passing board, exactly as plan-review r2 traced line-by-line.
- **AC-3(b) marker-proof** RED because `refusedSynthetic.length` is 0 — pre-fix the tiny `#9999` fixture run through the real hook records `skipped-no-token` (as the OLD `AC-HOOK-SMOKE` test asserted), not `synthetic-board`.
- **AC-3(c) traversal** and **AC-EXPORT-FAIL** stayed GREEN pre-fix BY DESIGN (regression arms — see the plan's Pre-fix lines for AC-3).

## AC-4(c) — pre-fix fake-but-resolvable-credentials probe

Ran the PRE-FIX courier (`scripts/upload-board.ts`, same stashed state as
above) directly via `npx tsx scripts/upload-board.ts`, with a syntactically
valid but bogus OIDC token (well-formed JWT, `exp` one year in the future,
garbage signature) and a fake store id in a crafted token file — no ambient
credentials, `NODE_ENV` unset so `main()` runs for real:

```
$ env -u VERCEL_OIDC_TOKEN -u BLOB_STORE_ID -u NODE_ENV \
    OIDC_TOKEN_FILE=<tmp>/fake-oidc.env OUT=<tmp>/board.json SYNC_LOG=<tmp>/sync.log \
    npx tsx scripts/upload-board.ts

upload-board: upload failed — Vercel Blob: Access denied, please provide a valid token for this resource.
EXIT:1
```

Resulting sync-log record:

```json
{"ts":"2026-07-11T12:58:50.515Z","result":"failed","reason":"BlobAccessError","url":null,"boardBytes":190,"boardMtime":"2026-07-11T12:58:38.212Z"}
```

This proves pre-fix code traversed all the way past auth resolution to an
ACTUAL `put()` attempt against the real Vercel Blob API — the server rejected
the garbage token (`BlobAccessError`), and only that server-side rejection
prevented a publish. No board was written; the request was rejected before
any bytes landed. `grep -c '"result":"failed"'` over this artifact prints
≥1 (the JSON record above), and `grep -Ec 'FAIL|✕'` over this artifact prints
≥2 (the AC-1/AC-2/AC-9/AC-3b jest FAIL blocks above).

## Post-fix GREEN confirmation

`git stash pop` restored the fix. Then:

```
$ npx tsc --noEmit
(exit 0, no output)

$ npx jest
Test Suites: 1 failed, 33 passed, 34 total
Tests:       338 passed, 338 total
```

The one failing suite (`__tests__/lane-reveal.test.ts`) is a PRE-EXISTING,
UNRELATED infra gap — `jest-environment-jsdom` is listed in
`package.json` devDependencies but is not installed in the primary clone's
`node_modules` (`npm ls jest-environment-jsdom` in the primary clone prints
`(empty)`). That file is untouched by this diff (last touched by an unrelated
PR #55) and the gap predates this branch. All 338 tests that DID run,
including every new/modified #1578 test, pass.

Every new/modified guard test individually, post-fix:

```
PASS __tests__/publish-guard.test.ts
  publish-guard — script-path RED controls (#1578 AC-1, AC-2)
    ✓ AC-1: inert by default — opt-in missing → refused before credentials (373 ms)
    ✓ AC-2: shape floor refuses synthetic content even when publishing is authorized (359 ms)
  publish-guard — AC-9 in-process discriminator (#1578, THE placement gate)
    ✓ AC-9: uploadBoard() refuses IN-PROCESS with the marker unset; the put spy is never invoked (2 ms)

PASS __tests__/on-task-change-hook.test.ts
  on-task-change.sh — #1158 Layer B / #1578 AC-3 mandatory hook smoke
    ✓ AC-3 fence-integrity + marker-proof: hook sets BOARD_PUBLISH, tiny #9999 fixture stays floor-REFUSED (synthetic-board) (804 ms)
    ✓ AC-3 traversal: real hook + real-shaped fixture clears BOTH guards, reaches credential resolution (skipped-no-token) (757 ms)
    ✓ AC-EXPORT-FAIL: export:board failure → hook still exits 0 AND logs `export-failed` (584 ms)
```

## AC-6 — no new bypass, both arms, with positive controls

Run against the real branch diff (`origin/master...HEAD`) after committing:

```
Arm 1 (env-var kill-switch): 0
Arm 1 positive control:      1
Arm 2 (DI-surface auth):     0
Arm 2 positive control:      1
```

(Grep verdicts via `command grep -Ec` + numeric compare, never through
`| head`/`| tail`; positive controls run in the same invocation shape.)

## AC-7 — live production board proven intact by CONTENT

Fetched the live board from the real production blob URL (the newest
`uploaded` record's `url` field in the primary clone's `data/sync.log`,
written by the operator's own installed hook — NOT by any test in this PR):

```
$ curl -sS https://tj7p6b4mu3ckuyc5.public.blob.vercel-storage.com/board.json -o /tmp/1578-live-board-check.json
fetched: 669140 bytes

$ node -e '... tickets.length ...'
tickets: 382

$ command grep -Ec '"id": ?"9999"' /tmp/1578-live-board-check.json
0
$ command grep -Ec '"id": ?"9999"' <positive-control-incident-fixture>
1
```

382 ≥ 50, no id `9999` present, and the positive control (the incident's own
fixture shape) correctly trips the same grep — proving the check has power.
Production was never touched by any test/probe in this PR: every probe above
used a temp `SYNC_LOG`/`OUT`/`OIDC_TOKEN_FILE` pointed at hermetic scratch
directories, and the one live network call (AC-4c) used deliberately garbage
credentials rejected server-side before any bytes were written.
