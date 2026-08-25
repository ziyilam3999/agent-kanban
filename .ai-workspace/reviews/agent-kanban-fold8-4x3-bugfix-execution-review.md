# Execution-review — agent-kanban-fold8-4x3-bugfix (PR #74)

- Role: execution-review (independent; did NOT author or implement this diff). LAST line of defense before ship.
- Task: `agent-kanban-fold8-4x3-bugfix`. PR #74, head `a1d6b781`, base `master`, branch `agent-kanban-fold8-4x3-bugfix-exec`.
- Fix baseline for RED runs: `origin/master fdbc415` (PR #73 merged).
- Session: 6bae4820-a911-4659-b95f-f7058c3071d1.
- Plan (governing contract): `.ai-workspace/plans/2026-08-25-agent-kanban-fold8-4x3-bugfix-responsive.md` (plan-review Decision: PASS, AC-1..AC-7).

The operator said verbatim "you need to verify and iterate it before raise pr again." This review therefore RE-RAN
the discriminators myself against real product code — I did NOT trust the executor's pasted numbers. Every RED number
below is one I reproduced on an unmodified `fdbc415` worktree; every GREEN number is one I reproduced on the PR head.

## Central risk — ACs are genuinely INTERACTION-DRIVEN, not computed-style in disguise (VERIFIED)

Read all three e2e specs + the shared `e2e/fixtures/touch.ts`:

- **AC-1** (`e2e/fold8-scroll-reachability.e2e.spec.ts`): drives real CDP `Input.dispatchTouchEvent`
  (touchStart/touchMove*/touchEnd via `touchDragAt`). Oracle = `anyOffsetIncreased` (some ancestor `scrollTop` or
  `window.scrollY` strictly increased, walked generically up the DOM chain — NOT pinned to `.ak-col`, per A5) AND
  `fullyInViewport` (the target card's `getBoundingClientRect()` ends inside the viewport). No `getComputedStyle`,
  no screenshot. Genuinely interaction-driven. The target card is found dynamically (nearest off-viewport card),
  not a hardcoded fixture id.
- **AC-3b** (`e2e/fold8-inp-under-poll.e2e.spec.ts`): `PerformanceObserver('event', {durationThreshold:16, buffered:true})`
  under the SHIPPED 5s poll cadence + 4x CDP CPU throttle + production-scale board (1000 tickets / 3.25MB). Real taps
  and scroll bursts straddle poll ticks #2/#3/#4. Interaction-driven.
- **AC-3a** (same file): `PerformanceObserver('longtask', {buffered:true})` across ≥3 UNCHANGED-payload ticks under
  the same throttle + board scale. Load-driven, not computed-style.
- **AC-2** (`e2e/fold8-portrait-2x2.e2e.spec.ts`): geometric assertions on real `boundingBox()` numbers (not
  screenshots) + a real touch-scroll → live-poll-tick → `scrollTop`-preserved leg.

None of AC-1/2/3 uses `getComputedStyle` or a static screenshot as its oracle. PASS on the central risk.

## Discriminators I re-ran myself (RED on unmodified fdbc415 → GREEN on PR head)

Harness: two `next dev` servers (`BOARD_BLOB_URL=` empty) — PR head on :3939, unmodified `fdbc415` worktree on :3940
(product code untouched at fdbc415; the new spec files + touch.ts + board-fixture.ts copied in so both runs use the
SAME frozen harness). fdbc415 worktree confirmed: `components/BoardColumn.tsx` ABSENT, `app/globals.css` still on the
old unconditional `640-1023.98` band.

- **AC-1a — 840×660 structural dead zone**
  - RED on fdbc415: FAILED at `expect(result.scrolled).toBe(true)` → received `false`. `startedOffscreen` PASSED
    first (card genuinely off-viewport at load), so this is a REAL dead zone, not a vacuous "nothing to reach" pass —
    after 10 real touch-swipes at 840×660, ZERO ancestor scroll offset moved. Card unreachable.
  - GREEN on PR head: PASSED (2.7s) — card reachable by real touch swipe.
- **AC-3a — idle-tick cost (≥3 unchanged-payload ticks)**
  - RED on fdbc415: FAILED (both viewports). 3 longtasks ≥100ms per observation window, ~500ms each, spaced ~5000ms
    apart (matches POLL_MS): 750×1000 = {509, 501, 503}ms at t={10690, 15692, 20688}; 1000×750 = {503, 550, 497}ms.
    Exactly the unconditional-re-render-per-tick signature.
  - GREEN on PR head: PASSED — `totalInWindow:0, big:0` (zero longtasks of ANY size on unchanged ticks).
- **AC-3b — interaction latency under live polling**
  - RED on fdbc415: FAILED (both viewports). worst event DURATION 750×1000 = **624ms**, 1000×750 = **616ms**
    (threshold <200) — reproduces the operator's ~600ms INP-class slowness. worst input delay stayed low (~29-31ms),
    matching the plan's finding that the dominant cost is re-render DURATION, not input delay.
  - GREEN on PR head: PASSED. worst duration 750×1000 = **104ms**, 1000×750 = **80ms**; worst delay ~25-32ms.
  - Both directions captured **107 events** — the instrument fires and VARIES (616-624ms red vs 80-104ms green),
    so the green pass is non-vacuous (not an empty-array `reduce(...,0)` trivial pass).

Rule 18 satisfied: every "fixed" bug genuinely reproduced RED on unmodified master before greening on the fix.

## Fix is GENERAL, not test-shaped (source-read + monotonicity + empirical)

- **CSS scroll fix (`app/globals.css`)** — the shell clamp (`overflow:hidden` on `.ak-app/.ak-main/.ak-board` +
  `height:100dvh`) is narrowed from the whole `640-1023.98` band to the OR of the two grid tiers' OWN literal gates:
  `(min-width:900px) and (max-width:1023.98px)` (4-up) OR `(min-width:640px) and (max-width:899.98px) and
  (min-height:700px)` (2×2). This is keyed to the CSS conditions that decide whether a per-column scroller exists —
  NOT to the AC-1 fixture viewport. Outside both gates the shell falls back to the base/phone rules (page scroll +
  base `.ak-strip{overflow-x:auto}`) already exercised by AC-4's phone hold-out. The AC-1c band sweep greens 26/26
  cells (not just the one 840×660 fixture point) — a general invariant. General, not test-shaped.
- **Monotonicity (#1590)** — the only last-writer-wins arm is the CSS cascade on `.ak-app/.ak-main/.ak-board`
  overflow. The OLD bug was the STRONGER writer (`overflow:hidden`, later in source) erasing the WEAKER permissive
  base `.ak-strip{overflow-x:auto}` across the whole band. The fix narrows the strong writer's scope so it only
  fires where a grid tier grants an alternative scroll path. I verified the cosmetic band block that still spans the
  full `640-1023.98` band (globals.css:1694) touches ONLY chrome (`.ak-header`, `.ak-meter`, `.ak-meterbar`,
  `.ak-lanes`) and does NOT re-set `overflow` on app/main/board — so nothing re-introduces the clamp in the
  dead-zone sub-band. The weaker permissive scroll path is no longer erased there. Monotonicity holds.
- **Poll short-circuit (`components/BoardView.tsx`)** — `if (rawText === lastRawBoardRef.current) return;` compares
  the RAW response TEXT before `JSON.parse`. Content-independent, keyed to byte-equality of the payload, NOT to any
  fixture. Empirically confirmed general by AC-3a green (0 longtasks on unchanged ticks, whatever the payload). No
  new monotonicity hazard: `/api/board` returns the full board regardless of selected session, so session switching
  (driven by separate state, not the poll) is unaffected by the short-circuit.
- **`components/BoardColumn.tsx` (React.memo extraction)** — the per-column render is moved verbatim behind a
  `React.memo` shallow-prop boundary. Props are referentially stable unless something affecting THAT column changed,
  so an unrelated BoardView state change (`setSelectedId` on tap) no longer re-renders ~1000 cards. Keyed to prop
  identity, not to any interaction or fixture. Empirically confirmed by AC-3b green (~620ms → ~90ms).

## Named-risk note dispositions (carried to this seat, #2434)

`node hooks/named-risk-notes.mjs list --task agent-kanban-fold8-4x3-bugfix` printed two NOTE lines (no NO-NOTES, no
PUBLICATION-GAP). Both are dispositioned here, bound to their ids:

DISPOSITION fold8-nrn-test-shaping addressed — (a) the scroll-reachability fix is NOT keyed to the AC-1 fixture
viewports: it ORs the two grid tiers' own literal CSS gates and falls back to the general base/phone scroll path
outside them; verified by source-read + the 26/26 AC-1c band sweep + monotonicity check that no other rule
re-clamps `.ak-board` across the band. (b) the unchanged-payload re-render skip is a general raw-TEXT
byte-equality guard (`rawText === lastRawBoardRef.current`), content-independent, NOT keyed to the synthetic
`buildBoard` fixture; verified by source-read + AC-3a RED→GREEN reproduced myself (3× ~500ms longtasks on
master → 0 on fix). Neither the scroll fix nor the poll fix is test-shaped.

DISPOSITION fold8-nrn-prior-dead-control observed-in-diff — `e2e/fold8-4x3-grid-tiers.e2e.spec.ts` is NOT in the
PR diff (`git diff --name-only origin/master...HEAD` does not list it; `git diff` against master is empty =
byte-identical), still EXISTS at head, is NOT cited as proof for AC-1/2/3 (AC-1/2/3 are proven only by the new
real-interaction specs), and is NOT deleted. The executor's red-evidence records it 24/24 GREEN unmodified. The
prior structural/computed-style spec that passed while the device was broken is preserved and untouched — exactly
what this note asked to protect.

## Other required checks

- **Dead-control spec (item 4)**: PASS — unmodified, present, not cited, not deleted (see disposition above).
- **jest-mock change in `__tests__/lane-reveal.test.ts` (item 5)**: PASS — adds `text: async () => JSON.stringify(b)`
  ALONGSIDE the existing `json:`. Product code now calls `res.text()` for the equality short-circuit, so this is a
  mock-completeness fix matching the real Fetch `Response` surface. It does NOT weaken, loosen, or skip any
  assertion; the existing `.json()` is left in place. jest 445/445 green confirms the test still exercises its
  assertions.
- **AC-2 honesty (item 6)**: PASS — PR body + red-evidence explicitly ship AC-2 as a regression FENCE ("regression
  fence, not RED→GREEN; residual → AC-7"), no silent "fixed". Portrait did not reproduce "out of sync" in Chromium.
- **AC-6 ui-evolve (item 7)**: PASS — verdict ACCEPT 7.1/10; the verdict file itself states screenshots are NOT
  accepted as proof for AC-1/2/3. Necessary-not-sufficient, not cited for the interaction ACs.
- **AC-5 (item 8)**: PASS — I re-ran `tsc --noEmit` (exit 0, no output) and `npx jest` (45/45 suites, 445/445 tests)
  on the PR head myself.
- **Privacy (item 8)**: PASS — `bash scripts/privacy-scan.sh --working <11 branch text files>` (ai-brain canonical
  scanner, `--working` named explicitly, never `--staged <path>`) → `privacy-scan: CLEAN mode=working size=141480`
  (exit 0, non-zero size = real content scan). Positive control: identical invocation shape on a scratch copy seeded
  with a seeded absolute home-path needle (a `/Users/<name>/...` path, redacted here) → `privacy-scan: DIRTY
  (home-path matches=1, ...)` exit 1 — the
  instrument has power against this artifact's match class. The branch-carried `.ai-workspace` red-evidence +
  ui-evolve verdict artifacts are clean (no home path / username / personal email).

## Note not blocking ship (recorded, not mine to gate)

- The initial PR metadata showed `mergeStateStatus: UNSTABLE` (CI still settling); a re-fetch this turn showed CLEAN /
  MERGEABLE. Task id is non-numeric, so the numeric-anchored ledger merge gate SKIPS — completion verification is
  manual, as the PR body honestly states. These are ship-time concerns for the orchestrator, not review blockers.
- AC-7 (operator real-device smoke on the physical Samsung Fold 8) remains the disclosed residual — Chromium/CDP
  emulation is necessary-but-not-sufficient. This is recorded, not merge-gating, and correctly carried in the PR body.

## Verdict

Every Binary AC that claims RED→GREEN was reproduced by me from real product code, not trusted from the executor's
report. The three interaction ACs are genuinely interaction-driven; the fix is general (not test-shaped) across all
three surfaces; the dead-control spec and jest mock are honest; AC-2 ships as an honest fence; privacy is clean with a
proven-powered scanner. Both carried named-risk notes are dispositioned and hold against the actual diff.

Decision: PASS
