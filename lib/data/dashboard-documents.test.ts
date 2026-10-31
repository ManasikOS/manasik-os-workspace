import { describe, expect, it } from "vitest";

import type { DocumentListItem } from "./documents";
import { buildDocumentReview, DOCUMENT_REVIEW_ROW_LIMIT } from "./dashboard-documents";

let seq = 0;

function doc(overrides: Partial<DocumentListItem> = {}): DocumentListItem {
  seq += 1;
  return {
    documentId: `d${seq}`,
    pilgrimId: `p${seq}`,
    groupId: "g1",
    groupName: "Umrah Dec",
    groupCode: "UMR-DEC",
    daysToDeparture: 30,
    required: true,
    status: "VERIFIED",
    documentType: "PASSPORT_BIO",
    requiredByStage: "VISA",
    isExpiringSoon: false,
    aiVerdict: null,
    ...overrides,
  } as DocumentListItem;
}

describe("buildDocumentReview", () => {
  it("counts with the documents module's own KPI definitions, plus rejected", () => {
    const data = buildDocumentReview([
      doc({ status: "NOT_SUBMITTED" }),
      doc({ status: "NOT_SUBMITTED" }),
      doc({ status: "SUBMITTED" }),
      doc({ status: "REJECTED" }),
      doc({ status: "VERIFIED", isExpiringSoon: true }),
      doc({ status: "SUBMITTED", aiVerdict: "WARNING" }),
    ]);
    expect(data.counts).toEqual({
      missingDocuments: 2,
      awaitingReview: 2,
      rejected: 1,
      aiFlagged: 1,
      expiringSoon: 1,
    });
    expect(data.totalDocuments).toBe(6);
  });

  it("lists groups needing action soonest departure first, each with its most urgent verb", () => {
    const data = buildDocumentReview([
      doc({ groupId: "late", groupName: "Late", daysToDeparture: 50, status: "NOT_SUBMITTED" }),
      doc({ groupId: "soon", groupName: "Soon", daysToDeparture: 8, status: "SUBMITTED" }),
      doc({ groupId: "soon", groupName: "Soon", daysToDeparture: 8, status: "NOT_SUBMITTED" }),
    ]);
    expect(data.groups.map((g) => g.groupId)).toEqual(["soon", "late"]);
    expect(data.groups[0].action).toBe("Review 1");
    expect(data.groups[1].action).toBe("Chase 1 missing");
  });

  it("puts an expiring passport ahead of a rejected or missing document", () => {
    const data = buildDocumentReview([
      doc({ status: "VERIFIED", isExpiringSoon: true, documentType: "PASSPORT_BIO" }),
      doc({ status: "REJECTED" }),
      doc({ status: "NOT_SUBMITTED" }),
    ]);
    expect(data.groups[0].action).toBe("Check 1 expiring");
  });

  it("skips a group where every document is verified", () => {
    const data = buildDocumentReview([doc({ status: "VERIFIED" }), doc({ status: "VERIFIED" })]);
    expect(data.groups).toEqual([]);
    expect(data.actionableGroupCount).toBe(0);
  });

  it("ignores groups that have already departed", () => {
    const data = buildDocumentReview([doc({ daysToDeparture: -2, status: "REJECTED" })]);
    expect(data.groups).toEqual([]);
    expect(data.totalDocuments).toBe(0);
  });

  it("limits the list but still reports how many groups need action", () => {
    const many = Array.from({ length: DOCUMENT_REVIEW_ROW_LIMIT + 2 }, (_, i) =>
      doc({ groupId: `g${i}`, groupName: `G${i}`, daysToDeparture: i + 1, status: "SUBMITTED" }),
    );
    const data = buildDocumentReview(many);
    expect(data.groups).toHaveLength(DOCUMENT_REVIEW_ROW_LIMIT);
    expect(data.actionableGroupCount).toBe(DOCUMENT_REVIEW_ROW_LIMIT + 2);
  });

  it("carries no traveller data - no name, number or file reaches the block", () => {
    const data = buildDocumentReview([
      doc({ status: "SUBMITTED", fullName: "A. Pilgrim", passportNumber: "N1234567", fileName: "passport.pdf" }),
    ]);
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain("A. Pilgrim");
    expect(serialised).not.toContain("N1234567");
    expect(serialised).not.toContain("passport.pdf");
  });

  it("returns empty counts for an agency with no documents", () => {
    expect(buildDocumentReview([])).toEqual({
      counts: { missingDocuments: 0, awaitingReview: 0, rejected: 0, aiFlagged: 0, expiringSoon: 0 },
      groups: [],
      actionableGroupCount: 0,
      totalDocuments: 0,
    });
  });
});
