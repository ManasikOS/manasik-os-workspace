import { describe, expect, it } from "vitest";
import { classifyInboundMedia } from "./classify";
import { reviewPassportCandidate } from "./passport";
import { receiptReview } from "./receipt";

const traveller = { id: "traveller-1", fullName: "Aisha Perera", passportNumber: "N1234567" };
const context = (overrides: Partial<Parameters<typeof reviewPassportCandidate>[1]> = {}) => ({
  travellers: [traveller],
  departureDate: "2026-12-01",
  passportValidityMonths: 6,
  ...overrides,
});

describe("media intelligence", () => {
  it("marks sensitive media before analysis", () => expect(classifyInboundMedia({ mimeType: "image/jpeg", filename: "passport.jpg" })).toEqual({ kind: "PASSPORT", sensitiveKinds: ["PASSPORT"] }));
  it("accepts an exact passport match without changing canonical traveller data", () => expect(reviewPassportCandidate({ passportNumber: "N1234567", expiryDate: "2028-01-01", fullName: "Aisha Perera", confidence: 0.99 }, context(), new Date("2026-09-21"))).toMatchObject({ matchedTravellerId: "traveller-1", fieldMismatches: [], reviewRequired: false }));
  it("raises passport expiry and leaves uncertain fields for review", () => expect(reviewPassportCandidate({ expiryDate: "2025-01-01", confidence: 0.7 }, context(), new Date("2026-09-21"))).toMatchObject({ expired: true, signal: "PASSPORT_EXPIRY_RISK", reviewRequired: true }));
  it("reports name and passport-number mismatches against the selected traveller", () => expect(reviewPassportCandidate({ passportNumber: "OTHER", expiryDate: "2028-01-01", fullName: "Different Name", confidence: 0.99 }, context({ selectedTravellerId: "traveller-1" }), new Date("2026-09-21"))).toMatchObject({ fieldMismatches: ["passportNumber", "fullName"], reviewRequired: true }));
  it("requires validity through the configured threshold after departure", () => expect(reviewPassportCandidate({ passportNumber: "N1234567", expiryDate: "2027-05-31", fullName: "Aisha Perera", confidence: 0.99 }, context(), new Date("2026-09-21"))).toMatchObject({ insufficientValidityAtDeparture: true, signal: "PASSPORT_EXPIRY_RISK" }));
  it("requires a staff choice when multiple booking travellers remain plausible", () => expect(reviewPassportCandidate({ expiryDate: "2028-01-01", confidence: 0.99 }, context({ travellers: [traveller, { id: "traveller-2", fullName: "Fatima Perera", passportNumber: "N7654321" }] }), new Date("2026-09-21"))).toMatchObject({ travellerSelectionRequired: true, candidateTravellerIds: ["traveller-1", "traveller-2"] }));
  it("requires review when no traveller is linked", () => expect(reviewPassportCandidate({ passportNumber: "N1234567", expiryDate: "2028-01-01", fullName: "Aisha Perera", confidence: 0.99 }, context({ travellers: [] }), new Date("2026-09-21"))).toMatchObject({ matchedTravellerId: null, reviewRequired: true }));
  it("keeps low-confidence fields non-authoritative", () => expect(reviewPassportCandidate({ passportNumber: "N1234567", expiryDate: "2028-01-01", fullName: "Aisha Perera", confidence: 0.7 }, context(), new Date("2026-09-21")).uncertainFields).toEqual(["passportNumber", "expiryDate", "fullName"]));
  it("a receipt only opens a payment-claim review and never changes payment state", () => expect(receiptReview({ amount: 10_000, reference: "TX1", paidAt: "2026-09-20", confidence: 0.8 }, "att-1")).toMatchObject({ paymentStateMutation: null, intervention: { kind: "PAYMENT_CLAIM", proofAttachmentId: "att-1" } }));
  it("audio remains a distinct non-authoritative source", () => expect(classifyInboundMedia({ mimeType: "audio/ogg" }).kind).toBe("VOICE"));
});
