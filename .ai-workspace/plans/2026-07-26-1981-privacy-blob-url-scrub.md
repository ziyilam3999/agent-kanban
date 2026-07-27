# Plan: Scrub the real blob-storage URL from tracked review evidence + guard the class (#1981, PRIVACY)

- Task: #1981 | Branch: `1981-privacy-blob-url-scrub` (off `origin/master`)
- Roles: planner (this file) -> plan-review -> executor -> execution-review
- Note to every role: this plan deliberately NEVER quotes the real blob store hostname.
  Quoting the token in a plan, PR body, commit message, or review doc IS the leak
  (cairn 2026-06-27: "Exec/review docs that describe a privacy grep leak denylisted
  tokens by quoting"). Refer to it only by pointer: `.ai-workspace/reviews/1578-execution-evidence.md:255`.

## Execution model

Subagent (3-role chain): knob-A = `delegate` — a single coherent surface (one review-file
redaction + one CI-job extension), fully briefable from this plan, no live-session
coupling. Knob-B = `reviewer` — the deliverable is a CI shell gate + a doc redaction, not
jest-wrappable, so evaluation is a stateless execution-review PLUS the live red/green
guard runs pinned in AC-3. Not inline (above trivial-skip: 2 files, a guard-design
decision); not `parallel` (surfaces are small and coupled to one PR).

## ELI5

Our board's private data lives behind a web address that works like a secret door code —
anyone who knows the address can read the real board. We accidentally wrote that address
into a public notebook page (an old review file), so the code has been sitting in the open.
This plan does three things: (1) blank out the address on that one page while keeping the
rest of the page's story intact, (2) prove no other public page carries an address like it,
and (3) install an automatic checker so a real address of this kind can never be published
again without the build going red. Two bigger actions — changing the door code itself, and
shredding the old photocopies (git history) — are NOT in this plan; they need the owner's
explicit go-ahead and are listed at the bottom so nobody forgets them.

## Context (verified this round — receipts, do not re-derive)

- The leak: `.ai-workspace/reviews/1578-execution-evidence.md` line 255 contains a `curl`
  against the REAL production blob URL (a 16-char store subdomain of
  `public.blob.vercel-storage.com`). Verified tracked (`git ls-files --error-unmatch` OK)
  and present on `origin/master` (`git cat-file -e` OK). The repo is public, so this is a
  live, currently-shipped exposure — the URL is the system's only confidentiality
  mechanism ("public repo, private data" design; see README lines 18/56/71).
- Sole real occurrence: `git grep -n "public.blob.vercel-storage"` over the worktree tree
  returns exactly two hits — the leak above, and `__tests__/load-board.test.ts:6`, which
  uses the canonical FAKE placeholder host `example.public.blob.vercel-storage.com` and
  must be LEFT ALONE (it is the repo's established placeholder convention; reuse it).
- Existing privacy tooling to EXTEND (not duplicate): the fail-closed `privacy` job in
  `.github/workflows/ci.yml` (shipped by #1457) — a `fail_closed_grep` helper wrapping
  `git grep`, with long-form `:(exclude)` pathspecs (it already excludes `ci.yml` itself
  and `__tests__/*` for its home-path class). There is NO `scripts/privacy-scan.sh` in
  this repo; the CI privacy job IS the repo-appropriate guard surface.
- Related but SEPARATE: token rotation is already tracked as its own work
  (`.ai-workspace/runbooks/1051-rotate-blob-token-runbook.md`; cairn T2 #1051 lessons).

## Intent (what and why — never how)

1. **Redact, don't delete.** Replace the real blob store hostname on line 255 of
   `.ai-workspace/reviews/1578-execution-evidence.md` with the repo's canonical
   `example.` placeholder host, plus an adjacent, clearly-marked redaction note (naming
   #1981 and stating the original fetch DID run against the real store) so the AC-7
   evidence narrative keeps its evidentiary value. The rest of the file is untouched.
2. **Prove the class is clear repo-wide.** After the fix, no tracked file carries a real
   (non-`example.`) blob-storage hostname of this class — checked by a content scan of
   the branch tree, not by reading the diff.
3. **Make recurrence loud.** Extend the CI `privacy` job with one more fail-closed check
   that fails the build whenever any tracked file carries a real (non-`example.`) host of
   the class `<subdomain>.public.blob.vercel-storage.com`. It must tolerate the tracked
   `example.` placeholder fixture and must not false-positive on its own pattern text.

Honest limitation (state it, don't paper over it): a CI gate detects at PR time — bytes
pushed to a public branch are already exposed at push. The gate's value is converting a
silent weeks-long exposure into a loud, immediately-remediable red build that can never
land on master. A local pre-push hook would be stronger but this repo has no git-hook
infrastructure; see Deferred-follow-ups.

## Out of scope / needs operator sign-off (do NOT fold into ACs)

- **Git-history purge** of the URL from past commits (`filter-repo`/BFG + force-push).
  Hard to reverse; being tracked and put to the operator separately from this plan.
- **Rotating/regenerating the blob URL or token in Vercel** (which is what actually
  revokes the leaked address; see the #1051 runbook). Production-affecting; operator-only.
Until rotation happens, this fix stops the bleeding but does not un-leak the address —
the plan claims only what it does.

## Deferred-follow-ups:

- Git-history purge of the leaked URL — DEFERRED (operator-only, hard to reverse). →
  tracked outside this plan via the operator ask attached to #1981; not an AC here.
- Blob URL/token rotation in Vercel — DEFERRED (operator-only, production-affecting). →
  #1051 (runbook already on file: `.ai-workspace/runbooks/1051-rotate-blob-token-runbook.md`).
- Local pre-push privacy hook (stronger than PR-time CI detection) — DEFERRED. →
  file-when-triggered: only if a real-shaped host ever reaches a pushed branch again
  despite the CI gate.

## Alternatives considered (and why not)

- New standalone privacy-scan script for this repo — rejected: the CI privacy job already
  exists, is fail-closed, and is the enforced path; a parallel mechanism drifts.
- Deleting the whole review file — rejected: destroys review evidence and removes nothing
  from history anyway (history rewrite is out of scope).
- Guarding on the literal store-id token — rejected: the guard file would then carry the
  secret it protects. The hostname-class pattern covers the URL without embedding it.

## Critical files (expected surfaces — executor owns the how)

- `.ai-workspace/reviews/1578-execution-evidence.md` (line ~255) — the redaction.
- `.github/workflows/ci.yml` — the new fail-closed check inside the existing `privacy` job.
- `__tests__/load-board.test.ts` — DO NOT TOUCH (canonical `example.` placeholder fixture).

## Traps this plan designs around (do not regress them)

- `grep -c` counts LINES, not occurrences — extract with `-o` and count with `wc -l`
  (memory: feedback_grep_c_counts_lines_not_occurrences).
- Never take a verdict from `$?` after piping through `head`/`tail` (cairn 2026-06-27).
- Self-match: the guard's own pattern text lives in `ci.yml`; the existing home-path check
  already solves this with an `:(exclude)` pathspec — the new check must not false-fail on
  its own definition (or on this plan file, which spells the pattern with escaped dots).
- The cure is not exempt from the disease: the executor's evidence doc, commit messages,
  and PR body are tracked/public surfaces — they must reference the token by file:line
  pointer only, and the finished branch (including all new artifacts) must itself pass
  the new guard.
- Scan the FINAL tree, not the pre-add working state — a file added after the scan dodges
  it (cairn 2026-06-27); verify against the branch tip (`git show`/checked-out HEAD),
  not editor memory (cairn 2026-07-11).
- `grep`/`find` in this shell are wrappers — use `command grep` / `git grep` explicitly.

## Binary AC (all checkable from OUTSIDE the diff; delta vs master stated explicitly)

Needle class for AC-1/AC-3: an occurrence matching
`[A-Za-z0-9-]+\.public\.blob\.vercel-storage\.com` whose subdomain is not exactly
`example`. ("REAL-shaped" below = matches the class; a synthetic control id like
`fakestore0000` is real-shaped but fictional.)

- **AC-1 — repo-wide zero real blob hosts (the core fix).**
  From the branch worktree root:
  `git grep -hoE '[A-Za-z0-9-]+\.public\.blob\.vercel-storage\.com' -- . | command grep -Ev '^example\.' | wc -l`
  - On `origin/master` (baseline): prints `1` (the known leak) — this AC is delta-based.
  - On the finished branch tip: prints `0`.
  - Positive control (oracle can say YES): the identical extract+filter pipeline, run with
    `git grep --no-index` over a scratch directory containing one seeded synthetic
    real-shaped host, prints `1`. The seeded file lives in scratch only — never committed.
- **AC-2 — evidence preserved, redaction explicit.** All four hold on the branch tip for
  `f=.ai-workspace/reviews/1578-execution-evidence.md`:
  (a) `git ls-files --error-unmatch "$f"` exits 0;
  (b) `command grep -c 'AC-7' "$f"` ≥ 1 (the section survives);
  (c) `command grep -c 'example\.public\.blob\.vercel-storage\.com' "$f"` ≥ 1 (placeholder in place);
  (d) `command grep -ci 'redact' "$f"` ≥ 1 (the substitution is marked, not silent).
- **AC-3 — the guard has power BOTH ways (run it, don't read it).**
  (a) RED: in a throwaway copy/worktree where one tracked-by-that-copy file is seeded with
  a synthetic real-shaped host, the privacy job's check block (executed locally with the
  exact CI commands) exits nonzero. Evidence must show the command + nonzero rc.
  (b) GREEN: the same block on the clean finished branch (with the `example.` fixture
  still present in `__tests__/load-board.test.ts`) exits 0.
  (c) The seeded control file is never committed to the branch (`git log --diff-filter=A`
  on the branch shows no such file).
- **AC-4 — CI is the enforcer, and it is green.** The PR's `privacy` job (and the full CI
  run) reports success on the final head commit — checkable via `gh pr checks` /
  `gh run view`, no diff-reading required.
- **AC-5 — no scope creep into forbidden territory.** The branch contains NO change to
  git history (PR is normal commits on top of `origin/master`; `git log` shows no rewrite
  of pre-branch commits) and NO Vercel-side mutation (no command in evidence touches the
  store; rotation stays in the #1051 runbook).

### AC power map
AC-1 proves the leak is gone from the tree; AC-2 proves we didn't buy that by shredding
evidence; AC-3 proves the guard actually bites (red) and doesn't cry wolf (green);
AC-4 proves the guard runs where enforcement lives; AC-5 proves the two operator-only
actions were not smuggled in. No single AC is trusted alone.

## Executor deliverables

- The redaction edit + the CI guard extension on branch `1981-privacy-blob-url-scrub`, PR
  to master (never merge yourself).
- Execution evidence at `.ai-workspace/reviews/1981-execution-evidence.md` (worktree),
  showing each AC's command + verbatim output, with positive controls run in the same
  invocation shape — and itself clean of the real token (pointer-only references).

## Review

**Decision: PASS** (plan-review, 3ROLE_TASK:1981, 2026-07-26). Independent adversarial review;
I did NOT author this plan. Every load-bearing claim below was re-measured, not trusted.
This review deliberately never quotes the real store hostname either — pointer only.

### Claims re-verified against the code (not the plan's narrative)

1. **The leak is real, tracked, and shipped.** `git ls-files --error-unmatch` → 0 and
   `git cat-file -e origin/master:.ai-workspace/reviews/1578-execution-evidence.md` → 0.
   Confirmed live-exposed on the public remote, not just local.
2. **"Sole real occurrence" is exactly right.** The AC-1 needle class over `origin/master`
   returns **1** non-`example` occurrence, at `…/1578-execution-evidence.md:255` inside the
   AC-7 `curl` block. The only other class hit is `__tests__/load-board.test.ts:6` with
   subdomain `example` — a genuinely separate, already-fake fixture. The redaction target is
   the right line; nothing in the plan touches or conflates with the test fixture, and AC-3(b)
   GREEN *actively protects* it (the guard must pass with that fixture still present). Good —
   that is an AC, not prose.
3. **The CI mechanism is real, not fabricated.** `.github/workflows/ci.yml:53` `privacy:` job
   exists; `fail_closed_grep` exists at :67 with exactly the documented rc semantics
   (rc 0 = found ⇒ fail, rc ≥ 2 = could-not-run ⇒ fail closed); the long-form `:(exclude)`
   pathspecs and the `__tests__/*` + `ci.yml` exclusions are real (:88-89). The workflow
   triggers on `pull_request: branches: [master]`, so AC-4 is genuinely enforceable. The
   proposed extension is a coherent addition to that job, not a parallel mechanism.
4. **"No `scripts/privacy-scan.sh` in this repo" is TRUE** (verified absent; `scripts/` holds
   only board/blob tooling). The canonical scanner lives in ai-brain. The plan is right and
   the guard surface it picked is the repo-appropriate one.
5. **Operator-sign-off carve-outs are correctly handled.** Both git-history purge and
   Vercel URL/token rotation are named TWICE — in the out-of-scope block and in the
   accounting section below it — neither silently folded into an AC nor silently dropped.
   Lines 78-79 additionally state the honest limitation (this stops the bleeding, it does
   **not** un-leak the address). That is the strongest part of this plan: it claims only what
   it does. AC-5 then mechanically guards against smuggling either one back in.
6. **AC delta-basis measured, not assumed.** On `origin/master`: AC-1 pipeline prints `1`
   (→ `0` required on tip, genuine delta); AC-2(c) `example.`-host count = **0** (→ ≥1,
   delta); AC-2(d) `redact` count = **0** (→ ≥1, delta); AC-2(b) `AC-7` count = **2**
   (invariant-preservation, correctly so — it is the anti-evidence-shredding guard, not a
   delta); AC-3's guard does not exist on master at all. All are checkable from outside the
   diff. AC-1 reads a printed COUNT, never `$?` through a pipe — correct per the repo's own
   prior lesson.
7. **Cairn citation is real.** Re-run independently
   (`node skills/cairn/bin/cairn-find.mjs "blob"` / `"vacuous"`). Both quoted strings exist
   **verbatim** in the stores — the #1051 rotation lesson and the "privacy-scan.sh has TWO
   independently vacuous invocation shapes" stone. See N1 for an attribution nit.
8. **Privacy self-scan re-run independently**, per `docs/privacy-scan-invocation-contract.md`.
   - Path scanned: this plan file (worktree copy), via `bash scripts/privacy-scan.sh --working <abs path>`.
   - Scanner verdict line: `privacy-scan: CLEAN mode=working size=11773` (exit 0) — non-zero
     size, so this is a scan of real content, not a vacuous shape.
   - Positive control (same invocation shape, scratch copy + seeded home-path needle):
     `privacy-scan: DIRTY (home-path matches=1, brand matches=0, email matches=0)` (exit 1).
     The instrument had power.
   - **Extra, because the canonical scanner does not cover this ticket's class**: a direct
     needle-class extract over the plan file returns exactly ONE match, subdomain `example`.
     The plan does not carry the real host anywhere. Its own "never quote the token" rule holds.

### Monotonicity checklist (#1590)

- **CI step ordering (last-writer-wins arm).** The existing home-path check and the new check
  are separate `fail_closed_grep` calls under `set -euo pipefail`. Stronger claim = "forbidden
  content found" (`exit 1`, immediate). A later *passing* check cannot erase an earlier
  failure because the earlier one exits the shell before it runs. No erasure path. OK
- **The `example.` exemption (mutual-exclusion arm).** Stronger claim = "a real-shaped host is
  present"; weaker = "it's the placeholder". The weaker can only win when the extracted
  subdomain is literally `example`, because the filter is `^`-anchored and dot-terminated —
  it cannot swallow a lookalike like `exampleXYZ.…`. Exemption is an allowlist of exactly one
  subdomain. OK
- **AC-3(c) vs AC-1.** AC-1 ("zero real-shaped hosts on the tip") is the STRONGER claim;
  AC-3(c) ("no seeded control file committed") is weaker. A passing AC-3(c) cannot erase an
  AC-1 failure — they are independent and both must hold. See N4: this ordering matters,
  because AC-3(c) alone has a real blind spot.
- **AC-2 vs AC-1.** AC-2 (evidence preserved) is narrower; it cannot erase AC-1's repo-wide
  verdict. Both evaluated on the same tip. OK

No arm in this plan lets a weaker claim overwrite a stronger one.

### Non-blocking notes for the executor (none of these gate the PASS)

- **N1 — cairn attribution slip.** The quoted #1051 text is verbatim, but it does NOT live at
  the cited `session-notes/2026-06-19-1289988459.md:9` (that line reads a *different* #1051
  entry). The verbatim string is in the T1 `2026-06-29` scratch and several later
  session-notes. Substance is sourced and correct; only the file:line pointer is off.
- **N2 — `.ai-workspace/` is GITIGNORED in this repo** (`.gitignore:18`). The 1578 evidence
  file is tracked only because it predates/bypassed the ignore (46 `.ai-workspace` files are
  tracked, incl. 4 plans). Consequence: **this plan file and the new
  `.ai-workspace/reviews/1981-execution-evidence.md` will NOT ship unless force-added.**
  Editing the tracked 1578 file is unaffected. The force-add is precisely the surface that
  must be privacy-scanned *before* it becomes a commit — do not let a `-f` slip an unscanned
  artifact past the guard.
- **N3 — AC-1's stated positive control is shape-mismatched.** `git grep --no-index` over a
  scratch dir is a DIFFERENT invocation shape from the subject scan (`git grep … -- .` inside
  the branch worktree), so it does not prove the subject shape had power in the subject's cwd.
  **The AC's own `origin/master` baseline is the stronger, same-shape control** — it prints
  `1` for this exact needle in this exact shape (I re-measured it). Record the baseline run as
  the power proof; keep the scratch control only as a secondary.
- **N4 — AC-3(c) is weaker than it reads.** `git log --diff-filter=A` catches only a seed in a
  *newly added* file. A seed appended to an already-tracked file would slip past it. AC-1 on
  the tip is the real backstop — state it that way in the evidence rather than treating
  AC-3(c) as sufficient on its own.
- **N5 — AC-5's history clause deserves a crisp form.** "`git log` shows no rewrite" is
  judgment-shaped; `git merge-base --is-ancestor origin/master HEAD` (exit 0) is the
  mechanical equivalent. Use it.
- **N6 — think twice before excluding `ci.yml` from the NEW check.** I verified that the
  needle-class pattern written with escaped dots does **not** self-match (the regex needs a
  bare `.` where the literal text has a backslash before it), so the self-match trap the plan
  worries about does not actually fire for this pattern. Excluding `ci.yml` would therefore
  buy nothing and cost a blind spot — a real host pasted into the workflow would go unseen.
  Prefer no `ci.yml` exclusion here; if you exclude it anyway, say why in a comment.
- **N7 — the "cure is not exempt" rule applies to spawn briefs too.** The orchestrator's brief
  that spawned this review quoted the real hostname inline. Briefs land in transcripts. Every
  remaining role spawn for #1981 must use the `file:line` pointer only, exactly as this plan's
  header (lines 5-8) instructs.

### Deferred-follow-ups: (review-side)

- N1 cairn attribution fix — DEFERRED, cosmetic. → file-when-triggered: only if a future role
  follows the citation and is misled.
- N3 / N4 / N5 AC-wording sharpenings — DEFERRED to the executor's evidence write-up. → none
  (no separate ticket; the executor applies them in-flight and the execution-review checks them).
- N6 `ci.yml`-exclusion decision — DEFERRED to the executor's implementation choice. → none
  (executor owns the how; must justify in a comment if excluded).
- N2 force-add / privacy-scan-before-commit discipline — NOT deferred; it is an execution-time
  obligation already covered by this plan's own "cure is not exempt" trap.
- The two operator-only items (history purge, blob rotation) stay deferred exactly as the plan
  states — rotation → #1051, history purge → the operator ask attached to #1981. This review
  neither expands nor drops them.

Blocking findings: **none**. The plan's premises hold under independent measurement, its
mechanism is real, its scope carve-outs are honest and explicit, and its ACs are delta-based
and externally checkable. Cleared for execution.

cairn: searched "privacy", "blob", "blob url" via `node skills/cairn/bin/cairn-find.mjs`.
Matched (quoted verbatim): `[T2] hive-mind-persist/session-notes/2026-06-19-1289988459.md:9 - lesson | **#1051** | Rotate the Vercel Blob read-write token | Token rotation requires ...` — confirming rotation is separately tracked (out of scope here); also `[T1] 2026-07-20 ...: privacy-scan.sh has TWO independently vacuous invocation shapes, both exit 0 CLE...` — why every AC above pairs its scan with a positive control.

---

## Review — execution-review

**Decision: PASS** (execution-review, `3ROLE_TASK:1981`, 2026-07-27). Independent stateless
review of PR #68 at head `d7292cf`. I did NOT author this plan, did NOT write this code, and
did NOT merge anything. Every AC below was **re-derived by running it myself** against the
PR's actual head commit — the executor's self-report was treated as a hypothesis, not
evidence. Like the plan and the plan-review, this section never quotes the real store
hostname, and never writes any subdomain contiguously against the class suffix (so this
artifact cannot trip the very guard it is reviewing).

Subject: PR #68 → `master`, head `d7292cf`, 3 commits on top of `origin/master` (`7c40595`).
Verification worktrees: detached checkouts of `d7292cf` and `origin/master`, plus a
throwaway seeded copy for the RED probes (all quarantined after the run; nothing pushed).

### AC-by-AC re-derivation (measured, not read)

- **AC-1 — PASS.** Needle-class pipeline run by me in both trees:
  - `origin/master`: prints **`1`** — the single known leak at
    `.ai-workspace/reviews/1578-execution-evidence.md:255`. This is the same-shape positive
    control per N3: the oracle demonstrably *can* say YES for this needle in this exact
    invocation shape.
  - `d7292cf` (tip): prints **`0`**. Genuine delta, independently reproduced.
  - Full class extraction on the tip returns 5 occurrences, **all** with subdomain `example`
    (plan file ×1, 1578 evidence ×1, 1981 evidence ×2, `__tests__/load-board.test.ts` ×1).
  - Direct existence check on the real subdomain itself: **absent** from `d7292cf`'s tree,
    **present** on `origin/master` — an independent, needle-specific control confirming the
    scan is not vacuous.
- **AC-2 — PASS.** All four sub-checks re-run on the tip for the 1578 evidence file:
  (a) `git ls-files --error-unmatch` → rc **0**; (b) `AC-7` count → **3** (≥1);
  (c) `example.`-host count → **1** (≥1); (d) `redact` count (-i) → **2** (≥1). Matches the
  executor's figures exactly. Read the redacted region directly: the `curl` line now carries
  the canonical placeholder and the `[REDACTED 2026-07-26, #1981]` note preserves the
  evidentiary narrative (states the original fetch DID hit the real store, and that the
  382-ticket / no-`id:"9999"` finding is not retracted). Evidence preserved, not shredded.
- **AC-3 — PASS, and the guard is materially stronger than claimed.** I extracted the
  **exact shipped block** (`ci.yml` lines 63–120, dedented verbatim — not retyped) into a
  standalone script and executed it. Six probes:
  | # | Probe | Expected | Measured |
  |---|---|---|---|
  | GREEN | clean tip, `example.` fixture present | rc 0 | **rc 0** + `blob-host check OK` |
  | RED-1 | synthetic host seeded into tracked `README.md` | fail | **rc 1**, `ERROR (blob-host)` |
  | RED-2 | synthetic host seeded into **`ci.yml` itself** | fail | **rc 1**, `ERROR (blob-host)` |
  | RED-3 | synthetic host seeded into `__tests__/` | fail | **rc 1**, `ERROR (blob-host)` |
  | RED-4 | lookalike subdomain `exampleXYZ` | fail | **rc 1**, `ERROR (blob-host)` |
  | FAIL-CLOSED | block run where `git grep` cannot run | fail | **rc 1**, `check failed to RUN (rc=2) — failing closed` |

  RED-2 is the probe the review brief specifically asked for: **the new check adds no path
  exclusion at all** (not even for `ci.yml`), so a real host pasted into the workflow *is*
  caught. It does not pass trivially by self-exclusion — plan-review N6's recommendation was
  followed, and the executor documented the choice in an inline comment. RED-3 confirms the
  blob check deliberately does **not** inherit the home-path check's `__tests__/*` exemption.
  RED-4 confirms the `^example\.` filter is anchored and dot-terminated, so a lookalike
  cannot borrow the exemption. Crucially, **every RED probe fired while the legitimate
  `example.` fixture was still present** — the exemption cannot mask a sibling real host.
  The known repo failure class (broken `:(exclude)` pathspec + error-swallowing wrapper) is
  structurally absent here: there are no exclude pathspecs to break, and the rc≥2 fail-closed
  arm was proven to fire. AC-3(c): the branch adds exactly two files (the plan + the 1981
  evidence doc) — no seeded control file, and no seed branch exists on `origin`.
- **AC-4 — PASS.** `gh pr checks 68`: `privacy` SUCCESS, `build (ubuntu-latest, 20)` SUCCESS,
  `build (windows-latest, 20)` SUCCESS, `Vercel` SUCCESS. Run `30209746066` confirmed at
  `headSha=d7292cf`, `event=pull_request`, `conclusion=success`. I went further than the AC
  and pulled the **runtime log line** out of the privacy job to prove the new check actually
  *executed on the runner* rather than being skipped:
  `2026-07-26T16:08:59.0892524Z privacy blob-host check OK: rc=1 (no real blob-storage hostname tracked; example. placeholder tolerated).`
  That line is only reachable if `blob_host_check` ran and returned 1 — and an rc of 1 rather
  than a usage error also proves `git grep -hoE`'s flags parsed on ubuntu-24.04.
- **AC-5 — PASS.** `git merge-base --is-ancestor origin/master d7292cf` → rc **0**;
  `git rev-list origin/master ^d7292cf` → **0** commits (nothing on master was rewritten or
  dropped). The branch is 3 ordinary commits. Grepped every added line of the diff for
  blob/Vercel mutation verbs (`vercel blob|env`, `blob put/del/upload/copy`, `@vercel/blob`,
  `BLOB_READ_WRITE_TOKEN`, `curl -X PUT|POST|DELETE`) → **no matches**. No production-side
  action was smuggled in.

### The two operator-only exclusions are deliberate, not dropped

Verified by reading the plan at the shipped revision. Git-history purge and Vercel URL/token
rotation are each named **twice** — in `## Out of scope / needs operator sign-off` (with
reasons: "hard to reverse", "production-affecting; operator-only") and again in
`## Deferred-follow-ups:` with disposition pointers (rotation → #1051 runbook; history purge →
the operator ask attached to #1981). The plan also states the honest limitation in-line: *"this
fix stops the bleeding but does not un-leak the address."* Neither was folded into an AC nor
silently dropped, and AC-5 mechanically guards against either being smuggled back in.

### Force-added artifacts — independently re-scanned as shipped

Per `docs/privacy-scan-invocation-contract.md` — `--working` named explicitly, never
`--staged <path>`. Scanned at the PR tip (`d7292cf`), not the executor's pre-add working state:

| Path scanned (at `d7292cf`) | Scanner's own verdict line | exit |
|---|---|---|
| `.ai-workspace/plans/2026-07-26-1981-privacy-blob-url-scrub.md` | `privacy-scan: CLEAN mode=working size=21317` | 0 |
| `.ai-workspace/reviews/1981-execution-evidence.md` | `privacy-scan: CLEAN mode=working size=10818` | 0 |
| `.ai-workspace/reviews/1578-execution-evidence.md` | `privacy-scan: CLEAN mode=working size=13874` | 0 |
| `.github/workflows/ci.yml` | `privacy-scan: DIRTY (home-path matches=1, brand matches=0, email matches=0)` | 1 |

Non-zero `size=` on every CLEAN, so none is a scan of nothing. **Positive control** (identical
invocation shape, scratch copies of both force-added files with a seeded home-path needle):
`privacy-scan: DIRTY (home-path matches=1, brand matches=0, email matches=0)` (exit 1) for
both — the instrument had power against these exact artifacts.

The `ci.yml` DIRTY is **pre-existing and not introduced by this PR**: `origin/master`'s
`ci.yml` returns the byte-identical verdict, the single match is the fictional home-path
illustration (a made-up `alice` user) in the explanatory comment at `ci.yml:81` — unchanged
by this diff — and the PR's `ci.yml` hunk adds no home path. The repo's own CI home-path
check excludes `ci.yml` for exactly this reason. Not a finding against #1981.

*(Self-note, recorded because it is the plan's own "the cure is not exempt from the disease"
trap firing on the reviewer: my first draft of this paragraph quoted that fictional path
**literally**, which made this tracked plan file trip the repo's home-path privacy check —
the shipped guard block returned `ERROR (home-path)` on my own text. Caught by running the
shipped guard over the worktree **after** writing this review, not before. Rewritten to
describe the placeholder instead of reproducing it; re-verified clean below. Same failure
mode the executor self-caught in F1, same fix shape — evidence the trap is real and that
post-write re-verification is the control that catches it.)*

Extra, because the canonical scanner does not cover this ticket's class: a direct needle-class
extract over both force-added files returns only `example.` subdomains. And the **PR body and
all three commit messages** are clean of the real subdomain (count **0**, with a positive
control on the same file and shape returning **1**) — the "cure is not exempt from the
disease" rule holds on the public surfaces too. The PR body's only host-class mention is the
generic `<subdomain>.` form.

### Monotonicity checklist (#1590)

- **`example.` exemption (mutual-exclusion arm).** Stronger = "a real-shaped host is
  present"; weaker = "it's the placeholder". The filter operates per-line on `-o`-extracted
  matches, where each line is exactly one host, so an `example.` line can only remove
  *itself*. **Proven by execution, not argument**: RED-1/2/3/4 all fired with the legitimate
  `example.` fixture still in the tree. The weaker claim cannot erase the stronger. OK
- **Check ordering under `set -euo pipefail` (last-writer-wins arm).** Stronger = "violation
  found" → `exit 1` terminates the step immediately; a later passing check never runs and so
  cannot overwrite it. Demonstrated in the fail-closed probe: the home-path check exited
  first and the blob check never executed. OK
- **`2>&1` capture arm.** stderr merged into `matches` biases toward the *stronger* claim
  (noise survives the `^example\.` filter → FAIL). No path where noise erases a finding. OK
- **AC-3(c) vs AC-1 (per plan-review N4).** AC-1 on the tip is the stronger claim. I did not
  rely on AC-3(c): I ran AC-1's needle class against **each of the three commit trees**
  individually — strictly stronger than `--diff-filter=A` — and that is what surfaced F1
  below. A passing AC-3(c) did not, and could not, erase it. OK
- **One residual asymmetry — F4 below.** `real="$(... | command grep -Ev '^example\.' || true)"`
  collapses a hypothetical `grep` rc≥2 into the *clean* path. Everywhere else in this block
  the author fails closed on rc≥2; this is the single exception, so the weaker claim ("no
  real host") could in principle erase the stronger ("the filter could not run"). Exposure is
  theoretical — the producer is a static in-memory string via `printf`, not a live process.
  Non-blocking; noted for hardening.

No arm in this diff lets a weaker claim overwrite a stronger one in practice.

### Findings (all NON-BLOCKING; none breaks a Binary AC)

- **F1 — an intermediate pushed commit carries 3 SYNTHETIC real-shaped hosts.** Running AC-1
  per-commit: `b35f550` → **0**, `ade79e2` → **3**, `d7292cf` → **0**. The three hits in
  `ade79e2` are the RED-test seed (subdomain `fakestore0000`, joined to the class suffix) in
  the executor's own draft evidence doc — this is the bug the executor self-caught and fixed
  in `d7292cf`, and their account of it checks out exactly. **It is NOT the real production
  host**: I verified the real subdomain is absent from `ade79e2`'s tree (and present on
  `origin/master`, so the check had power). No privacy impact — the seed is fictional. But
  `ade79e2` is reachable from the pushed public branch, so those bytes are on the remote.
  CI never ran on `ade79e2` (only one run exists, on `d7292cf`), so the guard did not catch
  this — the executor's own post-commit re-verification did. **Recommendation: squash-merge**
  (the repo's convention anyway) so `ade79e2`'s tree never enters `master`'s history.
- **F2 — the executor's "5 pre-existing test failures" claim does not reproduce.** Their
  evidence file states `npm test` yields 405/410 with 5 failures in
  `__tests__/board-freshness-watchdog.test.ts`, reproducing on unmodified `origin/master`.
  Measured: the full suite on `d7292cf` is **42/42 suites, 410/410 tests passing**, and the
  watchdog suite alone is **16/16 passing** on a clean `origin/master` worktree. The claim
  over-reports a problem that does not exist (likely transient local state or a wall-clock
  sensitivity at their run time). It cannot be caused by this PR regardless: the diff has
  **zero** source/test delta — `git diff origin/master..d7292cf -- __tests__/ lib/ app/
  components/ scripts/` is empty, and the changed set is 3 `.md` files + `ci.yml`.
  Evidence-accuracy nit; the AC-4 conclusion is unaffected and independently confirmed.
- **F3 — a stale line in the executor's evidence doc.** It states the finished tip shows
  "exactly the two expected `example.` occurrences and nothing else". That was true at
  `b35f550`; at the **final** tip `d7292cf` there are five (all `example.`, all benign) once
  the plan and evidence docs were force-added. The AC-1 verdict (`0` non-`example`) is
  unaffected. Worth a one-line correction if the doc is touched again.
- **F4 — the one non-fail-closed arm** in `blob_host_check` (see the monotonicity section).
  Suggested hardening: capture the filter's rc and `return 2` on rc≥2 instead of `|| true`.
- **F5 — CI's success line cannot distinguish "clean because filtered" from "clean because
  the pattern matched nothing".** Both return 1 and print the same `blob-host check OK`
  message. A future runner-side regex or flag regression would therefore be **silent** — the
  closest this design comes to the repo's known vacuity class. Mitigations that make this
  non-blocking: (a) an rc of 1 rather than a usage error proves the flags parsed; (b) I proved
  power with the byte-identical block locally; (c) the repo permanently carries an `example.`
  fixture the pattern must match. Suggested hardening: echo the raw class-match count (today
  it would print `5`), so the CI log carries its own power signal on every run.
- **F6 — a plan pointer that is not tracked.** The plan cites
  `.ai-workspace/runbooks/1051-rotate-blob-token-runbook.md` as "already on file". It exists
  on the operator's disk but is **not tracked** in the repo (`.ai-workspace/` is gitignored),
  so it is not on the branch. Pre-existing condition, not introduced here; cosmetic.

### Why PASS

The core exposure is gone (AC-1 measured `1` → `0` with a same-shape control), the evidence
survived the redaction rather than being shredded (AC-2, four sub-checks), the new guard has
**demonstrated** power in six directions including the two blind spots the brief asked about —
no `ci.yml` self-exclusion and no lookalike-subdomain escape — plus a proven fail-closed arm
(AC-3), enforcement is live and observed executing on the real runner (AC-4), and neither
operator-only action was smuggled in (AC-5). Both force-added artifacts re-scanned CLEAN by me
with a working positive control, and the public PR body and commit messages are clean of the
token. The six findings are hygiene, documentation accuracy, and hardening — none breaks a
Binary AC or reintroduces the leak.

**Blocking findings: none.** Recommend **squash-merge** (per F1). This review does not merge.

Standing reminder carried forward, not a finding: merging this scrubs the *tree*, not the
*history*. The real hostname remains readable in `origin/master`'s past commits and in this
PR's own diff until the two deferred operator-only actions run — history purge, and rotation
at #1051. Until rotation, the address is scrubbed but not revoked, exactly as the plan says.

cairn: searched "privacy blob url", "vacuous", "fail-closed" via
`node skills/cairn/bin/cairn-find.mjs`. Matched (quoted verbatim):
`When writing a fail-closed shell check, use a three-way branch on the real return code (1=clean, 0=match found/FAIL, >=2=` —
which is exactly the shape `blob_host_check` implements and which F4 flags the one deviation
from; and `When validating a new fail-closed gate, prove it fires RED on a genuine violation first, not just` —
why this review ran six live probes of the shipped block instead of reading it.
