# Changelog

All notable changes to this project are documented here. Format mirrors content-pipeline
(semantic-release-style): each release lists Features / Bug Fixes with PR links.

## [0.3.1](https://github.com/ziyilam3999/agent-kanban/compare/v0.3.0...v0.3.1) — 2026-06-20

### Miscellaneous

* **ci(live):** auto-sync the login-gated `live` Vercel preview on every master push. The
  live board renders real data from the `live` branch (a Preview-only env), which only
  rebuilds on a push there — so it silently lagged every release (it sat on v0.2.1 while
  master shipped v0.3.0). A new `sync-live` workflow merges master into `live` (`--no-ff`)
  and pushes, so the live board is never behind a release again. (#12)

## [0.3.0](https://github.com/ziyilam3999/agent-kanban/compare/v0.2.2...v0.3.0) — 2026-06-20

### Features

* **board:** clear arrival-glow when a card lands in a new column. The poll already flags
  cards that change column, but the old highlight was a faint 0.6s pulse — easy to miss. The
  `ak-glow` animation now runs 1.4s with a colored halo ring, a border flash, a brief fill
  tint, and a small scale-pop; `GLOW_MS` holds the flag for the full animation; the
  reduced-motion fallback gains a matching static border+tint. Transform/shadow/color only —
  zero CLS, reduced-motion-safe. (#10)

## [0.2.2] — 2026-06-19

### Tests

* **drawer:** unit-test `elapsedGap` — move it from the Drawer component into `lib/relative-time.ts`
  (pure, dependency-free) and add jest coverage: `<1s ⇒ null` (no noisy `+0s`), negative/unparseable
  ⇒ null, real gaps render `+Ns/+Nm/+Nh/+Nd`, and unit-boundary thresholds. No runtime behavior change. (#8)

## [0.2.1] — 2026-06-19

### Bug Fixes

* **drawer:** suppress the noisy `+0s` elapsed label on near-simultaneous timeline steps — a
  sub-second gap (e.g. a retroactively batch-logged ledger, or two roles back-to-back) now renders
  no gap label instead of `+0s` on every node. Real spaced-out steps (`+15m`, `+2h`) are unchanged. (#6)

## [0.2.0] — 2026-06-19

### Features

* **session-picker filtering:** the exporter now tags every session's tickets with an 8-char
  `sessionId` and exports **all** sessions; the board filters to the selected session (with an
  all-tickets fallback so a stale snapshot never blanks the board), and the poll-diff is re-keyed
  per session. Switching sessions in the picker now actually changes the cards. (#4)
* **deep timeline drawer:** each role node can carry a **verdict pill** (green = APPROVE/PASS,
  amber = WITH-FIXES/NOTES, red = BLOCK/FAIL), timestamps are relative + local with
  elapsed-between-steps, and a 4-step pipeline-progress header (planner → plan-review → executor →
  exec-review) shows stages done + current/next. `LedgerComment.verdict` is read-through;
  populating real verdicts is a follow-up ai-brain ledger `--verdict` write flag. (#4)

## [0.1.1] — 2026-06-19

### Bug Fixes

* **security:** bump Next.js `15.5.0 → 15.5.19` and React/React-DOM `19.1.0 → 19.2.7` to
  remediate **CVE-2025-66478 / CVE-2025-55182 (React2Shell)** — a CVSS 10.0 remote-code-execution
  flaw in the React Server Components protocol affecting App Router apps. The 15.5 line is fixed
  in 15.5.7+; this takes the latest patch. No secret rotation required (the deploy had no secrets
  wired). Typecheck, 34 jest tests, and `next build` all green on the new versions.

## [0.1.0] — 2026-06-19

First public release: a phone-first, dark "mission-control" board that mirrors AI-agent /
3-role-model work across **To Do → In Progress → In Review → Done**, with a per-ticket
audit-trail drawer. Local `~/.claude` task + 3-role-ledger files are the source of truth;
the web view is a synced, login-gated mirror that refreshes every ~1.5s.

### Features

* **scaffold:** public-repo bootstrap — gitignore-first (agent-scratch + private board
  snapshot stay out of git), CI (ubuntu + windows matrix, Node 20, typecheck + jest +
  Conventional-Commits gate + a privacy gate), CHANGELOG, README.
* **exporter:** `lib/build-board.ts` + `scripts/export-board.ts` — joins the local task
  store with the 3-role ledger, **redacts home paths** (`/Users/<name>/`, `/home/<name>/`,
  `C:\Users\<name>\`), derives the four columns (`in_review` = in_progress + an
  execution-review ledger line), and detects the active session by newest task-file mtime.
* **telemetry-console UI:** `app/` + `components/` — bold black-box-telemetry point of view
  (Martian Mono + Hanken Grotesk, deep-space palette, phosphor live-accent). Phone-first
  snap-scroll columns with a sticky console header (session picker + LIVE badge + pipeline
  meter); telemetry cards with role-progress pips; a bottom-sheet per-ticket timeline drawer.
  Only the card that changed column animates; reduced-motion safe. Validated with ui-evolve
  (accessibility 96, 0 critical/serious axe issues, perf 98, CLS ~0).
* **sync courier:** `lib/load-board.ts` + `scripts/upload-board.ts` — `loadBoard()` branches
  server-side on env (`BOARD_BLOB_URL` → `fetch(url, { cache: 'no-store' })` → local
  `data/board.json` → synthetic `data/board.sample.json`), so the blob URL/token never reach
  the browser. The uploader reads `BLOB_READ_WRITE_TOKEN` from the macOS Keychain and writes
  with a near-zero blob cache so 1–2s polling stays fresh.
