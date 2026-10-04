/**
 * Composes the customer-facing invoice PDF from `lib/pdf.ts`'s low-level
 * primitives. All the actual layout for this one document type lives here —
 * `lib/pdf.ts` stays a general-purpose text/rect/line/image writer, this
 * file is what makes it look like an invoice.
 *
 * Client-only — `PdfDocument` builds a `Blob`, and normalizing the agency
 * logo (whatever format it was uploaded as) into a JPEG the writer can
 * embed goes through `<canvas>`.
 */

import type { InvoiceLetterhead } from "./actions";
import type { InvoiceLineItem } from "./booking-invoice";
import { formatDate, formatExactCurrency } from "./utils";
import { PAGE_WIDTH, PDF_MIME, PdfDocument, parseJpegDimensions, type PdfJpegImage } from "@/lib/pdf";
import { textWidth, wrapText } from "@/lib/pdf-fonts";

const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PAGE_BOTTOM = 800; // leaves room for the footer note
const GREY = [0.45, 0.45, 0.45] as const;
const LIGHT_GREY = [0.9, 0.9, 0.92] as const;
const BLACK = [0, 0, 0] as const;

export interface InvoicePdfInput {
  letterhead: InvoiceLetterhead;
  invoiceNumber: string;
  issuedAt: string | null;
  dueAt: string | null;
  currency: string;
  bookingReference: string;
  primaryContactName: string;
  primaryContactPhone: string;
  groupLabel: string;
  departureDate: string | null;
  travellerCount: number;
  lineItems: InvoiceLineItem[];
  amountPaid: number;
}

/**
 * Fetches whatever image format the logo was uploaded as and re-encodes it
 * as a JPEG via `<canvas>` — the writer only ever needs to embed one format
 * (`DCTDecode`, byte-for-byte, no PNG unfiltering). Never throws: a logo
 * that fails to load (CORS, a bad path, an unsupported SVG) just means the
 * invoice renders with a text-only letterhead instead of blocking on it.
 */
async function normalizeLogo(url: string): Promise<PdfJpegImage | null> {
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Logo image failed to load."));
    });
    image.src = url;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0 || canvas.height === 0) return null;

    // JPEG has no alpha channel — flatten onto white first so a
    // transparent-background PNG logo doesn't turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) return null;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dims = parseJpegDimensions(bytes);
    if (dims.components !== 1 && dims.components !== 3) return null;

    return { bytes, widthPx: dims.widthPx, heightPx: dims.heightPx, components: dims.components };
  } catch {
    return null;
  }
}

/** Scales `w × h` down to fit inside `maxW × maxH`, preserving aspect ratio. */
function containSize(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  const scale = Math.min(maxW / w, maxH / h, 1);
  return { w: w * scale, h: h * scale };
}

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<Blob> {
  const doc = new PdfDocument();
  const logoAsset = input.letterhead.logoUrl ? await normalizeLogo(input.letterhead.logoUrl) : null;
  const logo = logoAsset ? doc.registerImage(logoAsset) : null;

  let y = MARGIN;

  /** Starts a fresh page and resets the cursor, carrying nothing over. */
  const newPage = () => {
    doc.newPage();
    y = MARGIN;
  };

  const ensureSpace = (height: number) => {
    if (y + height > PAGE_BOTTOM) newPage();
  };

  /* ── Letterhead ────────────────────────────────────────────────────── */
  const logoBoxSize = 50;
  let textLeft = MARGIN;
  if (logo && logoAsset) {
    const fitted = containSize(logoAsset.widthPx, logoAsset.heightPx, logoBoxSize, logoBoxSize);
    doc.image(logo, MARGIN, y, fitted.w, fitted.h);
    textLeft = MARGIN + logoBoxSize + 12;
  }

  doc.text(textLeft, y + 12, input.letterhead.agencyName, { font: "Helvetica-Bold", size: 15 });
  let leftY = y + 28;
  if (input.letterhead.legalName && input.letterhead.legalName !== input.letterhead.agencyName) {
    doc.text(textLeft, leftY, input.letterhead.legalName, { size: 9, color: [...GREY] });
    leftY += 12;
  }
  if (input.letterhead.officeAddress) {
    for (const line of wrapText(input.letterhead.officeAddress, "Helvetica", 9, 260)) {
      doc.text(textLeft, leftY, line, { size: 9, color: [...GREY] });
      leftY += 12;
    }
  }
  if (input.letterhead.registrationNumber) {
    doc.text(textLeft, leftY, `Reg. ${input.letterhead.registrationNumber}`, { size: 9, color: [...GREY] });
    leftY += 12;
  }
  if (input.letterhead.primaryEmail) {
    doc.text(textLeft, leftY, input.letterhead.primaryEmail, { size: 9, color: [...GREY] });
    leftY += 12;
  }

  const rightX = PAGE_WIDTH - MARGIN;
  const rightAt = (text: string, size: number, lineY: number, font: "Helvetica" | "Helvetica-Bold" = "Helvetica") =>
    doc.text(rightX - textWidth(text, font, size), lineY, text, { font, size });

  rightAt("INVOICE", 16, y + 12, "Helvetica-Bold");
  rightAt(input.invoiceNumber, 10, y + 28);
  rightAt(`Issued ${formatDate(input.issuedAt)}`, 9, y + 42);
  if (input.dueAt) rightAt(`Due ${formatDate(input.dueAt)}`, 9, y + 54);

  y = Math.max(leftY, y + 62) + 10;
  doc.line(MARGIN, y, rightX, y, { color: [...LIGHT_GREY] });
  y += 18;

  /* ── Bill to / booking facts ──────────────────────────────────────── */
  doc.text(MARGIN, y, "Bill to", { size: 8, color: [...GREY] });
  doc.text(MARGIN, y + 13, input.primaryContactName, { font: "Helvetica-Bold", size: 11 });
  doc.text(MARGIN, y + 26, input.primaryContactPhone, { size: 9, color: [...GREY] });

  doc.text(rightX - 220, y, "Booking", { size: 8, color: [...GREY] });
  doc.text(
    rightX - 220,
    y + 13,
    `${input.bookingReference} · ${input.groupLabel}`,
    { size: 10 },
  );
  doc.text(
    rightX - 220,
    y + 26,
    `${input.departureDate ? `Departs ${formatDate(input.departureDate)} · ` : ""}${input.travellerCount} traveller${input.travellerCount === 1 ? "" : "s"}`,
    { size: 9, color: [...GREY] },
  );

  y += 45;
  doc.line(MARGIN, y, rightX, y, { color: [...LIGHT_GREY] });
  y += 14;

  /* ── Line items, grouped by traveller ────────────────────────────── */
  const amountColX = rightX - 90;
  const descriptionWidth = amountColX - MARGIN - 20;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 18, { fill: [...LIGHT_GREY] });
  doc.text(MARGIN + 6, y + 13, "Description", { font: "Helvetica-Bold", size: 8 });
  rightAt("Amount", 8, y + 13, "Helvetica-Bold");
  y += 26;

  let subtotal = 0;
  const byTraveller = new Map<string, InvoiceLineItem[]>();
  for (const item of input.lineItems) {
    const list = byTraveller.get(item.travellerName) ?? [];
    list.push(item);
    byTraveller.set(item.travellerName, list);
  }

  for (const [travellerName, items] of byTraveller) {
    ensureSpace(20);
    doc.text(MARGIN, y, travellerName.toUpperCase(), { font: "Helvetica-Bold", size: 8, color: [...GREY] });
    y += 14;

    for (const item of items) {
      const lineTotal = item.quantity * item.unitAmount;
      subtotal += lineTotal;

      const titleLines = wrapText(item.title, "Helvetica", 9, descriptionWidth);
      ensureSpace(titleLines.length * 12 + item.details.length * 10 + 6);

      doc.text(MARGIN + 6, y, titleLines[0] ?? "", { size: 9 });
      rightAt(formatExactCurrency(lineTotal, input.currency), 9, y);
      y += 12;
      for (const extra of titleLines.slice(1)) {
        doc.text(MARGIN + 6, y, extra, { size: 9 });
        y += 12;
      }
      for (const detail of item.details) {
        for (const line of wrapText(detail, "Helvetica", 8, descriptionWidth - 10)) {
          doc.text(MARGIN + 14, y, line, { size: 8, color: [...GREY] });
          y += 10;
        }
      }
      y += 4;
    }
  }

  y += 6;
  doc.line(MARGIN, y, rightX, y, { color: [...BLACK], lineWidth: 1 });
  y += 18;

  /* ── Totals ───────────────────────────────────────────────────────── */
  ensureSpace(60);
  const balanceDue = Math.max(subtotal - input.amountPaid, 0);

  doc.text(amountColX - 90, y, "Subtotal", { size: 9, color: [...GREY] });
  rightAt(formatExactCurrency(subtotal, input.currency), 9, y);
  y += 14;

  if (input.amountPaid > 0) {
    doc.text(amountColX - 90, y, "Paid", { size: 9, color: [...GREY] });
    rightAt(`-${formatExactCurrency(input.amountPaid, input.currency)}`, 9, y);
    y += 14;
  }

  doc.text(amountColX - 90, y, "Balance due", { font: "Helvetica-Bold", size: 11 });
  rightAt(formatExactCurrency(balanceDue, input.currency), 11, y, "Helvetica-Bold");
  y += 24;

  if (input.letterhead.invoiceFooter.trim()) {
    ensureSpace(30);
    doc.line(MARGIN, y, rightX, y, { color: [...LIGHT_GREY] });
    y += 14;
    for (const line of wrapText(input.letterhead.invoiceFooter, "Helvetica", 8, CONTENT_WIDTH)) {
      ensureSpace(10);
      doc.text(MARGIN, y, line, { size: 8, color: [...GREY] });
      y += 10;
    }
  }

  return doc.toBlob();
}

export { PDF_MIME };
