/**
 * Minimal, dependency-free PDF writer, in the same spirit as `lib/xlsx.ts`:
 * a PDF is a flat list of numbered objects, a page tree, per-page content
 * streams, and an xref table. For text + rules + a table + one logo image,
 * that is tractable by hand — the 14 standard Type1 fonts (Helvetica,
 * Helvetica-Bold) need no embedding, so the hard part of PDF generation
 * (font subsetting) never comes up. A JPEG can be dropped straight into an
 * Image XObject via `/Filter /DCTDecode` with no re-encoding.
 *
 * Scope is deliberately small — one page size, two fonts, straight text,
 * filled/stroked rectangles, lines, and JPEG images. It is not a general
 * PDF library; `app/(main)/departure-groups/invoice-pdf.ts` is where the
 * actual invoice layout lives, built on these primitives.
 *
 * Client-only — it uses `Blob`. Import it from client components.
 */

import type { PdfFontName } from "./pdf-fonts";

export const PDF_MIME = "application/pdf";

/** A4 in points (1/72 inch), the only page size this writer supports. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

export type PdfColor = [number, number, number]; // 0–1 RGB

export interface PdfTextOptions {
  font?: PdfFontName;
  size?: number;
  color?: PdfColor;
}

export interface PdfRectOptions {
  fill?: PdfColor;
  stroke?: PdfColor;
  lineWidth?: number;
}

export interface PdfLineOptions {
  color?: PdfColor;
  lineWidth?: number;
}

/** A JPEG decoded just enough to embed: its own bytes plus pixel size. */
export interface PdfJpegImage {
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** 1 = grayscale, 3 = RGB. Anything else is rejected by `registerImage`. */
  components: 1 | 3;
}

/** Reads width/height/component-count out of a JPEG's SOF marker. */
export function parseJpegDimensions(bytes: Uint8Array): {
  widthPx: number;
  heightPx: number;
  components: number;
} {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Not a JPEG file (missing SOI marker).");
  }
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    // Markers with no payload.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;

    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isSof) {
      const heightPx = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const widthPx = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const components = bytes[offset + 7];
      return { widthPx, heightPx, components };
    }
    offset += length;
  }
  throw new Error("No SOF marker found — not a baseline/progressive JPEG.");
}

/* ── Byte helpers ─────────────────────────────────────────────────────────── */

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Encodes a JS string as Latin-1 bytes (one byte per char code, clamped). */
function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i] = code <= 0xff ? code : 0x3f; // '?' for anything outside Latin-1
  }
  return out;
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Escapes a string for a PDF literal `(...)` and drops control characters. */
function escapePdfLiteral(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/[\x00-\x09\x0b-\x1f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/* ── Document ─────────────────────────────────────────────────────────────── */

interface PdfPage {
  contentOps: string[];
}

interface RegisteredImage {
  resourceName: string;
  objId: number;
  widthPx: number;
  heightPx: number;
  bytes: Uint8Array;
  components: 1 | 3;
}

const FONT_RESOURCE: Record<PdfFontName, string> = {
  Helvetica: "/F1",
  "Helvetica-Bold": "/F2",
};

/**
 * A single PDF document. Coordinates passed to `text`/`rect`/`line`/`image`
 * are measured from the page's top-left corner in points — the writer
 * flips them into PDF's bottom-left-origin space internally, so callers
 * never think in PDF coordinates.
 */
export class PdfDocument {
  private pages: PdfPage[] = [];
  private images: RegisteredImage[] = [];

  constructor() {
    this.pages.push({ contentOps: [] });
  }

  private get current(): PdfPage {
    return this.pages[this.pages.length - 1];
  }

  newPage(): void {
    this.pages.push({ contentOps: [] });
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Registers a JPEG for reuse across `image()` calls; call once per asset. */
  registerImage(jpeg: PdfJpegImage): PdfJpegImage & { resourceName: string } {
    if (jpeg.components !== 1 && jpeg.components !== 3) {
      throw new Error("Only grayscale or RGB JPEGs can be embedded.");
    }
    const resourceName = `/Im${this.images.length + 1}`;
    this.images.push({
      resourceName,
      objId: -1, // assigned during finalize()
      widthPx: jpeg.widthPx,
      heightPx: jpeg.heightPx,
      bytes: jpeg.bytes,
      components: jpeg.components,
    });
    return { ...jpeg, resourceName };
  }

  text(x: number, yFromTop: number, value: string, opts: PdfTextOptions = {}): void {
    const font = opts.font ?? "Helvetica";
    const size = opts.size ?? 10;
    const [r, g, b] = opts.color ?? [0, 0, 0];
    const y = PAGE_HEIGHT - yFromTop;
    this.current.contentOps.push(
      `BT ${FONT_RESOURCE[font]} ${fmt(size)} Tf ${fmt(r)} ${fmt(g)} ${fmt(b)} rg ${fmt(x)} ${fmt(y)} Td (${escapePdfLiteral(value)}) Tj ET`,
    );
  }

  rect(x: number, yFromTop: number, w: number, h: number, opts: PdfRectOptions = {}): void {
    const y = PAGE_HEIGHT - yFromTop - h;
    const parts: string[] = [];
    if (opts.fill) parts.push(`${opts.fill.map(fmt).join(" ")} rg`);
    if (opts.stroke) {
      parts.push(`${opts.stroke.map(fmt).join(" ")} RG`);
      parts.push(`${fmt(opts.lineWidth ?? 1)} w`);
    }
    parts.push(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re`);
    parts.push(opts.fill && opts.stroke ? "B" : opts.fill ? "f" : "S");
    this.current.contentOps.push(parts.join(" "));
  }

  line(x1: number, y1FromTop: number, x2: number, y2FromTop: number, opts: PdfLineOptions = {}): void {
    const color = opts.color ?? [0, 0, 0];
    const y1 = PAGE_HEIGHT - y1FromTop;
    const y2 = PAGE_HEIGHT - y2FromTop;
    this.current.contentOps.push(
      `${color.map(fmt).join(" ")} RG ${fmt(opts.lineWidth ?? 1)} w ${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S`,
    );
  }

  /** Draws a previously `registerImage()`d asset at the given size, in points. */
  image(asset: { resourceName: string }, x: number, yFromTop: number, w: number, h: number): void {
    const y = PAGE_HEIGHT - yFromTop - h;
    this.current.contentOps.push(
      `q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(y)} cm ${asset.resourceName} Do Q`,
    );
  }

  /** Serializes the document to bytes and wraps it as a downloadable Blob. */
  toBlob(): Blob {
    const objects: Uint8Array[] = []; // index i holds object (i+1)'s full body
    const push = (bytes: Uint8Array) => {
      objects.push(bytes);
      return objects.length; // 1-based id just assigned
    };

    // Reserve ids: 1=Catalog, 2=Pages, 3=Helvetica, 4=Helvetica-Bold, then images.
    push(ascii("")); // placeholder for Catalog (id 1)
    push(ascii("")); // placeholder for Pages (id 2)
    const helveticaId = push(
      ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    );
    const helveticaBoldId = push(
      ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
    );

    for (const img of this.images) {
      const colorSpace = img.components === 1 ? "/DeviceGray" : "/DeviceRGB";
      const header = ascii(
        `<< /Type /XObject /Subtype /Image /Width ${img.widthPx} /Height ${img.heightPx} ` +
          `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`,
      );
      const footer = ascii("\nendstream");
      img.objId = push(concatBytes([header, img.bytes, footer]));
    }

    const imageResourceEntries = this.images
      .map((img) => `${img.resourceName} ${img.objId} 0 R`)
      .join(" ");
    const resourcesDict =
      `<< /Font << /F1 ${helveticaId} 0 R /F2 ${helveticaBoldId} 0 R >>` +
      (this.images.length > 0 ? ` /XObject << ${imageResourceEntries} >>` : "") +
      ` >>`;

    const pageIds: number[] = [];
    for (const page of this.pages) {
      // Content streams carry text literals in WinAnsi/Latin-1, not UTF-8 —
      // TextEncoder would multi-byte-encode any accented character and
      // desync every Tj string from what the font's encoding expects.
      const content = latin1Bytes(page.contentOps.join("\n"));
      const contentId = push(
        concatBytes([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii("\nendstream")]),
      );
      const pageId = push(
        ascii(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(PAGE_WIDTH)} ${fmt(PAGE_HEIGHT)}] /Resources ${resourcesDict} /Contents ${contentId} 0 R >>`,
        ),
      );
      pageIds.push(pageId);
    }

    objects[0] = ascii(`<< /Type /Catalog /Pages 2 0 R >>`);
    objects[1] = ascii(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
    );

    // Serialize: header, each object with its offset recorded, xref, trailer.
    const parts: Uint8Array[] = [ascii("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
    const offsets: number[] = [];
    let runningOffset = parts[0].length;

    for (let i = 0; i < objects.length; i++) {
      offsets.push(runningOffset);
      const wrapped = concatBytes([ascii(`${i + 1} 0 obj\n`), objects[i], ascii("\nendobj\n")]);
      parts.push(wrapped);
      runningOffset += wrapped.length;
    }

    const xrefOffset = runningOffset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    parts.push(ascii(xref));
    parts.push(ascii(trailer));

    return new Blob([concatBytes(parts) as BlobPart], { type: PDF_MIME });
  }
}
