# fold8-poll-metered-payload-diet — ETag/304 conditional polling + payload diet for /api/board

- **Date**: 2026-08-26
- **Task id**: fold8-poll-metered-payload-diet
- **Repo**: agent-kanban (Next.js; worktrees do NOT need sparse-checkout)
- **Role**: planner (Fable) — 3-role chain; plan-review must PASS before execution
- **Branch naming**: lead with the task id — `fold8-poll-metered-payload-diet` (non-numeric task id ⇒ the numeric-anchor ledger merge gate SKIPS; reviewers check manually)

## Execution model

**subagent (knob-A `delegate`)** — single coherent write surface (one route + one client poll loop +
tests), fully briefable from this plan, no live-session coupling. Executor implements in an isolated
worktree branched from `origin/master`; evaluator = `both` (real jest oracles per ACs 5–7 AND the
independent execution-review role, since the deployed-edge leg (AC 8) is not fully unit-testable).

## Intent (what + why — never how)

**What**: the live board's `GET /api/board` becomes a conditional, cheap-when-unchanged endpoint. An
unchanged board answered to a repeat poll transfers ~0 body bytes (`304 Not Modified`); only a genuinely
changed board ships a full body. The client poll loop participates: it presents the validator it last saw,
treats "unchanged" as a no-op (no re-parse, no state churn), and keeps its existing pause-while-hidden
behavior locked by a regression test.

**Why**: Vercel here is METERED (Fast Data/Origin transfer + Blob reads). The board payload is ~5.25–5.5 MB
of JSON and the client polls every 5 s. The 2026-06 #1138 fix already added an edge cache
(`s-maxage=10`) and a hidden-tab skip, which cut the origin/Blob leg — but every poll that reaches the
CDN still ships the FULL body edge→client, changed or not, and every origin revalidation re-ships it
origin→edge. A validator-based conditional path is the remaining large lever: idle boards (nights,
weekends, nobody typing) become near-zero-byte polls. Metered-platform doctrine (ai-brain CLAUDE.md,
"Metered-platform live UI = cost budget", #1138/#1142) names four levers; two are live at HEAD, this task
lands the third and evaluates the fourth honestly (see "Measured current state").

## ELI5

The kanban web page asks the server "what does the board look like?" every 5 seconds, and the server
mails back the ENTIRE 5 MB board every single time — even at 3 a.m. when nothing has moved. On a
pay-per-byte platform that is like re-mailing someone the whole phone book every 5 seconds to say
"nothing changed". The fix: the server puts a fingerprint sticker (an ETag) on the board. The page keeps
the sticker and next time asks "has the board with THIS sticker changed?" If not, the server replies with
a tiny "nope" (304) — practically free. Only when the board really changed does the full book get mailed
again. The page already knows to stop asking while its tab is hidden ("stop when nobody's looking") —
we keep that and bolt it down with a test so it can't silently break.

## Measured current state (verified at HEAD b4e6d47, 2026-08-26 — do not inherit; re-verify cheaply)

The dispatch brief's premise "no caching/conditional at all" is PARTIALLY stale. Verified:

1. **Route**: `app/api/board/route.ts` — `export const dynamic = "force-dynamic"` (line 13); `GET()`
   (lines 15–20) loads the board and returns `NextResponse.json(board)` with
   `Cache-Control: public, s-maxage=10, stale-while-revalidate=20` (from `lib/board-cache.ts:13–19`,
   the #1138 SSOT, locked by `__tests__/board-route-cache.test.ts`). **No `ETag`, no `If-None-Match`
   handling anywhere in `app/`, `components/`, `lib/` (grep verified). Lever 1 is absent — the core gap.**
2. **Client poll**: `components/BoardView.tsx` — `POLL_MS = 5000` (line 21); poll loop lines 89–156;
   `fetch("/api/board", { cache: "no-store" })` (line 98). **Hidden-tab skip already exists**: line 96
   returns early when `document.hidden`; lines 139–144 refetch immediately on
   `visibilitychange → visible`. Lever 3 is live at HEAD but has NO locking unit test (grep of
   `__tests__/` finds no visibility coverage; only unrelated e2e string hits).
3. **Data source**: `lib/load-board.ts:57–79` — precedence blob (`BOARD_BLOB_URL`, fetched `no-store`)
   → local `data/board.json` → sample. Producer: `scripts/on-task-change.sh` re-exports and uploads to
   Blob **only on TaskCreate/TaskUpdate** — so the blob is byte-stable whenever no task changes, and a
   body-derived validator will genuinely repeat. `generatedAt` is stamped only at export
   (`lib/build-board.ts:528–558`), so it cannot poison the validator during idle stretches. The client
   uses `generatedAt` only as the SSR-deterministic initial clock (`BoardView.tsx:67`); the freshness
   watchdog (`scripts/board-freshness-watchdog.ts`) reads the blob host-side, NOT via `/api/board` —
   neither is broken by a 304-holding client.
4. **Payload profile** (local `data/board.json`, 5,534,285 B on 2026-08-26; PROJECT-INDEX recorded
   5,252,588 B on 2026-08-20 — the brief's ~5.25 MB): `tickets` n=2,266 across 16 sessions = 4,958 KB of
   it. Per-field totals: `description` 3,764 KB (**68%**, read ONLY by the detail drawer,
   `components/Drawer.tsx:327–328`), `comments` 493 KB (load-bearing everywhere: `lib/active.ts`,
   `lib/stage-bar.ts`, `components/Card.tsx`), `subject` 317 KB, all else <40 KB each. **No field is both
   large and never-read** — the brief's "drop fields the UI never reads" lever yields ~nothing as
   literally stated; the only big trim (description off the wire + on-demand fetch) adds an endpoint +
   drawer loading state, so it is scoped as a stretch, not core (brief: "don't over-scope").

**cairn**: searched `node skills/cairn/bin/cairn-find.mjs "etag 304 poll board payload"` — matched the
task's own filing: "[WM] session-state-20260825-fold8-bugfix-lanes.md:82 — NEW TICKET filed:
fold8-poll-metered-payload-diet (ETag/304 + payload diet for …)" plus the recurring T2 lesson "A
live-polling board only reflects state at the last manual or hook-tri[ggered sync]". Doctrine source:
parent CLAUDE.md "Metered-platform live UI = cost budget" (#1138/#1142) — all four levers applied here.

## Scope

**In (core)**:
- `/api/board` responses carry a stable validator (`ETag`) and honor `If-None-Match` with `304` + empty
  body when unchanged. The validator must repeat for byte-identical board content and differ for changed
  content; computing it must not require an extra Blob read. The existing `Cache-Control` policy stays.
- The client poll presents the last-seen validator on every subsequent poll and treats `304` as
  "no change" (no JSON parse, no state update, no re-render churn). First paint and changed-board
  behavior are unchanged.
- Regression tests locking: the conditional contract (route), the client conditional behavior, and the
  already-existing pause-when-hidden + refetch-on-visible behavior.
- Live measurement on a real deployment (preview is fine) of transferred bytes for a 200 vs a 304 poll,
  recorded in the PR body (Rule 18 — the cost claim must be measured, not asserted; wire bytes are
  compressed, so the honest number comes from the wire, not from `board.json`'s size).

**Out (non-goals)**: a delta/patch protocol; producer-side (export/upload) changes; session-retention
trims; changing `POLL_MS` or the `s-maxage`/`swr` values (justified as-is: poll 5 s + s-maxage 10 s
already pair per #1138 and are CI-locked).

**Stretch (optional — only if genuinely cheap; NOT required for done)**: serve the board wire without
`description` (−68%) with the drawer fetching a single ticket's detail on demand. If taken, the drawer's
new loading state is a visible UI change and the FULL ui-task-gate (frontend-design + ui-evolve) applies
to it. If not taken, note the option in the PR body and stop.

## Constraints & risks

- **r1**: The validator must identify the representation actually served (the route currently
  re-serializes via `NextResponse.json`); a mismatch between hashed bytes and served bytes silently
  breaks 304 correctness. Weak-vs-strong choice must be deliberate and documented in code.
- **r2**: Whether the Vercel edge answers `If-None-Match` with 304 for CACHED function responses is a
  load-bearing platform assumption — AC 8 tests it on a real deployment. If the edge ships full 200s
  from cache regardless, record the measured behavior honestly in the PR; the origin-level 304 (AC 2)
  must hold either way.
- **r3**: The client currently uses `cache: "no-store"`, which suppresses the browser's automatic
  conditional revalidation — the conditional behavior must therefore be explicit and test-observable,
  not assumed from browser defaults.
- **r4**: On `304`, client state (selected session, open drawer, glow sets) must be untouched — a 304
  that resets UI state is a regression AC 6 must catch.
- **r5**: `__tests__/board-route-cache.test.ts` must stay green — the #1138 header contract is not
  loosened by adding the validator.

## Gate statement (which gate applies and why)

Core scope changes response headers and polling behavior only — zero visual delta (no layout, CSS, or
DOM changes). The mechanical ui-task-gate will still trigger on the `components/BoardView.tsx` path, so
the completion carries `metadata.ui_gate_skip`: "network/polling behavior only — no visual change;
verified by route-header tests + client fetch-count tests + live deployed byte measurement". A
real-interaction NETWORK artifact (test-asserted fetch counts while hidden/visible + deployed curl
transcript) replaces computed-style assertions per the brief. If the stretch lands, its drawer loading
state voids the skip and the full two-leg UI gate applies to that part.

### Binary AC

Each independently true/false, checkable from OUTSIDE the diff. ACs 1–4 run against a locally served
build (`npm run build && npm run start`, no `BOARD_BLOB_URL` ⇒ local `data/board.json` source); AC 8
runs against a real Vercel deployment (preview OK).

1. **200 carries a validator**: `curl -si http://localhost:3000/api/board` exits 0 and the response is
   `200` with a non-empty `ETag` header AND a `Cache-Control` header containing `s-maxage`.
2. **Unchanged ⇒ 304, empty body**: a second
   `curl -si -H 'If-None-Match: <ETag from AC 1>' http://localhost:3000/api/board` returns status
   `304` and `curl -s -o /dev/null -w '%{size_download}'` for the same conditional request prints `0`.
3. **Changed ⇒ 200 + new validator**: after modifying board content (e.g. editing one ticket field in
   `data/board.json`), the same conditional request (old ETag) returns `200` with an `ETag` header
   whose value differs from AC 1's.
4. **304 keeps the CDN policy**: the AC 2 response ALSO carries `Cache-Control` containing `s-maxage`
   (the edge keeps absorbing repeat polls between changes).
5. **Client conditional + visibility behavior is test-locked**: a committed test file passes
   (`npx jest <file>` exit 0) asserting all three: (i) polls after the first successful fetch include
   `If-None-Match` with the last-seen validator; (ii) zero `/api/board` fetches occur while the
   document is hidden; (iii) a fetch fires immediately when visibility returns to visible.
6. **304 is a no-op, change still lands within one poll**: a committed test passes (`npx jest <file>`
   exit 0) driving the poll through a `200(v1) → 304 → 200(v2)` response sequence and asserting the
   rendered board still shows v1 state (unreset) after the 304 tick and shows v2 within the next poll
   tick after the changed response — i.e. a data change reaches the UI within one poll interval.
7. **No regression**: `npm test` exits 0 (existing suite incl. `board-route-cache.test.ts` untouched
   in meaning) AND `npm run build` exits 0 AND `npm run typecheck` exits 0.
8. **Deployed, measured win (Rule 18)**: against a real Vercel deployment URL of this branch, a curl
   transcript recorded in the PR body shows (i) an unconditional `--compressed` GET with its measured
   `%{size_download}` > 0, and (ii) a conditional GET reusing that response's ETag returning `304`
   with `%{size_download}` = 0. If (ii) is impossible at the edge (risk r2), the PR body instead
   records the measured edge behavior AND AC 2's origin-level 304 evidence — silence about the
   discrepancy fails this AC.

## Critical files (read before executing)

- `app/api/board/route.ts` (whole file, 20 lines) — the route to extend
- `lib/board-cache.ts` — Cache-Control SSOT; extend, don't fork
- `lib/load-board.ts:57–79` — data source precedence; validator must not add Blob reads
- `components/BoardView.tsx:88–156` — the poll loop; lines 96, 139–144 are the visibility behavior to lock
- `__tests__/board-route-cache.test.ts` — the #1138 contract that must stay green
- `__tests__/load-board.test.ts` — mocking patterns for loadBoard-adjacent tests

## Deferred-follow-ups:

- **Payload trim (serve board wire without `description`, −68%, + on-demand drawer fetch)** — DEFERRED to
  STRETCH (optional, not required for done). → file a follow-up ticket ONLY if AC 8's deployed measurement
  shows the changed-board 200 body transfer is still the dominant metered cost after ETag/304 lands.
- **AC 8 deployed byte-measurement** — if a live Vercel preview deploy is not achievable in-lane, DEFER
  the deployed transcript and → file a follow-up to run it post-merge on the real deployment. Core
  correctness stays proven by the locally-testable ACs 1–6 regardless.

## Review

**Decision: PASS** (independent adversarial plan-review — Opus, Agent-tool fallback path; did NOT author this plan).
Reviewed cold against HEAD `b4e6d47` on 2026-08-26. All load-bearing MEASURED premises independently
re-verified true; no refuted premise; ETag/304 correctness is protected by outside-the-diff Binary AC.
Two named-risk notes are carried DURABLY (registered via `hooks/named-risk-notes.mjs`) for execution-review
to decide against the actual diff.

### Measured premises — spot-checked, all VERIFIED at HEAD b4e6d47
- **Route** (`app/api/board/route.ts`): `dynamic = "force-dynamic"` at line 13 ✓; `GET()` returns
  `NextResponse.json(board, { headers: { "Cache-Control": BOARD_CACHE_CONTROL } })` (lines 15–20) ✓.
- **Cache policy** (`lib/board-cache.ts`): `BOARD_CDN_SMAXAGE = 10` (line 13), `BOARD_CACHE_CONTROL =
  "public, s-maxage=10, stale-while-revalidate=20"` (line 19) ✓. Locked by
  `__tests__/board-route-cache.test.ts` ✓.
- **No existing conditional path**: `command grep -rniE "etag|if-none-match|304|conditional"` over
  `app/ components/ lib/` returns ONLY `conditional`/`unconditional` prose (CSS comment, active.ts,
  build-board.ts) — genuinely NO `ETag`/`If-None-Match`/`304` code. Lever 1 is absent as claimed. ✓
- **Client poll** (`components/BoardView.tsx`): `POLL_MS = 5000` (line 21) ✓; poll loop lines 89–156 ✓;
  `fetch("/api/board", { cache: "no-store" })` (line 98) ✓; hidden-tab early-return (line 96) ✓;
  refetch-on-`visibilitychange`→visible (`onVisible`, lines 139–144) ✓. `setInterval` keeps firing while
  hidden but `poll()` returns before `fetch`, so "zero fetches while hidden" holds. ✓
- **No visibility/etag test**: grep of `__tests__/` for `document.hidden|visibilitychange|If-None-Match|
  etag|304` is clean (the lone hit is `#1304` substring-matching `304`). Lever 3 is live but unlocked. ✓
- **Data source** (`lib/load-board.ts:57–79`): blob (fetched `no-store`) → local `data/board.json` →
  sample; a validator computed from the already-loaded `board` object needs no extra Blob read. ✓
  `data/board.json` is present (5,535,101 B — matches the plan's ~5.53 MB).
- Payload field-breakdown numbers (description 68% etc.) were NOT independently re-derived — they are
  STRETCH-scope only and load-bear on nothing in core; accepted as-is.
- **Monotonicity (#1590)**: the only ordering arm is 304-no-op (weaker) vs 200-with-new-body (stronger).
  Safe by construction: the diff baseline `prevCols.current` is updated ONLY on a 200
  (`BoardView.tsx:116`); a 304 never touches it, so a 304 cannot erase a pending change and the next 200
  delivers it. AC 6's "change lands within one poll" locks this. Weaker cannot overwrite stronger. ✓

### Adversarial focus verdicts
1. **Measured claims** — all true (above). No inference laundered into fact.
2. **ETag correctness (r1)** — sound. `NextResponse.json(board)` serializes via `JSON.stringify(board)`
   (no replacer/space); a strong validator over that same serialization matches the served bytes. The
   classic timestamp-poison bug is neutralized: `generatedAt` is stamped only at export, so an idle board
   yields byte-stable content and a repeating validator. r1 already flags "hashed bytes must equal served
   bytes" and mandates a deliberate weak-vs-strong choice. NON-BLOCKING: hashing ~5.5 MB is bounded by the
   ORIGIN hit-rate (≈once per s-maxage=10 s window + SWR revalidations), NOT per poll — negligible; the
   edge absorbs the rest.
3. **304 must not corrupt client state (r4)** — see NRN-2: AC 6 as worded asserts board-DATA-unreset but
   not the enumerated UI-interaction state (selected session / open drawer / glow sets) that r4 promises.
4. **Edge vs 304 (r2)** — exemplary Rule-18 handling. The plan does NOT assume the Vercel edge honors
   `If-None-Match` on cached function responses; r2 + AC 8 MEASURE it on a real deploy and require honest
   recording either way, with AC 2's origin-level 304 as the fallback proof. No overclaim in the
   load-bearing sense. (The ELI5's "idle boards become near-zero-byte polls" is end-to-end true only if
   the edge does conditional OR polls reach origin — but that is exactly what AC 8 exists to measure, so
   the claim is gated, not laundered.)
5. **Gate choice** — correct. Core is network/polling only, zero visual delta; the ui-task-gate fires
   mechanically on the `components/BoardView.tsx` path, so the ≥20-char specific `metadata.ui_gate_skip`
   is the right escape. Stretch correctly voids the skip. CONTINGENT on NRN-1 (preserve the `now`-clock)
   so "no visual change" stays literally true.
6. **AC verifiability** — ACs 1–7 are each independently binary and checkable outside the diff
   (curl status/size + `npx jest` exit 0 + `npm test`/`build`/`typecheck`). AC 8 is inspection-based (PR
   body transcript) — unavoidable for a deployed-byte measurement; evaluator=`both` + independent
   execution-review is the right compensating control. AC 4 correctly locks that the 304 STILL carries
   `Cache-Control` (many stacks strip headers on 304 — must be set explicitly).

### Named-risk notes (carried to execution-review — decidable against the diff)
- **NRN-1 (now-clock freeze vs the "no visual change" gate-skip).** The Scope/Intent phrase "no state
  update, no re-render churn" on a 304, if implemented as a total early-`return`, freezes the `now` state
  (`BoardView.tsx:119` `setNow(Date.now())` runs only after a successful body). `now` feeds
  `computeActiveIds` (active-heartbeat window/cap, `lib/active.ts`) and every Card's relative-time
  (`nowMs`). Frozen during idle 304 stretches ⇒ disjunct-3 window tickets keep breathing past the 8-min
  window and "Nm ago" labels stall until the next 200 — a VISUAL idle-state change that would quietly
  falsify the `ui_gate_skip` reason. Correct fix costs zero metered bytes: keep `setNow(Date.now())`
  advancing on a 304; only skip `setBoard` + the diff + glow. Execution-review MUST read the 304 branch
  and confirm the `now`-clock still advances (or that the gate-skip reason is amended to own the change).
- **NRN-2 (AC 6 under-locks r4).** r4 says "a 304 that resets UI state is a regression AC 6 must catch,"
  but AC 6 only asserts "rendered board still shows v1 state (unreset)" — board DATA, not the enumerated
  selected-session / open-drawer / glow-set state. Recommended AC 6 strengthening: the committed test
  should select a ticket / open the drawer BEFORE the 304 tick and assert it survives the 304, in
  addition to the board-data and within-one-poll checks. Execution-review MUST confirm the committed test
  exercises UI-interaction state, not just board data. (Non-blocking: the idiomatic `if (304) return;`
  trivially preserves all state; this hardens the AC against a non-idiomatic implementation.)

### Non-blocking notes for the executor
- `GET()` currently takes no request arg; reading `If-None-Match` requires `GET(req: Request)` — set the
  returned ETag from the SAME serialization actually sent (r1).
- Core CORRECTNESS is carried by locally-testable ACs 1–4 + client ACs 5–6; AC 8 is the cost-proof (see
  Deferred-follow-ups), not the correctness-proof.

_cairn: matched the metered-platform doctrine this plan builds on —
`hive-mind-persist/session-notes/2026-07-*-304944233.md:9 "lesson Live/real-time UI on a METERED platform
(Vercel Fast-Origin + Blob Data…)"` (#1138/#1142) — plus the task's own filing
(`session-state-20260825-fold8-bugfix-lanes.md:92`). No cairn lesson contradicts the plan._
