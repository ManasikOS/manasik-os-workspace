import { describe, expect, it } from "vitest";

import type { VisaListItem } from "./visa";
import { buildVisaQueue, VISA_QUEUE_ROW_LIMIT } from "./dashboard-visa";

let seq = 0;

function item(overrides: Partial<VisaListItem> = {}): VisaListItem {
  seq += 1;
  return {
    journeyId: `j${seq}`,
    groupId: "g1",
    groupName: "Umrah Dec",
    groupCode: "UMR-DEC",
    departureDate: "2026-12-01",
    daysToDeparture: 30,
    visaStatus: "NOT_STARTED",
    rejectedDocuments: 0,
    riskBand: "GREEN",
    validityState: "NONE",
    verifiedAt: null,
    ...overrides,
  } as VisaListItem;
}

describe("buildVisaQueue", () => {
  it("counts applications with the visa module's own KPI definitions", () => {
    const data = buildVisaQueue([
      item({ visaStatus: "READY_TO_SUBMIT" }),
      item({ visaStatus: "READY_TO_SUBMIT" }),
      item({ visaStatus: "SUBMITTED" }),
      item({ visaStatus: "UNDER_REVIEW" }),
      item({ visaStatus: "REJECTED" }),
      item({ visaStatus: "REWORK_REQUIRED" }),
      item({ visaStatus: "APPROVED", verifiedAt: "2026-10-01" }),
    ]);
    expect(data.counts).toEqual({ readyToSubmit: 2, submittedPending: 2, visaIssues: 2, issued: 1 });
    expect(data.totalApplications).toBe(7);
  });

  it("lists groups that need action, soonest departure first, with the verb for the most urgent problem", () => {
    const data = buildVisaQueue([
      item({ groupId: "late", groupName: "Late", daysToDeparture: 40, visaStatus: "READY_TO_SUBMIT" }),
      item({ groupId: "soon", groupName: "Soon", daysToDeparture: 9, visaStatus: "REJECTED" }),
      item({ groupId: "soon", groupName: "Soon", daysToDeparture: 9, visaStatus: "READY_TO_SUBMIT" }),
    ]);
    expect(data.groups.map((g) => g.groupId)).toEqual(["soon", "late"]);
    expect(data.groups[0].action).toBe("Resolve 1 rejected");
    expect(data.groups[1].action).toBe("Submit 1");
  });

  it("skips a group with nothing for anyone to do", () => {
    const data = buildVisaQueue([
      item({ groupId: "done", visaStatus: "APPROVED", verifiedAt: "2026-10-01" }),
      item({ groupId: "waiting", visaStatus: "SUBMITTED" }),
    ]);
    expect(data.groups).toEqual([]);
    expect(data.actionableGroupCount).toBe(0);
  });

  it("flags an issued-but-unverified visa as something to do", () => {
    const data = buildVisaQueue([item({ visaStatus: "APPROVED", verifiedAt: null })]);
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].action).toMatch(/verify|review/i);
  });

  it("ignores groups that have already departed", () => {
    const data = buildVisaQueue([item({ groupId: "gone", daysToDeparture: -3, visaStatus: "REJECTED" })]);
    expect(data.groups).toEqual([]);
    expect(data.totalApplications).toBe(0);
  });

  it("limits the list but still reports how many groups need action", () => {
    const many = Array.from({ length: VISA_QUEUE_ROW_LIMIT + 3 }, (_, i) =>
      item({ groupId: `g${i}`, groupName: `G${i}`, daysToDeparture: i + 1, visaStatus: "READY_TO_SUBMIT" }),
    );
    const data = buildVisaQueue(many);
    expect(data.groups).toHaveLength(VISA_QUEUE_ROW_LIMIT);
    expect(data.actionableGroupCount).toBe(VISA_QUEUE_ROW_LIMIT + 3);
  });

  it("carries no personal data - nothing about a pilgrim reaches the block", () => {
    const data = buildVisaQueue([item({ visaStatus: "READY_TO_SUBMIT", fullName: "A. Pilgrim", passportNumber: "N1234567" })]);
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain("A. Pilgrim");
    expect(serialised).not.toContain("N1234567");
  });

  it("returns empty counts for an agency with no visa applications", () => {
    expect(buildVisaQueue([])).toEqual({
      counts: { readyToSubmit: 0, submittedPending: 0, visaIssues: 0, issued: 0 },
      groups: [],
      actionableGroupCount: 0,
      totalApplications: 0,
    });
  });
});
