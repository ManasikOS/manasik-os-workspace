import { describe, expect, it } from "vitest";

import {
  INBOX_MEDIA_VAULT_MAX_BYTES,
  mediaRoutingOptions,
  mediaTypeCanBeSavedToVault,
  type MediaRoutingInput,
  type MediaRoutingOption,
} from "./routing";

const base: MediaRoutingInput = {
  kind: "BROCHURE",
  mimeType: "application/pdf",
  byteSize: 200_000,
  hasOriginal: true,
  savedDocumentId: null,
  can: { saveToVault: true, openFinanceReview: true, saveToTravellerDocuments: true },
};

const optionFor = (options: MediaRoutingOption[], destination: MediaRoutingOption["destination"]) =>
  options.find((option) => option.destination === destination);

describe("mediaTypeCanBeSavedToVault", () => {
  it("accepts exactly the types and size the vault bucket accepts", () => {
    for (const mimeType of [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]) {
      expect(mediaTypeCanBeSavedToVault(mimeType, 1000)).toBe(true);
    }
    expect(mediaTypeCanBeSavedToVault("application/pdf; charset=binary", 1000)).toBe(true);
    for (const mimeType of ["image/webp", "image/gif", "text/plain", "text/csv", "audio/ogg", "application/zip"]) {
      expect(mediaTypeCanBeSavedToVault(mimeType, 1000)).toBe(false);
    }
    expect(mediaTypeCanBeSavedToVault("application/pdf", INBOX_MEDIA_VAULT_MAX_BYTES)).toBe(true);
    expect(mediaTypeCanBeSavedToVault("application/pdf", INBOX_MEDIA_VAULT_MAX_BYTES + 1)).toBe(false);
    expect(mediaTypeCanBeSavedToVault("application/pdf", 0)).toBe(false);
  });
});

describe("mediaRoutingOptions", () => {
  it("offers a brochure as proposal collateral and never sends or publishes it", () => {
    const result = mediaRoutingOptions(base);
    expect(optionFor(result.options, "PROPOSAL_COLLATERAL")).toMatchObject({ availability: "AVAILABLE" });
    expect(result.options.map((option) => option.destination)).toEqual(["PROPOSAL_COLLATERAL", "DOWNLOAD"]);
    expect(result.sendsOrPublishesAutomatically).toBe(false);
    expect(JSON.stringify(result.options)).not.toMatch(/send|publish/i);
  });

  it("offers any other supported file as a Document", () => {
    const result = mediaRoutingOptions({ ...base, kind: "OTHER" });
    expect(result.options.map((option) => option.destination)).toEqual(["DOCUMENTS", "DOWNLOAD"]);
    expect(optionFor(result.options, "DOCUMENTS")).toMatchObject({ availability: "AVAILABLE" });
  });

  it("routes a receipt only to Finance intake and never to the shared vault", () => {
    const result = mediaRoutingOptions({ ...base, kind: "RECEIPT", mimeType: "image/jpeg" });
    expect(result.options.map((option) => option.destination)).toEqual(["FINANCE_INTAKE", "DOWNLOAD"]);
    expect(optionFor(result.options, "FINANCE_INTAKE")).toMatchObject({ availability: "AVAILABLE" });
  });

  it("denies Finance intake without review access and for a type Finance cannot read", () => {
    const denied = mediaRoutingOptions({ ...base, kind: "RECEIPT", mimeType: "image/jpeg", can: { ...base.can, openFinanceReview: false } });
    expect(optionFor(denied.options, "FINANCE_INTAKE")).toMatchObject({ availability: "DENIED" });
    const unsupported = mediaRoutingOptions({ ...base, kind: "RECEIPT", mimeType: "image/gif" });
    expect(optionFor(unsupported.options, "FINANCE_INTAKE")).toMatchObject({ availability: "UNAVAILABLE" });
  });

  it("routes a passport only to the traveller's Documents and never to the shared vault", () => {
    const result = mediaRoutingOptions({ ...base, kind: "PASSPORT", mimeType: "image/jpeg" });
    expect(result.options.map((option) => option.destination)).toEqual(["TRAVELLER_DOCUMENTS", "DOWNLOAD"]);
    const denied = mediaRoutingOptions({ ...base, kind: "PASSPORT", mimeType: "image/jpeg", can: { ...base.can, saveToTravellerDocuments: false } });
    expect(optionFor(denied.options, "TRAVELLER_DOCUMENTS")).toMatchObject({ availability: "DENIED" });
  });

  it("offers nothing for a voice note, which has its own transcript and player", () => {
    expect(mediaRoutingOptions({ ...base, kind: "VOICE", mimeType: "audio/ogg" }).options).toEqual([]);
  });

  it("denies saving to Documents for a role that cannot manage the vault, with a reason", () => {
    const result = mediaRoutingOptions({ ...base, can: { ...base.can, saveToVault: false } });
    expect(optionFor(result.options, "PROPOSAL_COLLATERAL")).toMatchObject({
      availability: "DENIED",
      reason: expect.stringMatching(/role/i),
    });
    expect(optionFor(result.options, "DOWNLOAD")).toMatchObject({ availability: "AVAILABLE" });
  });

  it("reports an already-saved file as done instead of offering it again", () => {
    const result = mediaRoutingOptions({ ...base, savedDocumentId: "doc-1" });
    expect(optionFor(result.options, "PROPOSAL_COLLATERAL")).toMatchObject({ availability: "DONE" });
  });

  it("keeps manual download for an Office file the reader cannot open, saves it to Documents, and says why", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const result = mediaRoutingOptions({ ...base, kind: "OTHER", mimeType: docx });
    expect(optionFor(result.options, "DOCUMENTS")).toMatchObject({ availability: "AVAILABLE" });
    expect(optionFor(result.options, "DOWNLOAD")).toMatchObject({ availability: "AVAILABLE" });
    expect(result.limitation).toMatch(/cannot be read automatically/i);
  });

  it("leaves a text file with manual download only and a clear limitation", () => {
    const result = mediaRoutingOptions({ ...base, kind: "OTHER", mimeType: "text/plain" });
    expect(optionFor(result.options, "DOCUMENTS")).toMatchObject({ availability: "UNAVAILABLE", reason: expect.stringMatching(/type/i) });
    expect(optionFor(result.options, "DOWNLOAD")).toMatchObject({ availability: "AVAILABLE" });
    expect(result.limitation).toMatch(/cannot be read automatically/i);
  });

  it("has no limitation for a file the reader can open", () => {
    expect(mediaRoutingOptions(base).limitation).toBeNull();
    expect(mediaRoutingOptions({ ...base, mimeType: "image/png" }).limitation).toBeNull();
  });

  it("marks everything unavailable, with a retention reason, once the Inbox copy is gone", () => {
    const result = mediaRoutingOptions({ ...base, hasOriginal: false });
    for (const option of result.options) {
      expect(option.availability).toBe("UNAVAILABLE");
      expect(option.reason).toMatch(/no longer|still being/i);
    }
  });

  it("refuses an oversized file as a vault save but still allows download", () => {
    const result = mediaRoutingOptions({ ...base, byteSize: INBOX_MEDIA_VAULT_MAX_BYTES + 1 });
    expect(optionFor(result.options, "PROPOSAL_COLLATERAL")).toMatchObject({ availability: "UNAVAILABLE", reason: expect.stringMatching(/too large/i) });
    expect(optionFor(result.options, "DOWNLOAD")).toMatchObject({ availability: "AVAILABLE" });
  });

  it("treats an unknown size as something the server will check, not as too large", () => {
    const result = mediaRoutingOptions({ ...base, byteSize: null });
    expect(optionFor(result.options, "PROPOSAL_COLLATERAL")).toMatchObject({ availability: "AVAILABLE" });
  });

  it("gives every unavailable or denied option a plain reason", () => {
    const inputs: MediaRoutingInput[] = [
      { ...base, can: { ...base.can, saveToVault: false } },
      { ...base, kind: "OTHER", mimeType: "text/plain" },
      { ...base, hasOriginal: false },
      { ...base, kind: "RECEIPT", mimeType: "image/gif" },
    ];
    for (const input of inputs) {
      for (const option of mediaRoutingOptions(input).options) {
        if (option.availability === "DENIED" || option.availability === "UNAVAILABLE") {
          expect(option.reason && option.reason.length > 10).toBe(true);
        }
      }
    }
  });
});
