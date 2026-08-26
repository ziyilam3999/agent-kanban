# Execution-review — fold8-poll-metered-payload-diet (PR #76)

**Decision: PASS**

Independent execution-review (Opus, cc-execution-review seat). I did NOT write this code. Every
Binary AC below was verified BY EXECUTION in an isolated worktree checked out from the PR head, not
from the executor's self-report. Reviewed at PR #76 head `be6882db1f63640f08f2e169c192616183a92c96`
(== `origin/fold8-poll-metered-payload-diet`), base master, mergeStateStatus CLEAN.

Worktree: `.claude/worktrees/fold8-poll-metered-payload-diet` (repo-relative)
(head SHA re-verified == be6882db BEFORE this verdict commit was appended).

## Binary AC — verified by execution

| AC | Result | Evidence |
|----|--------|----------|
| AC1 — 200 carries a validator | PASS | Live `curl -si localhost:3999/api/board` → `200`, `etag: "845287cc…"` (non-empty), `cache-control: public, s-maxage=10, stale-while-revalidate=20`. |
| AC2 — unchanged ⇒ 304, empty body | PASS | `curl -si -H 'If-None-Match: "845287cc…"'` → `304 Not Modified`; `-w '%{size_download}'` = `0`. |
| AC3 — changed ⇒ 200 + new validator | PASS | After bumping a field in `data/board.json`, conditional GET with the OLD ETag → `200` size `5101434` with a DIFFERENT ETag `"0b863a0b…"`; that new ETag round-trips to `304`. Restoring the byte content reproduced the ORIGINAL ETag `"845287cc…"`. |
| AC4 — 304 keeps the CDN policy | PASS | The AC2 `304` response ALSO carried `cache-control: public, s-maxage=10, stale-while-revalidate=20`. |
| AC5 — client conditional + visibility test-locked | PASS | `npx jest __tests__/board-poll-conditional.test.ts` — AC5 (i)(ii)(iii) all green: If-None-Match presented after the first fetch; ZERO fetches while `document.hidden`; immediate refetch on `visibilitychange`→visible. |
| AC6 — 304 no-op, change lands within one poll | PASS | Same test file green; `200(v1)→304→200(v2)` proves v1 survives the 304 unreset and v2 lands on the next tick. Mutation-proven oracle (below). |
| AC7 — no regression | PASS | `npx jest` = **451/451** (46 suites); `npm run build` exit 0 (`/api/board` = ƒ Dynamic); `npm run typecheck` exit 0. `board-route-cache.test.ts` (#1138 contract) still green. |
| AC8 — deployed byte measurement | DEFERRED (sanctioned) | Per the plan's "Deferred-follow-ups" escape hatch (Vercel deploy blocked by auto-mode classifier; preview hit SSO 302 wall). PR body records both blocked attempts honestly. NON-BLOCKING per this review's brief; origin-level 304 correctness is fully proven by AC1–4 live. See open item below. |

## Adversarial probes

1. **ETag determinism (feature-critical).** PASS. Three repeated fresh GETs of unchanged content returned
   the IDENTICAL ETag; restoring byte content reproduced the original ETag; changed content produced a
   different ETag; a NON-matching `If-None-Match` returned a full `200` (5,101,434 B). No timestamp/now
   poison in the hashed body — `route.ts` serializes the board ONCE via `JSON.stringify(board)` and both
   hashes and serves that exact text (r1 honored); `generatedAt` is stamped only at export, so idle boards
   hash stably. The instrument can return BOTH 304 and 200 depending on the validator — the feature is live,
   not a blanket-304.
2. **NRN-1 (now-clock).** ADDRESSED. The `304` branch calls `setNow(Date.now())` before returning (skips only
   `setBoard`/diff/glow). Proven a real oracle: mutating the 304 branch to a bare early-return (the exact
   frozen-clock bug) made the NRN-1 test FAIL ("Expected 1m ago, Received just now"); restored → PASS.
3. **NRN-2 (UI state survives 304).** ADDRESSED. The committed test opens the drawer (`[role="dialog"]`
   aria-label "Ticket #t1 audit log") AND sets an in-flight glow (`.ak-card--live`) BEFORE the 304, fired via
   `visibilitychange` with zero time-advance to isolate the 304 branch from glow's own 2s timer, then asserts
   both survive plus board-data unreset. Proven a real oracle: mutating the 304 branch to reset UI state
   (`setSelectedId(null)`, clear `moved`/`fresh`) made the NRN-2 test FAIL on the glow assertion; restored → PASS.
4. **Changed-tick correctness.** PASS. The server recomputes the CURRENT ETag every request and only 304s when
   current content matches the presented validator, so a stale client ETag can never cause a missed change —
   the next poll gets a full 200. AC6 locks "change lands within one poll."
5. **AnimatePresence / querySelector "fix".** The orientation's claim of a column-scoped querySelector PRODUCT
   change is NOT in this diff — there is no `querySelector`/`AnimatePresence` change anywhere in
   `components/BoardView.tsx` (grep-verified; the whole BoardView diff is 62 lines, all the poll-loop ETag
   work). The column-scoping lives in the TEST's query helpers (to avoid grabbing AnimatePresence's stale
   exiting DOM node). No product query was narrowed → no regression risk. In-scope and clean.
6. **Monotonicity (#1590).** PASS. The only last-writer/mutual-exclusion arm is 304-no-op (weaker) vs
   200-with-change (stronger). Verified in code: the diff baselines `prevCols.current` (BoardView.tsx:173,243),
   `lastRawBoardRef.current` (:157), and `lastEtagRef.current` (:146) are ALL advanced ONLY on the 200-changed
   path — a 304 writes none of them. The weaker "unchanged" signal therefore cannot erase a pending change;
   the next real 200 delivers it. Weaker cannot overwrite stronger.

## Named-risk note dispositions (round-scope carry — receiving-end duty #2434)

Both notes carried for this task were listed (`node hooks/named-risk-notes.mjs list`), read in full, and
decided against the actual diff:

DISPOSITION nrn1-now-clock-freeze-on-304 addressed — the 304 branch advances `setNow(Date.now())` (BoardView.tsx:139-142); committed NRN-1 test locks it and mutation-fails on a frozen clock. The `ui_gate_skip` "no visual change" reason stays literally true.
DISPOSITION nrn2-ac6-underlocks-r4-uistate addressed — the committed AC-6 test exercises the enumerated UI-interaction state (open drawer + in-flight glow), selecting/opening BEFORE the 304 and asserting survival; mutation-fails when the 304 branch resets that state.

## Privacy scan (per docs/privacy-scan-invocation-contract.md)

- Invocation: `bash scripts/privacy-scan.sh --working <7 changed artifacts>` (route.ts, BoardView.tsx,
  board-cache.ts, board-poll-conditional.test.ts, board-route-cache.test.ts, lane-reveal.test.ts, plan .md).
- Verdict line: `privacy-scan: CLEAN mode=working size=72771` (non-zero size — real content inspected).
- Positive control: same `--working` shape on a scratch copy seeded with a `/Users/<name>/…` home-path needle →
  `privacy-scan: DIRTY (home-path matches=1, …)`, exit 1 — instrument had power against this artifact's class.

## Local verification runs

- `npx jest __tests__/board-poll-conditional.test.ts` → 6 passed.
- `npx jest` (full) → 46 suites / 451 tests passed.
- `npm run typecheck` → exit 0.
- `npm run build` → exit 0.
- `npm run start` (PORT=3999, `BOARD_BLOB_URL` unset ⇒ local `data/board.json`) → live curl AC1–4 + determinism + controls above.
- `data/board.json` is gitignored/untracked; the AC3 edit never touched the PR and was reverted (ETag restored to `"845287cc…"`).

## Open items (non-blocking)

- **AC8 follow-up ticket.** The PR body flags the deployed-byte-measurement follow-up "for the orchestrator"
  rather than confirming `fold8-payload-diet-ac8-deployed-byte-measurement` is filed. I could not confirm the
  ticket exists on the board from this seat. Deferral itself is honestly scoped and sanctioned; filing the
  follow-up is an orchestrator action, not a blocker on this diff.

**Verdict: PASS** — all locally-testable Binary AC (1–7) pass by independent execution; both named-risk
notes are addressed and mutation-proven; AC8 is honestly deferred per the sanctioned escape hatch.
