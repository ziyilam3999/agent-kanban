// sync-failure-alert.test.ts — out-of-band alert on consecutive courier failures.
//
// Provenance: the 2026-07-02 token-rotation outage — the courier logged
// `failed BlobAccessError` 3x to data/sync.log and NOTHING surfaced it (the
// PostToolUse wrapper discards stdio), so the live board silently served stale
// data ~25 minutes. These tests are BOTH-ENDS: the exact outage tail must demand
// an alert (red on the bug — pre-fix code had no alert path at all), and healthy /
// recovering tails must stay quiet (green on the fix, no spam).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  consecutiveTrailingFailures,
  shouldNotify,
  uploadBoard,
  type UploadDeps,
} from "../scripts/upload-board";
import { appendSyncRecord, type SyncRecord } from "../lib/sync-log";

const R = (result: SyncRecord["result"]): Pick<SyncRecord, "result"> => ({
  result,
});

describe("consecutiveTrailingFailures", () => {
  it("counts the real outage tail (uploaded, skipped, failed x3) as 3", () => {
    // The literal shape of data/sync.log during the 2026-07-02 outage.
    const tail = [
      R("uploaded"),
      R("skipped-unchanged"),
      R("failed"),
      R("failed"),
      R("failed"),
    ];
    expect(consecutiveTrailingFailures(tail)).toBe(3);
  });

  it("resets to 0 after a success (recovery is quiet)", () => {
    expect(
      consecutiveTrailingFailures([R("failed"), R("failed"), R("uploaded")])
    ).toBe(0);
    expect(
      consecutiveTrailingFailures([R("failed"), R("skipped-unchanged")])
    ).toBe(0);
  });

  it("counts skipped-no-token as a failure state (board still not syncing)", () => {
    expect(
      consecutiveTrailingFailures([
        R("uploaded"),
        R("skipped-no-token"),
        R("failed"),
      ])
    ).toBe(2);
  });

  it("fail-closed: an unknown/hook-written result counts as a failure state", () => {
    const weird = [{ result: "export-failed" as SyncRecord["result"] }];
    expect(consecutiveTrailingFailures(weird)).toBe(1);
  });

  it("empty log = 0", () => {
    expect(consecutiveTrailingFailures([])).toBe(0);
  });
});

describe("shouldNotify", () => {
  it("stays quiet below 3 (1 or 2 flaky failures are not an incident)", () => {
    expect(shouldNotify(0)).toBe(false);
    expect(shouldNotify(1)).toBe(false);
    expect(shouldNotify(2)).toBe(false);
  });

  it("fires at exactly 3 — the outage threshold", () => {
    expect(shouldNotify(3)).toBe(true);
  });

  it("debounces a long outage: every 3rd, not every failure", () => {
    expect(shouldNotify(4)).toBe(false);
    expect(shouldNotify(5)).toBe(false);
    expect(shouldNotify(6)).toBe(true);
    expect(shouldNotify(9)).toBe(true);
  });
});

describe("uploadBoard wires the alert (hermetic, injected notify)", () => {
  let dir: string;
  let logPath: string;
  let boardPath: string;
  let notifications: Array<{ title: string; message: string }>;

  const failingDeps = (): UploadDeps => ({
    put: async () => {
      throw new Error("Vercel Blob: Access denied (synthetic test error)");
    },
    resolveAuth: () => ({
      mode: "oidc" as const,
      oidcToken: "synthetic-test-token",
      storeId: "store_test123",
      reason: "oidc-file",
    }),
    boardPath,
    logPath,
    notify: (title, message) => notifications.push({ title, message }),
  });

  const savedBoardPublish = process.env.BOARD_PUBLISH;

  // #1578: the pre-guard fixture here was `{"schema":1,"tickets":[]}` — 0
  // tickets, ~26 bytes — which the new fixture-shape floor would refuse
  // BEFORE the injected failing `put`, silently changing what these
  // alert-streak tests prove (they exist to show `failed` records, from a
  // REACHED `put`, drive `consecutiveTrailingFailures` — not `refused`
  // records). Per the plan's B5 decision, migrate to a floor-passing fixture
  // rather than re-base the tests on `refused`.
  function floorPassingBoardJson(): string {
    return JSON.stringify({
      schema: 1,
      generatedAt: 1,
      sessionId: "a1b2c3d4",
      sessions: [],
      tickets: Array.from({ length: 12 }, (_, i) => ({
        id: String(7000 + i),
        subject: `Sample ticket ${i}`,
        description: "Lorem ipsum dolor sit amet. ".repeat(70),
        column: "todo",
        status: "pending",
        blockedBy: [],
        comments: [],
        updatedAt: 1,
        sessionId: "a1b2c3d4",
      })),
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-alert-"));
    logPath = path.join(dir, "sync.log");
    boardPath = path.join(dir, "board.json");
    fs.writeFileSync(boardPath, floorPassingBoardJson());
    notifications = [];
    // #1578: legitimate opt-in via the TEST PROCESS'S OWN environment (see
    // upload-board.test.ts for the same discipline) — these tests must reach
    // the `put` path (or its failure) to prove the failure-streak alert.
    process.env.BOARD_PUBLISH = "1";
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedBoardPublish === undefined) delete process.env.BOARD_PUBLISH;
    else process.env.BOARD_PUBLISH = savedBoardPublish;
  });

  const seed = (result: SyncRecord["result"]): void =>
    appendSyncRecord(
      {
        ts: new Date(0).toISOString(),
        result,
        reason: "seed",
        url: null,
        boardBytes: null,
        boardMtime: null,
      },
      logPath
    );

  it("3rd consecutive failure fires exactly one notification", async () => {
    seed("failed");
    seed("failed");
    const code = await uploadBoard(failingDeps());
    expect(code).toBe(1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain("agent-kanban");
    expect(notifications[0].message).toContain("3 times in a row");
  });

  it("1st failure after a healthy log stays quiet", async () => {
    seed("uploaded");
    const code = await uploadBoard(failingDeps());
    expect(code).toBe(1);
    expect(notifications).toHaveLength(0);
  });

  it("a notify that throws never breaks the courier", async () => {
    seed("failed");
    seed("failed");
    const deps = failingDeps();
    deps.notify = () => {
      throw new Error("notification center unavailable");
    };
    await expect(uploadBoard(deps)).resolves.toBe(1);
  });
});
