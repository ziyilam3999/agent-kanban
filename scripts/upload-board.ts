#!/usr/bin/env tsx
// upload-board.ts — the courier UPLOAD step.
//
// Reads data/board.json (produced by export:board) and uploads it to Vercel Blob
// at the stable pathname "board.json" (overwrite-in-place, near-zero CDN cache so
// 1.5s polling sees fresh cards). Prints ONLY the resulting blob URL + a one-line
// env hint — NEVER the token.
//
// Token resolution (in order):
//   1. BLOB_READ_WRITE_TOKEN env var  (CI / non-Mac override)
//   2. macOS Keychain: security find-generic-password -s BLOB_READ_WRITE_TOKEN -w
// The token is never printed, never written to a file, never put in an error trace.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { put } from "@vercel/blob";

const BOARD_PATH = process.env.OUT || path.join("data", "board.json");

/** Resolve the Blob read-write token from env, else macOS Keychain. "" if absent. */
function resolveToken(): string {
  const fromEnv = process.env.BLOB_READ_WRITE_TOKEN;
  if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", "BLOB_READ_WRITE_TOKEN", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return out.trim();
  } catch {
    // Not on macOS, or the keychain item is absent — caller reports cleanly.
    return "";
  }
}

const TOKEN_HELP = [
  "upload-board: no Blob token found.",
  "  Store it in the macOS Keychain (recommended — never touches a file):",
  '    security add-generic-password -a "$USER" -s BLOB_READ_WRITE_TOKEN -w',
  "  …then paste the token at the prompt. Or, for CI / non-Mac, export it:",
  "    export BLOB_READ_WRITE_TOKEN=...",
  "  See .env.example for the full note.",
].join("\n");

async function main(): Promise<void> {
  if (!fs.existsSync(BOARD_PATH)) {
    console.error(
      `upload-board: ${BOARD_PATH} not found — run \`npm run export:board\` first.`
    );
    process.exit(1);
  }

  const token = resolveToken();
  if (!token) {
    console.error(TOKEN_HELP);
    process.exit(1);
  }

  const body = fs.readFileSync(BOARD_PATH);

  const { url } = await put("board.json", body, {
    access: "public",
    token,
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
    allowOverwrite: true,
    contentType: "application/json",
  });

  // ONLY the URL + the one-line env hint. No token, ever.
  console.log(url);
  console.log(`set BOARD_BLOB_URL=${url} in the Vercel project env`);
}

main().catch((err: unknown) => {
  // Print only the message — never the stack (could echo request internals).
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`upload-board: upload failed — ${msg}`);
  process.exit(1);
});
