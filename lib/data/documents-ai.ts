/**
 * AI Document Agent — server-only pipeline.
 *
 * Posture: assistive verification, never final authority. This module has no
 * code path to `VERIFIED` — `verifyGroupPilgrimDocument()` requires a real
 * `GroupActor`, which this pipeline never constructs. Every write here lands
 * in `document_ai_analyses` (findings) or the AI cache columns on the
 * document row; the human decision still runs through the existing
 * `departure-groups-documents.ts` mutators via the Documents actions layer.
 *
 * Runs inside the request that already holds a user session (see the
 * Documents plan §5.4, D8) — no service-role client, so it can only be
 * triggered from a Server Action, never a detached job. Batch re-scans are
 * therefore capped (see `MAX_BULK_SCAN`) until a service-role client is
 * introduced for that purpose alone.
 *
 * Gracefully inert without `OPENROUTER_API_KEY`: `isAiConfigured()` gates
 * every call site so the rest of the module works — with AI features simply
 * absent — in an environment that hasn't set the key.
 */

import {
  insertAiAnalysis,
  updateAiAnalysis,
  updateDocumentFields,
  type Db,
} from "@/lib/data/documents-repository";
import { AI_EXTRACTION_SUPPORTED, DOCUMENT_TYPE_LABELS } from "@/lib/data/documents-copy";
import type { AiRecommendedAction, AiVerdict, DocumentAiCheck, DocumentType } from "@/lib/types/documents";
// Phase 0 (P0.1): this module used to open its own Anthropic client and
// duplicate `MODEL_ID`/`isAiConfigured()` — it now shares the one lazy
// client every agent uses, from `lib/ai/provider.ts`.
import { MODEL_FOR_TIER, getClient, isAiConfigured } from "@/lib/ai/provider";

// Passport and document reading: the stronger cheap tier, not the chat model.
const MODEL_ID = MODEL_FOR_TIER.reason;

export { isAiConfigured };
export const MAX_BULK_SCAN = 25;

/** JSON schema for the model's structured output — one shape covers every
 *  supported type; unsupported types return classification + quality only. */
const ANALYSIS_SCHEMA = {
  type: "object" as const,
  properties: {
    detected_type: {
      type: "string",
      enum: [
        "PASSPORT_BIO",
        "PASSPORT_ADDITIONAL",
        "PASSPORT_PHOTO",
        "NATIONAL_ID",
        "VISA_COPY",
        "INSURANCE",
        "VACCINATION",
        "MEDICAL",
        "EMERGENCY_CONTACT",
        "PAYMENT_PROOF",
        "FLIGHT_TICKET",
        "HOTEL_VOUCHER",
        "OTHER",
      ],
    },
    type_confidence: { type: "number" },
    quality_verdict: { type: "string", enum: ["PASS", "WARNING", "BLOCKED"] },
    quality_issue: { type: "string" },
    extracted: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          label: { type: "string" },
          outcome: { type: "string", enum: ["PASS", "WARN", "FAIL"] },
          detail: { type: "string" },
        },
        required: ["code", "label", "outcome", "detail"],
        additionalProperties: false,
      },
    },
    overall_confidence: { type: "number" },
    recommended_action: {
      type: "string",
      enum: ["VERIFY", "REQUEST_BETTER_COPY", "REJECT", "MANUAL_REVIEW", "NOT_APPLICABLE"],
    },
    recommendation_reason: { type: "string" },
    drafted_message: { type: "string" },
  },
  required: [
    "detected_type",
    "type_confidence",
    "quality_verdict",
    "extracted",
    "checks",
    "overall_confidence",
    "recommended_action",
    "recommendation_reason",
    "drafted_message",
  ],
  additionalProperties: false,
} as const;

interface AnalysisResult {
  detected_type: DocumentType;
  type_confidence: number;
  quality_verdict: "PASS" | "WARNING" | "BLOCKED";
  quality_issue?: string;
  extracted: Record<string, string>;
  checks: DocumentAiCheck[];
  overall_confidence: number;
  recommended_action: AiRecommendedAction;
  recommendation_reason: string;
  drafted_message: string;
}

function systemPrompt(): string {
  return `You are Manasik Copilot, reviewing documents for a Hajj/Umrah travel agency's document operations desk.
You classify a single uploaded traveller document, assess its image/scan quality, extract structured
fields where the type supports it, and recommend a next action for a human reviewer.

You are assistive only. A staff member makes the final verification decision — you never verify a
document yourself. Be conservative: when uncertain, prefer MANUAL_REVIEW or REQUEST_BETTER_COPY over
VERIFY, and give confidence scores that reflect genuine uncertainty rather than defaulting high.

Supported document types for field extraction: ${[...AI_EXTRACTION_SUPPORTED]
    .map((t) => `${t} (${DOCUMENT_TYPE_LABELS[t]})`)
    .join(", ")}. For any other type, extract nothing and set checks to classification/quality only.

Never make a medical eligibility determination — for vaccination/medical documents, only check that
the document is present, dated, and names the traveller.`;
}

function userPrompt(input: {
  documentName: string;
  requirementType: DocumentType;
  pilgrimName: string;
  passportNumber: string | null;
  returnDate: string;
}): string {
  return `Analyse this file, submitted against the requirement "${input.documentName}" (expected type: ${input.requirementType}).

Traveller on file: ${input.pilgrimName}${input.passportNumber ? `, passport ${input.passportNumber}` : ""}.
Journey return date: ${input.returnDate} (passport/visa/insurance validity must cover this).

Return your analysis as the structured JSON the schema describes. In "checks", include one entry per
rule you evaluated (classification, legibility/quality, and — for supported types — expiry and
name/DOB match against the traveller on file). Write "drafted_message" as a short WhatsApp message to
the traveller ONLY if recommended_action is REQUEST_BETTER_COPY or REJECT; otherwise leave it empty.`;
}

/**
 * The Messages API only accepts `image/jpeg | image/png | image/gif |
 * image/webp` and `application/pdf` — HEIC (the default format for every
 * recent iPhone photo, and accepted by every upload dialog and by the
 * `pilgrim-documents` bucket's own `allowed_mime_types`) is not among them.
 * Sending it anyway used to 400 against the API and land as an opaque
 * "analysis could not be completed" FAILED record; returning `null` here
 * lets the caller refuse the scan up front with a message that says why.
 */
function mimeTypeFor(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  return null;
}

/**
 * Runs one document through the pipeline: downloads the file server-side via
 * a fresh signed URL, calls the model once, persists the analysis, updates
 * the document's AI cache columns, and recomputes its priority score.
 *
 * Never throws to the caller on a model-side failure — a refusal or an API
 * error is recorded as a FAILED analysis so the queue can show it, not lost.
 */
export async function analyseDocument(
  db: Db,
  supabaseStorage: { createSignedUrl: (path: string, ttl: number) => Promise<{ data: { signedUrl: string } | null; error: unknown }> },
  input: {
    documentId: string;
    filePath: string;
    fileName: string;
    documentName: string;
    requirementType: DocumentType;
    pilgrimName: string;
    passportNumber: string | null;
    returnDate: string;
  },
): Promise<{ ok: true; analysisId: string } | { ok: false; error: string }> {
  if (!isAiConfigured()) {
    return { ok: false, error: "Manasik Copilot is not configured for this environment." };
  }

  const analysis = await insertAiAnalysis(db, {
    document_id: input.documentId,
    file_path: input.filePath,
    file_checksum: null,
    model_id: MODEL_ID,
    pipeline_version: "v1",
    status: "RUNNING",
    detected_type: null,
    type_confidence: null,
    verdict: "PENDING",
    confidence: null,
    recommended_action: null,
    recommendation_reason: null,
    extracted: {},
    checks: [],
    drafted_message: null,
    input_tokens: null,
    output_tokens: null,
    error_message: null,
    completed_at: null,
  });

  try {
    const { data: signed, error: signError } = await supabaseStorage.createSignedUrl(input.filePath, 60);
    if (signError || !signed) throw new Error("Could not read the uploaded file.");

    const fileResponse = await fetch(signed.signedUrl);
    if (!fileResponse.ok) throw new Error("Could not download the uploaded file.");
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    const base64 = bytes.toString("base64");
    const mimeType = mimeTypeFor(input.fileName);

    if (!mimeType) {
      const isHeic = input.fileName.toLowerCase().endsWith(".heic");
      throw new Error(
        isHeic
          ? "Manasik Copilot can't read HEIC photos yet — ask for a JPG, PNG or PDF instead."
          : "Manasik Copilot can't read that file type.",
      );
    }

    const contentBlock =
      mimeType === "application/pdf"
        ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } } as const)
        : ({
            type: "image",
            source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/webp", data: base64 },
          } as const);

    const response = await getClient().messages.create({
      model: MODEL_ID,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
      system: systemPrompt(),
      messages: [
        {
          role: "user",
          content: [contentBlock, { type: "text", text: userPrompt(input) }],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Manasik Copilot declined to analyse this file.");
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No analysis returned.");
    const result = JSON.parse(textBlock.text) as AnalysisResult;

    const verdict = deriveOverallVerdict(result);
    const confidence = clampConfidence(result.overall_confidence);

    await updateAiAnalysis(db, analysis.id, {
      status: "COMPLETE",
      detected_type: result.detected_type,
      type_confidence: clampConfidence(result.type_confidence),
      verdict,
      confidence,
      recommended_action: result.recommended_action,
      recommendation_reason: result.recommendation_reason,
      extracted: result.extracted,
      checks: result.checks,
      drafted_message: result.drafted_message || null,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      completed_at: new Date().toISOString(),
    });

    await updateDocumentFields(db, input.documentId, {
      ai_analysis_id: analysis.id,
      ai_verdict: verdict,
      ai_confidence: confidence,
      last_activity_at: new Date().toISOString(),
    });

    return { ok: true, analysisId: analysis.id };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The analysis could not be completed.";
    await updateAiAnalysis(db, analysis.id, {
      status: "FAILED",
      verdict: "ERROR",
      error_message: message,
      completed_at: new Date().toISOString(),
    });
    await updateDocumentFields(db, input.documentId, { ai_verdict: "ERROR" });
    return { ok: false, error: message };
  }
}

function deriveOverallVerdict(result: AnalysisResult): AiVerdict {
  if (result.quality_verdict === "BLOCKED") return "BLOCKED";
  if (result.recommended_action === "REJECT") return "BLOCKED";
  if (result.quality_verdict === "WARNING" || result.recommended_action === "REQUEST_BETTER_COPY" || result.recommended_action === "MANUAL_REVIEW") {
    return "WARNING";
  }
  return "PASS";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100));
}
