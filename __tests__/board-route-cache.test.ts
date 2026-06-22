import { GET } from "@/app/api/board/route";
import { BOARD_CDN_SMAXAGE as CDN_SMAXAGE } from "@/lib/board-cache";

// #1138 — the /api/board response MUST carry a CDN cache window (s-maxage) so the
// Vercel edge serves frequent client polls instead of re-running Compute + re-reading
// the board from Blob on every poll (the Fast Origin Transfer cut). Both-ends guard:
// it FAILS on the old "no-store, max-age=0" header and PASSES only when a public
// s-maxage CDN cache is set, so a future revert to no-caching trips CI.
describe("GET /api/board — CDN cache header (#1138 origin-transfer cut)", () => {
  beforeAll(() => {
    // Force the local/sample precedence path so the handler never hits the network
    // (a configured blob URL would make loadBoard fetch it).
    delete process.env.BOARD_BLOB_URL;
  });

  it("declares a positive CDN cache window", () => {
    expect(Number.isInteger(CDN_SMAXAGE)).toBe(true);
    expect(CDN_SMAXAGE).toBeGreaterThan(0);
  });

  it("responds with a public s-maxage CDN cache, NOT no-store", async () => {
    const res = await GET();
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain(`s-maxage=${CDN_SMAXAGE}`);
    expect(cc).toContain("public");
    expect(cc).toContain("stale-while-revalidate");
    // The old no-caching behaviour must be gone — this is the regression guard that
    // keeps the origin-transfer cut from silently reverting.
    expect(cc).not.toContain("no-store");
  });
});
