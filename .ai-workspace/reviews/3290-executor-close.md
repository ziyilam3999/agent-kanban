# 3290 executor close — feed fail-loud half (agent-kanban)

DISPATCH-NONCE:OR-NONCE-d6defc3cf46ff51f

Executor-close: PR https://github.com/ziylam3999/agent-kanban/pull/94 (draft) — made board-live-push.mjs abort before the first upsert, state hash unwritten, with a named focus-join-failed stderr line whenever focus-progress returned focuses but the inner status-tables run gave no focus scalars (fail / empty foci / timeout), added the sandboxed fail-loud smoke (npm run test:board-live-push-failloud: must-fire red at pristine origin/master, green at head; healthy fixture byte-identical to base), and verified parity, size and jest suites green.

## Fix cycle 1 — 2026-10-22 (execution review feed: findings 1–3)

DISPATCH-NONCE:OR-NONCE-737277ee4840fc29

Executor-close: PR https://github.com/ziyilam3999/agent-kanban/pull/94 — fixed review findings 1–3: every focus-progress failure shape (crash, garbled JSON, script missing) now aborts the push before the first upsert via a cause-class focusFail (no raw error echo), a wholesale name-match miss aborts naming unmatched focus names only (names joined on trimmed form, so whitespace drift still publishes), and the sandbox gh stub now accepts only the two real invocation shapes the script makes and rejects everything else real-gh-style; 7 must-fire arms red at pristine origin/master, green at head, healthy output byte-identical.

- RULE: the board push must refuse to publish whenever any input it joins (status tables, focus lists, focus progress) is missing, unparseable, or fails to match — the catch around a joined input aborts with a named cause class before the first upsert instead of degrading to a partial board; a fake CLI in a test harness must reject every argument shape the real CLI would reject.
- SIBLING-SEARCH: `command grep -n -E "JSON.parse|execFileSync|spawnSync" scripts/board-live-push.mjs` — 20 hits. Every input read checked for the silent-fallback shape: the two publish-integrity joins are the status-tables run (:124) and focus-progress (:332) — both now guarded (foci guard + focusFail + all-names-unmatched guard, all before the first upsert). The rest are not publish-integrity: wiki registry (:58) and jevResearch (:376) are documented fail-open optionals; routes (:95), seats (:98/:99), zaiModel (:171) degrade cosmetic strings; board file (:66) and gh (:409-410) crash loud; bad --kanban-json (:199) exits 2; the selector fallback (:200) records itself in laneSource; per-ticket reads (:125, :252, :377, :379) and prev-state (:454) treat absent as legal quiet.
- HELD-OUT (own variants, both directions):
  - must-fire: focus-progress exits non-zero → push aborts, zero publishes (FF_MODE=crash)
  - must-fire: focus-progress prints truncated JSON → push aborts (FF_MODE=garbled)
  - must-fire: focus-progress script absent from the focus dir → push aborts (empty --focus-dir)
  - must-fire: status-tables foci names match none of focus-progress's → push aborts naming the unmatched names only (ST_MODE=drift)
  - must-not-fire: healthy inputs → same bytes published as pristine origin/master (healthy-equivalence arm)
  - must-not-fire: one focus with zero tickets but a matching name → publishes (FF_MODE=zerotickets)
  - must-not-fire: focus names differing only in surrounding whitespace → publishes (ST_MODE=ws)
  - must-not-fire: gh stub is offered an unknown flag / unexpected positional / missing --title → stub exits non-zero (strictness spot-checks)

- PR-TABLE:

| variant | direction | expected | observed |
|---|---|---|---|
| focus-progress-exits-nonzero | must-fire | rc≠0, named line, 0 upserts, no state | head: `npm run test:board-live-push-failloud` rc=0 (arm ok); base: scratch non-exiting-fail copy rc=0 reporting arm red (rc=0 push, 4 upserts, state written) |
| focus-progress-prints-garbled-json | must-fire | rc≠0, named line, 0 upserts, no state | head: same command rc=0 (arm ok); base: same scratch copy — arm red (rc=0 push, 4 upserts) |
| focus-progress-script-missing | must-fire | rc≠0, named line, 0 upserts, no state | head: same command rc=0 (arm ok); base: same scratch copy — arm red (rc=0 push, 4 upserts) |
| all-focus-names-unmatched | must-fire | rc≠0, named line (names only), 0 upserts, no state | head: same command rc=0 (arm ok); base: same scratch copy — arm red (rc=0 push, 4 upserts) |
| inner-run-exits-nonzero / empty-foci / times-out | must-fire (pre-existing r0 arms) | rc≠0, named line, 0 upserts, no state | head: same command rc=0 (all ok); base: same scratch copy — all red (rc=0 push, 4 upserts) |
| healthy-fixture | must-not-fire | rc=0, 4 upserts, state written, byte-identical to base | head: `BASE_MJS=<pristine origin/master copy> bash __tests__/board-live-push-failloud-test.sh` rc=0 (healthy-equivalence ok) |
| focus-zero-tickets-matching-name | must-not-fire | publishes, no abort | head: same command rc=0 (arm ok); green at base too |
| focus-name-whitespace-drift | must-not-fire | publishes, no abort | head: same command rc=0 (arm ok); green at base too |
| gh stub unknown flag / stray positional / missing --title | must-not-fire (stub must reject) | stub rc≠0 with real-style stderr | head: same command rc=0 (spot-checks ok) |

- INPUT-BOUND: n/a -- every joined input is read through one bounded execFileSync (20 s timeout, so a hung producer cannot loop) and one JSON.parse whose throw now aborts the push (fail closed on oversized or garbled output); the match guard is a single pass of set lookups over the already-parsed focus arrays (O(n), no unbounded loop), and the bodies already carry the pre-existing 60000-byte fail-closed cap before any upsert.
