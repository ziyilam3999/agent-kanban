# Changelog

All notable changes to this project are documented here. Format mirrors content-pipeline
(semantic-release-style): each release lists Features / Bug Fixes with PR links.

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
