import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_MAX_FILE_BYTES,
  knowledgeArticleSchema,
  knowledgeDocumentIdSchema,
  knowledgeUploadSchema,
  registerKnowledgeDocumentSchema,
  setKnowledgeDocumentActiveSchema,
} from "./knowledge-base";

const VALID_UPLOAD = {
  title: "Cancellation policy",
  documentKind: "POLICY",
  language: "en",
  fileName: "cancellation-policy.pdf",
  mimeType: "application/pdf",
  byteSize: 250_000,
};

describe("knowledgeUploadSchema", () => {
  it("accepts a well-formed upload", () => {
    expect(knowledgeUploadSchema.safeParse(VALID_UPLOAD).success).toBe(true);
  });

  it("trims the title and rejects a blank one with a plain-language message", () => {
    const trimmed = knowledgeUploadSchema.parse({ ...VALID_UPLOAD, title: "  Refund terms  " });
    expect(trimmed.title).toBe("Refund terms");

    const blank = knowledgeUploadSchema.safeParse({ ...VALID_UPLOAD, title: "   " });
    expect(blank.success).toBe(false);
    if (!blank.success) expect(blank.error.issues[0].message).toMatch(/title/i);
  });

  it("rejects a title over 200 characters", () => {
    expect(knowledgeUploadSchema.safeParse({ ...VALID_UPLOAD, title: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects file types the storage bucket would refuse", () => {
    for (const mimeType of ["application/msword", "image/png", "application/zip", ""]) {
      expect(knowledgeUploadSchema.safeParse({ ...VALID_UPLOAD, mimeType }).success).toBe(false);
    }
  });

  it("accepts text and markdown", () => {
    for (const mimeType of ["text/plain", "text/markdown"]) {
      expect(knowledgeUploadSchema.safeParse({ ...VALID_UPLOAD, mimeType }).success).toBe(true);
    }
  });

  it("enforces the 10 MB limit exactly at the boundary", () => {
    expect(knowledgeUploadSchema.safeParse({ ...VALID_UPLOAD, byteSize: KNOWLEDGE_MAX_FILE_BYTES }).success).toBe(true);
    expect(knowledgeUploadSchema.safeParse({ ...VALID_UPLOAD, byteSize: KNOWLEDGE_MAX_FILE_BYTES + 1 }).success).toBe(false);
  });

  it("rejects an empty or fractional file size", () => {
    expect(knowledgeUploadSchema.safeParse({ ...VALID_UPLOAD, byteSize: 0 }).success).toBe(false);
    expect(knowledgeUploadSchema.safeParse({ ...VALID_UPLOAD, byteSize: 10.5 }).success).toBe(false);
  });

  it("rejects an unknown document kind or language", () => {
    expect(knowledgeUploadSchema.safeParse({ ...VALID_UPLOAD, documentKind: "PRICE_LIST" }).success).toBe(false);
    expect(knowledgeUploadSchema.safeParse({ ...VALID_UPLOAD, language: "fr" }).success).toBe(false);
  });
});

describe("registerKnowledgeDocumentSchema", () => {
  it("requires the storage path of the uploaded file", () => {
    expect(registerKnowledgeDocumentSchema.safeParse(VALID_UPLOAD).success).toBe(false);
    expect(
      registerKnowledgeDocumentSchema.safeParse({ ...VALID_UPLOAD, storagePath: "agency-1/file.pdf" }).success,
    ).toBe(true);
  });
});

describe("knowledgeArticleSchema", () => {
  const ARTICLE = {
    title: "Refund rules",
    documentKind: "POLICY",
    language: "en",
    body: "Refunds are paid within 14 days of a cancellation being confirmed.",
  };

  it("accepts a new article and an edit of an existing one", () => {
    expect(knowledgeArticleSchema.safeParse(ARTICLE).success).toBe(true);
    expect(
      knowledgeArticleSchema.safeParse({ ...ARTICLE, documentId: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e" }).success,
    ).toBe(true);
  });

  it("rejects a body that is too short or too long, with a plain message", () => {
    const short = knowledgeArticleSchema.safeParse({ ...ARTICLE, body: "Too short." });
    expect(short.success).toBe(false);
    if (!short.success) expect(short.error.issues[0].message).toMatch(/couple of sentences/);
    expect(knowledgeArticleSchema.safeParse({ ...ARTICLE, body: "x".repeat(20_001) }).success).toBe(false);
  });

  it("rejects a malformed document id", () => {
    expect(knowledgeArticleSchema.safeParse({ ...ARTICLE, documentId: "nope" }).success).toBe(false);
  });
});

describe("knowledge document id schemas", () => {
  it("requires a UUID", () => {
    expect(knowledgeDocumentIdSchema.safeParse({ documentId: "not-a-uuid" }).success).toBe(false);
    expect(knowledgeDocumentIdSchema.safeParse({ documentId: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e" }).success).toBe(true);
  });

  it("requires an explicit boolean when pausing or resuming", () => {
    const documentId = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
    expect(setKnowledgeDocumentActiveSchema.safeParse({ documentId }).success).toBe(false);
    expect(setKnowledgeDocumentActiveSchema.safeParse({ documentId, isActive: "yes" }).success).toBe(false);
    expect(setKnowledgeDocumentActiveSchema.safeParse({ documentId, isActive: false }).success).toBe(true);
  });
});
