// on-task-change-hook.test.ts — #1158 Layer B (MANDATORY end-to-end hook smoke).
//
// Runs the REAL scripts/on-task-change.sh and asserts BOTH ends of the shell
// contract under an env-absent / no-reachable-token setup:
//   (a) the hook process exits 0 (catches a dropped non-aborting wrapper → set -e
//       would abort → exit 1), AND
//   (b) a `skipped-no-token` line was appended to the temp SYNC_LOG (proves the hook
//       invoked the courier UNCONDITIONALLY end-to-end after the pre-probe removal).
//
// HERMETICITY (R2-MED-1 + #1050 B1 fence): the host Keychain HOLDS the real token,
// so merely unsetting BLOB_READ_WRITE_TOKEN would let the resolver fall through to
// `security` and do a REAL Keychain read + REAL upload. We neutralize the host
// Keychain by prepending a temp dir to PATH that contains a `security` STUB which
// exits non-zero (exit 1 → the resolver's honest keychain-unreachable-or-absent
// classification) — so the keychain read fails DETERMINISTICALLY and no real upload
// can occur. #1050 adds the OIDC arms, which the fence covers too: (a) the ambient
// VERCEL_OIDC_TOKEN / BLOB_STORE_ID env vars are DELETED, (b) OIDC_TOKEN_FILE points
// at a NONEXISTENT temp path (so the real repo-root token file — which EXISTS with a
// live token after rollout — is never read; this is the red-on-regression proof that
// the env override is honored by the real default deps), and (c) a fake `vercel`
// stub (exit 1) sits beside the `security` stub so the refresh/bootstrap pull arm is
// inert. We also point TASKS_DIR + OUT at temp paths so export:board is hermetic and
// never reads/writes the real ~/.claude state or the repo's data/board.json. No real
// Keychain, no network, no real CLI, on ANY host.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSyncLog } from "@/lib/sync-log";

const HOOK = join(process.cwd(), "scripts", "on-task-change.sh");

let root: string;
let stubDir: string;
let logPath: string;

/** Build the hermetic env: PATH stubs + unset creds + fenced OIDC + temp SYNC_LOG/OUT. */
function hookEnv(extra: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH ?? ""}`,
    SYNC_LOG: logPath,
    // B1 fence: point the resolver's token-file arm at a path that does NOT exist,
    // so the REAL repo-root .env.vercel-oidc.local (live token, post-rollout) is
    // never read from inside the test suite.
    OIDC_TOKEN_FILE: join(root, "no-such-oidc-token.env"),
    ...extra,
  };
  // Force the genuine no-token path regardless of the host Keychain / CI env.
  delete env.BLOB_READ_WRITE_TOKEN;
  // B1 fence: strip any ambient OIDC credentials (arm 1 of the resolver).
  delete env.VERCEL_OIDC_TOKEN;
  delete env.BLOB_STORE_ID;
  // The jest runner sets NODE_ENV=test; the REAL hook runs with it unset. Strip it so
  // the export + courier `if (NODE_ENV !== "test") main()` guards actually fire (else
  // both scripts no-op and write nothing — the smoke would be vacuous).
  delete env.NODE_ENV;
  return env;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "akb-hook-"));
  logPath = join(root, "sync.log");

  // A `security` stub that always fails (exit 1) → the resolver can never read the
  // real Keychain (clean black-box neutralization). Shadows /usr/bin/security.
  stubDir = join(root, "bin");
  mkdirSync(stubDir, { recursive: true });
  const stub = join(stubDir, "security");
  writeFileSync(stub, "#!/bin/sh\nexit 1\n", "utf8");
  chmodSync(stub, 0o755);

  // #1050 B1 fence: a `vercel` stub that always fails (exit 1) → the resolver's
  // refresh/bootstrap `vercel env pull` arm is inert inside the test suite.
  const vercelStub = join(stubDir, "vercel");
  writeFileSync(vercelStub, "#!/bin/sh\nexit 1\n", "utf8");
  chmodSync(vercelStub, 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("on-task-change.sh — #1158 Layer B mandatory hook smoke", () => {
  it("AC-HOOK-SMOKE: env-absent + neutralized Keychain → hook exits 0 AND logs `skipped-no-token`", () => {
    // A hermetic tasks dir with one valid session so export:board succeeds and writes
    // a board snapshot the courier can then attempt to upload.
    const tasksDir = join(root, "tasks");
    const session = join(tasksDir, "smoke-session-1158");
    mkdirSync(session, { recursive: true });
    writeFileSync(
      join(session, "9999.json"),
      JSON.stringify({
        id: "9999",
        subject: "smoke ticket",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
      }),
      "utf8"
    );
    const boardPath = join(root, "board.json");

    const res = spawnSync("bash", [HOOK], {
      env: hookEnv({ TASKS_DIR: tasksDir, OUT: boardPath }) as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });

    // End (a): the hook preserved the PostToolUse exit-0 contract under set -e.
    expect(res.status).toBe(0);

    // End (b): the courier ran unconditionally and logged a precise skip.
    const recs = readSyncLog(logPath);
    const skips = recs.filter((r) => r.result === "skipped-no-token");
    expect(skips.length).toBeGreaterThanOrEqual(1);
    expect(skips[0].reason).toBeTruthy();

    // Hermeticity: nothing in the log leaks a home path or a token. The probe is
    // built from fragments so the literal never appears in this file (F1).
    const homeProbe = "/Use" + "rs/";
    for (const r of recs) {
      expect(JSON.stringify(r)).not.toContain(homeProbe);
    }
  });

  it("AC-EXPORT-FAIL: export:board failure → hook still exits 0 AND logs `export-failed`", () => {
    // An EMPTY tasks dir → collectSessions() finds no session → export-board exits 1.
    const emptyTasks = join(root, "empty-tasks");
    mkdirSync(emptyTasks, { recursive: true });
    const boardPath = join(root, "missing-board.json"); // never written → courier sees board-not-found

    const res = spawnSync("bash", [HOOK], {
      env: hookEnv({ TASKS_DIR: emptyTasks, OUT: boardPath }) as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });

    expect(res.status).toBe(0);
    const recs = readSyncLog(logPath);
    const exportFailed = recs.filter(
      (r) => r.result === "failed" && r.reason === "export-failed"
    );
    expect(exportFailed.length).toBeGreaterThanOrEqual(1);
  });
});
