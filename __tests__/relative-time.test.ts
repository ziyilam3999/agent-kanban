import { relativeTime } from "@/lib/relative-time";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it('renders "just now" under a minute', () => {
    expect(relativeTime(NOW, NOW)).toBe("just now");
    expect(relativeTime(NOW - 59_000, NOW)).toBe("just now");
  });

  it("clamps future timestamps to just now", () => {
    expect(relativeTime(NOW + 5000, NOW)).toBe("just now");
  });

  it("renders minutes", () => {
    expect(relativeTime(NOW - 1 * MIN, NOW)).toBe("1m ago");
    expect(relativeTime(NOW - 2 * MIN, NOW)).toBe("2m ago");
    expect(relativeTime(NOW - 59 * MIN, NOW)).toBe("59m ago");
  });

  it("renders hours", () => {
    expect(relativeTime(NOW - 1 * HOUR, NOW)).toBe("1h ago");
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(relativeTime(NOW - 23 * HOUR, NOW)).toBe("23h ago");
  });

  it('renders "yesterday" at exactly the 1-day span', () => {
    expect(relativeTime(NOW - 1 * DAY, NOW)).toBe("yesterday");
    expect(relativeTime(NOW - (1 * DAY + 5 * HOUR), NOW)).toBe("yesterday");
  });

  it("renders multi-day spans", () => {
    expect(relativeTime(NOW - 2 * DAY, NOW)).toBe("2d ago");
    expect(relativeTime(NOW - 15 * DAY, NOW)).toBe("15d ago");
  });

  it("crosses the minute boundary at exactly 60s", () => {
    expect(relativeTime(NOW - MIN, NOW)).toBe("1m ago");
  });
});
