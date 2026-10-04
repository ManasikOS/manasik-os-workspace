/**
 * Free, local, non-AI passenger-name extraction from a ticket PDF's own text
 * layer — no network call to any model, no per-document cost, nothing to
 * configure. Reads the text pdf-parse pulls straight out of the PDF (the
 * same text you could Ctrl+F in a viewer) and pattern-matches it, rather
 * than asking a vision model to read a picture of the same text.
 *
 * Works only for a digitally generated PDF that actually carries a text
 * layer — an e-ticket, an airline confirmation, a GDS itinerary receipt. A
 * scanned or photographed ticket has no text to read this way; callers
 * should fall back to the AI review (`ticket-visa-ai.ts`, if configured) or
 * manual per-pilgrim assignment for those.
 *
 * IATA/GDS e-tickets overwhelmingly print passenger names as
 * `SURNAME/GIVENNAME[ MIDDLENAME] TITLE` — the one convention every airline
 * and every GDS (Amadeus, Sabre, Galileo) uses on the ticket itself — which
 * is why that pattern is tried first and matched most aggressively. A
 * "Passenger Name: ..." label style is tried second, for confirmation-email
 * PDFs that don't follow the IATA convention.
 */

import type { PDFParse as PdfParser } from "pdf-parse";

export interface PdfTicketExtraction {
  ok: boolean;
  passengerNames: string[];
  /** Flight numbers found anywhere in the text — a soft signal, not authoritative (see `flightNumberAppears`). */
  flightNumbers: string[];
  pnr: string | null;
  /** The PDF's own text, for callers that need to search it themselves (see `locationAppears`). Empty on failure. */
  rawText: string;
  error: string | null;
}

/**
 * `SURNAME/GIVENNAME[ MIDDLENAME][ TITLE]` — both the surname and the given
 * name are matched as their own multi-word groups, not single words. A
 * one-word assumption here used to silently drop part of a name that is
 * routinely two or three words in Sri Lankan, Maldivian and many South Asian
 * naming conventions ("MOHAMED AFRAS/MOHAMED SHAFAATH", "DE SILVA/JOHN") —
 * losing "DE" or the first "MOHAMED" made the name read as someone slightly
 * different rather than the same person with a compound name.
 */
const IATA_NAME = /\b([A-Z][A-Z' -]{1,30}?)\/([A-Z][A-Z' -]{1,40})\b/g;
const TITLE_SUFFIX = /\s+(?:MR|MRS|MS|MSTR|MISS|DR|CHD|INF)$/;
const LABELLED_NAME =
  /(?:passenger(?:\s*name)?|traveler|traveller|pax\s*name|guest\s*name)\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{2,60})/gi;
const FLIGHT_NUMBER = /\b([A-Z]{2}|[0-9][A-Z]|[A-Z][0-9])[\s-]?(\d{2,4})\b/g;
const PNR_PATTERN =
  /(?:\bpnr\b|booking\s*ref(?:erence)?|confirmation\s*(?:code|number)|record\s*locator)\s*[:\-]?\s*([A-Z0-9]{5,8})\b/i;

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Whether a known flight number shows up anywhere in the extracted text, ignoring spacing/hyphens. */
export function flightNumberAppears(text: string, flightNumber: string | null): boolean {
  if (!flightNumber) return false;
  const needle = flightNumber.replace(/[\s-]/g, "").toUpperCase();
  const haystack = text.replace(/[\s-]/g, "").toUpperCase();
  return haystack.includes(needle);
}

/**
 * Whether an airport shows up anywhere in the text — by its 3-letter IATA
 * code OR by its full name/city (some tickets print "Colombo" or "Jeddah"
 * instead of "CMB"/"JED", especially airline-portal-generated confirmations
 * rather than GDS e-tickets). Either counts as a match; only when NEITHER
 * form appears is the airport actually missing from the ticket.
 */
export function locationAppears(
  text: string,
  code: string | null,
  name: string | null,
): boolean {
  const haystack = text.toUpperCase();
  if (code && haystack.includes(code.toUpperCase())) return true;
  if (name) {
    // A name like "Bandaranaike International (Colombo)" — take the first
    // word, since that's the part a ticket is most likely to print verbatim
    // even when it drops the rest ("Colombo" alone, not the full airport name).
    const firstWord = name.trim().split(/\s+/)[0];
    if (firstWord && firstWord.length >= 3 && haystack.includes(firstWord.toUpperCase())) {
      return true;
    }
  }
  return false;
}

function parseText(text: string): Omit<PdfTicketExtraction, "ok" | "error"> {
  const names = new Set<string>();
  for (const match of text.matchAll(IATA_NAME)) {
    const surname = match[1].trim();
    const given = match[2].trim().replace(TITLE_SUFFIX, "").trim();
    names.add(titleCase(`${given} ${surname}`));
  }
  if (names.size === 0) {
    for (const match of text.matchAll(LABELLED_NAME)) {
      names.add(titleCase(match[1].trim()));
    }
  }

  const flightNumbers = new Set<string>();
  for (const match of text.matchAll(FLIGHT_NUMBER)) {
    flightNumbers.add(`${match[1]}${match[2]}`.toUpperCase());
  }

  const pnrMatch = text.match(PNR_PATTERN);

  return {
    passengerNames: Array.from(names),
    flightNumbers: Array.from(flightNumbers),
    pnr: pnrMatch ? pnrMatch[1].toUpperCase() : null,
    rawText: text,
  };
}

/**
 * Extracts identity/flight fields from a PDF's own text layer. Never throws.
 *
 * `pdf-parse` is loaded with a dynamic `import()` *inside* this function, not
 * as a top-level import, and that placement is load-bearing rather than
 * stylistic. `lib/data/departure-groups.ts` imports this module for
 * `extractTicketIdentityFromPdf()` below, and that file also exports
 * `getCurrentStaffRole()` — which `app/(main)/layout.tsx` calls, so it sits in
 * the module graph of *every* authenticated page. A static import here
 * therefore made every route in the app evaluate `pdfjs-dist` at module load,
 * and `pdfjs-dist`'s Node branch runs environment-mutating code at module
 * scope (see `node_modules/pdfjs-dist/legacy/build/pdf.mjs`), including:
 *
 *     if (!globalThis.navigator?.language) {
 *       globalThis.navigator = { language: "en-US", platform: "", userAgent: "" };
 *     }
 *
 * On a Node build where `navigator` exists but carries no `language` (the
 * global was added in Node 21.0, `language` only in 21.2, and it is
 * ICU-dependent), that guard passes and the assignment targets a getter-only
 * accessor from inside an ES module — always strict mode — which throws
 * `TypeError: Cannot set property navigator of #<Object> which has only a
 * getter`. The throw happens while the *route module* is being evaluated, so
 * no `error.tsx` can catch it and no request-time code ever runs: the
 * function dies in tens of milliseconds having made zero outgoing calls,
 * which is exactly the shape of the production `FUNCTION_INVOCATION_FAILED`
 * on `/dashboard` that this indirection fixes. It reproduced on the
 * deployment's Node build and not on the developer's, which is why the app
 * was fine on localhost.
 *
 * Keeping the import behind this call means only the ticket-parsing path
 * pays for the PDF engine — and only that path can ever be broken by it.
 * `next.config.ts`'s `serverExternalPackages` entry still applies: the
 * dynamic import stays a plain runtime `require()` and the file tracer still
 * sees the specifier, so the package is still bundled into the deployment.
 */
export async function extractTicketIdentityFromPdfBytes(
  bytes: Uint8Array,
): Promise<PdfTicketExtraction> {
  let parser: PdfParser | null = null;
  try {
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    const text = result.text || "";

    if (!text.trim()) {
      return {
        ok: false,
        passengerNames: [],
      rawText: "",
        flightNumbers: [],
        pnr: null,
        error:
          "This PDF has no readable text layer — it looks like a scanned image rather than a digital ticket.",
      };
    }

    return { ok: true, ...parseText(text), error: null };
  } catch (cause) {
    return {
      ok: false,
      passengerNames: [],
      rawText: "",
      flightNumbers: [],
      pnr: null,
      error: cause instanceof Error ? cause.message : "Could not read this PDF.",
    };
  } finally {
    await parser?.destroy();
  }
}

interface StorageLike {
  createSignedUrl: (
    path: string,
    ttl: number,
  ) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
}

/** Downloads a staged file and runs it through the free PDF extraction — only meaningful for a `.pdf`. */
export async function extractTicketIdentityFromPdf(
  storage: StorageLike,
  input: { filePath: string; fileName: string },
): Promise<PdfTicketExtraction> {
  if (!input.fileName.toLowerCase().endsWith(".pdf")) {
    return {
      ok: false,
      passengerNames: [],
      rawText: "",
      flightNumbers: [],
      pnr: null,
      error: "Not a PDF — the free text-layer method only reads digital PDF tickets.",
    };
  }

  const { data: signed, error: signError } = await storage.createSignedUrl(input.filePath, 60);
  if (signError || !signed) {
    return {
      ok: false,
      passengerNames: [],
      rawText: "",
      flightNumbers: [],
      pnr: null,
      error: "Could not read the uploaded file.",
    };
  }

  const response = await fetch(signed.signedUrl);
  if (!response.ok) {
    return {
      ok: false,
      passengerNames: [],
      rawText: "",
      flightNumbers: [],
      pnr: null,
      error: "Could not download the uploaded file.",
    };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return extractTicketIdentityFromPdfBytes(bytes);
}
