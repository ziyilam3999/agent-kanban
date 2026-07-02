// upload-board.test.ts — #1158 Layer A (hermetic courier unit).
//
// Drives the injectable uploadBoard(deps) with a mocked `put` + an injected auth
// resolver + SYNC_LOG → an OS temp file. NO real network, NO real Keychain, NO real
// @vercel/blob (AC-HERMETIC). Both-ends: the skip case asserts non-success + a
// `skipped-no-token` record, so a silent-swallow regression goes RED.
//
// #1050: auth resolution moved to scripts/blob-auth.ts (its unit tests live in
// blob-auth.test.ts); this file injects ready-made BlobAuth values and covers the
// courier's put options (oidc passes NO `token` key — AC-3) and the failure-streak
// alert (AC-4). #1405 removed the RW arms and the rw-fallback alert, so all
// fixtures here are oidc-mode or none-mode.

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

const FAKE_URL = "https://blob.example.test/board.json";
const BOARD_BODY = JSON.stringify({ generatedAt: 1, tickets: [] });
const ENUM = new Set([
  "uploaded",
  "skipped-no-token",
  "skipped-unchanged",
  "failed",
]);
// Privacy probe built from fragments so the literal never appears in this file (F1).
const HOME_PROBE = "/Use" + "rs/";
// sha256 of the exact upload bytes — computed the SAME way the impl does, so the
// tests are self-checking against the real digest.
const H_BODY = require("node:crypto")
  .createHash("sha256")
  .update(BOARD_BODY)
  .digest("hex");
const H_OLD = "0".repeat(64);

const OIDC_AUTH: BlobAuth = {
  mode: "oidc",
  oidcToken: "synthetic.oidc.jwt",
  storeId: "store_test123",
  reason: "oidc-file",
};
const NONE_AUTH: BlobAuth = { mode: "none", reason: "oidc-refresh-failed" };

let root: string;
let boardPath: string;
let logPath: string;
const savedOut = process.env.OUT;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "akb-upload-"));
  boardPath = join(root, "board.json");
  logPath = join(root, "sync.log");
  writeFileSync(boardPath, BOARD_BODY, "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  jest.restoreAllMocks();
  if (savedOut === undefined) delete process.env.OUT;
  else process.env.OUT = savedOut;
});

/** One seeded JSONL record (newest-last file order is the caller's responsibility). */
function record(
  result: string,
  reason: string,
  extra: Record<string, unknown> = {}
): string {
  return (
    JSON.stringify({
      ts: "2026-06-29T00:00:00.000Z",
      result,
      reason,
      url: result === "uploaded" ? FAKE_URL : null,
      boardBytes: 1,
      boardMtime: "2026-06-29T00:00:00.000Z",
      ...extra,
    }) + "\n"
  );
}

/** Every line valid JSON, result in the closed enum, no token / no home path. */
function assertLogClean(path: string): void {
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line); // throws → test fails if not valid JSON
    expect(ENUM.has(obj.result)).toBe(true);
    expect(line).not.toContain(HOME_PROBE);
    expect(line).not.toContain("SECRET-TOKEN");
    expect(line).not.toContain("synthetic.oidc.jwt");
  }
}

describe("uploadBoard — courier unit (#1158 Layer A, hermetic)", () => {
  it("(i) happy path: auth present + put resolves → put called once + `uploaded` record", async () => {
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));
    const resolveAuth = jest.fn<BlobAuth, []>(() => OIDC_AUTH);

    const code = await uploadBoard({ put, resolveAuth, boardPath, logPath });

    expect(code).toBe(0);
    expect(put).toHaveBeenCalledTimes(1);
    const recs = readSyncLog(logPath);
    expect(recs).toHaveLength(1);
    expect(recs[0].result).toBe("uploaded");
    expect(recs[0].url).toBe(FAKE_URL);
    expect(recs[0].reason).toBe("oidc-file");
    expect(recs[0].boardBytes).toBe(Buffer.byteLength(BOARD_BODY));
    expect(typeof recs[0].boardMtime).toBe("string");
    // #1358: the success record now carries the sha256 of the uploaded bytes.
    expect(recs[0].hash).toBe(H_BODY);
    assertLogClean(logPath);
  });

  it("(ii) no credential: resolver returns mode none → NO put, non-zero, `skipped-no-token`", async () => {
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>();
    const resolveAuth = jest.fn<BlobAuth, []>(() => NONE_AUTH);

    const code = await uploadBoard({ put, resolveAuth, boardPath, logPath });

    // Both-ends regression guard: must report FAILURE, never a silent success.
    expect(code).not.toBe(0);
    expect(code).toBe(1);
    expect(put).not.toHaveBeenCalled();
    const recs = readSyncLog(logPath);
    expect(recs).toHaveLength(1);
    expect(recs[0].result).toBe("skipped-no-token");
    expect(recs[0].reason).toBe("oidc-refresh-failed");
    expect(recs[0].url).toBeNull();
    assertLogClean(logPath);
  });

  it("(iii) every covered path appends exactly one parseable JSONL line in the closed enum", async () => {
    const okPut = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));
    await uploadBoard({
      put: okPut,
      resolveAuth: () => OIDC_AUTH,
      boardPath,
      logPath,
    });
    await uploadBoard({
      put: jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(),
      resolveAuth: () => ({ mode: "none", reason: "oidc-vars-missing" }),
      boardPath,
      logPath,
    });
    const recs = readSyncLog(logPath);
    expect(recs).toHaveLength(2);
    for (const r of recs) expect(ENUM.has(r.result)).toBe(true);
    assertLogClean(logPath);
  });

  it("(iv) failure path: put rejects → `failed` with the error CLASS (not message/stack), non-zero", async () => {
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => {
      throw new TypeError("network exploded with SECRET-TOKEN inside");
    });

    const code = await uploadBoard({ put, resolveAuth: () => OIDC_AUTH, boardPath, logPath });

    expect(code).toBe(1);
    const recs = readSyncLog(logPath);
    expect(recs[0].result).toBe("failed");
    expect(recs[0].reason).toBe("TypeError"); // class only — message never logged
    // The message (which carried a fake secret) must NOT have leaked into the log.
    assertLogClean(logPath);
  });

  it("absent board → `failed` / `board-not-found`, non-zero, resolver never consulted", async () => {
    rmSync(boardPath, { force: true });
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>();
    const resolveAuth = jest.fn<BlobAuth, []>();

    const code = await uploadBoard({ put, resolveAuth, boardPath, logPath });

    expect(code).toBe(1);
    expect(put).not.toHaveBeenCalled();
    expect(resolveAuth).not.toHaveBeenCalled();
    const recs = readSyncLog(logPath);
    expect(recs[0].result).toBe("failed");
    expect(recs[0].reason).toBe("board-not-found");
  });

  // ───────────────────────── #1050 auth-mode branching ─────────────────────────

  it("AC-3 oidc mode: put receives oidcToken + storeId and NO `token` property", async () => {
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));

    const code = await uploadBoard({ put, resolveAuth: () => OIDC_AUTH, boardPath, logPath });

    expect(code).toBe(0);
    expect(put).toHaveBeenCalledTimes(1);
    const opts = put.mock.calls[0][2];
    // An explicit `token` key silently DEFEATS OIDC (SDK prefers it) — both ends:
    expect(opts).not.toHaveProperty("token");
    expect(opts.oidcToken).toBe("synthetic.oidc.jwt");
    expect(opts.storeId).toBe("store_test123");
    const recs = readSyncLog(logPath);
    expect(recs[0].result).toBe("uploaded");
    expect(recs[0].reason).toBe("oidc-file");
    assertLogClean(logPath);
  });

  it("AC-4 failure streak: 3 consecutive OIDC-reason failures → injected notify fired", async () => {
    writeFileSync(
      logPath,
      record("skipped-no-token", "oidc-refresh-failed") +
        record("skipped-no-token", "oidc-refresh-failed"),
      "utf8"
    );
    const notify = jest.fn();
    const code = await uploadBoard({
      put: jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(),
      resolveAuth: () => NONE_AUTH,
      boardPath,
      logPath,
      notify,
    });

    expect(code).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toContain("3 times in a row");
    expect(notify.mock.calls[0][1]).toContain("oidc-refresh-failed");
  });

  it("a successful `uploaded` run fires NO notification (the streak alert is failure-only)", async () => {
    // #1405 removed the rw-fallback alert with the rw arms; the only remaining
    // alert channel is the failure streak, which a success must never trip.
    const notify = jest.fn();
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));

    const code = await uploadBoard({ put, resolveAuth: () => OIDC_AUTH, boardPath, logPath, notify });

    expect(code).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  // ───────────────────────── #1358 skip-if-unchanged (both-ends) ─────────────────────────

  it("CHANGED: prior uploaded hash differs from current body → put called exactly once, new hash recorded", async () => {
    // Pre-seed an `uploaded` record carrying a DIFFERENT (old) hash.
    writeFileSync(
      logPath,
      record("uploaded", "oidc-file", { boardBytes: 1, hash: H_OLD }),
      "utf8"
    );
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));

    const code = await uploadBoard({ put, resolveAuth: () => OIDC_AUTH, boardPath, logPath });

    expect(code).toBe(0);
    expect(put).toHaveBeenCalledTimes(1);
    const recs = readSyncLog(logPath);
    const newest = recs[recs.length - 1];
    expect(newest.result).toBe("uploaded");
    expect(newest.hash).toBe(H_BODY); // the freshly-computed sha256 of the current body
    expect(newest.hash).not.toBe(H_OLD);
    assertLogClean(logPath);
  });

  it("UNCHANGED: prior hash equals current body hash → put NOT called, `skipped-unchanged` appended, returns 0", async () => {
    // Pre-seed a record whose hash IS the sha256 of the current BOARD_BODY.
    writeFileSync(
      logPath,
      record("uploaded", "oidc-file", {
        boardBytes: Buffer.byteLength(BOARD_BODY),
        hash: H_BODY,
      }),
      "utf8"
    );
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>();

    const code = await uploadBoard({ put, resolveAuth: () => OIDC_AUTH, boardPath, logPath });

    // The metered put is suppressed — the remote already holds these exact bytes.
    expect(put).toHaveBeenCalledTimes(0);
    expect(code).toBe(0);
    const recs = readSyncLog(logPath);
    const newest = recs[recs.length - 1];
    expect(newest.result).toBe("skipped-unchanged");
    expect(newest.reason).toBe("unchanged");
    expect(newest.url).toBeNull();
    expect(newest.hash).toBe(H_BODY);
    assertLogClean(logPath);
  });

  it("UNCHANGED (variant): a prior `skipped-unchanged` record is also a valid remote-hash source → still skips", async () => {
    // The remote-hash source accepts skipped-unchanged records too (both confirm remote).
    writeFileSync(
      logPath,
      record("skipped-unchanged", "unchanged", {
        boardBytes: Buffer.byteLength(BOARD_BODY),
        hash: H_BODY,
      }),
      "utf8"
    );
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>();

    const code = await uploadBoard({ put, resolveAuth: () => OIDC_AUTH, boardPath, logPath });

    expect(put).toHaveBeenCalledTimes(0);
    expect(code).toBe(0);
    const recs = readSyncLog(logPath);
    expect(recs[recs.length - 1].result).toBe("skipped-unchanged");
    assertLogClean(logPath);
  });

  it("FIRST-UPLOAD: empty/absent log → put called once, record carries a 64-char sha256 hash", async () => {
    // logPath does not exist yet (fresh temp root) → lastRemoteHash returns null → upload.
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));

    const code = await uploadBoard({ put, resolveAuth: () => OIDC_AUTH, boardPath, logPath });

    expect(code).toBe(0);
    expect(put).toHaveBeenCalledTimes(1);
    const recs = readSyncLog(logPath);
    const newest = recs[recs.length - 1];
    expect(newest.result).toBe("uploaded");
    expect(typeof newest.hash).toBe("string");
    expect((newest.hash as string).length).toBe(64);
    expect(newest.hash).toBe(H_BODY);
    assertLogClean(logPath);
  });

  it("LEGACY-HASHLESS: prior `uploaded` record with NO hash field → can't confirm unchanged → put called once, hash back-filled", async () => {
    // A legacy record predating #1358 has no `hash` field → must fail safe to upload.
    writeFileSync(
      logPath,
      record("uploaded", "env-token", { boardBytes: Buffer.byteLength(BOARD_BODY) }),
      "utf8"
    );
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));

    const code = await uploadBoard({ put, resolveAuth: () => OIDC_AUTH, boardPath, logPath });

    expect(code).toBe(0);
    expect(put).toHaveBeenCalledTimes(1); // never wrongly skip on legacy data
    const recs = readSyncLog(logPath);
    const newest = recs[recs.length - 1];
    expect(newest.result).toBe("uploaded");
    expect(newest.hash).toBe(H_BODY); // the new record now carries the hash
    assertLogClean(logPath);
  });

  it("(v) AC-IMPORTABLE: importing the courier under NODE_ENV=test fires neither put nor security/vercel", () => {
    expect(process.env.NODE_ENV).toBe("test");
    process.env.OUT = boardPath; // make existsSync(boardPath) true if the guard were gone

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cp = require("node:child_process");
    const secSpy = jest.spyOn(cp, "execFileSync");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const blob = require("@vercel/blob");

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("@/scripts/upload-board");
    });

    expect(secSpy).not.toHaveBeenCalled();
    expect(blob.put).not.toHaveBeenCalled();
  });
});
