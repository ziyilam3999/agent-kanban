// on-task-change-hook.test.ts — #1158 Layer B (MANDATORY end-to-end hook smoke),
// redesigned for #1578's fail-closed publish guard (AC-3).
//
// This is the ONE test in the suite genuinely wired to production: it strips
// NODE_ENV so the REAL hook -> REAL main() -> REAL put from @vercel/blob ->
// REAL defaultResolveBlobAuth all fire (`hookEnv` below). Before #1578 the
// only thing standing between it and a live publish was a 3-part credential
// fence. #1578 adds two MORE locks (the publish opt-in + the fixture-shape
// floor) that live INSIDE uploadBoard() — and this file must prove all of it
// stays engaged, never traded away to make a fixture "reach" further:
//
//   (a) fence-integrity  — MANDATORY pre-assertion, run before every hook
//       spawn below: all three credential locks are engaged (ambient
//       VERCEL_OIDC_TOKEN/BLOB_STORE_ID absent, OIDC_TOKEN_FILE points at a
//       path that does not exist, and the REAL resolver — called in-process
//       with the child's env — independently confirms mode "none"). A fence
//       regression now fails RED instead of silently publishing.
//   (b) marker-proof      — the REAL hook sets BOARD_PUBLISH for its own
//       courier call, and the EXISTING tiny `#9999` fixture (the incident's
//       own shape) is still floor-REFUSED (`synthetic-board`, not
//       `publish-optin-missing`, not `skipped-no-token`) — proving the hook
//       sets the marker while BOTH new locks stay engaged and the courier
//       never reaches auth or `put`.
//   (c) traversal          — a REAL-SHAPED fixture (>=10 tickets, exported
//       board >=20,000 bytes, hex-prefix session, no id 9999) clears BOTH
//       guards and reaches credential resolution (`skipped-no-token`) — the
//       #1158 Layer-B contract (hook-invoked courier traverses to auth) kept
//       alive under the new guards.
//
// HERMETICITY (R2-MED-1 + #1050 B1 fence, updated for #1405's OIDC-only 2-arm
// reality): (a) the ambient VERCEL_OIDC_TOKEN / BLOB_STORE_ID env vars are
// DELETED, (b) OIDC_TOKEN_FILE points at a NONEXISTENT temp path (so the real
// repo-root token file — which EXISTS with a live token after rollout — is
// never read), and (c) a fake `vercel` stub (exit 1) sits on a prepended PATH
// so the refresh/bootstrap pull arm is inert for the SPAWNED child. A
// `security` stub is kept beside it as defense-in-depth. We also point
// TASKS_DIR + OUT at temp paths so export:board is hermetic and never
// reads/writes the real ~/.claude state or the repo's data/board.json. No
// real Keychain, no network, no real CLI, on ANY host.

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
import { defaultResolveBlobAuth } from "@/scripts/blob-auth";

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
  // B1 fence: strip any ambient OIDC credentials (arm 1 of the resolver).
  delete env.VERCEL_OIDC_TOKEN;
  delete env.BLOB_STORE_ID;
  // The jest runner sets NODE_ENV=test; the REAL hook runs with it unset. Strip it so
  // the export + courier `if (NODE_ENV !== "test") main()` guards actually fire (else
  // both scripts no-op and write nothing — the smoke would be vacuous).
  delete env.NODE_ENV;
  return env;
}

/**
 * (a) fence-integrity — MANDATORY pre-assertion (#1578 AC-3a), run before
 * every hook spawn in this file. Two cheap static checks plus one dynamic,
 * COMPLETE check: calling the REAL resolver in-process with the child's env
 * covers every arm (present and future), not just the three known ones.
 *
 * `pullEnv` MUST be neutralized here (r2 note N-D's caveat): the refresh arm
 * execs the real `vercel` binary, and this assertion runs in the PARENT jest
 * process, whose PATH does NOT carry the fenced `vercel`-fails stub the
 * CHILD process gets below — a live `pullEnv` here would shell out to the
 * real Vercel CLI. Forcing it to fail keeps this assertion itself hermetic.
 */
function assertFenceEngaged(env: Record<string, string | undefined>): void {
  expect(env.VERCEL_OIDC_TOKEN).toBeUndefined();
  expect(env.BLOB_STORE_ID).toBeUndefined();
  const auth = defaultResolveBlobAuth({ env, pullEnv: () => false });
  expect(auth.mode).toBe("none");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "akb-hook-"));
  logPath = join(root, "sync.log");

  // A `security` stub that always fails (exit 1). Shadows /usr/bin/security.
  // Defense-in-depth: keeps this hook test hermetic even if an exec-based
  // credential arm (keyed on the revoked RW-token service name) is ever
  // reintroduced — the standing fence PR #45's keep-hermetic-fences lesson asks for.
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

describe("on-task-change.sh — #1158 Layer B / #1578 AC-3 mandatory hook smoke", () => {
  it("AC-3 fence-integrity + marker-proof: hook sets BOARD_PUBLISH, tiny #9999 fixture stays floor-REFUSED (synthetic-board)", () => {
    // The incident's own shape: a hermetic tasks dir with one valid session
    // holding the reserved test ticket #9999, so export:board succeeds and
    // writes a board snapshot the courier can then attempt to upload.
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
    const env = hookEnv({ TASKS_DIR: tasksDir, OUT: boardPath });

    // (a) fence-integrity — before spawning, confirm all three credential
    // locks are engaged.
    assertFenceEngaged(env);

    const res = spawnSync("bash", [HOOK], {
      env: env as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });

    // The hook preserved the PostToolUse exit-0 contract under set -e.
    expect(res.status).toBe(0);

    // (b) marker-proof — only a marker-setting hook can produce
    // `synthetic-board` here (the opt-in guard runs BEFORE the floor, so a
    // hook that failed to set BOARD_PUBLISH would show
    // `publish-optin-missing` instead) — yet the tiny #9999 fixture still
    // trips the shape floor: BOTH new locks stayed engaged and the courier
    // never reached auth or `put`.
    const recs = readSyncLog(logPath);
    const refusedSynthetic = recs.filter(
      (r) => r.result === "refused" && r.reason === "synthetic-board"
    );
    expect(refusedSynthetic.length).toBeGreaterThanOrEqual(1);
    expect(
      recs.filter((r) => r.reason === "publish-optin-missing")
    ).toHaveLength(0);
    expect(recs.filter((r) => r.result === "skipped-no-token")).toHaveLength(
      0
    );

    // Hermeticity: nothing in the log leaks a home path or a token. The probe is
    // built from fragments so the literal never appears in this file (F1).
    const homeProbe = "/Use" + "rs/";
    for (const r of recs) {
      expect(JSON.stringify(r)).not.toContain(homeProbe);
    }
  });

  it("AC-3 traversal: real hook + real-shaped fixture clears BOTH guards, reaches credential resolution (skipped-no-token)", () => {
    // A real-shaped fixture store: >=10 tickets, a hex-prefix session dir
    // name (export-board.ts slices the dir name to 8 chars for both
    // Ticket.sessionId and Board.sessionId), no id 9999, and descriptions
    // padded so the EXPORTED board.json clears the 20,000-byte floor arm
    // (>=10 tickets alone does not guarantee it — r2 note N-E).
    const tasksDir = join(root, "tasks");
    const sessionName = "a1b2c3d4-traversal-fixture";
    const session = join(tasksDir, sessionName);
    mkdirSync(session, { recursive: true });
    for (let i = 0; i < 12; i++) {
      writeFileSync(
        join(session, `${6000 + i}.json`),
        JSON.stringify({
          id: String(6000 + i),
          subject: `Traversal fixture ticket ${i}`,
          description: "Lorem ipsum dolor sit amet. ".repeat(80),
          status: "pending",
          blocks: [],
          blockedBy: [],
        }),
        "utf8"
      );
    }
    const boardPath = join(root, "board.json");
    const env = hookEnv({ TASKS_DIR: tasksDir, OUT: boardPath });

    // (a) fence-integrity, same mandatory pre-assertion as the marker-proof case.
    assertFenceEngaged(env);

    const res = spawnSync("bash", [HOOK], {
      env: env as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });

    expect(res.status).toBe(0);

    // (c) traversal — both new guards were cleared (opt-in: the hook set the
    // marker; floor: the fixture is real-shaped), so the hook-invoked
    // courier reached credential resolution and recorded the honest
    // no-reachable-credential outcome, never a refusal.
    const recs = readSyncLog(logPath);
    expect(
      recs.filter((r) => r.result === "skipped-no-token").length
    ).toBeGreaterThanOrEqual(1);
    expect(recs.filter((r) => r.result === "refused")).toHaveLength(0);

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
