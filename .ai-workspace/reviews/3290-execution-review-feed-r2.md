# 3290 execution review r2 — feed fail-loud half (agent-kanban PR #94), after fix cycle 1

3ROLE_TASK:3290 ROLE:execution-review
PR: ziyilam3999/agent-kanban#94 · branch 3290-feed-failloud · head 71abc17cd5 · base origin/master c699035f17
Plan: ai-brain .ai-workspace/plans/2026-10-19-3290-board-pct.md (Intent 4 + "Second PR" bullet)
Prior round: .ai-workspace/reviews/3290-execution-review-feed.md (NEEDS-WORK: 2 MAJOR, 1 MINOR)

## Review

Decision: PASS

Fix cycle 1 closes all three round-1 findings, verified by running, not by reading the executor's
table. Every must-fire arm (7) is red at a pristine `git archive origin/master` and green at head;
every must-not-fire arm (5) is green at both; the healthy #4 body and the dry-run summary are
byte-identical to base; mutation red controls on each new guard and on the strict gh stub turn the
suite red. Parity and size smokes are untouched and green. What remains is three MINOR edges (one
mislabelled cause class, one reverse-direction empty shape, one upstream silent id-drop) that do not
reopen the incident class the plan targets; I recommend one batched S follow-up.

### What I ran (scratch sandboxes only; stub gh on a cut PATH; HOME in a temp dir; never the live push)

- Head: `BASE_MJS=<pristine origin/master board-live-push.mjs> bash __tests__/board-live-push-failloud-test.sh`
  rc=0 — 7 must-fire ok, 5 must-not-fire ok, gh-stub strictness spot-checks ok,
  `ok healthy-equivalence (#4 body + dry-run summary byte-identical to base)`.
- Base (red at pristine): the head test file copied into a `git archive origin/master` tree with `fail()`
  made non-exiting so every arm reports: all 7 must-fire arms FAIL at base (exit 0, no named line,
  4 upserts, state hash written); all 5 must-not-fire arms ok at base (guards, as intended).
- Red controls (head script mutated in a scratch copy, head test unchanged):
  `if (focusFail)` disabled -> `FAIL: focus-progress-exits-nonzero: exited 0`;
  the all-unmatched guard disabled -> `FAIL: all-focus-names-unmatched: exited 0`;
  the script's `gh issue edit` given an unknown flag -> `FAIL: healthy-fixture: exited 1` (the strict stub bites).
- `BOARD_AI_BRAIN=<ai-brain primary> npm run test:board-live-push-parity` rc=0
  ("green reproduces expected-old.json; red control diverges"; wiki arms green).
- `BOARD_AI_BRAIN=<ai-brain primary> bash __tests__/board-live-size-smoke-test.sh` rc=0 (summary 45559 B, cap 48000).
- `git diff --stat origin/master...HEAD` on the parity and size smoke files: empty. Test file mode 100755.
- Extra shape probes at head (scratch copy of the test sandbox with extra stub modes, plus a copy of the
  real focus-progress script run against synthetic focus-lists.json states):

| shape | head result |
|---|---|
| real focus-progress, focus-lists.json missing | rc=1, 0 upserts, no state, named line |
| real focus-progress, focus-lists.json garbled | rc=1, 0 upserts, no state, named line |
| focus-progress prints valid JSON that is not an array (`{}`) | rc=1, 0 upserts, no state |
| focus-progress rows field missing | rc=1, 0 upserts, no state |
| focus dir absent | rc=1, 0 upserts, cause "script missing" |
| focus script absent, dir present | rc=1, 0 upserts, cause "run failed (non-zero exit or timeout)" (finding 1) |
| focus-progress `[]` while status-tables has foci | rc=0, 4 upserts, state written (finding 2) |
| focus-progress `[]` and status-tables dead | rc=0, 4 upserts, state written (finding 2) |
| real focus-progress, every listed ticket id unknown | rc=0, 4 upserts, all cards 0/0 (finding 3) |
| one focus unmatched, other matched | rc=0, 4 upserts, unmatched card wtdPct null (documented legal) |

### Round-1 findings — closure check

- R1-1 (MAJOR, focus-progress failures ship a hollow board): CLOSED. The catch now sets a cause-class
  `focusFail`, and the guard exits 1 before the first upsert and before the state write. Crash, garbled,
  script-missing, not-an-array and no-rows all abort (table above); red at base for the three tested arms.
- R1-2 (MAJOR, guard tested `foci.length`, not the join outcome): CLOSED. A wholesale name miss aborts
  (`all-focus-names-unmatched`, red at base, red when the guard is disabled). Partial miss stays legal and
  the code comment says why (one card degrades visibly; the rest stays truthful). Names join on the trimmed
  form, and the whitespace arm proves trimming matches (at head a failed match would trip the abort).
- R1-3 (MINOR, permissive gh stub): CLOSED. The stub accepts only the two real invocation shapes and rejects
  unknown flags, stray positionals and a title-less create with `gh:`-style stderr; the mutation control
  above shows a broken argument shape now turns the must-not-fire arms red.

### Findings (this round)

1. MINOR — cause class mislabelled for two shapes. A missing focus script inside an existing focus dir
   reports `focus-progress run failed (non-zero exit or timeout)`, not `script missing` (node exits
   non-zero on a missing module; ENOENT only fires when the cwd itself is absent). Valid JSON of the wrong
   shape (`{}`, rows missing) also reports `run failed (non-zero exit or timeout)` though the run
   succeeded. The push still aborts correctly; only the operator-facing diagnosis is wrong. The
   `focus-progress-script-missing` arm greps only `focus-join-failed:`, so it does not pin the class the
   executor close claims. Fix shape: check the script's presence before spawning, and give shape errors
   their own class (for example "focus-progress output not the expected shape").
2. MINOR — reverse-direction empty shape still publishes. When focus-progress returns `[]` while
   status-tables (which spawns the same script) reports foci, the guard `focuses.length > 0 && ...` does
   not fire: the summary ships with no focus cards and #4 is overwritten with an empty map. The realistic
   trigger is a race (focus-lists.json edited between the two reads ~1 s apart), and the next tick
   self-heals, so this is not the incident shape; round 1 also judged `[]` a legal quiet board. A
   symmetric check (abort when exactly one side is empty) would close it cheaply. Both-empty stays legal.
3. MINOR — every-id-unknown publishes an all-zero board. The live focus-progress script silently drops
   listed ticket ids whose task file is missing; if the tasks dir moves or every id is unknown, every focus
   reports 0/0 and the push ships empty lists. status-tables reproduces the same zeros, so the board is
   consistent with the status tables (the plan's oracle) and the feed cannot see the configured id list;
   the fix belongs upstream (focus-progress reporting its dropped-id count), outside this PR's file.
4. NOTE — error-message hygiene (brief check 3): the new lines print a cause class, focus counts and, for
   the wholesale miss, focus names only (names already shown on the board). No file contents, no paths,
   no ticket text. The pre-existing `focuses: <message>` echo of the raw error (which carried the script
   path) is gone. Separately, and NOT introduced by this diff: `execFileSync` inherits the child's stderr,
   so a crashed focus-progress still prints its own stack (with the script path) to the local log; base
   does the same. Local log only, never published.
5. NOTE — hermeticity (brief check 2): PASS. Sandbox PATH is `<stub bin>:/usr/bin:/bin`; the harness fails
   closed if gh does not resolve to its stub; HOME, the ai-brain checkout, focus dir and data are mktemp;
   every target is passed explicitly; the script's only network path is `gh` (lines 409-410), which is the
   strict stub. The script's own unknown-flag refusal (#3272 F1) is unchanged.
6. NOTE — no parity arm weakened (brief check 4): PASS. Parity and size smoke files unchanged and green;
   the guards sit after every print-mode exit (`--focuses-only`, `--focus-body`, `--dry-run`), so print
   modes still emit (a hollow print on a dead join is caught downstream by check-push's equality check,
   it is never published). The trimmed-name join changes no healthy byte (equivalence arm).
7. NOTE — plan reconciliation carried from round 1 (the "Second PR" bullet's "empty stRow aborts" vs the
   deliberate non-abort on no running lanes) still stands; reconcile when the plan is next touched.

Recommendation: one batched S follow-up ticket for findings 1-3 (cause classes, symmetric empty check,
upstream dropped-id count). None blocks this PR.

### Named-risk notes

`node hooks/named-risk-notes.mjs list --task 3290` printed one note, NR-3290-R1 (page-half harness arms).

DISPOSITION NR-3290-R1 not-applicable: the note concerns the page half (ai-brain tools/board/page/index.html running-list join and its AC1/AC3 harness arms); this agent-kanban PR does not touch the page, so it is decided by the execution review of the ai-brain PR.

### Monotonicity

Three early-exit arms, all before the first upsert and the state write: `focusFail` (focus-progress dead),
`focuses.length > 0 && stFoci.length === 0` (status-tables dead or empty), and the wholesale name miss. The
stronger claim (dead or wholly unmatched join -> no publish) cannot be erased: each is a `process.exit(1)`
that precedes every write, and no later statement can re-enable a publish. The partial-miss pass-through is
the weaker claim and runs only when none of the aborts fired. No clear-list, mutual-exclusion or
last-writer-wins arm in the diff.

### Size

plan-review ran (ledger check: not WAIVED size-s); size M stands: one code file, one new smoke,
package.json wiring.
