import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseEmbeddingResponse, toPgVector, EmbeddingError } = await import("./embeddings");

const vec = (fill: number, length = 1024) => Array.from({ length }, () => fill);

describe("parseEmbeddingResponse", () => {
  it("returns vectors in input order even if the service reorders them", () => {
    const body = { data: [{ index: 1, embedding: vec(2) }, { index: 0, embedding: vec(1) }] };
    const result = parseEmbeddingResponse(body, 2);
    expect(result[0][0]).toBe(1);
    expect(result[1][0]).toBe(2);
  });

  it("rejects a wrong count, a wrong size and a malformed body", () => {
    expect(() => parseEmbeddingResponse({ data: [{ index: 0, embedding: vec(1) }] }, 2)).toThrow(EmbeddingError);
    expect(() => parseEmbeddingResponse({ data: [{ index: 0, embedding: vec(1, 768) }] }, 1)).toThrow(/768 dimensions/);
    expect(() => parseEmbeddingResponse(null, 1)).toThrow(EmbeddingError);
  });
});

describe("toPgVector", () => {
  it("formats the pgvector text literal", () => {
    expect(toPgVector([0.5, -1, 2])).toBe("[0.5,-1,2]");
  });
});
