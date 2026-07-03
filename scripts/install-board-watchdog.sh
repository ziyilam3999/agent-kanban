#!/usr/bin/env bash
# install-board-watchdog.sh — install (or preview) the #1435 external board-freshness
# watchdog as a macOS launchd LaunchAgent.
#
# OPT-IN, not auto-live (mirrors on-task-change.sh's wiring story + the
# ai_brain_hook_ship_is_not_live_until_setup_sh discipline): shipping this file does
# NOT start the watchdog. The operator runs this installer explicitly, and a --dry-run
# lets them eyeball the exact plist first.
#
# It GENERATES the plist from scripts/board-watchdog.plist.template by substituting the
# real absolute paths at install time — the committed template holds only placeholder
# tokens, so no home path is ever committed.
#
# Usage:
#   scripts/install-board-watchdog.sh --dry-run   # print the plist + Label, plutil-lint
#                                                  # it, mutate NOTHING (no LaunchAgents
#                                                  # write, no launchctl bootstrap)
#   scripts/install-board-watchdog.sh             # write ~/Library/LaunchAgents/<label>.plist
#                                                  # and bootstrap it into launchd
#   scripts/install-board-watchdog.sh --uninstall # bootout + move the plist aside
#
# Config (Rule 16 — nothing hardcoded):
#   BOARD_WATCHDOG_LABEL       launchd Label     (default com.user.kanban-board-watchdog)
#   BOARD_WATCHDOG_INTERVAL_S  StartInterval sec (default 120 — << the 10-min stale N)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/board-watchdog.plist.template"

LABEL="${BOARD_WATCHDOG_LABEL:-com.user.kanban-board-watchdog}"
INTERVAL_S="${BOARD_WATCHDOG_INTERVAL_S:-120}"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$AGENTS_DIR/${LABEL}.plist"

MODE="install"
case "${1:-}" in
  --dry-run) MODE="dry-run" ;;
  --uninstall) MODE="uninstall" ;;
  "") MODE="install" ;;
  *) echo "usage: $0 [--dry-run|--uninstall]" >&2; exit 2 ;;
esac

[ -f "$TEMPLATE" ] || { echo "[install-watchdog] template missing: $TEMPLATE" >&2; exit 1; }

# Render the plist by substituting the placeholder tokens. `|` sed delimiter so the
# path slashes need no escaping.
render_plist() {
  sed \
    -e "s|__LABEL__|${LABEL}|g" \
    -e "s|__REPO__|${REPO_DIR}|g" \
    -e "s|__HOME__|${HOME}|g" \
    -e "s|__INTERVAL__|${INTERVAL_S}|g" \
    "$TEMPLATE"
}

if [ "$MODE" = "uninstall" ]; then
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  fi
  if [ -f "$PLIST_PATH" ]; then
    # Rule 14: mv aside, never rm.
    mv "$PLIST_PATH" "${PLIST_PATH}.removed-$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    echo "[install-watchdog] unloaded + moved aside: $PLIST_PATH"
  else
    echo "[install-watchdog] nothing to uninstall (no plist at $PLIST_PATH)"
  fi
  exit 0
fi

# Lint the rendered plist in a temp file (plutil reads a file). macOS-only tool.
TMP_PLIST="$(mktemp -t kanban-watchdog-plist.XXXXXX)"
render_plist > "$TMP_PLIST"
if command -v plutil >/dev/null 2>&1; then
  if ! plutil -lint "$TMP_PLIST" >/dev/null; then
    echo "[install-watchdog] generated plist FAILED plutil -lint — aborting." >&2
    plutil -lint "$TMP_PLIST" >&2 || true
    rm -f "$TMP_PLIST"
    exit 1
  fi
fi

if [ "$MODE" = "dry-run" ]; then
  echo "[install-watchdog] DRY-RUN — mutating nothing (no LaunchAgents write, no launchctl)."
  echo "[install-watchdog] Label: ${LABEL}"
  echo "[install-watchdog] StartInterval: ${INTERVAL_S}s"
  echo "[install-watchdog] would install to: ${PLIST_PATH}"
  echo "---8<--- rendered plist ---8<---"
  cat "$TMP_PLIST"
  echo "---8<--- end plist ---8<---"
  echo "[install-watchdog] NOTE (R1 — who watches the watchdog): register Label"
  echo "  '${LABEL}' in ai-brain tools/launchd-health-check.sh SPEC so the daily"
  echo "  launchd-healthmon surfaces this job if it is ever unloaded. See README."
  rm -f "$TMP_PLIST"
  exit 0
fi

# Real install.
mkdir -p "$AGENTS_DIR"
cp "$TMP_PLIST" "$PLIST_PATH"
rm -f "$TMP_PLIST"
echo "[install-watchdog] wrote $PLIST_PATH"

if command -v launchctl >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  if launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"; then
    echo "[install-watchdog] bootstrapped ${LABEL} (StartInterval=${INTERVAL_S}s)"
  else
    echo "[install-watchdog] launchctl bootstrap failed — load it manually:" >&2
    echo "  launchctl bootstrap gui/\$(id -u) $PLIST_PATH" >&2
    exit 1
  fi
else
  echo "[install-watchdog] launchctl not found (non-macOS?) — plist written but not loaded." >&2
fi

echo "[install-watchdog] R1 follow-up: add '${LABEL}' to ai-brain tools/launchd-health-check.sh SPEC."
exit 0
