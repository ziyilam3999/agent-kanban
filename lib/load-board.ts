// load-board.ts — the ONE data source for the web view. SERVER-SIDE ONLY.
//
// Resolves the snapshot in a fixed precedence:
//   (a) BOARD_BLOB_URL set  → fetch it (no-store) — the live, deployed source.
//   (b) else local data/board.json present → read it — local dev with live data.
//   (c) else data/board.sample.json → the synthetic fixture fallback.
//
// PRIVACY: BOARD_BLOB_URL is the PUBLIC (unguessable, no-auth) blob URL. It is
// read from SERVER env and fetched SERVER-SIDE only — it is NEVER handed to the
// browser. The client only ever calls the login-gated /api/board. Do NOT add
// 'use client' here, and do NOT export BOARD_BLOB_URL to any client component.

import { promises as fs } from "fs";
import path from "path";
import type { Board } from "./board-schema";

const DATA_DIR = path.join(process.cwd(), "data");
const LIVE = path.join(DATA_DIR, "board.json");
const SAMPLE = path.join(DATA_DIR, "board.sample.json");

export type BoardSource = "blob" | "local" | "sample";

/**
 * Pure precedence resolver — testable without network or filesystem.
 * blob (a configured URL) wins; else local file if present; else the sample.
 */
export function resolveSource(
  blobUrl: string | undefined,
  hasLocalFile: boolean
): BoardSource {
  if (blobUrl && blobUrl.trim() !== "") return "blob";
  if (hasLocalFile) return "local";
  return "sample";
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Read + parse a local snapshot file, LIVE first then SAMPLE. */
async function loadLocal(): Promise<Board> {
  try {
    const raw = await fs.readFile(LIVE, "utf8");
    return JSON.parse(raw) as Board;
  } catch {
    const raw = await fs.readFile(SAMPLE, "utf8");
    return JSON.parse(raw) as Board;
  }
}

/** Load the current board snapshot (SERVER-SIDE). Blob → local → sample. */
export async function loadBoard(): Promise<Board> {
  const blobUrl = process.env.BOARD_BLOB_URL;
  const hasLocal = await fileExists(LIVE);
  const source = resolveSource(blobUrl, hasLocal);

  if (source === "blob") {
    try {
      const res = await fetch(blobUrl!.trim(), { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`blob responded ${res.status} ${res.statusText}`);
      }
      return JSON.parse(await res.text()) as Board;
    } catch (err) {
      // Never throw the page down — degrade to the local/sample snapshot.
      console.warn(
        `loadBoard: blob fetch failed (${
          err instanceof Error ? err.message : String(err)
        }) — falling back to local/sample.`
      );
    }
  }

  return loadLocal();
}
