// clock.test.ts — board-render-perf-inp: quantizeNow (lib/clock.ts).

import { quantizeNow, CLOCK_GRANULARITY_MS } from "@/lib/clock";

describe("quantizeNow", () => {
  it("floors to the granularity boundary at or below the input", () => {
    expect(quantizeNow(0)).toBe(0);
    expect(quantizeNow(59_999)).toBe(0);
    expect(quantizeNow(60_000)).toBe(60_000);
    expect(quantizeNow(60_001)).toBe(60_000);
    expect(quantizeNow(119_999)).toBe(60_000);
    expect(quantizeNow(120_000)).toBe(120_000);
  });

  it("never rounds up (the result is always <= the input)", () => {
    for (const ms of [1, 999, 30_000, 59_999, 60_000, 1_800_000_005_432]) {
      expect(quantizeNow(ms)).toBeLessThanOrEqual(ms);
    }
  });

  it("is idempotent (quantizing an already-quantized value is a no-op)", () => {
    const q = quantizeNow(1_234_567);
    expect(quantizeNow(q)).toBe(q);
  });

  it("respects a custom granularity", () => {
    expect(quantizeNow(1234, 1000)).toBe(1000);
    expect(quantizeNow(999, 1000)).toBe(0);
  });

  it("defaults to a 60s granularity", () => {
    expect(CLOCK_GRANULARITY_MS).toBe(60_000);
  });
});
