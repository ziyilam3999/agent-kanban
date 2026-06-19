#!/usr/bin/env bash
# on-task-change.sh — OPT-IN local sync hook (NOT auto-installed).
#
# Wire this as a PostToolUse hook so the board re-syncs whenever task state changes:
# it re-exports data/board.json locally and, ONLY if a Blob token is resolvable,
# uploads it. With no token it just re-exports locally and exits 0 (silent no-op
# on the upload). Idempotent, fast, and never prints secrets.
#
# Registration: see README ("Live sync — opt-in PostToolUse hook").

set -euo pipefail

# Run from the repo root regardless of the caller's cwd.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# Always re-export the local snapshot (cheap, no secrets). Never fail the hook.
npm run --silent export:board >/dev/null 2>&1 || exit 0

# Upload only when a token is resolvable (env override, else macOS Keychain).
token_present=0
if [ -n "${BLOB_READ_WRITE_TOKEN:-}" ]; then
  token_present=1
elif command -v security >/dev/null 2>&1 &&
  security find-generic-password -s BLOB_READ_WRITE_TOKEN -w >/dev/null 2>&1; then
  token_present=1
fi

if [ "$token_present" -eq 1 ]; then
  npm run --silent kanban:upload >/dev/null 2>&1 || true
fi

exit 0
