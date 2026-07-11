#!/usr/bin/env bash
# on-task-change.sh — the local board-sync hook.
#
# WIRING SOURCE OF TRUTH: the global PostToolUse hook entry in ~/.claude/settings.json
# (matcher TaskCreate|TaskUpdate) whose command is the absolute path to this script.
# On the operator machine it IS wired there and fires on every task change; on a
# fresh clone it is inert until that settings.json entry is added (see README,
# "Live sync — opt-in PostToolUse hook").
#
# The hook re-exports data/board.json locally and then UNCONDITIONALLY runs the
# courier, which owns credential resolution (OIDC-first, RW fallback — see
# scripts/blob-auth.ts) + writes its own outcome record to data/sync.log
# (uploaded / skipped-no-token / failed). With a reachable credential it genuinely
# uploads; with none it logs a precise `skipped-no-token` and the hook STILL exits 0
# (PostToolUse contract). Nothing is silent — every attempt leaves a sync.log
# record. Never prints secrets.

set -euo pipefail

# Run from the repo root regardless of the caller's cwd.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# The sync logbook (SYNC_LOG override, else data/sync.log). The courier honours the
# same default; the hook only writes here for the export-failure case it alone sees.
SYNC_LOG_PATH="${SYNC_LOG:-data/sync.log}"

# Append one JSONL record (single write). Best-effort: never fail the hook on a log
# error. Stores only result/reason — never board content, a token, or a home path.
log_sync() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$(dirname "$SYNC_LOG_PATH")" 2>/dev/null || true
  printf '{"ts":"%s","result":"%s","reason":"%s","url":null,"boardBytes":null,"boardMtime":null}\n' \
    "$ts" "$1" "$2" >>"$SYNC_LOG_PATH" 2>/dev/null || true
}

# Re-export the local snapshot. The hook is the ONLY place that sees the export exit
# code, so on a non-zero export it records an `export-failed` line (MED-1) — that way
# a subsequent stale-board `uploaded` from the courier can never be SILENT (the
# export failure is already on the record). Do NOT blindly `|| exit 0`.
if ! npm run --silent export:board >/dev/null 2>&1; then
  log_sync failed export-failed
fi

# Then UNCONDITIONALLY run the courier — it owns token resolution + its own outcome
# record. The `|| true` is a NON-ABORTING wrapper (HIGH-1): under `set -euo pipefail`
# a non-zero courier (the genuine no-token case REQUIRES a non-zero exit) would
# otherwise abort the script before `exit 0`. This is NOT a blind swallow — the
# courier has ALREADY written its data/sync.log record before exiting, so the outcome
# is durable; the wrapper only preserves the PostToolUse exit-0 contract.
#
# BOARD_PUBLISH=1 (#1578): this hook is the ONE code path allowed to set the
# publish opt-in marker, and it sets it ONLY for this courier invocation (a
# local variable-prefix on this exact command, not `export`ed into the wider
# shell) — every other way of running the courier (bare `npm run kanban:upload`,
# an ad-hoc `tsx` invocation, an in-process test call) stays inert by default.
BOARD_PUBLISH=1 npm run --silent kanban:upload >/dev/null 2>&1 || true

exit 0
