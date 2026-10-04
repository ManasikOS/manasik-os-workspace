"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForDocuments } from "@/lib/access/documents-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  markGroupVisasUnderReview,
  rejectGroupPilgrimDocument,
  submitGroupPilgrimDocument,
  verifyGroupPilgrimDocument,
  waiveGroupPilgrimDocument,
} from "@/lib/data/departure-groups";
import { analyseDocument, isAiConfigured, MAX_BULK_SCAN } from "@/lib/data/documents-ai";
import {
  insertReviewEvent,
  loadDocumentQueue,
  loadLatestAiAnalyses,
  loadReviewHistory,
  updateDocumentFields,
  type Db,
} from "@/lib/data/documents-repository";
import { requireUser } from "@/lib/dal";
import {
  assignReviewerSchema,
  bulkNotRequiredSchema,
  bulkReminderSchema,
  bulkReworkSchema,
  requestReworkSchema,
  toDocumentFieldErrors,
  updateExpirySchema,
  uploadOnBehalfSchema,
  verifyDocumentSchema,
} from "@/lib/validations/documents";
import { createClient } from "@/utils/supabase/server";

const BUCKET = "pilgrim-documents";

async function db(): Promise<Db> {
  return createClient(await cookies());
}

function revalidateDocuments() {
  revalidatePath("/documents");
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Loads one document's queue row, scoped for the actions below. Every
 * mutation re-checks role and re-resolves the group id itself, because a
 * Server Action is a public POST endpoint regardless of caller. */
async function findQueueRow(supabase: Db, documentId: string) {
  const { data, error } = await supabase
    .from("document_queue_rows")
    .select("*")
    .eq("document_id", documentId)
    .maybeSingle();
  if (error) throw error;
  return data as
    | (Awaited<ReturnType<typeof loadDocumentQueue>>)[number]
    | null;
}

async function actorContext() {
  const { role, name } = await getCurrentStaffRole();
  const user = await requireUser();
  return { role, actorName: name ?? "Staff", actorId: user.id };
}

async function logReview(
  supabase: Db,
  documentId: string,
  action: Parameters<typeof insertReviewEvent>[1]["action"],
  fields: Partial<Parameters<typeof insertReviewEvent>[1]> = {},
) {
  const { role, actorName, actorId } = await actorContext();
  await insertReviewEvent(supabase, {
    document_id: documentId,
    actor_id: actorId,
    actor_name: actorName,
    actor_role: role,
    action,
    from_status: null,
    to_status: null,
    reason_code: null,
    note: null,
    overrode_ai_analysis_id: null,
    override_reason: null,
    ...fields,
  });
}

/* ── Upload on behalf ─────────────────────────────────────────────────────── */

export async function uploadDocumentOnBehalfAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.uploadOnBehalf) return { ok: false, error: "Your role cannot upload documents." };

  const parsed = uploadOnBehalfSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid upload.", fieldErrors: toDocumentFieldErrors(parsed.error) };
  }
  const supabase = await db();
  const row = await findQueueRow(supabase, parsed.data.documentId);
  if (!row) return { ok: false, error: "That document could not be found." };

  const outcome = await submitGroupPilgrimDocument({
    documentId: parsed.data.documentId,
    departureGroupId: row.departure_group_id,
    filePath: parsed.data.filePath,
    fileName: parsed.data.fileName,
    fileSizeBytes: parsed.data.fileSizeBytes,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await updateDocumentFields(supabase, parsed.data.documentId, {
    last_activity_at: new Date().toISOString(),
    ai_verdict: null,
    ai_confidence: null,
    ai_analysis_id: null,
  });
  await logReview(supabase, parsed.data.documentId, "UPLOADED", { to_status: "SUBMITTED" });

  if (isAiConfigured() && capabilitiesForDocuments(role).runAiScan) {
    const requirementType = row.document_type;
    await analyseDocument(
      supabase,
      { createSignedUrl: (path, ttl) => supabase.storage.from(BUCKET).createSignedUrl(path, ttl) },
      {
        documentId: parsed.data.documentId,
        filePath: parsed.data.filePath,
        fileName: parsed.data.fileName,
        documentName: row.name,
        requirementType,
        pilgrimName: row.full_name,
        passportNumber: row.passport_number,
        returnDate: row.return_date,
      },
    );
    await logReview(supabase, parsed.data.documentId, "AI_ANALYSED");
  }

  revalidateDocuments();
  return { ok: true };
}

/* ── Run AI scan on demand ────────────────────────────────────────────────── */

export async function runAiScanAction(documentId: string): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.runAiScan) return { ok: false, error: "Your role cannot run a Manasik Copilot document review." };
  if (!isAiConfigured()) return { ok: false, error: "Manasik Copilot is not configured for this environment." };

  const supabase = await db();
  const row = await findQueueRow(supabase, documentId);
  if (!row) return { ok: false, error: "That document could not be found." };
  if (!row.file_path) return { ok: false, error: "Nothing has been uploaded for this document yet." };

  const result = await analyseDocument(
    supabase,
    { createSignedUrl: (path, ttl) => supabase.storage.from(BUCKET).createSignedUrl(path, ttl) },
    {
      documentId,
      filePath: row.file_path,
      fileName: row.file_name ?? "document",
      documentName: row.name,
      requirementType: row.document_type,
      pilgrimName: row.full_name,
      passportNumber: row.passport_number,
      returnDate: row.return_date,
    },
  );
  if (!result.ok) return { ok: false, error: result.error };

  await logReview(supabase, documentId, "AI_ANALYSED");
  revalidateDocuments();
  return { ok: true };
}

export async function runBulkAiScanAction(documentIds: string[]): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.runAiScan) return { ok: false, error: "Your role cannot run the AI Document Agent." };
  if (!isAiConfigured()) return { ok: false, error: "The AI Document Agent is not configured for this environment." };

  const capped = documentIds.slice(0, MAX_BULK_SCAN);
  for (const id of capped) {
    await runAiScanAction(id);
  }
  revalidateDocuments();
  return { ok: true };
}

/* ── Verify ───────────────────────────────────────────────────────────────── */

export async function verifyDocumentAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.verifyDocuments) return { ok: false, error: "Your role cannot verify documents." };

  const parsed = verifyDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const row = await findQueueRow(supabase, parsed.data.documentId);
  if (!row) return { ok: false, error: "That document could not be found." };

  const isOverridingAi = row.ai_verdict === "WARNING" || row.ai_verdict === "BLOCKED";
  if (isOverridingAi && !parsed.data.overrideReason?.trim()) {
    return {
      ok: false,
      error: "This document has an AI warning — give a reason for verifying it anyway.",
      fieldErrors: { overrideReason: "Required to override an AI finding." },
    };
  }

  const outcome = await verifyGroupPilgrimDocument({
    documentId: parsed.data.documentId,
    departureGroupId: row.departure_group_id,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await updateDocumentFields(supabase, parsed.data.documentId, { last_activity_at: new Date().toISOString() });
  await logReview(supabase, parsed.data.documentId, isOverridingAi ? "AI_OVERRIDDEN" : "VERIFIED", {
    to_status: "VERIFIED",
    overrode_ai_analysis_id: isOverridingAi ? row.ai_analysis_id : null,
    override_reason: isOverridingAi ? parsed.data.overrideReason?.trim() ?? null : null,
  });

  revalidateDocuments();
  return { ok: true };
}

/* ── Request rework / reject ──────────────────────────────────────────────── */

export async function requestReworkAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.requestRework) return { ok: false, error: "Your role cannot request rework." };

  const parsed = requestReworkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request.", fieldErrors: toDocumentFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const row = await findQueueRow(supabase, parsed.data.documentId);
  if (!row) return { ok: false, error: "That document could not be found." };

  const outcome = await rejectGroupPilgrimDocument({
    documentId: parsed.data.documentId,
    departureGroupId: row.departure_group_id,
    reason: parsed.data.message,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await updateDocumentFields(supabase, parsed.data.documentId, { last_activity_at: new Date().toISOString() });
  await logReview(supabase, parsed.data.documentId, "REWORK_REQUESTED", {
    to_status: "REJECTED",
    reason_code: parsed.data.reasonCode,
    note: parsed.data.message,
  });

  revalidateDocuments();
  return { ok: true };
}

/* ── Waive ────────────────────────────────────────────────────────────────── */

export async function waiveDocumentAction(documentId: string, reason: string): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.waiveRequirement) return { ok: false, error: "Your role cannot waive requirements." };

  const supabase = await db();
  const row = await findQueueRow(supabase, documentId);
  if (!row) return { ok: false, error: "That document could not be found." };

  const outcome = await waiveGroupPilgrimDocument({
    documentId,
    departureGroupId: row.departure_group_id,
    reason,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await updateDocumentFields(supabase, documentId, { last_activity_at: new Date().toISOString() });
  await logReview(supabase, documentId, "WAIVED", { to_status: "NOT_APPLICABLE", note: reason });

  revalidateDocuments();
  return { ok: true };
}

export async function bulkRequestReworkAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.bulkActions || !can.requestRework) return { ok: false, error: "Your role cannot run bulk actions." };

  const parsed = bulkReworkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const results = await Promise.all(
    parsed.data.documentIds.map((documentId) =>
      requestReworkAction({
        documentId,
        reasonCode: parsed.data.reasonCode,
        message: parsed.data.message,
        channel: "NONE",
      }),
    ),
  );
  const failed = results.filter((r) => !r.ok).length;
  revalidateDocuments();
  return failed > 0
    ? { ok: false, error: `${failed} of ${results.length} could not be updated.` }
    : { ok: true };
}

export async function bulkNotRequiredAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.bulkActions || !can.waiveRequirement) return { ok: false, error: "Your role cannot run bulk actions." };

  const parsed = bulkNotRequiredSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const results = await Promise.all(
    parsed.data.documentIds.map((id) => waiveDocumentAction(id, parsed.data.reason)),
  );
  const failed = results.filter((r) => !r.ok).length;
  revalidateDocuments();
  return failed > 0
    ? { ok: false, error: `${failed} of ${results.length} could not be updated.` }
    : { ok: true };
}

/* ── Assignment ───────────────────────────────────────────────────────────── */

export async function assignReviewerAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.assignReviewer) return { ok: false, error: "Your role cannot assign reviewers." };

  const parsed = assignReviewerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  for (const documentId of parsed.data.documentIds) {
    await updateDocumentFields(supabase, documentId, {
      assigned_to: parsed.data.assignedTo,
      assigned_to_name: parsed.data.assignedToName,
      assigned_at: parsed.data.assignedTo ? new Date().toISOString() : null,
    });
    await logReview(supabase, documentId, "ASSIGNED", { note: parsed.data.assignedToName ?? "Unassigned" });
  }

  revalidateDocuments();
  return { ok: true };
}

/* ── Reminders ────────────────────────────────────────────────────────────── */

export async function sendBulkReminderAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.sendReminders) return { ok: false, error: "Your role cannot send reminders." };

  const parsed = bulkReminderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  for (const documentId of parsed.data.documentIds) {
    await logReview(supabase, documentId, "REMINDER_SENT");
  }
  revalidateDocuments();
  return { ok: true };
}

/* ── Expiry edit ──────────────────────────────────────────────────────────── */

export async function updateExpiryAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.verifyDocuments) return { ok: false, error: "Your role cannot edit this field." };

  const parsed = updateExpirySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid date." };

  const supabase = await db();
  await updateDocumentFields(supabase, parsed.data.documentId, {
    expires_at: parsed.data.expiresAt,
    last_activity_at: new Date().toISOString(),
  });
  await logReview(supabase, parsed.data.documentId, "EXPIRY_FLAGGED", { note: parsed.data.expiresAt ?? "cleared" });

  revalidateDocuments();
  return { ok: true };
}

/* ── Review drawer reads ──────────────────────────────────────────────────── */

export async function getLatestAnalysisAction(documentId: string) {
  await requireUser();
  const supabase = await db();
  const rows = await loadLatestAiAnalyses(supabase, [documentId]);
  return rows[0] ?? null;
}

export async function getReviewHistoryAction(documentId: string) {
  await requireUser();
  const supabase = await db();
  return loadReviewHistory(supabase, documentId);
}

export async function createReviewDownloadUrlAction(filePath: string) {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForDocuments(role).viewDocumentFile) {
    return { ok: false as const, error: "Your role cannot view this document." };
  }
  if (!filePath.trim() || filePath.includes("..")) {
    return { ok: false as const, error: "That document reference is invalid." };
  }
  const supabase = await db();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 120);
  if (error || !data) return { ok: false as const, error: error?.message ?? "That document could not be opened." };
  return { ok: true as const, url: data.signedUrl };
}

/* ── Visa gate helper reused from the group tab ──────────────────────────── */

export async function moveDocumentVisaUnderReviewAction(
  departureGroupId: string,
  pilgrimId: string,
): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForDocuments(role);
  if (!can.verifyDocuments) return { ok: false, error: "Your role cannot update visa status." };

  const outcome = await markGroupVisasUnderReview({ departureGroupId, pilgrimIds: [pilgrimId] });
  if (!outcome.ok) return { ok: false, error: outcome.error };
  revalidateDocuments();
  return { ok: true };
}
