import { describe, expect, it } from "vitest";

import {
  confirmVaultUploadSchema,
  normalizeVaultCategoryLabel,
  requestVaultUploadUrlSchema,
  stageVaultDocumentInputSchema,
  vaultCategorySchema,
} from "@/lib/validations/vault";

describe("normalizeVaultCategoryLabel", () => {
  it.each(["passport", "Passport", "PASSPORT", "  passport  "])(
    "snaps %s to the suggested category's canonical casing",
    (input) => {
      expect(normalizeVaultCategoryLabel(input)).toBe("Passport");
    },
  );

  it("snaps a multi-word suggested category regardless of casing", () => {
    expect(normalizeVaultCategoryLabel("flight ticket")).toBe("Flight Ticket");
    expect(normalizeVaultCategoryLabel("FLIGHT TICKET")).toBe("Flight Ticket");
  });

  it("title-cases a custom category that isn't in the suggested list", () => {
    expect(normalizeVaultCategoryLabel("boarding pass")).toBe("Boarding Pass");
  });

  it("collapses internal whitespace on a custom category", () => {
    expect(normalizeVaultCategoryLabel("boarding    pass")).toBe("Boarding Pass");
  });

  it("trims leading and trailing whitespace on a custom category", () => {
    expect(normalizeVaultCategoryLabel("  boarding pass  ")).toBe("Boarding Pass");
  });
});

describe("vaultCategorySchema", () => {
  it("rejects an empty category", () => {
    expect(vaultCategorySchema.safeParse("   ").success).toBe(false);
  });

  it("normalizes a valid category through the transform", () => {
    const result = vaultCategorySchema.safeParse("visa");
    expect(result.success && result.data).toBe("Visa");
  });
});

describe("requestVaultUploadUrlSchema", () => {
  it("rejects a zero-byte file", () => {
    const result = requestVaultUploadUrlSchema.safeParse({ category: "Receipt", filename: "a.pdf", mimeType: "application/pdf", byteSize: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed request", () => {
    const result = requestVaultUploadUrlSchema.safeParse({ category: "Receipt", filename: "a.pdf", mimeType: "application/pdf", byteSize: 1024 });
    expect(result.success).toBe(true);
  });
});

describe("confirmVaultUploadSchema", () => {
  it("requires a non-empty title", () => {
    const result = confirmVaultUploadSchema.safeParse({ category: "Receipt", title: "  ", path: "a/b/c.pdf", filename: "c.pdf", mimeType: "application/pdf" });
    expect(result.success).toBe(false);
  });
});

describe("stageVaultDocumentInputSchema", () => {
  it("rejects a malformed conversation id", () => {
    const result = stageVaultDocumentInputSchema.safeParse({ conversationId: "nope", vaultDocumentId: "11111111-1111-4111-8111-111111111111" });
    expect(result.success).toBe(false);
  });

  it("accepts two valid ids", () => {
    const result = stageVaultDocumentInputSchema.safeParse({
      conversationId: "11111111-1111-4111-8111-111111111111",
      vaultDocumentId: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.success).toBe(true);
  });
});
