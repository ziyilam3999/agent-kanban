import { resolveSource } from "@/lib/load-board";

// Tests the three-way precedence WITHOUT touching the network or the Keychain:
// resolveSource is the pure decision and loadBoard is a thin wrapper around it.
describe("resolveSource (board snapshot precedence)", () => {
  const URL = "https://example.public.blob.vercel-storage.com/board.json";

  it("prefers blob when BOARD_BLOB_URL is set — regardless of a local file", () => {
    expect(resolveSource(URL, true)).toBe("blob");
    expect(resolveSource(URL, false)).toBe("blob");
  });

  it("treats empty / whitespace / undefined blob url as unset", () => {
    expect(resolveSource("", true)).toBe("local");
    expect(resolveSource("   ", true)).toBe("local");
    expect(resolveSource(undefined, true)).toBe("local");
  });

  it("uses the local file when no blob url and the local file exists", () => {
    expect(resolveSource(undefined, true)).toBe("local");
  });

  it("falls back to the sample when no blob url and no local file", () => {
    expect(resolveSource(undefined, false)).toBe("sample");
    expect(resolveSource("", false)).toBe("sample");
    expect(resolveSource("   ", false)).toBe("sample");
  });
});
