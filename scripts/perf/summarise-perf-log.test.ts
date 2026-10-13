import { describe, expect, it } from "vitest";

import { parsePerfLog, percentile, summarise } from "./summarise-perf-log";

describe("parsePerfLog", () => {
  it("reads the milliseconds for one label and ignores everything else", () => {
    const log = [
      "[perf] dashboard.loadData 412ms",
      "[perf] getCurrentStaffRole 38ms",
      "GET /dashboard 200 in 640ms",
      "[perf] dashboard.loadData 388ms",
      "[perf] dashboard.loadDataExtra 9ms",
    ].join("\n");
    expect(parsePerfLog(log, "dashboard.loadData")).toEqual([412, 388]);
  });

  it("copes with a prefixed log line, as a hosted log viewer adds", () => {
    expect(parsePerfLog("2026-10-13T09:00:00Z info [perf] dashboard.loadData 77ms", "dashboard.loadData")).toEqual([77]);
  });

  it("returns nothing for a log with no matching line", () => {
    expect(parsePerfLog("nothing here", "dashboard.loadData")).toEqual([]);
  });
});

describe("percentile", () => {
  it("uses nearest-rank on a sorted list", () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 50)).toBe(30);
    expect(percentile(sorted, 95)).toBe(50);
    expect(percentile(sorted, 0)).toBe(10);
  });
});

describe("summarise", () => {
  it("states how many samples it is built on, so a thin run cannot pass for a baseline", () => {
    expect(summarise([40, 10, 30, 20, 50])).toEqual({ n: 5, p50: 30, p95: 50, max: 50 });
  });

  it("returns null for no samples rather than inventing zeros", () => {
    expect(summarise([])).toBeNull();
  });
});
