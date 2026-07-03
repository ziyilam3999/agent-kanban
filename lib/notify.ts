// notify.ts — the ONE out-of-band operator alert channel (shared, #1435).
//
// Extracted from scripts/upload-board.ts (#1405) so BOTH the in-process courier
// failure-streak alarm AND the independent board-freshness watchdog (#1435) fire
// through the SAME macOS notification, without the watchdog having to import the
// courier (which pulls in the Blob upload SDK + would run the courier's main() on
// import). Keeping this a tiny, dependency-free module is what lets the watchdog path
// stay genuinely independent (D7: no Blob upload SDK, no credential, no network) while
// still reusing — not reinventing — the proven channel (D3).

import { execFileSync } from "node:child_process";

/**
 * Default out-of-band alert: a macOS user notification. A launchd job's stdio and
 * the courier hook's discarded stdio (`… >/dev/null 2>&1`) are STRUCTURALLY silent,
 * so a console line / log record never reaches a human — this notification is the
 * one channel proven (#1051/#1405) to surface regardless. Best-effort: never throws,
 * no-op off-macOS. The message carries ONLY result/reason tokens — never board
 * content, a path, or a secret.
 */
export function defaultNotify(title: string, message: string): void {
  if (process.platform !== "darwin") return;
  try {
    execFileSync(
      "osascript",
      [
        "-e",
        `display notification ${JSON.stringify(message)} with title ${JSON.stringify(
          title
        )} sound name "Basso"`,
      ],
      { stdio: "ignore", timeout: 5000 }
    );
  } catch {
    /* best-effort — an alert failure must never break the caller */
  }
}
