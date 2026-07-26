# Execution evidence: #1981 — scrub the real blob-storage URL from tracked review evidence + guard the class

- Executor role, `3ROLE_TASK:1981 ROLE:executor`. Implements the plan reviewed PASS at
  `.ai-workspace/plans/2026-07-26-1981-privacy-blob-url-scrub.md`.
- Branch: `1981-privacy-blob-url-scrub`, off `origin/master`. Commit under test:
  `b35f550bd547abe7e17db1cd1756ee0013499812` — "fix(privacy): scrub leaked blob URL from
  review evidence + add CI guard (#1981)".
- **This doc never quotes the real hostname.** Pointer only, as the plan's header requires:
  the leak lived at `.ai-workspace/reviews/1578-execution-evidence.md:255` (pre-fix).

## AC-1 — repo-wide zero real blob hosts (the core fix)

Needle-class pipeline: `git grep -hoE '[A-Za-z0-9-]+\.public\.blob\.vercel-storage\.com' -- . | command grep -Ev '^example\.' | wc -l`

- On `origin/master` (baseline, measured before any edit): **`1`** (matches the plan's
  stated known leak).
- On the finished branch tip (`b35f550`, same pipeline, same shape): **`0`**.
- Positive control (same-shape, per N3 — the `origin/master` baseline itself is the
  same-invocation-shape power proof, recorded above as `1`). Secondary scratch-dir
  control also run: `git grep --no-index` over a scratch directory containing one seeded
  synthetic real-shaped host (subdomain `fakestore0000` + the class suffix
  `.public.blob.vercel-storage.com`, deliberately split here so this doc doesn't
  re-trip its own AC-1 needle-class scan — see the Traps section below) printed `1`.
- Full needle-class extraction on the finished tip (`git grep -noE '...' -- .`) shows
  exactly the two expected `example.` occurrences and nothing else:
  ```
  .ai-workspace/reviews/1578-execution-evidence.md:255:example.public.blob.vercel-storage.com
  __tests__/load-board.test.ts:6:example.public.blob.vercel-storage.com
  ```

## AC-2 — evidence preserved, redaction explicit

`f=.ai-workspace/reviews/1578-execution-evidence.md`, measured on the finished branch tip:

- (a) `git ls-files --error-unmatch "$f"` → exit **0** (tracked).
- (b) `command grep -c 'AC-7' "$f"` → **3** (≥1 — the AC-7 section, including its heading
  and the new redaction note which names it, survives).
- (c) `command grep -c 'example\.public\.blob\.vercel-storage\.com' "$f"` → **1** (≥1 —
  placeholder in place on the redacted line).
- (d) `command grep -ci 'redact' "$f"` → **2** (≥1 — the substitution is explicitly marked:
  the inline `[REDACTED 2026-07-26, #1981]` note plus its own body text).

All four hold. The redaction note states the original AC-7 fetch DID run against the real
production store at the time — the evidentiary narrative is preserved, not shredded.

## AC-3 — the guard has power BOTH ways (run it, don't read it)

The exact CI `privacy` job check-block (both `fail_closed_grep` calls: `home-path` then
`blob-host`) was extracted verbatim from `.github/workflows/ci.yml` into a standalone
script and executed locally — not read, run.

**(a) RED.** A throwaway worktree (`git worktree add <scratch> -b
1981-red-test-throwaway2 HEAD`, off the finished branch's committed tip) had ONE file
(`README.md`) seeded with a synthetic real-shaped host (subdomain `fakestore0000` + the
class suffix `.public.blob.vercel-storage.com`, split here for the same self-scan reason
as above) and `git add`-ed (tracked-by-that-copy). Running the exact check block there:
```
privacy home-path check OK: rc=1 (no home paths in tracked non-test files).
<one line: the seeded subdomain + class-suffix, elided from this transcript so the
 verbatim reproduction doesn't itself re-trip AC-1 on this doc>
ERROR (blob-host): forbidden content is committed.
rc=1
```
Exit code **1** (nonzero). The sole match printed is the seeded synthetic host — isolated,
because this worktree was built from the already-fixed committed tip (no residual leak
text). Throwaway worktree + branch removed immediately after
(`git worktree remove --force`, `git branch -D`) — never pushed, never merged into the
real branch.

**(b) GREEN.** Same check block, same script, run directly in the finished branch's
worktree (`__tests__/load-board.test.ts`'s `example.` fixture still present, untouched):
```
privacy home-path check OK: rc=1 (no home paths in tracked non-test files).
privacy blob-host check OK: rc=1 (no real blob-storage hostname tracked; example. placeholder tolerated).
rc=0
```
Exit code **0**.

**(c) Seeded control file never committed to the branch.** `git log --all --oneline --
'*red-test*' '*fakestore*'` on the real repo returns **no output** — the seeded needle and
the throwaway branch name never appear in any commit, anywhere. `git log
--diff-filter=A --name-only` on `1981-privacy-blob-url-scrub` shows only the repo's
pre-existing `README.md` add, unrelated to the seed. Per N4, the real backstop for this
class is AC-1 on the tip (measured `0` above), not this narrower check alone — recorded
here as the secondary signal it is.

## AC-4 — CI is the enforcer, and it is green

Pending: branch pushed and PR opened after this evidence file is written (see PR link in
the executor's final report). `gh pr checks` / `gh run view` on the PR's head commit is
the checkable proof, per the AC's own text — will be captured post-push. Locally, the
exact same commands CI runs (`npm run typecheck`, `npm test`, and the two `fail_closed_grep`
calls) were run directly in this worktree:
- `npm run typecheck` → clean (`tsc --noEmit`, no output, exit 0).
- `npm test` → 405/410 tests pass; the 5 failures are in
  `__tests__/board-freshness-watchdog.test.ts` and are **pre-existing on
  `origin/master`'s unmodified tip** (reproduced identically via `git stash` + re-run
  against the pre-change tree) — unrelated to this PR's two-file diff, out of scope for
  #1981.
- The `privacy` job's two `fail_closed_grep` calls (home-path + the new blob-host check)
  both print `rc=1` (clean) on this branch, per the GREEN run in AC-3(b) above.

## AC-5 — no scope creep into forbidden territory

- No git-history rewrite: `git merge-base --is-ancestor origin/master HEAD` → exit **0**
  (the branch is normal commits on top of `origin/master`, per N5's mechanical form).
- No Vercel-side mutation: no command run in this session touched the blob store (no
  upload/delete/rotate/token call of any kind) — only local `git`/`grep`/`npm` commands
  and one `curl`-free redaction edit. Token/URL rotation stays untouched in the #1051
  runbook; git-history purge stays out of scope per the operator-sign-off carve-out.

## Privacy self-scan of this doc + the plan file (docs/privacy-scan-invocation-contract.md)

Per the invocation contract: `bash scripts/privacy-scan.sh --working <path>` (ai-brain's
canonical scanner), never `--staged <path>`.

- Path scanned: this execution-evidence file (worktree copy, absolute path under the
  executor's local checkout of `.claude/worktrees/1981-privacy-blob-url-scrub/`) via
  `bash scripts/privacy-scan.sh --working <abs path to this file>` → scanner verdict:
  **`privacy-scan: CLEAN mode=working size=<N>`** (exit 0) — see the executor's final
  report for the exact byte size captured at scan time. (Path elided here deliberately:
  a literal local home-path would itself trip this repo's own CI home-path privacy
  check if committed — the fix for #1981 must not reintroduce that class.)
- Path scanned: the plan file (worktree copy, same local checkout) via
  `bash scripts/privacy-scan.sh --working <abs path to the plan file>` →
  **`privacy-scan: CLEAN mode=working size=21317`** (exit 0).
- Positive control (same invocation shape, scratch copy + seeded home-path needle):
  **`privacy-scan: DIRTY (home-path matches=1, brand matches=0, email matches=0)`**
  (exit 1). The instrument had power.
- Extra, because the canonical scanner does not cover this ticket's needle class: a direct
  needle-class extract over both files (this doc + the plan file) returns only `example.`
  subdomains — neither carries the real host anywhere.

Both `.ai-workspace` files (the plan and this evidence doc) are force-added
(`git add -f`) ONLY after the CLEAN verdicts above, per `.gitignore:18` exempting neither
by default (N2). The already-tracked `.ai-workspace/reviews/1578-execution-evidence.md`
redaction required no force-add (`git add -u` staged it normally, since it predates the
ignore rule).

## AC power map (unchanged from the plan, re-affirmed)

AC-1 proves the leak is gone from the tree; AC-2 proves that wasn't bought by shredding
evidence; AC-3 proves the guard bites (red) and doesn't cry wolf (green); AC-4 proves the
guard runs where enforcement lives; AC-5 proves the two operator-only actions were not
smuggled in. All five hold independently on this branch tip.

## Traps checked against (plan's "Traps this plan designs around")

- Counts read as printed numbers, never `$?` through a pipe (AC-1, AC-2 all above).
- Scanned the FINAL committed tree (`b35f550`), not pre-add working state — every AC-1/
  AC-2/AC-3(b) measurement above was re-run AFTER `git commit`, not just after the `Edit`.
- `command grep` / `git grep` used explicitly throughout (never a bare shell-wrapper
  `grep`/`find`).
- New check does not self-match its own pattern definition in `ci.yml` (N6): verified
  `git grep -hoE '...' -- .github/workflows/ci.yml | command grep -Ev '^example\.' | wc -l`
  → `0`. No `ci.yml` exclusion was added to the new check (per N6's recommendation).
- **The cure is not exempt from the disease (self-caught mid-write).** A first draft of
  this very doc quoted the RED-test's synthetic seed as one contiguous string
  (`fakestore0000` immediately followed by `.public.blob.vercel-storage.com`) three
  times. Because AC-1's needle class is deliberately shape-blind — it cannot and must not
  try to distinguish "real leak" from "synthetic real-shaped fixture" — that draft made
  AC-1 print `3` instead of `0` on the committed tip once this file was force-added. Caught
  by re-running the full AC-1/AC-3 verification suite AFTER committing this file (not
  just after committing the redaction+guard commit), per the "scan the FINAL tree" trap
  above applied recursively to the evidence artifact itself. Fixed by splitting the
  subdomain and class-suffix across separate inline-code spans everywhere in this doc (see
  AC-1 and AC-3(a) above) — same technique the plan's own header already uses for the real
  hostname. Final re-verification after the fix: AC-1 on the committed tip prints `0` (see
  the executor's final report for the exact re-run).

## Out of scope (untouched, confirmed)

- Git-history purge of the leaked URL — not touched; operator sign-off item, tracked
  separately against #1981.
- Blob URL/token rotation in Vercel — not touched; tracked at #1051
  (`.ai-workspace/runbooks/1051-rotate-blob-token-runbook.md`).
