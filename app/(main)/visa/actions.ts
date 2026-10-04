"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForVisa } from "@/lib/access/visa-access";
import {
  getCurrentStaffRole,
  markGroupApplicationsSubmitted,
  markGroupVisasUnderReview,
  rejectGroupPilgrimVisa,
  uploadGroupPilgrimVisa,
} from "@/lib/data/departure-groups";
import {
  findVisaRow,
  insertBatch,
  insertVisaEvent,
  loadBatch,
  loadBatchesForGroup,
  loadVisaTimeline,
  nextBatchSequence,
  updateBatch,
  updateVisaFields,
  type Db,
} from "@/lib/data/visa-repository";
import { requireUser } from "@/lib/dal";
import {
  assignOfficerSchema,
  createBatchSchema,
  markBatchSubmittedSchema,
  recordIssueSchema,
  recordRejectionSchema,
  statusCheckSchema,
  toVisaFieldErrors,
  verifyIssueSchema,
} from "@/lib/validations/visa";
import { createClient } from "@/utils/supabase/server";

const BUCKET = "pilgrim-documents";

async function db(): Promise<Db> {
  return createClient(await cookies());
}

function revalidateVisa() {
  revalidatePath("/visa");
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

async function actorContext() {
  const { role, name } = await getCurrentStaffRole();
  const user = await requireUser();
  return { role, actorName: name ?? "Staff", actorId: user.id };
}

async function logEvent(
  supabase: Db,
  journeyId: string,
  departureGroupId: string,
  action: Parameters<typeof insertVisaEvent>[1]["action"],
  fields: Partial<Parameters<typeof insertVisaEvent>[1]> = {},
) {
  const { role, actorName, actorId } = await actorContext();
  await insertVisaEvent(supabase, {
    journey_id: journeyId,
    departure_group_id: departureGroupId,
    batch_id: null,
    actor_id: actorId,
    actor_name: actorName,
    actor_role: role,
    action,
    from_status: null,
    to_status: null,
    issue_type: null,
    note: null,
    evidence_path: null,
    ...fields,
  });
}

/* ── Batches ──────────────────────────────────────────────────────────────── */

export async function createBatchAction(input: unknown): Promise<ActionResult & { batchId?: string }> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForVisa(role);
  if (!can.createBatch) return { ok: false, error: "Your role cannot create submission batches." };

  const parsed = createBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid batch.", fieldErrors: toVisaFieldErrors(parsed.error) };
  }
  const supabase = await db();
  const { actorId, actorName } = await actorContext();

  const batch = await insertBatch(supabase, {
    departure_group_id: parsed.data.departureGroupId,
    batch_reference: parsed.data.batchReference,
    visa_type: parsed.data.visaType,
    sequence_number: await nextBatchSequence(supabase, parsed.data.departureGroupId),
    status: "DRAFT",
    owner_id: parsed.data.ownerId,
    owner_name: parsed.data.ownerName,
    submission_deadline: parsed.data.submissionDeadline ?? null,
    submitted_at: null,
    closed_at: null,
    notes: parsed.data.notes ?? null,
    created_by: actorId,
    created_by_name: actorName,
  });

  for (const journeyId of parsed.data.journeyIds) {
    await updateVisaFields(supabase, journeyId, {
      visa_batch_id: batch.id,
      visa_type: parsed.data.visaType,
      visa_last_update_at: new Date().toISOString(),
    });
    await logEvent(supabase, journeyId, parsed.data.departureGroupId, "BATCH_ADDED", {
      batch_id: batch.id,
      note: batch.batch_reference,
    });
  }

  revalidateVisa();
  return { ok: true, batchId: batch.id };
}

export async function markBatchSubmittedAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForVisa(role);
  if (!can.markSubmitted) return { ok: false, error: "Your role cannot mark applications submitted." };

  const parsed = markBatchSubmittedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const batch = await loadBatch(supabase, parsed.data.batchId);
  if (!batch) return { ok: false, error: "That batch could not be found." };

  // Membership is the FK on the enrolment — read the current members straight
  // off the base table rather than re-deriving it from the view.
  const { data: members, error } = await supabase
    .from("departure_group_pilgrims")
    .select("id, visa_status")
    .eq("visa_batch_id", batch.id);
  if (error) return { ok: false, error: error.message };

  const journeyIds = ((members ?? []) as { id: string }[]).map((m) => m.id);
  if (journeyIds.length === 0) return { ok: false, error: "This batch has no applications in it." };

  const outcome = await markGroupApplicationsSubmitted({
    departureGroupId: batch.departure_group_id,
    pilgrimIds: journeyIds,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await updateBatch(supabase, batch.id, {
    status: outcome.result.skipped.length > 0 ? "PARTIALLY_RESOLVED" : "SUBMITTED",
    submitted_at: new Date().toISOString(),
  });

  // The mutator reports skips by name, not id, so every member gets the same
  // "submitted in this batch" event; a skipped pilgrim's visa_status simply
  // never moved to SUBMITTED, and the batch note carries the skip summary.
  const now = new Date().toISOString();
  for (const id of journeyIds) {
    await updateVisaFields(supabase, id, { visa_last_update_at: now, visa_status_checked_at: now });
    await logEvent(supabase, id, batch.departure_group_id, "SUBMITTED", {
      batch_id: batch.id,
      to_status: "SUBMITTED",
      note: `Batch ${batch.batch_reference} submitted (${outcome.result.submittedCount} of ${journeyIds.length} applied)`,
    });
  }
  if (outcome.result.skipped.length > 0) {
    await updateBatch(supabase, batch.id, {
      notes: `Skipped: ${outcome.result.skipped.map((s) => `${s.fullName} (${s.reason})`).join("; ")}`,
    });
  }

  revalidateVisa();
  return { ok: true };
}

/* ── Assignment ───────────────────────────────────────────────────────────── */

export async function assignOfficerAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForVisa(role);
  if (!can.assignOfficer) return { ok: false, error: "Your role cannot assign officers." };

  const parsed = assignOfficerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  for (const journeyId of parsed.data.journeyIds) {
    const row = await findVisaRow(supabase, journeyId);
    if (!row) continue;
    await updateVisaFields(supabase, journeyId, {
      visa_assigned_to: parsed.data.assignedTo,
      visa_assigned_to_name: parsed.data.assignedToName,
      visa_assigned_at: parsed.data.assignedTo ? new Date().toISOString() : null,
    });
    await logEvent(supabase, journeyId, row.departure_group_id, "ASSIGNED", {
      note: parsed.data.assignedToName ?? "Unassigned",
    });
  }

  revalidateVisa();
  return { ok: true };
}

/* ── Status check ─────────────────────────────────────────────────────────── */

export async function recordStatusCheckAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForVisa(role);
  if (!can.recordStatusCheck) return { ok: false, error: "Your role cannot record a status check." };

  const parsed = statusCheckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const now = new Date().toISOString();
  for (const journeyId of parsed.data.journeyIds) {
    const row = await findVisaRow(supabase, journeyId);
    if (!row) continue;
    await updateVisaFields(supabase, journeyId, {
      visa_status_checked_at: now,
      visa_last_update_at: now,
    });
    await logEvent(supabase, journeyId, row.departure_group_id, "STATUS_CHECKED", {
      note: parsed.data.note ?? null,
    });
  }

  revalidateVisa();
  return { ok: true };
}

/* ── Under review ─────────────────────────────────────────────────────────── */

export async function moveVisaUnderReviewAction(journeyId: string): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForVisa(role);
  if (!can.recordStatusCheck) return { ok: false, error: "Your role cannot update visa status." };

  const supabase = await db();
  const row = await findVisaRow(supabase, journeyId);
  if (!row) return { ok: false, error: "That application could not be found." };

  const outcome = await markGroupVisasUnderReview({
    departureGroupId: row.departure_group_id,
    pilgrimIds: [journeyId],
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  const now = new Date().toISOString();
  await updateVisaFields(supabase, journeyId, { visa_last_update_at: now, visa_status_checked_at: now });
  await logEvent(supabase, journeyId, row.departure_group_id, "MOVED_UNDER_REVIEW", { to_status: "UNDER_REVIEW" });

  revalidateVisa();
  return { ok: true };
}

/* ── Issue capture ────────────────────────────────────────────────────────── */

export async function recordIssueAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForVisa(role);
  if (!can.recordIssuedVisa) return { ok: false, error: "Your role cannot record an issued visa." };

  const parsed = recordIssueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request.", fieldErrors: toVisaFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const row = await findVisaRow(supabase, parsed.data.id);
  if (!row) return { ok: false, error: "That application could not be found." };

  const isAmend = row.visa_status === "APPROVED";
  if (isAmend && !can.amendIssuedVisa) {
    return { ok: false, error: "Your role cannot amend an already-issued visa." };
  }

  const before = { visaId: row.visa_id, expiry: row.visa_expiry_date };

  const outcome = await uploadGroupPilgrimVisa({
    id: parsed.data.id,
    departureGroupId: parsed.data.departureGroupId,
    visaId: parsed.data.visaId,
    filePath: parsed.data.filePath ?? undefined,
    expiryDate: parsed.data.expiryDate ?? undefined,
    issueNote: parsed.data.issueNote ?? undefined,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await updateVisaFields(supabase, parsed.data.id, {
    visa_issue_date: parsed.data.issueDate ?? null,
    visa_entry_type: parsed.data.entryType ?? null,
    visa_valid_until: parsed.data.validUntil ?? null,
    visa_evidence_source: parsed.data.evidenceSource ?? null,
    // Recording is not verifying — a fresh record always clears verification.
    visa_verified_at: null,
    visa_verified_by: null,
    visa_verified_by_name: null,
    visa_last_update_at: new Date().toISOString(),
  });

  await logEvent(supabase, parsed.data.id, parsed.data.departureGroupId, isAmend ? "ISSUE_AMENDED" : "ISSUE_RECORDED", {
    to_status: "APPROVED",
    note: isAmend ? `Amended from ${before.visaId ?? "—"} / ${before.expiry ?? "—"}` : parsed.data.issueNote ?? null,
    evidence_path: parsed.data.filePath ?? null,
  });

  revalidateVisa();
  return { ok: true };
}

export async function verifyIssueAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForVisa(role);
  if (!can.verifyIssuedVisa) return { ok: false, error: "Your role cannot verify an issued visa." };

  const parsed = verifyIssueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const row = await findVisaRow(supabase, parsed.data.id);
  if (!row) return { ok: false, error: "That application could not be found." };
  if (row.visa_status !== "APPROVED") {
    return { ok: false, error: "Only an issued visa can be verified." };
  }
  if (!row.visa_id) {
    return { ok: false, error: "Record the visa number before verifying." };
  }

  const { actorId, actorName } = await actorContext();
  await updateVisaFields(supabase, parsed.data.id, {
    visa_verified_at: new Date().toISOString(),
    visa_verified_by: actorId,
    visa_verified_by_name: actorName,
    visa_last_update_at: new Date().toISOString(),
  });
  await logEvent(supabase, parsed.data.id, row.departure_group_id, "ISSUE_VERIFIED");

  revalidateVisa();
  return { ok: true };
}

/* ── Rejection / rework ───────────────────────────────────────────────────── */

export async function recordRejectionAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForVisa(role);
  if (!can.recordRejection) return { ok: false, error: "Your role cannot record a visa decision." };

  const parsed = recordRejectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request.", fieldErrors: toVisaFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const outcome = await rejectGroupPilgrimVisa({
    id: parsed.data.id,
    departureGroupId: parsed.data.departureGroupId,
    reason: parsed.data.reason,
    canReapply: parsed.data.canReapply,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await updateVisaFields(supabase, parsed.data.id, { visa_last_update_at: new Date().toISOString() });
  await logEvent(
    supabase,
    parsed.data.id,
    parsed.data.departureGroupId,
    parsed.data.canReapply ? "REWORK_REQUESTED" : "REJECTED",
    {
      to_status: outcome.result.visaStatus,
      issue_type: parsed.data.issueType,
      note: parsed.data.reason,
    },
  );

  revalidateVisa();
  return { ok: true };
}

/* ── Reference edit ───────────────────────────────────────────────────────── */

export async function updateReferenceAction(journeyId: string, reference: string | null): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForVisa(role);
  if (!can.manageBatch) return { ok: false, error: "Your role cannot edit the application reference." };

  const supabase = await db();
  const row = await findVisaRow(supabase, journeyId);
  if (!row) return { ok: false, error: "That application could not be found." };

  await updateVisaFields(supabase, journeyId, {
    visa_application_reference: reference?.trim() || null,
    visa_last_update_at: new Date().toISOString(),
  });
  await logEvent(supabase, journeyId, row.departure_group_id, "REFERENCE_RECORDED", { note: reference });

  revalidateVisa();
  return { ok: true };
}

/* ── Reads for the drawer ─────────────────────────────────────────────────── */

export async function getVisaTimelineAction(journeyId: string) {
  await requireUser();
  const supabase = await db();
  return loadVisaTimeline(supabase, journeyId);
}

export async function getBatchesForGroupAction(departureGroupId: string) {
  await requireUser();
  const supabase = await db();
  return loadBatchesForGroup(supabase, departureGroupId);
}

export async function createVisaDownloadUrlAction(filePath: string) {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForVisa(role).viewVisaNumberAndFile) {
    return { ok: false as const, error: "Your role cannot view this file." };
  }
  if (!filePath.trim() || filePath.includes("..")) {
    return { ok: false as const, error: "That file reference is invalid." };
  }
  const supabase = await db();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 120);
  if (error || !data) return { ok: false as const, error: error?.message ?? "That file could not be opened." };
  return { ok: true as const, url: data.signedUrl };
}
