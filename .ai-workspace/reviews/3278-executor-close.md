# 3278 executor close — details (#2) under the size cap

DISPATCH-NONCE:OR-NONCE-948332d6bdc91c3b

Executor-close: PR https://github.com/ziyilam3999/agent-kanban/pull/93 — put the #2 details body under the size cap with headroom by construction (per-entry trim desc ≤ 240 / 6 most-recent timeline rows; per-section row cap = recent lanes + 24 most-recently-updated active; unread top-level generatedAt dropped; new no-network `--details-body` print), proved by the extended size smoke (pinned RED control, GREEN ≤ 50,000, doubled-board growth bound, field coverage), with the #1/#3/#4 bodies and the 60,000 all-or-nothing guard untouched.

## AC evidence (2026-10-19, worktree 3278-details-cap @ da023f9)

All numbers below are from `bash __tests__/board-live-size-smoke-test.sh` with `BOARD_AI_BRAIN` set to the local ai-brain checkout, overall exit code 0, final line: `size smoke: details body 31328 bytes on today's shape, 31316 on the doubled board (target <= 50000, cap 60000); pre-fix blob refused the whole push at 87494 bytes`.

| AC | Command | Exit | Observed |
|----|---------|------|----------|
| 1 Under target with headroom | `--details-body` print (no network) inside the smoke, `wc -c` on the printed body | 0 | 31,328 bytes ≤ 50,000 on the today-shaped fixture (40 active rows, 420-char descriptions, 12-row timelines) |
| 2 RED on today's shape | pinned blob `git show 0555ad2:scripts/board-live-push.mjs` run on the same fixture, no `--dry-run`, gh absent from PATH (`env PATH="$WORK/dx-bin"` with only node) | 1 (asserted non-zero) | aborts on the pre-push size guard: `board-live details (auto) too large: 87494` (87494 > 60000); smoke exits non-zero if this control fails — it did not |
| 3 Growth bound | same fixture with active rows doubled (40 → 80), `--details-body` print, `wc -c` | 0 | 31,316 bytes ≤ 50,000 (row cap bounds the body; not a trim) |
| 4 Fields kept | field-coverage node block in the smoke on the GREEN body | 0 | top-level keys exactly `["details"]` (unread `generatedAt` dropped); every carried entry `d` string, `tl` parses as JSON array, every step keeps `r`/`t`/`c`/`v`/`m`/`e`/`a`; max 6 steps/entry; oldest non-lane active ids (9638–9640) correctly outside the cap |
| 5 Smoke green, no regressions | `bash __tests__/board-live-size-smoke-test.sh` | 0 | pre-existing #3272 arms unchanged and passing: summary 45,563 ≤ 48,000, its RED control 66,473 > 62,000, tracked-selector arm green |
| 6 Refuses when unset | `env -u BOARD_AI_BRAIN bash __tests__/board-live-size-smoke-test.sh` | 1 | `FAIL: BOARD_AI_BRAIN is not set (path to the ai-brain checkout holding tests/fixtures/board-size)` — before any feed invocation (no network) |
| 7 Never pushes | by construction + assertion | 0 | every #3278 feed invocation is a print (`--details-body`) or `--dry-run`; the one guard-crossing arm (RED) runs with only node on PATH and the smoke asserts the abort IS the size guard naming #2 |

Levers calibrated: `DETAIL_DESC_MAX = 240`, `DETAIL_TL_MAX = 6`, `DETAIL_ACTIVE_MAX = 24` in `scripts/board-live-push.mjs`; separate trimmed helpers so the shelf (#3) body keeps the 420/10 shape byte-identical. Live board untouched — every run targeted fixtures in a mktemp dir; no live push, no state write.
