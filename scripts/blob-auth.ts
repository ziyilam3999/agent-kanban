// blob-auth.ts — the courier's injectable auth resolver (#1050).
//
// SINGLE OWNER of all Blob credential resolution. The courier uploads with
// short-lived OIDC credentials first (env, else a `vercel env pull`ed token file
// that self-refreshes near expiry), and only falls back to the long-lived RW
// token (env, else macOS Keychain) when no OIDC path works. Every arm yields a
// stable, value-free `reason` token so data/sync.log shows which auth path
// served each upload. NEVER prints, logs, or throws a credential value.
//
// Resolution order (first match wins):
//   1. env VERCEL_OIDC_TOKEN + a store id (env BLOB_STORE_ID, else the token
//      file's) → mode "oidc", reason "oidc-env".
//      DECISION (F2): if the env token is set but no store id is findable,
//      FALL THROUGH (do not error) — the token file may supply both; the SDK
//      itself throws on a token-without-store-id combination.
//      DECISION (F2): arm 1 performs NO `exp` check on purpose — a stale
//      sourced-shell env token yields an honest upload failure + streak alert.
//   2. Token file at OIDC_TOKEN_FILE (default: repo-root .env.vercel-oidc.local).
//      Missing file → ONE bootstrap `vercel env pull` attempt (F10: first-run
//      self-healing; a failed bootstrap classifies as "oidc-refresh-failed").
//      Fresh `exp` → "oidc-file"; expired/near-expiry → refresh via pull →
//      "oidc-refreshed"; unparseable `exp` → one refresh attempt, else
//      upload-anyway as "oidc-file-unverified" (F6 — the server is the real
//      validator; a rejection lands as an honest `failed` record).
//   3. env BLOB_READ_WRITE_TOKEN → mode "rw", reason "rw-env" /
//      "rw-env-fallback" (see OIDC-signal below).
//   4. macOS Keychain BLOB_READ_WRITE_TOKEN → mode "rw", reason "rw-keychain" /
//      "rw-keychain-fallback".
//   5. Nothing → mode "none" with the most precise failure reason
//      ("oidc-refresh-failed" | "oidc-vars-missing" | "keychain-absent" |
//      "keychain-unreachable-or-absent").
//
// OIDC-signal (B2 fallback semantics): env VERCEL_OIDC_TOKEN set OR the token
// file exists. When an rw arm serves the credential AND OIDC-signal is true,
// resolution FELL THROUGH a configured-but-broken OIDC path → the "-fallback"
// reason variant (the courier alerts on it, edge-triggered). With no
// OIDC-signal (e.g. CI exporting only BLOB_READ_WRITE_TOKEN) the rw arm is
// deliberate → plain reason, no alert.
//
// Refresh policy: refresh ONLY when exp - now < skew (default 900 s, override
// via OIDC_REFRESH_SKEW_S). With ~12 h token validity that is ≤2 CLI calls/day
// — no per-hook-edge external-call amplification. The pull writes to a temp
// file then renameSync()s into place (atomic on the same volume — readers
// never see a torn file) with a 60 s timeout + SIGKILL (F4; no lockfile:
// last-writer-wins beats a stale-lock failure mode).

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** The resolved credential: exactly one of three modes, each with a stable reason. */
export type BlobAuth =
  | { mode: "oidc"; oidcToken: string; storeId: string; reason: string }
  | { mode: "rw"; token: string; reason: string }
  | { mode: "none"; reason: string };

/** Keychain read outcome: token ("" if absent) + a precise machine reason. */
export interface KeychainResolution {
  token: string;
  reason: string; // keychain-token | keychain-absent | keychain-unreachable-or-absent
}

/** Injectable dependencies — tests inject ALL of these (hermetic: no network, Keychain, or CLI). */
export interface BlobAuthDeps {
  env: Record<string, string | undefined>;
  /** Read a file as utf8, or null when missing/unreadable. */
  readFile: (p: string) => string | null;
  fileExists: (p: string) => boolean;
  /** Current time in SECONDS since epoch (JWT `exp` units). */
  now: () => number;
  /** Run `vercel env pull <tokenFile>` (temp-file + rename). True on success. */
  pullEnv: (tokenFile: string) => boolean;
  keychainRead: () => KeychainResolution;
  /** Default token-file path when OIDC_TOKEN_FILE is unset (injectable so tests
   * can prove the env override is honored without touching the real repo root). */
  defaultTokenFile: string;
}

/** Repo-root default token file, resolved relative to this script (never cwd). */
const DEFAULT_TOKEN_FILE = path.resolve(__dirname, "..", ".env.vercel-oidc.local");
const DEFAULT_REFRESH_SKEW_S = 900;

/**
 * Decode a JWT's `exp` claim WITHOUT verification (only used to schedule
 * refresh — the server is the real validator). Returns seconds-since-epoch or
 * null when unparseable. NEVER logs or returns the payload.
 */
export function decodeJwtExp(jwt: string): number | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Minimal KEY=value dotenv-line parser (double-quoted values supported — the
 * shape `vercel env pull` writes). No new dependency; ignores everything else.
 */
export function parseDotenv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/**
 * Default `vercel env pull` wrapper: pull into a sibling temp file (matches the
 * `.env.*` gitignore class at the default location), then renameSync into place
 * — atomic on the same volume, so a concurrent reader never sees a torn file.
 * 60 s timeout with SIGKILL (a signal-ignoring CLI cannot linger — F4).
 * stdio ignored: no TTY (a logged-out CLI exits non-zero fast, never prompts)
 * and nothing it prints can leak into our output.
 */
export function defaultPullEnv(tokenFile: string): boolean {
  const tmp = `${tokenFile}.pull-tmp-${process.pid}`;
  try {
    execFileSync("vercel", ["env", "pull", tmp, "--yes"], {
      stdio: "ignore",
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    fs.renameSync(tmp, tokenFile);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best-effort temp cleanup */
    }
    return false;
  }
}

/**
 * Resolve the RW token from the macOS Keychain — logic moved VERBATIM from
 * upload-board.ts's former defaultResolveToken (F3). Classifies the outcome
 * into a precise, value-free reason: hit → keychain-token; clean
 * errSecItemNotFound (exit 44) or empty output → keychain-absent; any other
 * non-zero / unrunnable `security` → keychain-unreachable-or-absent. We do NOT
 * over-claim locked-vs-missing from a background shell (not reliably knowable).
 */
export function defaultKeychainRead(): KeychainResolution {
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", "BLOB_READ_WRITE_TOKEN", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const token = out.trim();
    if (token !== "") return { token, reason: "keychain-token" };
    return { token: "", reason: "keychain-absent" };
  } catch (err) {
    // errSecItemNotFound → `security` exits 44: a clean "not in the keychain".
    const status = (err as { status?: number } | null)?.status;
    if (status === 44) return { token: "", reason: "keychain-absent" };
    return { token: "", reason: "keychain-unreachable-or-absent" };
  }
}

function defaultDeps(): BlobAuthDeps {
  return {
    env: process.env as Record<string, string | undefined>,
    readFile: (p) => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    fileExists: (p) => fs.existsSync(p),
    now: () => Math.floor(Date.now() / 1000),
    pullEnv: defaultPullEnv,
    keychainRead: defaultKeychainRead,
    defaultTokenFile: DEFAULT_TOKEN_FILE,
  };
}

function nonEmpty(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/** Parse the token file's two relevant vars; store id may be complemented from env. */
function readFileVars(
  deps: BlobAuthDeps,
  tokenFile: string
): { token: string | null; storeId: string | null } {
  const raw = deps.readFile(tokenFile);
  if (raw === null) return { token: null, storeId: null };
  const vars = parseDotenv(raw);
  return {
    token: nonEmpty(vars.VERCEL_OIDC_TOKEN),
    storeId: nonEmpty(vars.BLOB_STORE_ID) ?? nonEmpty(deps.env.BLOB_STORE_ID),
  };
}

/** Arm 2 (+ the arm-1 file-store-id else-clause). Returns an auth or a precise failure reason. */
function resolveFromFile(
  deps: BlobAuthDeps,
  tokenFile: string,
  skewS: number,
  envOidcToken: string | null
): { auth: BlobAuth | null; failReason: string } {
  if (!deps.fileExists(tokenFile)) {
    // F10: one bootstrap pull attempt (first-run self-healing).
    if (!deps.pullEnv(tokenFile) || !deps.fileExists(tokenFile)) {
      return { auth: null, failReason: "oidc-refresh-failed" };
    }
  }

  const { token, storeId } = readFileVars(deps, tokenFile);

  // Arm-1 else-clause: env token + the token file's store id (file has no token).
  if (!token && storeId && envOidcToken) {
    return {
      auth: { mode: "oidc", oidcToken: envOidcToken, storeId, reason: "oidc-env" },
      failReason: "",
    };
  }
  if (!token || !storeId) return { auth: null, failReason: "oidc-vars-missing" };

  const exp = decodeJwtExp(token);
  const refreshAndReread = (): { token: string | null; storeId: string | null } | null =>
    deps.pullEnv(tokenFile) ? readFileVars(deps, tokenFile) : null;

  if (exp === null) {
    // F6: unparseable `exp` → attempt ONE refresh; else upload-anyway, honestly labeled.
    const re = refreshAndReread();
    if (re && re.token && re.storeId) {
      const reExp = decodeJwtExp(re.token);
      return {
        auth: {
          mode: "oidc",
          oidcToken: re.token,
          storeId: re.storeId,
          reason: reExp === null ? "oidc-file-unverified" : "oidc-refreshed",
        },
        failReason: "",
      };
    }
    return {
      auth: { mode: "oidc", oidcToken: token, storeId, reason: "oidc-file-unverified" },
      failReason: "",
    };
  }

  const nowS = deps.now();
  if (exp - nowS >= skewS) {
    return {
      auth: { mode: "oidc", oidcToken: token, storeId, reason: "oidc-file" },
      failReason: "",
    };
  }

  // Expired or within the refresh skew → refresh.
  const re = refreshAndReread();
  if (re && re.token && re.storeId) {
    return {
      auth: { mode: "oidc", oidcToken: re.token, storeId: re.storeId, reason: "oidc-refreshed" },
      failReason: "",
    };
  }
  if (re) return { auth: null, failReason: "oidc-vars-missing" }; // pull ok, vars still missing
  if (exp > nowS) {
    // Refresh failed but the token is not yet expired (inside the skew window):
    // still valid — use it; the next fire retries the refresh.
    return {
      auth: { mode: "oidc", oidcToken: token, storeId, reason: "oidc-file" },
      failReason: "",
    };
  }
  return { auth: null, failReason: "oidc-refresh-failed" };
}

/**
 * Resolve the Blob credential through the 5 arms (module doc above). Call with
 * no args in production; tests inject every dep. Never throws; never logs.
 */
export function defaultResolveBlobAuth(overrides: Partial<BlobAuthDeps> = {}): BlobAuth {
  const deps: BlobAuthDeps = { ...defaultDeps(), ...overrides };
  const { env } = deps;

  const tokenFile = nonEmpty(env.OIDC_TOKEN_FILE) ?? deps.defaultTokenFile;
  const skewRaw = Number(nonEmpty(env.OIDC_REFRESH_SKEW_S) ?? NaN);
  const skewS =
    Number.isFinite(skewRaw) && skewRaw >= 0 ? skewRaw : DEFAULT_REFRESH_SKEW_S;

  // Arm 1: env OIDC token + env store id (no exp check — documented decision).
  const envOidcToken = nonEmpty(env.VERCEL_OIDC_TOKEN);
  const envStoreId = nonEmpty(env.BLOB_STORE_ID);
  if (envOidcToken && envStoreId) {
    return { mode: "oidc", oidcToken: envOidcToken, storeId: envStoreId, reason: "oidc-env" };
  }

  // Arm 2: the token file (also covers arm 1's file-supplied store id — F2 fall-through).
  const arm2 = resolveFromFile(deps, tokenFile, skewS, envOidcToken);
  if (arm2.auth) return arm2.auth;
  const oidcFailReason = arm2.failReason;

  // B2 OIDC-signal, evaluated AFTER any bootstrap pull may have created the file.
  const oidcSignal = envOidcToken !== null || deps.fileExists(tokenFile);

  // Arm 3: env RW token.
  const rwEnv = nonEmpty(env.BLOB_READ_WRITE_TOKEN);
  if (rwEnv) {
    return { mode: "rw", token: rwEnv, reason: oidcSignal ? "rw-env-fallback" : "rw-env" };
  }

  // Arm 4: Keychain RW token.
  const kc = deps.keychainRead();
  if (kc.token !== "") {
    return {
      mode: "rw",
      token: kc.token,
      reason: oidcSignal ? "rw-keychain-fallback" : "rw-keychain",
    };
  }

  // Arm 5: nothing — the OIDC failure is the primary-path diagnosis when present.
  return { mode: "none", reason: oidcFailReason || kc.reason };
}
