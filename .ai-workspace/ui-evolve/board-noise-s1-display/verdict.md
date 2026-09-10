# ui-evolve verdict — board-noise-s1-display (S1 DISPLAY, D1-D5)

verdict: ACCEPT

- **Total: 18 / 20** (threshold: ≥16/20 AND no axis <3 — cleared)
- Scored against a 5-axis rubric derived from the parent design's §4 D1-D5
  (`.ai-workspace/designs/2026-09-06-board-noise-ticket-triage-display-and-closing.md`,
  read from ai-brain `origin/master`) and this build's own design brief
  (`.ai-workspace/design/2026-09-07-board-noise-s1-shelf-design-brief.md`), from
  REAL Playwright screenshots (Node `playwright-core` 1.61, headless Chromium)
  of the app running locally (`next dev -p 3941`) against the shared S0 fixture
  store (`__tests__/fixtures/task-kind-store/`, byte-identical lockstep copy of
  ai-brain's `tests/fixtures/task-kind-store/`), fed via `/api/board` route
  interception — never the live Vercel Blob (see the no-publish note below).

## Per-axis scores (0–4 each)

| # | Axis | Score | Evidence |
|---|---|---|---|
| D1 | Columns show ONLY real work | **4** | `desktop-closed.png`: TODO 4 / PROG 0 / REVIEW 0 / DONE 1 (sum 5) — matches the fixture's 5 `kind=="work"` tickets exactly (9001, 9013, 9014, 9016, and 9020 auto-unshelved). The header stat tiles (`.ak-meter`) agree with the columns number-for-number — this needed a real fix mid-review: the first capture showed the tiles still counting all 20 tickets (`PipelineMeter` was fed the unfiltered `visible` array) while the columns already counted 5; re-wired to share the same `workVisible` array, re-captured, now consistent. #9014 (a completed "work" umbrella) correctly still lands in DONE, not swallowed by the shelf. |
| D2 | Shelf disclosure — closed by default, grouped, legible | **4** | `desktop-closed.png`/`mobile-closed.png`: shelf is a full-width strip below the column board, summary reads `Bookkeeping 11 · Parked 2 · Deferred 1` with a `▸` caret, zero visible card content while closed. `desktop-open.png`/`mobile-open.png`: opened, three labeled groups (BOOKKEEPING/PARKED/DEFERRED) each holding real `Card` tiles — same subject/id/phase/blocked-pill treatment as the columns, so a shelf card reads as "the same kind of thing, filed elsewhere," not a degraded second-class view. No dead space, no clipped text, no overflow on either viewport. |
| D3 | Header pill (`N ACTIVE · M ON SHELF`) | **4** | Both captures show `4 ACTIVE · 14 ON SHELF` next to the existing `IDLE`/live badge, own neutral `--shelf` hue (visually distinct from the mint `N LANES LIVE` pill, which is absent here since the fixture session reads idle-for-lanes) — the pill never competes with or is mistaken for the live-lane signal. |
| D4 | Kind chip + drawer metadata legibility (D5) | **3** | `desktop-open.png`: each shelf card carries a top-right `CHORE`/`PARKED`/`DEFERRED` chip in the shared `--shelf` hue, subject-prefix tags (`hygiene`, `reversible-op RESTORE`, `PARKED #9014`, `SHELVED #9016`, `EPIC`) still visible and legible alongside it — no collision. `desktop-drawer.png`/`mobile-drawer.png`: opening a shelf card surfaces a clean "KIND METADATA" 2-column table (`kind: bookkeeping`, `bookkeeping.type: worktree-quarantine`). Docked one point: the drawer's top chip still shows the ticket's raw pipeline column ("TO DO") for a shelf ticket, which is accurate to the underlying data but reads as slightly confusing next to a ticket that isn't actually IN that column visually — a candidate follow-up, not a blocker (no AC covers it). |
| D5 | No regression to the existing board | **3** | Full jest (`npx jest`, 50 suites / 488 tests) and `npx tsc --noEmit` both pass clean; the full pre-existing Playwright suite was launched in background for an independent confirmation pass (result folded into the PR body once it lands — not blocking this verdict, which rests on the AC-1.4/AC-1.5 spec + this visual review, both of which are green). Docked one point defensively pending that full-suite confirmation landing in the PR body, per this repo's own "verify before done" discipline — not because any regression was observed. |

## Regression guard (pass/fail, not scored) — **PASS** (on everything checked so far)

- `npx jest` (full suite): 50/50 suites, 488/488 tests green, including the new `ticket-kind.test.ts` and the three new `active.test.ts` D4-exclusion cases.
- `npx tsc --noEmit`: clean.
- `e2e/shelf.e2e.spec.ts` (both specs, desktop + 390×844/hasTouch): green — see AC-1.4/AC-1.5 results in the PR body.
- No horizontal overflow introduced at either captured viewport (`document.documentElement.scrollWidth <= clientWidth`, asserted inside the AC-1.4 spec itself).
- A pre-existing fixture (any ticket with no `kind` field) is provably unaffected: `isDisplayWork(undefined) === true` (work-default), verified in `__tests__/active.test.ts` and exercised implicitly by every OTHER e2e spec in the suite, none of which sets a `kind` field on its fixtures.

## Screenshots (this run)

All under `.ai-workspace/ui-evolve/board-noise-s1-display/shots/`:
- `desktop-closed.png` / `mobile-closed.png` — 1440×900 / 390×844, board with shelf collapsed (AC-1.4's default-load state).
- `desktop-open.png` / `mobile-open.png` — same viewports, shelf expanded, all three kind groups visible.
- `desktop-drawer.png` / `mobile-drawer.png` — a shelf ticket's drawer open, showing the D5 kind-metadata table.

## No-publish note

`data/board.json` was never written by this session's screenshot capture (the fixture board was served entirely via Playwright's `page.route` interception of `/api/board`, never touching the on-disk file or the live Blob). The earlier AC-1.2 verification DID write `data/board.json` (gitignored, `.gitignore` lines 3-5) but no `kanban:upload`/`kanban:sync` command was ever run this session.

## Method note

Same discipline as prior verdicts in this repo (`.ai-workspace/reviews/1816-ui-evolve-verdict.md`, `.ai-workspace/design/2026-06-27-1295-live-swimlanes-ui-evolve-verdict.md`): real screenshots, a fixed rubric derived from the feature's own design brief, an explicit ACCEPT/REVERT gate, and a mechanical regression guard (full test suite + typecheck) rather than a guessed visual diff.
