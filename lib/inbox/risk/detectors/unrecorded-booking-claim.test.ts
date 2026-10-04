import { describe, expect, it } from "vitest";

import { customerMessage, facts, MESSAGE_ID } from "../fixtures";
import { detectUnrecordedBookingClaim, referencesIn } from "./unrecorded-booking-claim";

const claimed = (text: string, claimedReferences: Array<{ reference: string; exists: boolean }>) => detectUnrecordedBookingClaim(facts({ latest: customerMessage(text), claimedReferences }));

describe("UNRECORDED_BOOKING_CLAIM", () => {
  it("fires when the customer quotes a booking reference we have no booking for", () => {
    expect(claimed("My booking UMR-NOV-BK099 is confirmed, please check", [{ reference: "UMR-NOV-BK099", exists: false }])).toMatchObject({ code: "UNRECORDED_BOOKING_CLAIM", messageId: MESSAGE_ID });
  });

  it("does not fire when the reference exists", () => {
    expect(claimed("My booking UMR-NOV-BK012", [{ reference: "UMR-NOV-BK012", exists: true }])).toBeNull();
  });

  it("fires if any one of several quoted references is unknown", () => {
    expect(claimed("BK012 and X-BK099", [{ reference: "UMR-NOV-BK012", exists: true }, { reference: "X-BK099", exists: false }])).not.toBeNull();
  });

  it("near-miss: the word booking with no reference is not a claim", () => {
    expect(claimed("I already have a booking with you", [])).toBeNull();
  });

  it("finds references in free text, once each, in any case", () => {
    expect(referencesIn("ref umr-nov-bk012, again UMR-NOV-BK012 and hajj-bk7? ")).toEqual(["UMR-NOV-BK012"]);
    expect(referencesIn("call 0771234567")).toEqual([]);
  });

  it("negative: no message", () => {
    expect(detectUnrecordedBookingClaim(facts({ claimedReferences: [{ reference: "X-BK099", exists: false }] }))).toBeNull();
  });
});
