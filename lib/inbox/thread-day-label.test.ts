import { describe, expect, it } from "vitest";

import { threadDayKey, threadDayLabel } from "./thread-day-label";

describe("threadDayLabel", () => {
  const now = new Date(2026, 9, 1, 15, 0);

  it("names today and yesterday", () => {
    expect(threadDayLabel(new Date(2026, 9, 1, 8, 0), now)).toBe("Today");
    expect(threadDayLabel(new Date(2026, 8, 30, 23, 0), now)).toBe("Yesterday");
  });

  it("measures today from the given time, not the system clock", () => {
    const laterNow = new Date(2031, 0, 15, 9, 0);
    expect(threadDayLabel(new Date(2031, 0, 15, 0, 1), laterNow)).toBe("Today");
    expect(threadDayLabel(new Date(2031, 0, 14, 23, 59), laterNow)).toBe("Yesterday");
    expect(threadDayLabel(new Date(2026, 9, 1, 8, 0), laterNow)).toBe("1 Oct 2026");
  });

  it("changes label exactly at local midnight", () => {
    expect(threadDayLabel(new Date(2026, 9, 1, 23, 59), new Date(2026, 9, 2, 0, 0))).toBe("Yesterday");
    expect(threadDayLabel(new Date(2026, 9, 2, 0, 0), new Date(2026, 9, 2, 0, 0))).toBe("Today");
    expect(threadDayLabel(new Date(2026, 9, 31, 12, 0), new Date(2026, 10, 1, 8, 0))).toBe("Yesterday");
  });

  it("shows day and month this year, and the year for an earlier one", () => {
    expect(threadDayLabel(new Date(2026, 2, 12, 9, 0), now)).toBe("12 Mar");
    expect(threadDayLabel(new Date(2025, 2, 12, 9, 0), now)).toBe("12 Mar 2025");
  });
});

describe("threadDayKey", () => {
  it("is the same within a local day and differs across midnight", () => {
    expect(threadDayKey(new Date(2026, 9, 1, 0, 5))).toBe(threadDayKey(new Date(2026, 9, 1, 23, 55)));
    expect(threadDayKey(new Date(2026, 9, 1, 23, 55))).not.toBe(threadDayKey(new Date(2026, 9, 2, 0, 5)));
  });
});
