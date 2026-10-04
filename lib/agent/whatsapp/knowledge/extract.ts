/**
 * Turns an uploaded knowledge file into plain text. PDFs are read from their own text layer with
 * pdf-parse (the same approach as lib/data/ticket-pdf-extraction.ts); a scanned PDF has no text
 * layer and is reported as such rather than guessed at (plan D8: no OCR in v1).
 */

export class KnowledgeExtractionError extends Error {
  /** True when retrying can't help (a scanned PDF stays scanned) — the job should fail once, not three times. */
  readonly permanent: boolean;

  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "KnowledgeExtractionError";
    this.permanent = permanent;
  }
}

const BYTE_ORDER_MARK = 0xfeff;

/**
 * Postgres text columns reject NUL, and a byte-order mark or stray control characters only add noise
 * to search. Line breaks, tabs and carriage returns are kept. Works on character codes so the source
 * file needs no control characters of its own.
 */
export function cleanExtractedText(text: string): string {
  let cleaned = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0) continue;
    if (code === BYTE_ORDER_MARK) continue;
    const isStrayControl = (code >= 1 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31);
    cleaned += isStrayControl ? " " : character;
  }
  return cleaned;
}

/**
 * pdf-parse writes a "-- 1 of 3 --" marker for every page, even a page with no text at all, so a scanned
 * PDF is never literally empty. Strip the markers before judging whether anything readable is left.
 */
export function stripPdfPageMarkers(text: string): string {
  return text.replace(/^[^\S\n]*--[^\S\n]*\d+[^\S\n]+of[^\S\n]+\d+[^\S\n]*--[^\S\n]*$/gm, "");
}

/** Fewer letters and digits than this is a stray page number or watermark, not a document. */
const MIN_READABLE_CHARACTERS = 20;

const UNREADABLE_PDF_MESSAGE =
  "This PDF has no readable text. It looks like a scan or a photo. Upload a PDF saved from a document, or paste the text into a .txt file.";

export async function extractKnowledgeText(bytes: Uint8Array, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") return extractPdfText(bytes);

  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    const text = cleanExtractedText(new TextDecoder("utf-8").decode(bytes));
    if (text.trim().length === 0) throw new KnowledgeExtractionError("This file is empty.", true);
    return text;
  }

  throw new KnowledgeExtractionError("This file type isn't supported. Upload a PDF, a plain text file or a Markdown file.", true);
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let parser: { getText: () => Promise<{ text?: string }>; destroy: () => Promise<void> } | null = null;
  try {
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    const text = stripPdfPageMarkers(cleanExtractedText(result.text ?? ""));
    if (text.replace(/[^\p{L}\p{N}]/gu, "").length < MIN_READABLE_CHARACTERS) {
      throw new KnowledgeExtractionError(UNREADABLE_PDF_MESSAGE, true);
    }
    return text;
  } catch (cause) {
    if (cause instanceof KnowledgeExtractionError) throw cause;
    // A damaged or password-protected PDF won't improve on retry either.
    throw new KnowledgeExtractionError(
      "We couldn't read this PDF. It may be damaged or password-protected. Try saving it again and re-uploading.",
      true,
    );
  } finally {
    await parser?.destroy();
  }
}
