// blob-auth.test.ts — hermetic unit tests for the courier's auth resolver
// (#1050, #1405 — OIDC-only after the RW-token arms were removed).
//
// Every dep is injected (env / readFile / fileExists / now / pullEnv /
// defaultTokenFile) — NO real network, CLI, or process env. One positive
// fixture PER resolution arm (per-disjunct rule). All JWTs and store ids are
// synthetic, built in-test — never real credential material.

import {
  decodeJwtExp,
  defaultResolveBlobAuth,
  parseDotenv,
  type BlobAuthDeps,
} from "@/scripts/blob-auth";

const NOW_S = 1_800_000_000; // fixed synthetic clock (seconds)
const SKEW_S = 900;

/** Synthetic JWT: base64url header + {"exp":<n>} payload + fake signature. */
function jwtWithExp(exp: number): string {
  const seg = (o: object): string =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${seg({ alg: "none", typ: "JWT" })}.${seg({ exp })}.synthetic-sig`;
}

const FRESH_JWT = jwtWithExp(NOW_S + 12 * 3600); // ~12h out — far beyond skew
const NEAR_JWT = jwtWithExp(NOW_S + 60); // inside the 900s skew, not yet expired
const EXPIRED_JWT = jwtWithExp(NOW_S - 60);
const GARBAGE_JWT = "not-a-jwt-at-all";
const STORE_ID = "store_test123";
const TOKEN_FILE = "/fake-root/.env.vercel-oidc.local"; // synthetic path, never touched
const DEFAULT_FILE = "/fake-default-root/.env.vercel-oidc.local";

function tokenFileBody(jwt: string, storeId: string | null = STORE_ID): string {
  const lines = [`VERCEL_OIDC_TOKEN="${jwt}"`];
  if (storeId !== null) lines.push(`BLOB_STORE_ID="${storeId}"`);
  return lines.join("\n") + "\n";
}

/** Hermetic dep kit over an in-memory file map. */
function makeDeps(opts: {
  env?: Record<string, string | undefined>;
  files?: Record<string, string>;
  pullResult?: boolean | ((tokenFile: string) => boolean);
}): {
  deps: Partial<BlobAuthDeps>;
  pullEnv: jest.Mock;
  files: Record<string, string>;
} {
  const files = { ...(opts.files ?? {}) };
  const pullEnv = jest.fn((tokenFile: string): boolean => {
    const r =
      typeof opts.pullResult === "function"
        ? opts.pullResult(tokenFile)
        : opts.pullResult ?? false;
    return r;
  });
  return {
    deps: {
      env: { OIDC_TOKEN_FILE: TOKEN_FILE, ...(opts.env ?? {}) },
      readFile: (p: string) => (p in files ? files[p] : null),
      fileExists: (p: string) => p in files,
      now: () => NOW_S,
      pullEnv,
      defaultTokenFile: DEFAULT_FILE,
    },
    pullEnv,
    files,
  };
}

describe("decodeJwtExp", () => {
  it("valid synthetic JWT → its exp", () => {
    expect(decodeJwtExp(FRESH_JWT)).toBe(NOW_S + 12 * 3600);
  });
  it("garbage / 2-segment strings → null", () => {
    expect(decodeJwtExp(GARBAGE_JWT)).toBeNull();
    expect(decodeJwtExp("onlyone")).toBeNull();
    const seg = Buffer.from(JSON.stringify({ noexp: true })).toString("base64url");
    expect(decodeJwtExp(`h.${seg}.s`)).toBeNull(); // parseable payload, no exp
    expect(decodeJwtExp("h.%%%not-base64-json%%%.s")).toBeNull();
  });
});

describe("parseDotenv", () => {
  it("parses KEY=value with and without double quotes; ignores junk lines", () => {
    const out = parseDotenv('A="quoted"\nB=bare\n# comment\nnot a line\n');
    expect(out.A).toBe("quoted");
    expect(out.B).toBe("bare");
    expect(Object.keys(out)).toHaveLength(2);
  });
});

describe("defaultResolveBlobAuth — arm 1 (env OIDC)", () => {
  it("env VERCEL_OIDC_TOKEN + env BLOB_STORE_ID → oidc/oidc-env, pullEnv never called", () => {
    const kit = makeDeps({
      env: { VERCEL_OIDC_TOKEN: FRESH_JWT, BLOB_STORE_ID: STORE_ID },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth).toEqual({
      mode: "oidc",
      oidcToken: FRESH_JWT,
      storeId: STORE_ID,
      reason: "oidc-env",
    });
    expect(kit.pullEnv).not.toHaveBeenCalled();
  });

  it("DECISION (no exp check): an EXPIRED env token is still returned as oidc-env", () => {
    const kit = makeDeps({
      env: { VERCEL_OIDC_TOKEN: EXPIRED_JWT, BLOB_STORE_ID: STORE_ID },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth.mode).toBe("oidc");
    expect(auth.reason).toBe("oidc-env");
  });

  it("F2 fall-through: env token, NO store id in env, file has BOTH → arm-2 result (file creds)", () => {
    const kit = makeDeps({
      env: { VERCEL_OIDC_TOKEN: EXPIRED_JWT },
      files: { [TOKEN_FILE]: tokenFileBody(FRESH_JWT) },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth).toEqual({
      mode: "oidc",
      oidcToken: FRESH_JWT, // the FILE's token, not the env one
      storeId: STORE_ID,
      reason: "oidc-file",
    });
  });

  it("arm-1 else-clause: env token + file supplies ONLY the store id → oidc-env with env token", () => {
    const kit = makeDeps({
      env: { VERCEL_OIDC_TOKEN: FRESH_JWT },
      files: { [TOKEN_FILE]: `BLOB_STORE_ID="${STORE_ID}"\n` },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth).toEqual({
      mode: "oidc",
      oidcToken: FRESH_JWT,
      storeId: STORE_ID,
      reason: "oidc-env",
    });
  });
});

describe("defaultResolveBlobAuth — arm 2 (token file)", () => {
  it("fresh exp → oidc-file, no pull", () => {
    const kit = makeDeps({ files: { [TOKEN_FILE]: tokenFileBody(FRESH_JWT) } });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth).toEqual({
      mode: "oidc",
      oidcToken: FRESH_JWT,
      storeId: STORE_ID,
      reason: "oidc-file",
    });
    expect(kit.pullEnv).not.toHaveBeenCalled();
  });

  it("near-expiry (exp - now < skew) → pullEnv called ONCE, re-read → oidc-refreshed", () => {
    const kit = makeDeps({
      files: { [TOKEN_FILE]: tokenFileBody(NEAR_JWT) },
      pullResult: (tokenFile: string) => {
        kit.files[tokenFile] = tokenFileBody(FRESH_JWT);
        return true;
      },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(kit.pullEnv).toHaveBeenCalledTimes(1);
    expect(auth).toEqual({
      mode: "oidc",
      oidcToken: FRESH_JWT,
      storeId: STORE_ID,
      reason: "oidc-refreshed",
    });
  });

  it("expired + refresh succeeds → oidc-refreshed with the new token", () => {
    const kit = makeDeps({
      files: { [TOKEN_FILE]: tokenFileBody(EXPIRED_JWT) },
      pullResult: (tokenFile: string) => {
        kit.files[tokenFile] = tokenFileBody(FRESH_JWT);
        return true;
      },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth.mode).toBe("oidc");
    expect(auth.reason).toBe("oidc-refreshed");
  });

  it("near-expiry but NOT expired + refresh FAILS → still-valid token served as oidc-file", () => {
    const kit = makeDeps({
      files: { [TOKEN_FILE]: tokenFileBody(NEAR_JWT) },
      pullResult: false,
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(kit.pullEnv).toHaveBeenCalledTimes(1);
    expect(auth).toEqual({
      mode: "oidc",
      oidcToken: NEAR_JWT,
      storeId: STORE_ID,
      reason: "oidc-file",
    });
  });

  it("F6 unparseable exp: one refresh attempted; refresh fails → upload-anyway as oidc-file-unverified", () => {
    const kit = makeDeps({
      files: { [TOKEN_FILE]: tokenFileBody(GARBAGE_JWT) },
      pullResult: false,
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(kit.pullEnv).toHaveBeenCalledTimes(1);
    expect(auth).toEqual({
      mode: "oidc",
      oidcToken: GARBAGE_JWT,
      storeId: STORE_ID,
      reason: "oidc-file-unverified",
    });
  });

  it("F6 unparseable exp + refresh yields a parseable token → oidc-refreshed", () => {
    const kit = makeDeps({
      files: { [TOKEN_FILE]: tokenFileBody(GARBAGE_JWT) },
      pullResult: (tokenFile: string) => {
        kit.files[tokenFile] = tokenFileBody(FRESH_JWT);
        return true;
      },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth.mode).toBe("oidc");
    expect(auth.reason).toBe("oidc-refreshed");
  });

  it("expired + refresh fails + no rw anywhere → mode none / oidc-refresh-failed", () => {
    const kit = makeDeps({
      files: { [TOKEN_FILE]: tokenFileBody(EXPIRED_JWT) },
      pullResult: false,
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth).toEqual({ mode: "none", reason: "oidc-refresh-failed" });
  });

  it("file exists but lacks the vars + no rw → mode none / oidc-vars-missing (no pull)", () => {
    const kit = makeDeps({ files: { [TOKEN_FILE]: "UNRELATED=1\n" } });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth).toEqual({ mode: "none", reason: "oidc-vars-missing" });
    expect(kit.pullEnv).not.toHaveBeenCalled();
  });

  it("F10 bootstrap: file MISSING + pull succeeds (creates it) → oidc served (first-run self-heal)", () => {
    const kit = makeDeps({
      files: {},
      pullResult: (tokenFile: string) => {
        kit.files[tokenFile] = tokenFileBody(FRESH_JWT);
        return true;
      },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(kit.pullEnv).toHaveBeenCalledTimes(1);
    expect(auth.mode).toBe("oidc");
    expect(auth.reason).toBe("oidc-file");
  });

  it("F10 bootstrap: file MISSING + pull fails + no rw → mode none / oidc-refresh-failed", () => {
    const kit = makeDeps({ files: {}, pullResult: false });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth).toEqual({ mode: "none", reason: "oidc-refresh-failed" });
  });
});

describe("defaultResolveBlobAuth — B1 hermeticity fence (AC-6, both ends)", () => {
  it("positive: OIDC_TOKEN_FILE override honored — decoy file at the overridden path resolves", () => {
    const overridden = "/fake-override/decoy.env";
    const kit = makeDeps({
      env: { OIDC_TOKEN_FILE: overridden },
      files: { [overridden]: tokenFileBody(FRESH_JWT, "store_override999") },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth).toEqual({
      mode: "oidc",
      oidcToken: FRESH_JWT,
      storeId: "store_override999",
      reason: "oidc-file",
    });
  });

  it("negative (RED if the override is ever bypassed): override → nonexistent path yields mode none even though a decoy EXISTS at the default path", () => {
    const kit = makeDeps({
      env: { OIDC_TOKEN_FILE: "/fake-override/does-not-exist.env" },
      files: { [DEFAULT_FILE]: tokenFileBody(FRESH_JWT) }, // decoy at the injected default
      pullResult: false,
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth.mode).toBe("none");
    expect(auth.reason).toBe("oidc-refresh-failed");
  });

  it("no override → the (injected) default path IS used", () => {
    const kit = makeDeps({
      env: { OIDC_TOKEN_FILE: undefined },
      files: { [DEFAULT_FILE]: tokenFileBody(FRESH_JWT) },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth.mode).toBe("oidc");
    expect(auth.reason).toBe("oidc-file");
  });
});

describe("defaultResolveBlobAuth — mode none (#1405: no RW arms to fall through to)", () => {
  it("nothing anywhere → mode none with the precise OIDC diagnosis (no OIDC configured at all)", () => {
    // No OIDC config: no env token, no file, bootstrap pull fails → the OIDC
    // diagnosis (oidc-refresh-failed) is the final reason — there is no
    // further arm to consult.
    const kit = makeDeps({
      files: {},
      pullResult: false,
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth).toEqual({ mode: "none", reason: "oidc-refresh-failed" });
  });

  it("broken token file (vars missing) → mode none / oidc-vars-missing — never any other mode", () => {
    const kit = makeDeps({
      files: { [TOKEN_FILE]: "UNRELATED=1\n" },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth).toEqual({ mode: "none", reason: "oidc-vars-missing" });
  });
});

describe("skew configurability (OIDC_REFRESH_SKEW_S)", () => {
  it("a tiny skew keeps a near-expiry token in the fresh path (no pull)", () => {
    const kit = makeDeps({
      env: { OIDC_REFRESH_SKEW_S: "10" }, // NEAR_JWT has 60s left — fresh under skew 10
      files: { [TOKEN_FILE]: tokenFileBody(NEAR_JWT) },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth.reason).toBe("oidc-file");
    expect(kit.pullEnv).not.toHaveBeenCalled();
  });

  it(`the default skew (${SKEW_S}s) refreshes the same token`, () => {
    const kit = makeDeps({
      files: { [TOKEN_FILE]: tokenFileBody(NEAR_JWT) },
      pullResult: (tokenFile: string) => {
        kit.files[tokenFile] = tokenFileBody(FRESH_JWT);
        return true;
      },
    });
    const auth = defaultResolveBlobAuth(kit.deps);
    expect(auth.reason).toBe("oidc-refreshed");
  });
});
