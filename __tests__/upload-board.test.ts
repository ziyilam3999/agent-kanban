// upload-board.test.ts — #1158 Layer A (hermetic courier unit).
//
// Drives the injectable uploadBoard(deps) with a mocked `put` + an injected token
// resolver + SYNC_LOG → an OS temp file. NO real network, NO real Keychain, NO real
// @vercel/blob (AC-HERMETIC). Both-ends: the skip case asserts non-success + a
// `skipped-no-token` record, so a silent-swallow regression goes RED.

import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  uploadBoard,
  defaultResolveToken,
  type PutFn,
  type TokenResolution,
} from "@/scripts/upload-board";
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
// sha256 of the exact upload bytes — computed the SAME way the impl does, so the
// tests are self-checking against the real digest.
const H_BODY = require("node:crypto")
  .createHash("sha256")
  .update(BOARD_BODY)
  .digest("hex");

let root: string;
let boardPath: string;
let logPath: string;
const savedToken = process.env.BLOB_READ_WRITE_TOKEN;
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
  if (savedToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = savedToken;
  if (savedOut === undefined) delete process.env.OUT;
  else process.env.OUT = savedOut;
});

/** Every line valid JSON, result in the closed enum, no token / no home path. */
function assertLogClean(path: string): void {
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line); // throws → test fails if not valid JSON
    expect(ENUM.has(obj.result)).toBe(true);
    expect(line).not.toContain("/Users/");
    expect(line).not.toContain("SECRET-TOKEN");
  }
}

describe("uploadBoard — courier unit (#1158 Layer A, hermetic)", () => {
  it("(i) happy path: token present + put resolves → put called once + `uploaded` record", async () => {
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));
    const resolveToken = jest.fn<TokenResolution, []>(() => ({
      token: "SECRET-TOKEN",
      reason: "env-token",
    }));

    const code = await uploadBoard({ put, resolveToken, boardPath, logPath });

    expect(code).toBe(0);
    expect(put).toHaveBeenCalledTimes(1);
    const recs = readSyncLog(logPath);
    expect(recs).toHaveLength(1);
    expect(recs[0].result).toBe("uploaded");
    expect(recs[0].url).toBe(FAKE_URL);
    expect(recs[0].reason).toBe("env-token");
    expect(recs[0].boardBytes).toBe(Buffer.byteLength(BOARD_BODY));
    expect(typeof recs[0].boardMtime).toBe("string");
    // #1358: the success record now carries the sha256 of the uploaded bytes.
    expect(recs[0].hash).toBe(H_BODY);
    assertLogClean(logPath);
  });

  it("(ii) background-no-Keychain: env absent + resolver returns empty → NO put, non-zero, `skipped-no-token`", async () => {
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>();
    // Simulates the background false-negative: the injected `security` runner failed.
    const resolveToken = jest.fn<TokenResolution, []>(() => ({
      token: "",
      reason: "keychain-unreachable-or-absent",
    }));

    const code = await uploadBoard({ put, resolveToken, boardPath, logPath });

    // Both-ends regression guard: must report FAILURE, never a silent success.
    expect(code).not.toBe(0);
    expect(code).toBe(1);
    expect(put).not.toHaveBeenCalled();
    const recs = readSyncLog(logPath);
    expect(recs).toHaveLength(1);
    expect(recs[0].result).toBe("skipped-no-token");
    expect(recs[0].reason).toBe("keychain-unreachable-or-absent");
    expect(recs[0].url).toBeNull();
    assertLogClean(logPath);
  });

  it("(iii) every covered path appends exactly one parseable JSONL line in the closed enum", async () => {
    const okPut = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));
    await uploadBoard({
      put: okPut,
      resolveToken: () => ({ token: "SECRET-TOKEN", reason: "env-token" }),
      boardPath,
      logPath,
    });
    await uploadBoard({
      put: jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(),
      resolveToken: () => ({ token: "", reason: "keychain-absent" }),
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
    const resolveToken = (): TokenResolution => ({
      token: "SECRET-TOKEN",
      reason: "env-token",
    });

    const code = await uploadBoard({ put, resolveToken, boardPath, logPath });

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
    const resolveToken = jest.fn<TokenResolution, []>();

    const code = await uploadBoard({ put, resolveToken, boardPath, logPath });

    expect(code).toBe(1);
    expect(put).not.toHaveBeenCalled();
    expect(resolveToken).not.toHaveBeenCalled();
    const recs = readSyncLog(logPath);
    expect(recs[0].result).toBe("failed");
    expect(recs[0].reason).toBe("board-not-found");
  });

  it("defaultResolveToken: env var present → token + reason `env-token` (no Keychain read)", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "  SECRET-TOKEN  ";
    const r = defaultResolveToken();
    expect(r.token).toBe("SECRET-TOKEN");
    expect(r.reason).toBe("env-token");
  });

  // ───────────────────────── #1358 skip-if-unchanged (both-ends) ─────────────────────────

  it("CHANGED: prior uploaded hash differs from current body → put called exactly once, new hash recorded", async () => {
    // Pre-seed an `uploaded` record carrying a DIFFERENT (old) hash.
    const H_old = "0".repeat(64);
    writeFileSync(
      logPath,
      JSON.stringify({
        ts: "2026-06-29T00:00:00.000Z",
        result: "uploaded",
        reason: "env-token",
        url: FAKE_URL,
        boardBytes: 1,
        boardMtime: "2026-06-29T00:00:00.000Z",
        hash: H_old,
      }) + "\n",
      "utf8"
    );
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));
    const resolveToken = (): TokenResolution => ({
      token: "SECRET-TOKEN",
      reason: "env-token",
    });

    const code = await uploadBoard({ put, resolveToken, boardPath, logPath });

    expect(code).toBe(0);
    expect(put).toHaveBeenCalledTimes(1);
    const recs = readSyncLog(logPath);
    const newest = recs[recs.length - 1];
    expect(newest.result).toBe("uploaded");
    expect(newest.hash).toBe(H_BODY); // the freshly-computed sha256 of the current body
    expect(newest.hash).not.toBe(H_old);
    assertLogClean(logPath);
  });

  it("UNCHANGED: prior hash equals current body hash → put NOT called, `skipped-unchanged` appended, returns 0", async () => {
    // Pre-seed a record whose hash IS the sha256 of the current BOARD_BODY.
    writeFileSync(
      logPath,
      JSON.stringify({
        ts: "2026-06-29T00:00:00.000Z",
        result: "uploaded",
        reason: "env-token",
        url: FAKE_URL,
        boardBytes: Buffer.byteLength(BOARD_BODY),
        boardMtime: "2026-06-29T00:00:00.000Z",
        hash: H_BODY,
      }) + "\n",
      "utf8"
    );
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>();
    const resolveToken = (): TokenResolution => ({
      token: "SECRET-TOKEN",
      reason: "env-token",
    });

    const code = await uploadBoard({ put, resolveToken, boardPath, logPath });

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
      JSON.stringify({
        ts: "2026-06-29T00:00:00.000Z",
        result: "skipped-unchanged",
        reason: "unchanged",
        url: null,
        boardBytes: Buffer.byteLength(BOARD_BODY),
        boardMtime: "2026-06-29T00:00:00.000Z",
        hash: H_BODY,
      }) + "\n",
      "utf8"
    );
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>();
    const resolveToken = (): TokenResolution => ({
      token: "SECRET-TOKEN",
      reason: "env-token",
    });

    const code = await uploadBoard({ put, resolveToken, boardPath, logPath });

    expect(put).toHaveBeenCalledTimes(0);
    expect(code).toBe(0);
    const recs = readSyncLog(logPath);
    expect(recs[recs.length - 1].result).toBe("skipped-unchanged");
    assertLogClean(logPath);
  });

  it("FIRST-UPLOAD: empty/absent log → put called once, record carries a 64-char sha256 hash", async () => {
    // logPath does not exist yet (fresh temp root) → lastRemoteHash returns null → upload.
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));
    const resolveToken = (): TokenResolution => ({
      token: "SECRET-TOKEN",
      reason: "env-token",
    });

    const code = await uploadBoard({ put, resolveToken, boardPath, logPath });

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
      JSON.stringify({
        ts: "2026-06-29T00:00:00.000Z",
        result: "uploaded",
        reason: "env-token",
        url: FAKE_URL,
        boardBytes: Buffer.byteLength(BOARD_BODY),
        boardMtime: "2026-06-29T00:00:00.000Z",
      }) + "\n",
      "utf8"
    );
    const put = jest.fn<ReturnType<PutFn>, Parameters<PutFn>>(async () => ({ url: FAKE_URL }));
    const resolveToken = (): TokenResolution => ({
      token: "SECRET-TOKEN",
      reason: "env-token",
    });

    const code = await uploadBoard({ put, resolveToken, boardPath, logPath });

    expect(code).toBe(0);
    expect(put).toHaveBeenCalledTimes(1); // never wrongly skip on legacy data
    const recs = readSyncLog(logPath);
    const newest = recs[recs.length - 1];
    expect(newest.result).toBe("uploaded");
    expect(newest.hash).toBe(H_BODY); // the new record now carries the hash
    assertLogClean(logPath);
  });

  it("(v) AC-IMPORTABLE: importing the courier under NODE_ENV=test fires neither put nor security", () => {
    expect(process.env.NODE_ENV).toBe("test");
    delete process.env.BLOB_READ_WRITE_TOKEN; // force the keychain branch if main ran
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
