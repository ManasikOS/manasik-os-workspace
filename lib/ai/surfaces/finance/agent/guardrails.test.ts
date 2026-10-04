import { describe, expect, it } from "vitest";

import { checkCorroboration, dayKeyInTimezone, isCadenceDue, isPackUnchanged, type FindingForCorroboration } from "./guardrails";

const METRIC_KEYS = new Set(["finance.total_invoiced", "finance.overdue_instalments"]);

describe("checkCorroboration", () => {
  it("keeps a WARNING/CRITICAL finding that cites a real metric key", () => {
    const findings: FindingForCorroboration[] = [
      { stagedId: "finding-1", severity: "CRITICAL", corroboratingMetricKey: "finance.overdue_instalments" },
    ];
    const { kept, violations } = checkCorroboration(findings, METRIC_KEYS);
    expect(kept).toHaveLength(1);
    expect(violations).toHaveLength(0);
  });

  it("drops a WARNING/CRITICAL finding with no metric key", () => {
    const findings: FindingForCorroboration[] = [{ stagedId: "finding-1", severity: "WARNING", corroboratingMetricKey: null }];
    const { kept, violations } = checkCorroboration(findings, METRIC_KEYS);
    expect(kept).toHaveLength(0);
    expect(violations).toHaveLength(1);
  });

  it("drops a finding citing a metric key that doesn't actually exist in the pack", () => {
    const findings: FindingForCorroboration[] = [
      { stagedId: "finding-1", severity: "CRITICAL", corroboratingMetricKey: "finance.made_up_metric" },
    ];
    const { kept, violations } = checkCorroboration(findings, METRIC_KEYS);
    expect(kept).toHaveLength(0);
    expect(violations).toHaveLength(1);
  });

  it("always keeps an INFO finding regardless of corroboration", () => {
    const findings: FindingForCorroboration[] = [{ stagedId: "finding-1", severity: "INFO", corroboratingMetricKey: null }];
    const { kept, violations } = checkCorroboration(findings, METRIC_KEYS);
    expect(kept).toHaveLength(1);
    expect(violations).toHaveLength(0);
  });

  it("evaluates a mixed batch independently", () => {
    const findings: FindingForCorroboration[] = [
      { stagedId: "finding-1", severity: "CRITICAL", corroboratingMetricKey: "finance.total_invoiced" },
      { stagedId: "finding-2", severity: "WARNING", corroboratingMetricKey: null },
      { stagedId: "finding-3", severity: "INFO", corroboratingMetricKey: null },
    ];
    const { kept, violations } = checkCorroboration(findings, METRIC_KEYS);
    expect(kept.map((f) => f.stagedId)).toEqual(["finding-1", "finding-3"]);
    expect(violations.map((v) => v.stagedId)).toEqual(["finding-2"]);
  });
});

describe("isPackUnchanged", () => {
  it("is true when the fingerprint matches the last run's", () => {
    expect(isPackUnchanged("abc123", "abc123")).toBe(true);
  });

  it("is false when the fingerprint differs", () => {
    expect(isPackUnchanged("abc123", "xyz789")).toBe(false);
  });

  it("is false when there is no last run at all", () => {
    expect(isPackUnchanged("abc123", null)).toBe(false);
  });
});

describe("dayKeyInTimezone", () => {
  it("shifts the calendar day for a timezone west of UTC near midnight", () => {
    // 2026-09-15T02:00:00Z is still 2026-09-14 evening in America/New_York (UTC-4/-5).
    expect(dayKeyInTimezone("2026-09-15T02:00:00.000Z", "America/New_York")).toBe("2026-09-14");
  });

  it("reads the local calendar day for a timezone east of UTC", () => {
    // 2026-09-15T20:00:00Z is already 2026-09-16 morning in Asia/Colombo (UTC+5:30).
    expect(dayKeyInTimezone("2026-09-15T20:00:00.000Z", "Asia/Colombo")).toBe("2026-09-16");
  });
});

describe("isCadenceDue", () => {
  it("is false before the cadence hour, even on a new day", () => {
    // 2026-09-14T20:00:00Z = 2026-09-15 01:30 in Colombo (UTC+5:30) — after midnight, still before 6am.
    expect(isCadenceDue("2026-09-14T20:00:00.000Z", "Asia/Colombo", "2026-09-14", 6)).toBe(false);
  });

  it("is true at/after the cadence hour on a day that hasn't run yet", () => {
    expect(isCadenceDue("2026-09-15T02:00:00.000Z", "Asia/Colombo", "2026-09-14", 6)).toBe(true);
  });

  it("is false if today's local day already ran", () => {
    expect(isCadenceDue("2026-09-15T12:00:00.000Z", "Asia/Colombo", "2026-09-15", 6)).toBe(false);
  });

  it("is true the very first time, with no prior run recorded", () => {
    expect(isCadenceDue("2026-09-15T12:00:00.000Z", "Asia/Colombo", null, 6)).toBe(true);
  });
});
