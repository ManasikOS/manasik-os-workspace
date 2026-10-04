import { describe, expect, it } from "vitest";
import { buildConversationHandoff, handoffItemSentence } from "./build";

const input = () => ({
  customer: { name: "Amina", phone: null },
  booking: { id: "b", reference: "BK-1", currency: "LKR", outstandingBalance: 0 },
  selection: { groupName: "December Umrah", departureDate: "2026-12-01", returnDate: "2026-12-12" },
  commercialStage: "BOOKED",
  readiness: [] as Array<{ label: string; status: string; required?: boolean }>,
  documents: [
    { name: "Passport scan", status: "NOT_SUBMITTED" },
    { name: "Passport scan", status: "REJECTED" },
  ] as Array<{ name: string; status: string; required?: boolean }>,
});

describe("buildConversationHandoff", () => {
  it("computes two missing passport scans from document rows — it never asks a model", () => {
    const handoff = buildConversationHandoff(input());
    expect(handoff.openItems).toContainEqual({ kind: "DOCUMENT", label: "Passport scan", count: 2 });
    expect(handoffItemSentence({ kind: "DOCUMENT", label: "Passport scan", count: 2 })).toBe("2 passport scans missing");
  });

  it("says a submitted document is awaiting verification, not missing", () => {
    const handoff = buildConversationHandoff({ ...input(), documents: [{ name: "Passport scan", status: "SUBMITTED" }] });
    expect(handoff.openItems).toEqual([{ kind: "DOCUMENT_REVIEW", label: "Passport scan", count: 1 }]);
    expect(handoffItemSentence(handoff.openItems[0])).toBe("1 passport scan awaiting verification");
  });

  it("does not count verified, not-applicable or optional documents", () => {
    const handoff = buildConversationHandoff({
      ...input(),
      documents: [
        { name: "Passport scan", status: "VERIFIED" },
        { name: "Photo", status: "NOT_APPLICABLE" },
        { name: "Extra form", status: "NOT_SUBMITTED", required: false },
      ],
    });
    expect(handoff.openItems).toEqual([]);
  });

  it("lists only required group tasks that are not complete, worded as group work", () => {
    const handoff = buildConversationHandoff({
      ...input(),
      documents: [],
      readiness: [
        { label: "Hotel confirmation", status: "IN_PROGRESS", required: true },
        { label: "Flight ticketing", status: "COMPLETE", required: true },
        { label: "Group photo", status: "NOT_STARTED", required: false },
      ],
    });
    expect(handoff.openItems).toEqual([{ kind: "READINESS", label: "Hotel confirmation", count: 1 }]);
    expect(handoffItemSentence(handoff.openItems[0])).toBe("Group task not complete: Hotel confirmation");
  });

  it("states an outstanding balance as a computed figure and nothing when settled", () => {
    const owing = buildConversationHandoff({ ...input(), documents: [], booking: { ...input().booking, outstandingBalance: 250000 } });
    expect(owing.openItems).toEqual([{ kind: "PAYMENT", label: "Outstanding LKR 250000.00", count: 1 }]);
    expect(buildConversationHandoff({ ...input(), documents: [] }).openItems).toEqual([]);
  });
});
