import { describe, expect, it } from "vitest";

import { cleanExtractedText, extractKnowledgeText, KnowledgeExtractionError, stripPdfPageMarkers } from "./extract";

const encode = (text: string) => new TextEncoder().encode(text);
const NUL = String.fromCharCode(0);
const BOM = String.fromCharCode(0xfeff);
const BELL = String.fromCharCode(7);
const NEWLINE = String.fromCharCode(10);

describe("cleanExtractedText", () => {
  it("removes NUL characters that Postgres text columns reject", () => {
    expect(cleanExtractedText(`Refund${NUL} policy`)).toBe("Refund policy");
  });

  it("removes a byte-order mark and turns stray control characters into spaces", () => {
    expect(cleanExtractedText(`${BOM}Line one${BELL}two`)).toBe("Line one two");
  });

  it("keeps normal line breaks", () => {
    expect(cleanExtractedText(`One${NEWLINE}Two`)).toBe(`One${NEWLINE}Two`);
  });
});

describe("extractKnowledgeText", () => {
  it("reads plain text and markdown", async () => {
    expect(await extractKnowledgeText(encode("# Visa\nBring your passport."), "text/markdown")).toContain("Bring your passport.");
    expect(await extractKnowledgeText(encode("Hello"), "text/plain")).toBe("Hello");
  });

  it("reports an empty text file as a permanent failure", async () => {
    const failure = await extractKnowledgeText(encode("  \n "), "text/plain").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(KnowledgeExtractionError);
    expect((failure as KnowledgeExtractionError).permanent).toBe(true);
  });

  it("rejects a file type it cannot read", async () => {
    await expect(extractKnowledgeText(encode("x"), "application/msword")).rejects.toThrow(/isn't supported/);
  });

  it("reports bytes that are not a PDF as unreadable rather than crashing", async () => {
    const failure = await extractKnowledgeText(encode("this is not a pdf"), "application/pdf").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(KnowledgeExtractionError);
    expect((failure as KnowledgeExtractionError).message).toMatch(/couldn't read this PDF/);
  });
});

/** A one-page PDF. With `text` it carries a real text layer; without, the page is blank, like a scan. */
function buildTestPdf(text: string | null): Uint8Array {
  const stream = text ? `BT /F1 12 Tf 20 100 Td (${text}) Tj ET` : "";
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
    ["4 0 obj<</Length " + stream.length + ">>stream", stream, "endstream endobj"].join(NEWLINE),
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
  ];
  return encode(["%PDF-1.4", ...objects, "trailer<</Root 1 0 R/Size 6>>", "%%EOF"].join(NEWLINE));
}

describe("stripPdfPageMarkers", () => {
  it("removes the page markers pdf-parse adds, and nothing else", () => {
    const withMarkers = ["Refund rules", "", "-- 1 of 2 --", "More text", "-- 2 of 2 --"].join(NEWLINE);
    expect(stripPdfPageMarkers(withMarkers).replace(/\s+/g, " ").trim()).toBe("Refund rules More text");
    expect(stripPdfPageMarkers("Section 1 of 2 parts")).toBe("Section 1 of 2 parts");
  });
});

describe("extractKnowledgeText with real PDFs", () => {
  it("reads the text layer of a digital PDF without page markers", async () => {
    const text = await extractKnowledgeText(buildTestPdf("Refunds are paid within fourteen days of approval"), "application/pdf");
    expect(text).toContain("Refunds are paid within fourteen days");
    expect(text).not.toMatch(/-- \d+ of \d+ --/);
  });

  it("fails a PDF with no text layer, as a scan would", async () => {
    const failure = await extractKnowledgeText(buildTestPdf(null), "application/pdf").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(KnowledgeExtractionError);
    expect((failure as KnowledgeExtractionError).message).toMatch(/no readable text/i);
    expect((failure as KnowledgeExtractionError).permanent).toBe(true);
  });
});
