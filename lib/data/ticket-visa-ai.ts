/**
 * AI review for an uploaded flight ticket or an issued visa — pure,
 * store-passing, same posture as `lib/data/documents-ai.ts`: assistive only,
 * never final authority. Nothing here sets `visa_status`; the one exception
 * is `flight_status`, which is nudged to the `NAME_MISMATCH` value it already
 * had a slot for — everything else is a finding for a human to act on.
 *
 * Routed through OpenRouter (an API gateway in front of many model
 * providers) rather than calling a provider SDK directly, so the model in
 * use can be swapped via `OPENROUTER_MODEL` without a code change. This is a
 * deliberate difference from `documents-ai.ts`, which calls Anthropic
 * directly — the two pipelines are independent and can evolve separately.
 *
 * Gracefully inert without `OPENROUTER_API_KEY`: `isTicketVisaAiConfigured()`
 * gates every call site, exactly like `documents-ai.ts`'s `isAiConfigured()`.
 */

import { openRouterProviderPreferences } from "@/lib/ai/openrouter-privacy";
import type { AiReviewIssue } from "@/lib/types/departure-groups";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** A widely-available OpenRouter vision model — override via env without a redeploy. */
const DEFAULT_MODEL = "google/gemini-3.8-flash";

export function isTicketVisaAiConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

function modelId(): string {
  return process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
}

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

/**
 * OpenRouter's vision models accept `application/pdf` and common raster
 * images, but not HEIC — the same gap `documents-ai.ts` has to work around,
 * because it is a limitation of every hosted vision model, not one provider.
 */
function mimeTypeFor(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext ? (EXTENSION_MIME[ext] ?? null) : null;
}

export interface TicketVisaAiOutcome {
  ok: boolean;
  extracted: Record<string, string>;
  issues: AiReviewIssue[];
  error: string | null;
}

interface StorageLike {
  createSignedUrl: (
    path: string,
    ttl: number,
  ) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
}

/** Structured findings the model must return, for either document kind. */
const REVIEW_SCHEMA_DESCRIPTION = `Respond with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:
{
  "extracted": { <field name>: <string value>, ... },
  "issues": [ { "code": string, "severity": "INFO" | "WARNING" | "CRITICAL", "message": string }, ... ]
}
"extracted" holds every field you can read off the document (passenger name, passport/ID number, flight number(s), airline(s), travel date(s), route(s), PNR, visa number, visa expiry — whatever the document actually shows; omit a key entirely if the document doesn't show it).
"issues" holds one entry per problem you find when comparing the document against the facts given to you below. An exact, unremarkable match produces NO issue for that fact — only report something a human needs to look at. If everything matches, return an empty "issues" array.`;

/** The one HTTP call, shared by every prompt shape this module sends — parses only as far as "here is the JSON object the model returned." */
async function callOpenRouterJson(
  systemPrompt: string,
  userPrompt: string,
  base64: string,
  mimeType: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const isPdf = mimeType === "application/pdf";
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      // OpenRouter asks for these on every request for its own rankings/analytics.
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://royalalfathima.travel",
      // Header values must be Latin-1 (ByteString) — no em-dash or other
      // non-ASCII punctuation here, or `fetch()` throws before the request
      // ever goes out.
      "X-Title": "Royal Al-Fathima CRM - Ticket/Visa Review",
    },
    body: JSON.stringify({
      ...openRouterProviderPreferences(),
      model: modelId(),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            isPdf
              ? { type: "file", file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${base64}` } }
              : { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      error: `OpenRouter request failed (${response.status}): ${body.slice(0, 300) || response.statusText}`,
    };
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    error?: { message?: string };
  };
  if (payload.error) {
    return { ok: false, error: payload.error.message || "OpenRouter returned an error." };
  }

  const text = payload.choices?.[0]?.message?.content;
  if (!text) return { ok: false, error: "No analysis returned." };

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: "The analysis response could not be read." };
  }
}

/** The `{extracted, issues}` shape both `analyseTicket()` and `analyseVisa()` ask for. */
async function callOpenRouterVision(
  systemPrompt: string,
  userPrompt: string,
  base64: string,
  mimeType: string,
): Promise<
  | { ok: true; extracted: Record<string, string>; issues: AiReviewIssue[] }
  | { ok: false; error: string }
> {
  const result = await callOpenRouterJson(systemPrompt, userPrompt, base64, mimeType);
  if (!result.ok) return result;
  const parsed = result.data as { extracted?: Record<string, string>; issues?: AiReviewIssue[] };
  return {
    ok: true,
    extracted: parsed.extracted ?? {},
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
  };
}

/** Downloads the uploaded file server-side via a fresh short-lived signed URL. */
async function fetchFileAsBase64(
  storage: StorageLike,
  filePath: string,
  fileName: string,
): Promise<{ ok: true; base64: string; mimeType: string } | { ok: false; error: string }> {
  const mimeType = mimeTypeFor(fileName);
  if (!mimeType) {
    const isHeic = fileName.toLowerCase().endsWith(".heic");
    return {
      ok: false,
      error: isHeic
        ? "HEIC photos aren't supported by the AI review yet — ask for a JPG, PNG or PDF instead."
        : "That file type isn't supported by the AI review.",
    };
  }

  const { data: signed, error: signError } = await storage.createSignedUrl(filePath, 60);
  if (signError || !signed) return { ok: false, error: "Could not read the uploaded file." };

  const fileResponse = await fetch(signed.signedUrl);
  if (!fileResponse.ok) return { ok: false, error: "Could not download the uploaded file." };
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  return { ok: true, base64: bytes.toString("base64"), mimeType };
}

export interface ExtractTicketIdentityOutcome {
  ok: boolean;
  /** Every passenger name found on the document — a group e-ticket often lists more than one. */
  passengerNames: string[];
  extracted: Record<string, string>;
  error: string | null;
}

/**
 * Reads a ticket with no pilgrim to compare it against yet — the first step
 * of bulk "Upload Tickets", where a whole batch is dropped in at once and
 * each file has to say who it belongs to before it can be filed and reviewed
 * with `analyseTicket()`. Deliberately a separate, simpler prompt rather than
 * calling `analyseTicket()` with a placeholder name: asking the model to
 * compare against a name it wasn't actually given would either invent a
 * mismatch or silently ignore the comparison, neither of which is what a
 * "who is this" question should produce.
 */
export async function extractTicketIdentity(
  storage: StorageLike,
  input: { filePath: string; fileName: string },
): Promise<ExtractTicketIdentityOutcome> {
  if (!isTicketVisaAiConfigured()) {
    return { ok: false, passengerNames: [], extracted: {}, error: "The AI ticket review is not configured for this environment." };
  }

  const file = await fetchFileAsBase64(storage, input.filePath, input.fileName);
  if (!file.ok) return { ok: false, passengerNames: [], extracted: {}, error: file.error };

  const systemPrompt = `You are a ticketing desk assistant for a Hajj/Umrah travel agency. You read one uploaded flight ticket/e-ticket and report who it belongs to — nothing else yet.

Respond with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:
{
  "passenger_names": [string, ...],
  "extracted": { <field name>: <string value>, ... }
}
"passenger_names" lists every traveller named on the document, exactly as printed (a single-passenger ticket has one entry; a group itinerary listing several travellers has one entry per traveller). If you cannot read a name at all, return an empty array.
"extracted" holds every other field you can read off the document (flight number(s), airline(s), travel date(s), route(s), PNR — whatever it actually shows).`;

  const userPrompt = `Read the attached ticket and list every passenger name it shows, plus whatever flight details you can read.`;

  const result = await callOpenRouterJson(systemPrompt, userPrompt, file.base64, file.mimeType);
  if (!result.ok) return { ok: false, passengerNames: [], extracted: {}, error: result.error };

  const parsed = result.data as { passenger_names?: unknown; extracted?: Record<string, string> };
  const passengerNames = Array.isArray(parsed.passenger_names)
    ? parsed.passenger_names.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    : [];
  return { ok: true, passengerNames, extracted: parsed.extracted ?? {}, error: null };
}

export interface AnalyseTicketInput {
  filePath: string;
  fileName: string;
  pilgrimName: string;
  passportNumber: string | null;
  /** The group's own booked legs — a ticket is checked against whichever of these exist. */
  outboundFlight: {
    airline: string;
    flightNumber: string | null;
    departureAt: string;
    originCode: string;
    originName: string;
    destinationCode: string;
    destinationName: string;
    pnr: string | null;
  } | null;
  returnFlight: {
    airline: string;
    flightNumber: string | null;
    departureAt: string;
    originCode: string;
    originName: string;
    destinationCode: string;
    destinationName: string;
    pnr: string | null;
  } | null;
}

function flightSummary(
  label: string,
  flight: AnalyseTicketInput["outboundFlight"],
): string {
  if (!flight) return `${label}: not yet booked on the group.`;
  const origin = flight.originName
    ? `${flight.originCode}/${flight.originName}`
    : flight.originCode;
  const destination = flight.destinationName
    ? `${flight.destinationCode}/${flight.destinationName}`
    : flight.destinationCode;
  return `${label}: ${flight.airline}${flight.flightNumber ? ` ${flight.flightNumber}` : ""}, ${origin} → ${destination}, departing ${flight.departureAt}${flight.pnr ? `, PNR ${flight.pnr}` : ""}.`;
}

/**
 * Shared guidance both ticket and visa reviews need: a ticket's own printed
 * conventions are not evidence of a mismatch on their own. Without this,
 * "SURNAME/GIVENNAME" ticket formatting and a spelled-out city instead of an
 * airport code were both liable to be reported as a discrepancy when they're
 * just how the document happens to be laid out.
 */
const MATCHING_GUIDANCE = `When comparing names: word order does not matter — airline tickets routinely print SURNAME/GIVENNAME (e.g. "MOHAMED AFRAS/MOHAMED SHAFAATH" is the same person as "Mohamed Shafaath Mohamed Afras" on file, just reordered), and a compound surname or given name may be split or reordered around the "/". Only report NAME_MISMATCH when the actual set of name parts differs, not when they are merely in a different order or arrangement.
When comparing locations: a ticket may print the full city or airport name instead of the 3-letter IATA code (e.g. "Colombo" for CMB, "Jeddah" for JED) — treat the code and its city/airport name as equivalent, and only report a route problem when neither form of the expected location appears at all.`;

/** Runs one uploaded ticket through the review. Never throws — a model or network failure comes back as `{ok:false}`. */
export async function analyseTicket(
  storage: StorageLike,
  input: AnalyseTicketInput,
): Promise<TicketVisaAiOutcome> {
  if (!isTicketVisaAiConfigured()) {
    return { ok: false, extracted: {}, issues: [], error: "The AI ticket review is not configured for this environment." };
  }

  const file = await fetchFileAsBase64(storage, input.filePath, input.fileName);
  if (!file.ok) return { ok: false, extracted: {}, issues: [], error: file.error };

  const systemPrompt = `You are a ticketing desk assistant for a Hajj/Umrah travel agency. You read one uploaded flight ticket/e-ticket and check it against the facts you are given about the traveller and the group's booked flight(s). You never approve or reject anything — you only report what you found and what looks wrong, for a human coordinator to act on.

${REVIEW_SCHEMA_DESCRIPTION}

Use these issue codes where they apply: "NAME_MISMATCH" (the passenger name on the ticket does not match the traveller on file), "FLIGHT_DETAILS_MISMATCH" (airline, flight number, date or route on the ticket does not match the group's booked flight), "PNR_MISMATCH" (the ticket shows a PNR/booking reference and a PNR was given to you above for that leg, but they don't match), "MISSING_FIELD" (a field you'd expect on a ticket is not legible or not present), "OTHER".

${MATCHING_GUIDANCE}`;

  const userPrompt = `Traveller on file: ${input.pilgrimName}${input.passportNumber ? `, passport ${input.passportNumber}` : ""}.
${flightSummary("Group outbound flight", input.outboundFlight)}
${flightSummary("Group return flight", input.returnFlight)}

Read the attached ticket and compare the passenger name and every flight segment it shows against the facts above.`;

  const result = await callOpenRouterVision(systemPrompt, userPrompt, file.base64, file.mimeType);
  if (!result.ok) return { ok: false, extracted: {}, issues: [], error: result.error };
  return { ok: true, extracted: result.extracted, issues: result.issues, error: null };
}

export interface AnalyseVisaInput {
  filePath: string;
  fileName: string;
  pilgrimName: string;
  passportNumber: string | null;
  passportExpiry: string | null;
  visaId: string | null;
  groupReturnDate: string;
}

/** Runs one issued visa through the review. Never throws. */
export async function analyseVisa(
  storage: StorageLike,
  input: AnalyseVisaInput,
): Promise<TicketVisaAiOutcome> {
  if (!isTicketVisaAiConfigured()) {
    return { ok: false, extracted: {}, issues: [], error: "The AI visa review is not configured for this environment." };
  }

  const file = await fetchFileAsBase64(storage, input.filePath, input.fileName);
  if (!file.ok) return { ok: false, extracted: {}, issues: [], error: file.error };

  const systemPrompt = `You are a visa desk assistant for a Hajj/Umrah travel agency. You read one uploaded visa copy and check it against the facts you are given about the traveller and the trip. You never approve, reject or verify anything — you only report what you found and what looks wrong, for a human coordinator to act on.

${REVIEW_SCHEMA_DESCRIPTION}

Use these issue codes where they apply: "NAME_MISMATCH" (the name on the visa does not match the traveller on file), "PASSPORT_MISMATCH" (the passport number on the visa does not match the traveller's passport on file), "EXPIRY_RISK" (the visa expires before, or uncomfortably close to, the trip's return date), "VISA_ID_MISMATCH" (the visa number on the document does not match the visa number recorded), "MISSING_FIELD", "OTHER".

${MATCHING_GUIDANCE}`;

  const userPrompt = `Traveller on file: ${input.pilgrimName}${input.passportNumber ? `, passport ${input.passportNumber}` : ""}${input.passportExpiry ? ` (passport expires ${input.passportExpiry})` : ""}.
${input.visaId ? `Visa number recorded: ${input.visaId}.` : "No visa number recorded yet."}
Trip return date: ${input.groupReturnDate} — the visa must remain valid through this date.

Read the attached visa and compare its name, passport number, visa number and expiry date against the facts above.`;

  const result = await callOpenRouterVision(systemPrompt, userPrompt, file.base64, file.mimeType);
  if (!result.ok) return { ok: false, extracted: {}, issues: [], error: result.error };
  return { ok: true, extracted: result.extracted, issues: result.issues, error: null };
}

/* ── Reconciling an extracted PNR against the flight record ──────────────── */

/**
 * Case-insensitive lookup for whichever key the model (or the free PDF
 * extractor's own `{PNR: ...}` shape) used for a booking reference — "PNR",
 * "Booking Reference", "Record Locator", etc. The vision model's `extracted`
 * object uses free-form field names it chose itself, not a fixed schema, so
 * an exact `extracted.PNR` lookup silently misses whenever it picks a
 * different label for the same field.
 */
export function extractedPnr(extracted: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(extracted)) {
    if (/pnr|record\s*locator|booking\s*ref/i.test(key) && value?.trim()) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Compares a PNR read off a ticket document against the PNR already recorded
 * on the group's flight — the one cross-check "Upload Ticket / PNR" (which
 * writes `flight.pnr`) and the ticket document review (which reads a PNR off
 * the file into `extracted`) never made against each other, even though both
 * sides already had the value on hand. Silent whenever either side has
 * nothing to compare: a flight with no PNR attached yet, or a ticket the
 * extractor couldn't find one on.
 */
export function pnrMismatchIssue(
  ticketPnr: string | null,
  flightPnr: string | null | undefined,
): AiReviewIssue | null {
  if (!ticketPnr || !flightPnr?.trim()) return null;
  const normalize = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();
  if (normalize(ticketPnr) === normalize(flightPnr)) return null;
  return {
    code: "PNR_MISMATCH",
    severity: "WARNING",
    message: `The ticket shows PNR ${ticketPnr}, which doesn't match the ${flightPnr} recorded on the flight — worth a manual check.`,
  };
}

/* ── Matching an extracted name to a pilgrim ──────────────────────────────── */

export interface PilgrimNameCandidate {
  pilgrimId: string;
  fullName: string;
}

export interface NameMatchResult {
  pilgrimId: string;
  fullName: string;
  confidence: number;
}

const HONORIFICS = /\b(mr|mrs|ms|miss|mstr|dr|haji|hajjah|hajjiya|sheikh|shaikh)\.?\b/g;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(HONORIFICS, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(name: string): Set<string> {
  return new Set(normalizeName(name).split(" ").filter(Boolean));
}

/** Order-independent overlap — "Doe John", "John Doe" and a dropped middle name all score highly against each other. */
function tokenOverlap(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

const MATCH_CONFIDENCE_THRESHOLD = 0.6;
/** How much clearer the best match must be than the runner-up before it's trusted automatically. */
const MATCH_MARGIN_THRESHOLD = 0.15;

/**
 * Matches one name read off a ticket to the pilgrim it most likely belongs
 * to — or to nobody, deliberately, when it can't tell. Two failure modes are
 * both treated as "no match" rather than a guess: a weak match to everyone
 * (a name that doesn't resemble anyone on the manifest), and a close contest
 * between two candidates (two similarly-named pilgrims — "Mohamed Ali" and
 * "Mohamed Alif", say). Either case is left for a human to file by hand
 * through the per-pilgrim "Upload Ticket" button instead of silently
 * attaching a ticket to the wrong traveller.
 */
export function matchExtractedNameToPilgrims(
  extractedName: string,
  candidates: readonly PilgrimNameCandidate[],
): NameMatchResult | null {
  let best: NameMatchResult | null = null;
  let runnerUpScore = 0;

  for (const candidate of candidates) {
    const score = tokenOverlap(extractedName, candidate.fullName);
    if (!best || score > best.confidence) {
      runnerUpScore = best?.confidence ?? 0;
      best = { pilgrimId: candidate.pilgrimId, fullName: candidate.fullName, confidence: score };
    } else if (score > runnerUpScore) {
      runnerUpScore = score;
    }
  }

  if (!best || best.confidence < MATCH_CONFIDENCE_THRESHOLD) return null;
  if (candidates.length > 1 && best.confidence - runnerUpScore < MATCH_MARGIN_THRESHOLD) return null;
  return best;
}
