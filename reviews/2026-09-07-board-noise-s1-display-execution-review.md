# Execution Review — board-noise-s1-display (S1 DISPLAY, agent-kanban)

Decision: FAIL

- **Role:** execution-review (stateless, last line of defense — did NOT author this code).
- **Task:** `board-noise-s1-display` (cross-repo: agent-kanban PR #80, branch `board-noise-s1-display`).
- **PR head reviewed:** `4d22390c3b326b3b19a59370197a5c2ad13eda12` (single commit on top of `origin/master`).
- **Pre-fix / fork-point commit:** `2de175457bf9ef5385b5aebb27f7e46a588d1852` ("fix(fold8) … #79").
- **Design source (ai-brain):** `.ai-workspace/designs/2026-09-06-board-noise-ticket-triage-display-and-closing.md` §S1.
- **Review method:** fresh detached worktree at the PR head; every test run by THIS reviewer, not trusted from the executor's numbers.

## Carried named-risk notes

`node hooks/named-risk-notes.mjs list --task board-noise-s1-display` → `NO-NOTES board-noise-s1-display`.
Nothing was carried for this task; the receiving-end disposition duty is skipped (nothing to disposition).

## Verdict summary

FAIL — **AC-1.6 does not hold on the PR head**: the interaction-test marker's structured
`interaction-test:` header line (`.ai-workspace/reviews/board-noise-s1-display-interaction-test.md:45`)
is EMPTY (colon, then end of line), so `hooks/ui-task-gate.sh` BLOCKS the completion (exit 2) —
"ERR missing interaction-test header". AC-1.6 requires the gate to "pass on its own." It does not.

AC-1.1 through AC-1.5 all PASS on re-measurement (real, independently reproduced numbers below),
and the SUBSTANCE of all three UI-gate legs is genuine and high quality — including the interaction
test, which I proved is a real device-interaction oracle (real `.tap()` + `scrollHeight` delta on a
390×844 touch viewport) that genuinely goes RED on the pre-fix build. The failure is a single
malformed marker field, not a hollow gate — but AC-1.6 is a Binary AC and it mechanically fails, so
the honest verdict is FAIL. Fix is one line (see "Required fix" below); re-review after.

## Per-AC re-measurement (all tests run by this reviewer)

### AC-1.1 — lockstep fixture + resolver — PASS
- `diff -r __tests__/fixtures/task-kind-store/ <ai-brain>/tests/fixtures/task-kind-store/` → **exit 0** (byte-identical lockstep copy).
- `npx jest __tests__/ticket-kind.test.ts` → **6 passed, 6 total** (exit 0). Confirms legacy `metadata.kind:"bug"` (9013) ⇒ `work`, an unknown `kind` value ⇒ `work`, and every fixture id reproduces `EXPECTED.json`.

### AC-1.2 — exporter kind enum + board-only step-4 — PASS
- `TASKS_DIR=<fixture> OUT=<scratch> npx tsx scripts/export-board.ts` → **exit 0**, 20 tickets.
- 20/20 tickets carry `kind` in the enum {work, bookkeeping, parked, deferred}; none missing.
- deferred-behind-pending (9019, blocker 9001 pending) → `deferred` ✓
- deferred-behind-completed (9020, blocker 9018 completed) → `work` ✓ (step-4 auto-unshelve fires only when `blockedBy` is empty after resolution).

### AC-1.3 — typecheck + full jest + activeIds exclusion — PASS
- `npm run typecheck` (`tsc --noEmit`) → **exit 0**.
- `npx jest` (full) → **50 suites / 488 tests passed** (exit 0). (A React dev `console.error` stack appears inside a passing suite — noise, not a failure; 488/488 green.)
- `active.test.ts` binds AC-1.3 to the fixture: the S0 fixture's in_progress bookkeeping ticket (9011) is EXCLUDED from a live session's `activeIds` (`isDisplayWork` gate in `computeActiveIds`). Verified.

### AC-1.4 — Playwright desktop shelf — PASS
- `PW_WEB_SERVER=1 npx playwright test e2e/shelf.e2e.spec.ts` (desktop) → **passed**.
- Asserts: sum of the four `.ak-col__count` == number of open `work` fixtures; `details.ak-shelf` exists and is CLOSED on load; summary matches `/Bookkeeping \d+ · Parked \d+ · Deferred \d+/`; header matches `/\d+ ACTIVE · \d+ ON SHELF/`; no horizontal overflow. All green, and expectations are derived from the SAME exported board (never hand-counted).

### AC-1.5 — Playwright 390×844 hasTouch real-interaction — PASS
- Fixed build: `.tap()` on `.ak-shelf__summary` → shelf body `scrollHeight` 0 → >0, four column counts unchanged → **passed**.
- **Red-on-prefix independently reproduced by this reviewer** (the load-bearing check): a throwaway detached worktree at `2de1754`, with only `e2e/shelf.e2e.spec.ts` + the fixture copied in and NO other source change, ran the same spec against the unmodified pre-fix app → **AC-1.5 FAILS**: `locator('details.ak-shelf')` "element(s) not found" (no shelf exists pre-fix); AC-1.4 also fails (`exp.workCount === 0`, pre-fix exporter has no `kind`). This proves the interaction test is a genuine live control (a real gesture on a touch viewport), not a dead control that passes on a broken app.

### AC-1.6 — completion metadata + `hooks/ui-task-gate.sh` passes on its own — **FAIL**
- design_brief file EXISTS and is a real POV (rejected alternatives, documented CSS trap) with a `design_pov:` line — gate leg (b) PASSES.
- ui_evolve_verdict file EXISTS with a structured `verdict: ACCEPT` + numeric rubric score (18/20) — gate leg (a) PASSES.
- interaction_test file EXISTS and is genuinely interaction-driven and proven red-on-prefix — but its **structured `interaction-test:` header value is EMPTY** (line 45 is just `interaction-test:` with nothing after the colon). The gate's header regex `^\s*interaction-test\s*[:=]\s*(\S.*)$` matches nothing, so leg (c) BLOCKS.
- No `ui_gate_skip` present (correct) — but the gate does NOT pass, and AC-1.6 forbids `ui_gate_skip` as an escape, so there is no legitimate path to a passing completion without fixing the marker.
- **Independently executed the gate against a synthetic completion citing all three artifacts (absolute paths) with UI code-work evidence:**
  - As-shipped marker → `UI-TASK GATE … cannot mark task … completed. interaction_test marker invalid: ERR missing interaction-test header` → **exit 2 (BLOCK)**.
  - Marker with a one-line header fix (`interaction-test: e2e/shelf.e2e.spec.ts (AC-1.5 …)`) and nothing else changed → **exit 0 (PASS)**: "ui-evolve OK structured ACCEPT + rubric score + frontend-design marker + interaction-test: OK … (asserts=scroll-delta)". This confirms the empty header is the SOLE blocker; every other structured field (asserts=scroll-delta, viewport=390x844 touch=true on the same line, red-on-prefix ≥7 chars, result=PASS with no structured FAIL/RED) is valid.

## 3-leg UI-task gate — adversarial judgment (substance)

1. **design_brief** — REAL. `.ai-workspace/design/2026-09-07-board-noise-s1-shelf-design-brief.md`: a bold, on-purpose POV (collapsed `<details>` shelf), explicitly rejects the 5th-column and hide-toggle alternatives with reasons, documents a load-bearing CSS trap (`display:none` needed so `scrollHeight` is genuinely 0 while closed), carries a `design_pov:` line. Not generic slop.
2. **ui_evolve_verdict** — REAL. `verdict: ACCEPT`, 18/20 (threshold ≥16, no axis <3), 5-axis rubric scored against 6 real Playwright screenshots (mobile 390×844 + desktop), regression guard (488 jest + typecheck). Screenshots are in the diff.
3. **interaction_test** — GENUINELY interaction-driven (NOT a computed-style check in marker costume): the cited spec uses a real Playwright `.tap()` (engine-level touch input, `hasTouch:true`, 390×844), asserts `.ak-shelf__body.scrollHeight` 0 → >0, and asserts the four column counts are unchanged. I reproduced its RED on the named pre-fix commit `2de1754` myself. The ONLY defect is the malformed marker HEADER field (empty value), which fails the gate's mechanical parse — a real gate rejection, not a quality objection.

## Monotonicity checklist (#1590) — clear-list / mutual-exclusion / last-writer arms in the diff

- `resolveTicketKind` (ticket-kind.ts): explicit in-enum `metadata.kind` is the STRONGER claim and returns first; the weaker subject-prefix fallback and the `work` default can never erase it. Correct.
- `buildBoard` step-4 deferred→work: the STRONGER "still blocked" state (non-empty `blockedBy` after `filterResolvedBlockers`) keeps `deferred`; the flip to `work` fires ONLY when `blockedBy` is empty. A weaker/absent signal can't unshelve. Correct.
- `filterResolvedBlockers`: an absent blocker is KEPT (fail-safe — the board never hides an unprovable blocker; documented deliberate opposite of the ai-brain gate). The stronger "cannot prove resolved" wins. Correct.
- `toColumn` / `newestExecutionReviewState` (build-board.ts): board moves forward only — resolved-nonfail stays in_review; only a fail-class verdict (a genuinely stronger backward signal) moves it back to in_progress; newest-by-ts (append-order tiebreak) wins, older verdicts can't erase it. Correct.
- `pipelineHasOpenPunchIn` (active.ts): a per-agentId `closedAt` (STRONGER "done") wins over any later open-looking row for the same agentId; a reopen mints a fresh agentId. Correct.
- ui-task-gate marker `result` REJECT-WINS: a structured FAIL/RED beats any later PASS. The as-shipped marker has only `result=PASS`/prose `Result: **PASS**` — no structured FAIL/RED token — so this arm does not fire; the block is on the missing header, not on a stray RED. Correct.

## Observed PR check status

`gh pr view 80` → state **OPEN**, mergeStateStatus **UNSTABLE**. Rollup: build (ubuntu, 20) SUCCESS · fold-front-screen-overflow-guard SUCCESS · **privacy SUCCESS** · **Vercel FAILURE** · Vercel Preview Comments SUCCESS. UNSTABLE is driven solely by the non-required **Vercel deploy** check failing (a deployment/infra concern, not a product-CI or AC signal); the product CI (build, privacy, overflow-guard) is green. The ACs were re-measured locally regardless of CI.

## Required fix (single line) for a passing re-review

In `.ai-workspace/reviews/board-noise-s1-display-interaction-test.md`, give the structured
`interaction-test:` header (line 45) a non-empty reference on the SAME line, e.g.
`interaction-test: e2e/shelf.e2e.spec.ts (AC-1.5 shelf real-interaction)`. With that change and
nothing else, `hooks/ui-task-gate.sh` passes (independently verified, exit 0). No code or test change
is needed — AC-1.1..AC-1.5 are already green.

## Privacy scan

Canonical invocation (`docs/privacy-scan-invocation-contract.md`), `--working`, home-dir fragment placeholdered:

```
bash scripts/privacy-scan.sh --working \
  <home-dir-path-pattern>/coding_projects/agent-kanban/.claude/worktrees/s1-review-4d22390/reviews/2026-09-07-board-noise-s1-display-execution-review.md \
  <home-dir-path-pattern>/…/.ai-workspace/reviews/board-noise-s1-display-interaction-test.md \
  <home-dir-path-pattern>/…/.ai-workspace/ui-evolve/board-noise-s1-display/verdict.md \
  <home-dir-path-pattern>/…/.ai-workspace/design/2026-09-07-board-noise-s1-shelf-design-brief.md
```

- Paths scanned: this verdict artifact + the interaction-test marker + the ui-evolve verdict + the design brief (all four `--working`).
- Scanner verdict line (verbatim): `privacy-scan: CLEAN mode=working size=28150` (exit 0; non-zero size = real content scanned).
- Positive control: the identical invocation shape against a scratch copy of this verdict carrying a seeded home-path needle → `privacy-scan: DIRTY (home-path matches=1, …)` (exit 1) — the instrument has power against this artifact's own match class.
- The repo `privacy` CI check on PR #80 is also SUCCESS.

Decision: FAIL
