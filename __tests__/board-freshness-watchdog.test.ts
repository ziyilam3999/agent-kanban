// board-freshness-watchdog.test.ts — the BOTH-ENDS proof for the #1435 external,
// out-of-band, fail-closed board-freshness watchdog.
//
// Provenance: the in-process courier alarm (upload-board.ts consecutiveTrailingFailures
// + shouldNotify, #1405) only advances when the courier RAN and FAILED. It is
// structurally blind to the courier NEVER RUNNING (hook unwired / kill-switch present /
// long silent executor leg) — all three write ZERO sync.log records, so the board
// freezes silently while work is active. These tests pin the fix BOTH ENDS: the
// freeze-while-active state MUST alert (red on the buggy/absent-guard state), and the
// healthy + genuinely-idle states MUST stay quiet (green, no cry-wolf).
//
// The pure-decision suite (the load-bearing both-ends proof) is platform-independent
// and runs everywhere. The launchd/osascript CLI + installer suites are macOS-only
// (the alert channel + scheduler are macOS, per plan scope) and skip on CI's
// ubuntu/windows runners so the suite stays green there.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  decideFreshness,
  isAlertingVerdict,
  runFreshnessCheck,
  type DecisionInput,
  type Verdict,
} from "../lib/board-freshness";

const N = 10 * 60 * 1000; // staleness threshold N (10 min)
const W = 8 * 60 * 1000; // active-window W (8 min)
const NOW = 1_000_000_000_000; // fixed injected clock

/** A DecisionInput with sane defaults; override per case. */
function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    now: NOW,
    killSwitch: false,
    boardMtimeMs: NOW, // fresh by default
    activityMtimeMs: NOW, // active by default
    staleMs: N,
    activeWindowMs: W,
    ...over,
  };
}

/** Run the decision with a notify spy; return { verdict, calls }. */
function withSpy(inp: DecisionInput): { verdict: Verdict; calls: number } {
  let calls = 0;
  const verdict = runFreshnessCheck(inp, {
    notify: () => {
      calls++;
    },
  });
  return { verdict, calls };
}

describe("board-freshness decision — both ends (RED on frozen, quiet on healthy/idle)", () => {
  // ---- RED-on-frozen: the exact bug this watchdog exists to catch. A no-op / absent
  // guard (one that never emits STALE-ACTIVE, or never calls notify) FAILS this case.
  it("RED-on-frozen: board older than N AND work within W ⇒ STALE-ACTIVE + notify fires", () => {
    const { verdict, calls } = withSpy(
      input({
        boardMtimeMs: NOW - (N + 60_000), // 1 min past stale
        activityMtimeMs: NOW - 30_000, // 30s ago — actively working
      })
    );
    expect(verdict).toBe("STALE-ACTIVE");
    expect(calls).toBe(1);
  });

  // ---- PASS-on-fresh: a fresh board is healthy; the alarm must stay silent.
  it("PASS-on-fresh: board within N ⇒ FRESH + notify does NOT fire", () => {
    const { verdict, calls } = withSpy(
      input({
        boardMtimeMs: NOW - 30_000, // 30s old — well within N
        activityMtimeMs: NOW - 10_000, // active, but board is fresh so no alarm
      })
    );
    expect(verdict).toBe("FRESH");
    expect(calls).toBe(0);
  });

  // ---- Idle must not cry wolf (AC-4).
  it("idle: board stale but NO activity within W ⇒ IDLE + notify does NOT fire", () => {
    const { verdict, calls } = withSpy(
      input({
        boardMtimeMs: NOW - (N + 60_000), // stale
        activityMtimeMs: NOW - (W + 60_000), // last activity older than W → idle
      })
    );
    expect(verdict).toBe("IDLE");
    expect(calls).toBe(0);
  });

  it("idle: board stale AND zero activity markers (NEGATIVE_INFINITY) ⇒ IDLE + quiet", () => {
    const { verdict, calls } = withSpy(
      input({
        boardMtimeMs: NOW - (N + 60_000),
        activityMtimeMs: Number.NEGATIVE_INFINITY, // readable, no markers → idle
      })
    );
    expect(verdict).toBe("IDLE");
    expect(calls).toBe(0);
  });

  // ---- Fail-closed (AC-5): can't-tell ⇒ alert, never silent.
  it("fail-closed: board file missing/unreadable ⇒ UNKNOWN + notify fires (regardless of activity)", () => {
    for (const activity of [NOW, Number.NEGATIVE_INFINITY, null]) {
      const { verdict, calls } = withSpy(
        input({ boardMtimeMs: null, activityMtimeMs: activity })
      );
      expect(verdict).toBe("UNKNOWN");
      expect(calls).toBe(1);
    }
  });

  it("fail-closed: board stale AND activity signal unreadable ⇒ UNKNOWN + notify fires", () => {
    const { verdict, calls } = withSpy(
      input({
        boardMtimeMs: NOW - (N + 60_000), // stale
        activityMtimeMs: null, // unreadable activity → fail-closed
      })
    );
    expect(verdict).toBe("UNKNOWN");
    expect(calls).toBe(1);
  });

  it("fresh board short-circuits an unreadable activity signal ⇒ FRESH + quiet (nothing is stale)", () => {
    const { verdict, calls } = withSpy(
      input({ boardMtimeMs: NOW - 30_000, activityMtimeMs: null })
    );
    expect(verdict).toBe("FRESH");
    expect(calls).toBe(0);
  });

  // ---- Kill-switch honored (AC-6).
  it("kill-switch: DISABLED + notify does NOT fire, regardless of board/activity state", () => {
    const states: Array<Partial<DecisionInput>> = [
      { boardMtimeMs: NOW - (N + 60_000), activityMtimeMs: NOW - 30_000 }, // would be STALE-ACTIVE
      { boardMtimeMs: null, activityMtimeMs: null }, // would be UNKNOWN
      { boardMtimeMs: NOW, activityMtimeMs: NOW }, // would be FRESH
    ];
    for (const s of states) {
      const { verdict, calls } = withSpy(input({ killSwitch: true, ...s }));
      expect(verdict).toBe("DISABLED");
      expect(calls).toBe(0);
    }
  });

  it("isAlertingVerdict marks exactly STALE-ACTIVE and UNKNOWN as alerting", () => {
    expect(isAlertingVerdict("STALE-ACTIVE")).toBe(true);
    expect(isAlertingVerdict("UNKNOWN")).toBe(true);
    expect(isAlertingVerdict("FRESH")).toBe(false);
    expect(isAlertingVerdict("IDLE")).toBe(false);
    expect(isAlertingVerdict("DISABLED")).toBe(false);
  });

  it("decideFreshness is pure — the boundary (age exactly N) is fresh, not stale", () => {
    expect(decideFreshness(input({ boardMtimeMs: NOW - N }))).toBe("FRESH");
    expect(decideFreshness(input({ boardMtimeMs: NOW - (N + 1) }))).not.toBe(
      "FRESH"
    );
  });
});

// ---------------------------------------------------------------------------
// macOS-only live integration: the CLI dry-run + installer dry-run. These exercise
// launchctl/plutil/osascript-adjacent paths, so they skip on non-darwin CI.
// ---------------------------------------------------------------------------
const darwinIt = process.platform === "darwin" ? it : it.skip;
const REPO_ROOT = path.resolve(__dirname, "..");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const CLI = path.join(REPO_ROOT, "scripts", "board-freshness-watchdog.ts");
const INSTALLER = path.join(REPO_ROOT, "scripts", "install-board-watchdog.sh");

/** A synthetic sandbox: a board file + ledger/heartbeat dirs, with mtimes we control. */
function makeSandbox(): {
  dir: string;
  boardPath: string;
  ledgerDir: string;
  heartbeatDir: string;
  offFile: string;
  stateFile: string;
  ledgerFile: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-cli-"));
  const boardPath = path.join(dir, "board.json");
  const ledgerDir = path.join(dir, "3role-ledger");
  const heartbeatDir = path.join(dir, "lane-heartbeats");
  const sessionDir = path.join(ledgerDir, "sess-synthetic");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(heartbeatDir, { recursive: true });
  const ledgerFile = path.join(sessionDir, "1435.jsonl");
  fs.writeFileSync(ledgerFile, '{"role":"executor"}\n');
  fs.writeFileSync(boardPath, JSON.stringify({ schema: 1, tickets: [] }));
  return {
    dir,
    boardPath,
    ledgerDir,
    heartbeatDir,
    offFile: path.join(dir, "nonexistent-off-file"),
    stateFile: path.join(dir, "state.json"),
    ledgerFile,
  };
}

/** Base env for the CLI: point every store at the sandbox, kill-switch OFF, no sync fold. */
function cliEnv(sb: ReturnType<typeof makeSandbox>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OUT: sb.boardPath,
    LEDGER_DIR: sb.ledgerDir,
    HEARTBEAT_DIR: sb.heartbeatDir,
    SYNC_LOG: path.join(sb.dir, "no-such-sync.log"),
    BOARD_WATCHDOG_FOLD_SYNCLOG: "0",
    BOARD_STALE_THRESHOLD_MS: String(N),
    BOARD_WATCHDOG_ACTIVE_WINDOW_MS: String(W),
    BOARD_WATCHDOG_OFF: "",
    BOARD_WATCHDOG_OFF_FILE: sb.offFile,
    BOARD_WATCHDOG_STATE_FILE: sb.stateFile,
  };
}

function setMtime(file: string, msAgo: number): void {
  const t = new Date(Date.now() - msAgo);
  fs.utimesSync(file, t, t);
}

describe("watchdog CLI --check (observable, fires + mutates nothing)", () => {
  darwinIt(
    "synthetic FRESH board ⇒ prints FRESH, exit 0, no state file written",
    () => {
      const sb = makeSandbox();
      setMtime(sb.boardPath, 5_000); // 5s old → fresh
      const r = spawnSync(TSX_BIN, [CLI, "--check"], {
        cwd: REPO_ROOT,
        env: cliEnv(sb),
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      expect((r.stdout || "").trim()).toBe("FRESH");
      expect(fs.existsSync(sb.stateFile)).toBe(false); // --check mutates nothing
    },
    30000
  );

  darwinIt(
    "synthetic FROZEN state (old board + fresh ledger) ⇒ prints STALE-ACTIVE, exit 0, no state file",
    () => {
      const sb = makeSandbox();
      setMtime(sb.boardPath, N + 5 * 60_000); // 15 min old → stale
      setMtime(sb.ledgerFile, 20_000); // 20s ago → active
      const r = spawnSync(TSX_BIN, [CLI, "--check"], {
        cwd: REPO_ROOT,
        env: cliEnv(sb),
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      expect((r.stdout || "").trim()).toBe("STALE-ACTIVE");
      expect(fs.existsSync(sb.stateFile)).toBe(false);
    },
    30000
  );

  darwinIt(
    "kill-switch env set ⇒ prints DISABLED, exit 0 (even with a frozen board)",
    () => {
      const sb = makeSandbox();
      setMtime(sb.boardPath, N + 5 * 60_000);
      setMtime(sb.ledgerFile, 20_000);
      const r = spawnSync(TSX_BIN, [CLI, "--check"], {
        cwd: REPO_ROOT,
        env: { ...cliEnv(sb), BOARD_WATCHDOG_OFF: "1" },
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      expect((r.stdout || "").trim()).toBe("DISABLED");
    },
    30000
  );
});

describe("installer --dry-run (valid plist, mutates neither LaunchAgents nor launchctl)", () => {
  darwinIt(
    "prints a plutil-valid plist referencing the watchdog; no plist file + no launchctl entry created",
    () => {
      const label = `com.user.kanban-board-watchdog-testonly-${process.pid}`;
      const plistPath = path.join(
        os.homedir(),
        "Library",
        "LaunchAgents",
        `${label}.plist`
      );
      const loadedBefore = spawnSync(
        "bash",
        ["-lc", `launchctl list | grep -c ${label} || true`],
        { encoding: "utf8" }
      ).stdout.trim();
      const existsBefore = fs.existsSync(plistPath);

      const r = spawnSync(INSTALLER, ["--dry-run"], {
        cwd: REPO_ROOT,
        env: { ...process.env, BOARD_WATCHDOG_LABEL: label },
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      const out = r.stdout || "";
      expect(out).toContain(label);
      expect(out).toContain("<?xml");
      expect(out).toContain("</plist>");
      expect(out).toContain("kanban:watchdog"); // ProgramArguments references the watchdog
      expect(out).toContain("StartInterval");

      // Extract the rendered plist and prove plutil accepts it directly.
      const start = out.indexOf("<?xml");
      const end = out.indexOf("</plist>") + "</plist>".length;
      const plist = out.slice(start, end);
      const tmp = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-plist-")),
        "out.plist"
      );
      fs.writeFileSync(tmp, plist);
      const lint = spawnSync("plutil", ["-lint", tmp], { encoding: "utf8" });
      expect(lint.status).toBe(0);

      // Nothing was mutated: same presence before and after the dry-run.
      expect(fs.existsSync(plistPath)).toBe(existsBefore);
      expect(fs.existsSync(plistPath)).toBe(false); // brand-new test label → absent
      const loadedAfter = spawnSync(
        "bash",
        ["-lc", `launchctl list | grep -c ${label} || true`],
        { encoding: "utf8" }
      ).stdout.trim();
      expect(loadedAfter).toBe(loadedBefore);
    },
    30000
  );
});
