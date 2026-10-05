import { describe, expect, it } from "vitest";

import {
  checkPassportFileForPromotion,
  choosePassportChecklistItem,
  mayRemoveUnsubmittedCopy,
  passportDocumentPath,
  PASSPORT_PROMOTION_MAX_BYTES,
  resolvePassportTraveller,
  type PassportChecklistItem,
} from "./promote-passport-plan";

describe("resolvePassportTraveller", () => {
  const onBooking = ["t1", "t2"];

  it("uses the traveller staff chose", () => {
    expect(resolvePassportTraveller({ selectedTravellerId: "t2", candidateTravellerIds: ["t1", "t2"], bookingTravellerIds: onBooking })).toEqual({ ok: true, travellerId: "t2" });
  });

  it("uses the only candidate without a choice", () => {
    expect(resolvePassportTraveller({ selectedTravellerId: null, candidateTravellerIds: ["t1"], bookingTravellerIds: onBooking })).toEqual({ ok: true, travellerId: "t1" });
  });

  it("refuses to pick between several candidates or none", () => {
    expect(resolvePassportTraveller({ selectedTravellerId: null, candidateTravellerIds: ["t1", "t2"], bookingTravellerIds: onBooking }).ok).toBe(false);
    expect(resolvePassportTraveller({ selectedTravellerId: null, candidateTravellerIds: [], bookingTravellerIds: onBooking }).ok).toBe(false);
  });

  it("refuses a traveller who is not on the booking, even when chosen", () => {
    expect(resolvePassportTraveller({ selectedTravellerId: "other", candidateTravellerIds: ["other"], bookingTravellerIds: onBooking }).ok).toBe(false);
  });
});

describe("choosePassportChecklistItem", () => {
  const item = (status: PassportChecklistItem["status"], documentType = "PASSPORT_BIO"): PassportChecklistItem => ({ id: "d1", status, documentType });

  it("accepts an empty or rejected passport item", () => {
    expect(choosePassportChecklistItem([item("NOT_SUBMITTED")]).ok).toBe(true);
    expect(choosePassportChecklistItem([item("REJECTED")]).ok).toBe(true);
  });

  it("never replaces a file that is waiting for review or already verified", () => {
    expect(choosePassportChecklistItem([item("SUBMITTED")])).toMatchObject({ ok: false });
    expect(choosePassportChecklistItem([item("VERIFIED")])).toMatchObject({ ok: false });
  });

  it("refuses when passport is not needed or the item is missing", () => {
    expect(choosePassportChecklistItem([item("NOT_APPLICABLE")]).ok).toBe(false);
    expect(choosePassportChecklistItem([item("NOT_SUBMITTED", "NATIONAL_ID")]).ok).toBe(false);
    expect(choosePassportChecklistItem([]).ok).toBe(false);
  });
});

describe("checkPassportFileForPromotion", () => {
  it("accepts the allowed types and derives the extension from the type", () => {
    expect(checkPassportFileForPromotion({ mimeType: "image/jpeg", sizeBytes: 1000 })).toEqual({ ok: true, extension: "jpg" });
    expect(checkPassportFileForPromotion({ mimeType: "application/pdf", sizeBytes: 1000 })).toEqual({ ok: true, extension: "pdf" });
  });

  it("refuses other types, empty files and files over 10 MB", () => {
    expect(checkPassportFileForPromotion({ mimeType: "audio/mp4", sizeBytes: 1000 }).ok).toBe(false);
    expect(checkPassportFileForPromotion({ mimeType: "application/x-msdownload", sizeBytes: 1000 }).ok).toBe(false);
    expect(checkPassportFileForPromotion({ mimeType: "image/png", sizeBytes: 0 }).ok).toBe(false);
    expect(checkPassportFileForPromotion({ mimeType: "image/png", sizeBytes: PASSPORT_PROMOTION_MAX_BYTES + 1 }).ok).toBe(false);
    expect(checkPassportFileForPromotion({ mimeType: "image/png", sizeBytes: PASSPORT_PROMOTION_MAX_BYTES }).ok).toBe(true);
  });
});

describe("passportDocumentPath", () => {
  it("builds the tenant-first path used by Documents", () => {
    expect(passportDocumentPath({ agencyId: "a1", departureGroupId: "g1", pilgrimId: "p1", documentId: "d1", extension: "jpg" })).toEqual({ path: "a1/g1/p1/d1.jpg", fileName: "d1.jpg" });
  });
});

describe("mayRemoveUnsubmittedCopy", () => {
  const destinationPath = "agency/group/pilgrim/doc.jpg";
  it("removes the copy only when nothing points at it", () => {
    expect(mayRemoveUnsubmittedCopy({ readFailed: false, itemFilePath: null, destinationPath })).toBe(true);
    expect(mayRemoveUnsubmittedCopy({ readFailed: false, itemFilePath: "agency/group/pilgrim/older.jpg", destinationPath })).toBe(true);
  });
  it("keeps it when the checklist item points at that path, or when that could not be checked", () => {
    expect(mayRemoveUnsubmittedCopy({ readFailed: false, itemFilePath: destinationPath, destinationPath })).toBe(false);
    expect(mayRemoveUnsubmittedCopy({ readFailed: true, itemFilePath: null, destinationPath })).toBe(false);
  });
});
