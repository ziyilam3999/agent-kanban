// publish-guard.test.ts — #1578 fail-closed publish guard (SEV-HIGH).
//
// A test/verification run published a one-ticket fixture board (`#9999 smoke
// ticket`) to the LIVE production blob — root cause: one stable blob pathname,
// ambient creds on disk, and ZERO environment separation on the write path.
//
// This file carries the AC power map's TWO load-bearing legs (plan
// `.ai-workspace/plans/2026-07-11-1578-fixture-board-publish-guard.md`):
//
//   - AC-1 / AC-2 — script-path RED controls. These drive the courier via
//     `npm run kanban:upload` (the `main()` path) and therefore CANNOT
//     distinguish a guard placed inside `uploadBoard()` from one placed only
//     in `main()` — see the AC power map. They still matter as end-to-end
//     proof of the default behavior real operators hit.
//   - AC-9 — the SOLE discriminator. It calls `uploadBoard()` DIRECTLY,
//     in-process, bypassing `main()` entirely — the exact shape of the 18
//     existing in-process call sites in `upload-board.test.ts` /
//     `sync-failure-alert.test.ts`. A guard placed only in `main()` passes
//     AC-1/AC-2 (and every other script-driven AC) while leaving this one
//     RED — which is precisely why AC-9 is the gate.
//
// N-A (r2 MUST-READ, plan-review): jest sets NODE_ENV=test on itself, and
// scripts/upload-board.ts only runs `main()` when NODE_ENV !== "test". Every
// spawned child below explicitly `delete`s NODE_ENV from its own env — else
// the spawned courier no-ops and writes nothing, and AC-1/AC-2 pass for free
// while proving nothing (the exact trap __tests__/on-task-change-hook.test.ts
// already documents at its own env-builder).

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { uploadBoard, type PutFn } from "@/scripts/upload-board";
import type { BlobAuth } from "@/scripts/blob-auth";
import { readSyncLog } from "@/lib/sync-log";

// Belt-and-braces: a bare import of the courier must never pull the real blob client.
jest.mock("@vercel/blob", () => ({ put: jest.fn() }));

const REPO_ROOT = process.cwd();

/**
 * A board that clears every arm of the fixture-shape floor: ≥10 tickets,
 * ≥20,000 bytes (verified below — N-E), no ticket id "9999", hex-prefix
 * sessionId. Used to isolate the OPT-IN guard from the shape floor in AC-1
 * (a floor-passing board makes any refusal unambiguously about the marker).
 */
function floorPassingBoardJson(): string {
  const tickets = Array.from({ length: 12 }, (_, i) => ({
    id: String(5000 + i),
    subject: `Sample ticket ${i} for the #1578 publish-guard fixture`,
    description: "Lorem ipsum dolor sit amet. ".repeat(70),
    column: "todo",
    status: "pending",
    blockedBy: [],
    comments: [],
    updatedAt: 1,
    sessionId: "a1b2c3d4",
  }));
  const body = JSON.stringify({
    schema: 1,
    generatedAt: 1,
    sessionId: "a1b2c3d4",
    sessions: [
      {
        id: "a1b2c3d4",
        label: "active just now · 12 tickets",
        lastActive: 1,
        ticketCount: 12,
        live: true,
      },
    ],
    tickets,
  });
  // N-E: assert the fixture the executor actually ships clears the floor —
  // fails loudly at test-collection time if a future edit shrinks it below
  // the 20,000-byte arm, rather than silently making AC-1 meaningless.
  if (Buffer.byteLength(body) < 20_000) {
    throw new Error(
      `floorPassingBoardJson() fixture is ${Buffer.byteLength(body)} bytes — below the 20,000-byte floor it is meant to clear`
    );
  }
  return body;
}

/** The incident's own shape: one ticket id "9999", a `smoke`-prefixed session, ~2KB. */
function incidentBoardJson(): string {
  return JSON.stringify({
    schema: 1,
    generatedAt: 1,
    sessionId: "smoke-se",
    sessions: [
      {
        id: "smoke-se",
        label: "active just now · 1 tickets",
        lastActive: 1,
        ticketCount: 1,
        live: true,
      },
    ],
    tickets: [
      {
        id: "9999",
        subject: "smoke ticket",
        description: "",
        column: "todo",
        status: "pending",
        blockedBy: [],
        comments: [],
        updatedAt: 1,
        sessionId: "smoke-se",
      },
    ],
  });
}

function countMatches(raw: string, substr: string): number {
  return raw.split(substr).length - 1;
}

describe("publish-guard — script-path RED controls (#1578 AC-1, AC-2)", () => {
  let root: string;
  let boardPath: string;
  let logPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "akb-guard-"));
    boardPath = join(root, "board.json");
    logPath = join(root, "sync.log");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Hermetic child env: no reachable credentials, temp SYNC_LOG/OUT, real NODE_ENV.
   * Typed as a plain Record (not NodeJS.ProcessEnv) — Next.js's global type
   * augmentation declares NODE_ENV `readonly`, which would make `delete
   * env.NODE_ENV` a compile error below. */
  function childEnv(extra: Record<string, string>): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      ...process.env,
      SYNC_LOG: logPath,
      // Nonexistent token-file path — the real repo-root token file (which may
      // carry a live token) is never read from inside this test suite.
      OIDC_TOKEN_FILE: join(root, "no-such-oidc-token.env"),
      OUT: boardPath,
      ...extra,
    };
    delete env.VERCEL_OIDC_TOKEN;
    delete env.BLOB_STORE_ID;
    // N-A: see file banner — else the spawned courier no-ops entirely.
    delete env.NODE_ENV;
    return env;
  }

  it("AC-1: inert by default — opt-in missing → refused before credentials", () => {
    writeFileSync(boardPath, floorPassingBoardJson(), "utf8");
    const env = childEnv({});
    delete env.BOARD_PUBLISH;

    const res = spawnSync("bash", ["-c", "npm run --silent kanban:upload"], {
      cwd: REPO_ROOT,
      env: env as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });

    expect(res.status).not.toBe(0);
    const raw = readFileSync(logPath, "utf8");
    expect(countMatches(raw, '"result":"refused"')).toBe(1);
    expect(countMatches(raw, '"reason":"publish-optin-missing"')).toBe(1);
    // The ordering discriminator (N7, r1 note 7): a guard placed AFTER
    // resolveAuth() would hit auth.mode === "none" first and record
    // `skipped-no-token` instead — this must stay exactly 0.
    expect(countMatches(raw, '"result":"skipped-no-token"')).toBe(0);
  });

  it("AC-2: shape floor refuses synthetic content even when publishing is authorized", () => {
    writeFileSync(boardPath, incidentBoardJson(), "utf8");
    const env = childEnv({ BOARD_PUBLISH: "1" });

    const res = spawnSync("bash", ["-c", "npm run --silent kanban:upload"], {
      cwd: REPO_ROOT,
      env: env as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });

    expect(res.status).not.toBe(0);
    const raw = readFileSync(logPath, "utf8");
    expect(countMatches(raw, '"reason":"synthetic-board"')).toBe(1);
    expect(countMatches(raw, '"result":"uploaded"')).toBe(0);
    // The floor also fires before auth — same ordering discriminator as AC-1.
    expect(countMatches(raw, '"result":"skipped-no-token"')).toBe(0);
  });
});

describe("publish-guard — AC-9 in-process discriminator (#1578, THE placement gate)", () => {
  it("AC-9: uploadBoard() refuses IN-PROCESS with the marker unset; the put spy is never invoked", async () => {
    const root = mkdtempSync(join(tmpdir(), "akb-guard-ac9-"));
    const boardPath = join(root, "board.json");
    // N-B (r2): the temp log path must NOT exist yet — a prior record whose
    // hash matches the fixture would let the #1358 dedup short-circuit be the
    // (wrong) reason `put` isn't called, evaporating this AC's power.
    const logPath = join(root, "sync.log");
    writeFileSync(boardPath, floorPassingBoardJson(), "utf8");

    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>();
    // A VALID auth + a floor-passing board strip every OTHER reason `put`
    // might not be called, so a call (pre-fix) or non-call (post-fix) is
    // attributable ONLY to the opt-in guard at the pinned seam.
    const validAuth: BlobAuth = {
      mode: "oidc",
      oidcToken: "synthetic.oidc.jwt",
      storeId: "store_test123",
      reason: "oidc-file",
    };
    const resolveAuth = jest.fn<BlobAuth, []>(() => validAuth);

    const savedMarker = process.env.BOARD_PUBLISH;
    delete process.env.BOARD_PUBLISH;
    try {
      const code = await uploadBoard({ put, resolveAuth, boardPath, logPath });

      // (a) the placement discriminator itself.
      expect(put).not.toHaveBeenCalled();
      // (b) non-zero exit.
      expect(code).not.toBe(0);
      // (c) exactly one refused/publish-optin-missing record.
      const recs = readSyncLog(logPath);
      expect(recs).toHaveLength(1);
      expect(recs[0].result).toBe("refused");
      expect(recs[0].reason).toBe("publish-optin-missing");
    } finally {
      if (savedMarker === undefined) delete process.env.BOARD_PUBLISH;
      else process.env.BOARD_PUBLISH = savedMarker;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
