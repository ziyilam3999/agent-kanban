# 3290 execution review — feed fail-loud half (agent-kanban PR #94)

3ROLE_TASK:3290 ROLE:execution-review
PR: ziyilam3999/agent-kanban#94 · branch 3290-feed-failloud · head 3d4f0d7176 · base origin/master c699035f17
Plan: ai-brain .ai-workspace/plans/2026-10-19-3290-board-pct.md (Intent 4 + "Second PR" bullet)

## Review

Decision: NEEDS-WORK

The guard that shipped is correct for the shape the plan names (the inner status-tables run dies while
focus-progress returned focuses), it is red at a pristine origin/master and green at head, it publishes
nothing and leaves the state hash unwritten, and the healthy path is byte-identical. But the brief asks
that EVERY focus-join failure shape fail loud and publish nothing, and three probed shapes still ship a
hollow board with exit 0, four upserts and a fresh state hash. The guard checks a proxy (is `focus.foci`
non-empty) instead of the join's outcome (did the cards get their scalars).

### What I ran (all in a scratch sandbox: stub gh on a cut PATH, HOME in a temp dir, synthetic ai-brain)

- `npm run test:board-live-push-failloud` at head with `BASE_MJS` = pristine `git archive origin/master`
  copy: rc=0, all 7 arms ok (3 must-fire, 3 must-not-fire, healthy-equivalence byte-identical).
- The same test file run inside the pristine origin/master archive with `fail()` made non-exiting, so
  every arm reports: all 3 must-fire arms RED at base (exit 0, no named line, 4 upserts, state written);
  all 3 must-not-fire arms green at base too (they are guards, as intended).
- `npm run test:board-live-push-parity` at head with `BOARD_AI_BRAIN` = ai-brain primary: rc=0
  ("green reproduces expected-old.json; red control diverges"; wiki arms green). The parity and size
  smoke files are untouched by the diff (`git diff --stat origin/master...HEAD` on them is empty).
- Production no-false-abort check (read-only, counts only): live status-tables `--json` gives
  `focus.foci` = 4, live focus-progress `--json-full` gives 4. status-tables builds foci from every
  focus (active, paused, done), so an all-done or all-paused board does not trip the guard.
- Extra shape probe (scratch copy of the test's sandbox, extra stub modes), head vs base:

| shape | head | base |
|---|---|---|
| status-tables prints garbled JSON | rc=1, 0 upserts, named line, no state | rc=0, 4 upserts |
| status-tables foci present, no name matches focus-progress | rc=0, 4 upserts, state written | same |
| focus-progress prints garbled JSON | rc=0, 4 upserts, state written | same |
| focus-progress exits non-zero | rc=0, 4 upserts, state written | same |
| focus-progress script missing | rc=0, 4 upserts, state written | same |
| focus-progress `[]`, status-tables ok | rc=0, 4 upserts (legal empty board) | same |
| healthy | rc=0, 4 upserts | same |

### Findings

1. MAJOR — focus-progress failures still ship a hollow board. When the focus-progress run crashes,
   prints garbled JSON, or is missing, the `catch` around the focus block logs `focuses: <message>` and
   the push continues with `focuses = []`: the summary ships with no focus cards and the #4 focus-details
   body is overwritten with an empty map (the last good lists are wiped), exit 0, state hash written.
   That is the same "degraded push ships silently" class the plan's Intent 4 exists to close ("a degraded
   push must never ship silently"; "the board keeps the last good bodies instead of a hollow one"), and the
   brief names these shapes (missing focus file, garbled JSON) explicitly. The plan's literal wording
   scoped the abort to "while focus-progress returned focuses", so this is a plan gap the diff inherits,
   not an executor deviation; it still blocks the brief's check (1). Fix shape: a focus-progress failure
   (the catch firing) aborts before the first upsert with a named stderr line, state hash unwritten, plus
   a must-fire arm per shape (crash, garbled, missing) red at base and green at head. A genuinely empty
   list (`[]`) stays a legal quiet board.
2. MAJOR — the guard tests `foci.length`, not the join result. If status-tables returns foci whose names
   match none of focus-progress's names (label/name drift, or any other keying change), every card ships
   with `wtdPct: null` — exactly the incident's "no %" symptom — with exit 0 and 4 upserts. Fix shape:
   decide on the joined result (e.g. abort when focus-progress returned focuses and none of them found its
   status-tables scalars), with a must-fire arm for the all-unmatched case. The existing
   single-focus-missing-scalars pass-through arm can stay if that partial case is meant to be legal; if
   so, say why in the code comment.
3. MINOR — the gh stub accepts any arguments. It logs and succeeds for every call, so the 4-upsert
   must-not-fire arms would stay green even if a later change broke the `gh issue edit` argument shape
   (the #3312 class: fake CLIs must reject unknown flags). No live-write risk: the stub is the only gh on
   the cut PATH and the harness fails closed if gh does not resolve to it. Suggest the stub accept only the
   `issue edit <n> -R <repo> --body-file <f>` / `issue create ...` shapes the script uses and exit non-zero
   on anything else.
4. NOTE — deviation from the plan's "Second PR" bullet ("an empty foci/stRow ... aborts"): the executor
   deliberately does NOT abort on an empty stRow, because a board with no running work lanes is legal.
   I agree; the plan's Intent 4 wording (inner run fails or yields no focus scalars) does not require it.
   The plan bullet should be reconciled when the plan is next touched.
5. NOTE — error message hygiene (brief check 3): the new `focus-join-failed:` line names the cause
   ("no output (run failed or timed out)" vs "no focus scalars (focus.foci empty)") and prints only a
   focus count — no file contents, no paths, no ticket text. PASS. The pre-existing `focuses:` stderr line
   (not in this diff) echoes the raw error message, which includes the absolute focus-script path; if
   finding 1's fix adds an abort there, the new line should name the cause without echoing that message.
6. NOTE — hermeticity (brief check 2): PASS. Sandbox PATH is `<stub bin>:/usr/bin:/bin` with a fail-closed
   check that gh resolves to the stub; HOME, the ai-brain checkout, focus dir and data are all under a
   mktemp dir; `--kanban-json` avoids the selector spawn; the base-equivalence arm runs print modes only.
   Every target is passed explicitly; nothing defaults to a live path.
7. NOTE — no parity arm weakened (brief check 4): PASS. Parity and size smoke files unchanged; parity
   green at head. The new guard sits after the `--dry-run` exit, so every print mode is unaffected; the
   healthy equivalence arm covers `--focus-body` and `--dry-run --json`, and the inserted code only adds
   an exit branch after all bodies are computed, so the pushed bodies are unchanged by construction.

### Named-risk notes

DISPOSITION NR-3290-R1 not-applicable: the note concerns the page half (ai-brain tools/board/page/index.html running-list join); this agent-kanban PR does not touch the page, so it must be decided by the execution review of the ai-brain PR.

### Monotonicity

The diff adds one early-exit arm before the upserts; it has no clear-list, mutual-exclusion or
last-writer-wins arm. The stronger claim (dead join → no publish) cannot be erased by any later
statement because `process.exit(1)` precedes every upsert and the state write.

### Size

plan-review ran (not WAIVED size-s); size M stands: one code file, one new smoke, package.json wiring.
