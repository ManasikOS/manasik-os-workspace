"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  rejectGroupPilgrimDocument,
  submitGroupPilgrimDocument,
  verifyGroupPilgrimDocument,
  waiveGroupPilgrimDocument,
  markGroupApplicationsSubmitted,
  markGroupVisasUnderReview,
  uploadGroupPilgrimVisa,
  rejectGroupPilgrimVisa,
  recordBookingPayment,
} from "@/lib/data/departure-groups";
import {
  addSupportCaseAttachmentInStore,
  addSupportCaseCommentInStore,
  allocatePaymentToMilestonesInStore,
  createSupportRequestInStore,
  escalateSupportRequestInStore,
  linkSupportCaseSupplierInStore,
  pushPilgrimActivity,
  removeSupportCaseAttachmentInStore,
  updateMedicalRecordInStore,
  updatePersonalDetailsInStore,
  updatePilgrimConsentInStore,
  updateSupportRequestStatusInStore,
  type MutationOutcome,
} from "@/lib/data/pilgrims";
import { deleteSupportCaseAttachmentObject } from "./attachment-storage";
import type { ConsentChannel, ConsentStatus } from "@/lib/types/consent";
import {
  loadPilgrimStore,
  persistPilgrimStore,
  snapshotPilgrimStore,
  resolveOrCreatePilgrimPerson,
  updateJourneyFields,
  type PilgrimStore,
} from "@/lib/data/pilgrims-repository";
import { requireUser } from "@/lib/dal";
import {
  addSupportCaseCommentSchema,
  createSupportRequestSchema,
  escalateSupportRequestSchema,
  linkSupportCaseSupplierSchema,
  recordSupportCaseAttachmentSchema,
  removeSupportCaseAttachmentSchema,
  toPilgrimFieldErrors,
  updateMedicalRecordSchema,
  updatePersonalDetailsSchema,
} from "@/lib/validations/pilgrims";
import { createClient } from "@/utils/supabase/server";

async function db() {
  return createClient(await cookies());
}

function revalidatePilgrims(pilgrimId?: string) {
  revalidatePath("/pilgrims");
  revalidatePath("/operations");
  if (pilgrimId) revalidatePath(`/pilgrims/${pilgrimId}`);
}

/** Runs one mutation against the pilgrims store, scoped to a single person. */
async function mutate<T extends { ok: boolean }>(
  pilgrimId: string,
  run: (store: PilgrimStore, actorName: string) => T,
): Promise<T> {
  const supabase = await db();
  const { name } = await getCurrentStaffRole();
  const actorName = name ?? "Staff";

  const store = await loadPilgrimStore(supabase, { pilgrimId });
  const before = snapshotPilgrimStore(store);

  const outcome = run(store, actorName);
  if (!outcome.ok) return outcome;

  await persistPilgrimStore(supabase, before, store);
  return outcome;
}

/* ── Personal details ─────────────────────────────────────────────────────── */

export interface UpdatePersonalDetailsResult extends MutationOutcome {
  fieldErrors?: Record<string, string>;
}

export async function updatePersonalDetailsAction(input: unknown): Promise<UpdatePersonalDetailsResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.editPersonalDetails) return { ok: false, error: "Your role cannot edit personal details." };

  const parsed = updatePersonalDetailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toPilgrimFieldErrors(parsed.error) };
  }
  const { pilgrimId, ...fields } = parsed.data;

  const outcome = await mutate(pilgrimId, (store, actorName) =>
    updatePersonalDetailsInStore(store, { pilgrimId, fields, actorName }, new Date().toISOString()),
  );
  if (outcome.ok) revalidatePilgrims(pilgrimId);
  return outcome;
}

/* ── Medical ──────────────────────────────────────────────────────────────── */

export async function updateMedicalRecordAction(input: unknown): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.editMedical) return { ok: false, error: "Your role cannot edit medical information." };

  const parsed = updateMedicalRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };
  const { pilgrimId, ...rest } = parsed.data;

  const outcome = await mutate(pilgrimId, (store, actorName) =>
    updateMedicalRecordInStore(
      store,
      {
        pilgrimId,
        actorName,
        fields: {
          mobilitySupport: rest.mobilitySupport,
          wheelchairRequired: rest.wheelchairRequired,
          dietaryRequirement: rest.dietaryRequirement,
          allergyInformation: rest.allergyInformation,
          medicationNote: rest.medicationNote,
          accessibilityNote: rest.accessibilityNote,
          specialAssistance: rest.specialAssistance,
        },
      },
      new Date().toISOString(),
    ),
  );
  if (outcome.ok) revalidatePilgrims(pilgrimId);
  return outcome;
}

export async function logMedicalViewAction(pilgrimId: string): Promise<void> {
  const { role, name } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.viewMedical) return;
  await mutate(pilgrimId, (store) => {
    pushPilgrimActivity(
      store,
      { pilgrimId, type: "MEDICAL", message: "Viewed medical / accessibility record.", actorName: name ?? "Staff", isSensitive: true },
      new Date().toISOString(),
    );
    return { ok: true };
  });
}

/* ── Support requests ─────────────────────────────────────────────────────── */

export async function createSupportRequestAction(input: unknown): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageSupportRequests) return { ok: false, error: "Your role cannot raise support requests." };

  const parsed = createSupportRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Describe the request before submitting." };
  const { pilgrimId, ...fields } = parsed.data;

  const outcome = await mutate(pilgrimId, (store, actorName) =>
    createSupportRequestInStore(store, { pilgrimId, fields, actorName }, new Date().toISOString()),
  );
  if (outcome.ok) revalidatePilgrims(pilgrimId);
  return outcome;
}

export async function updateSupportRequestStatusAction(input: {
  pilgrimId: string;
  requestId: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageSupportRequests) return { ok: false, error: "Your role cannot update support requests." };

  const outcome = await mutate(input.pilgrimId, (store, actorName) =>
    updateSupportRequestStatusInStore(
      store,
      { requestId: input.requestId, status: input.status, actorName },
      new Date().toISOString(),
    ),
  );
  if (outcome.ok) revalidatePilgrims(input.pilgrimId);
  return outcome;
}

export async function addSupportCaseCommentAction(input: unknown): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageSupportRequests) return { ok: false, error: "Your role cannot comment on cases." };

  const parsed = addSupportCaseCommentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Write a comment before adding it." };
  const { pilgrimId, requestId, message } = parsed.data;

  const outcome = await mutate(pilgrimId, (store, actorName) =>
    addSupportCaseCommentInStore(store, { requestId, message, actorName }, new Date().toISOString()),
  );
  if (outcome.ok) revalidatePilgrims(pilgrimId);
  return outcome;
}

export async function escalateSupportRequestAction(input: unknown): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageSupportRequests) return { ok: false, error: "Your role cannot escalate cases." };

  const parsed = escalateSupportRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };
  const { pilgrimId, requestId, toRole, reason } = parsed.data;

  const outcome = await mutate(pilgrimId, (store, actorName) =>
    escalateSupportRequestInStore(store, { requestId, toRole, reason, actorName }, new Date().toISOString()),
  );
  if (outcome.ok) revalidatePilgrims(pilgrimId);
  return outcome;
}

export async function linkSupportCaseSupplierAction(input: unknown): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageSupportRequests) return { ok: false, error: "Your role cannot link a supplier." };

  const parsed = linkSupportCaseSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { pilgrimId, requestId, supplierId, supplierName } = parsed.data;

  const outcome = await mutate(pilgrimId, (store, actorName) =>
    linkSupportCaseSupplierInStore(store, { requestId, supplierId, supplierName, actorName }, new Date().toISOString()),
  );
  if (outcome.ok) revalidatePilgrims(pilgrimId);
  return outcome;
}

/**
 * Records an attachment already uploaded to storage (see
 * `createSupportCaseAttachmentUploadUrl` in `attachment-storage.ts` — the
 * client PUTs the file straight to the bucket first, then calls this to
 * record the resulting path).
 */
export async function recordSupportCaseAttachmentAction(input: unknown): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageSupportRequests) return { ok: false, error: "Your role cannot attach files to a case." };

  const parsed = recordSupportCaseAttachmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { pilgrimId, requestId, filePath, fileName, contentType, sizeBytes } = parsed.data;

  const outcome = await mutate(pilgrimId, (store, actorName) =>
    addSupportCaseAttachmentInStore(
      store,
      { requestId, filePath, fileName, contentType, sizeBytes, actorName },
      new Date().toISOString(),
    ),
  );
  if (outcome.ok) revalidatePilgrims(pilgrimId);
  return outcome;
}

export async function removeSupportCaseAttachmentAction(input: unknown): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageSupportRequests) return { ok: false, error: "Your role cannot remove a case attachment." };

  const parsed = removeSupportCaseAttachmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { pilgrimId, requestId, attachmentId } = parsed.data;

  const outcome = await mutate(pilgrimId, (store, actorName) =>
    removeSupportCaseAttachmentInStore(store, { attachmentId, requestId, actorName }, new Date().toISOString()),
  );
  if (!outcome.ok) return outcome;

  revalidatePilgrims(pilgrimId);
  // Best-effort: the row is already gone, a leftover object in storage is not
  // a correctness problem, just orphaned bytes.
  void deleteSupportCaseAttachmentObject(outcome.filePath);
  return { ok: true };
}

/* ── Consent ──────────────────────────────────────────────────────────────── */

/**
 * Records an explicit consent/do-not-contact decision on a pilgrim. Gated
 * by `editPersonalDetails` — the same capability that already lets a role
 * change any other personal field. Writes the `consent_events` audit row
 * directly (outside the diffed pilgrim store) after the store mutation
 * succeeds.
 */
export async function updatePilgrimConsentAction(input: {
  pilgrimId: string;
  consentStatus: ConsentStatus;
  doNotContact: boolean;
  contactableChannels: ConsentChannel[];
  source: string;
  note?: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  if (!capabilitiesForPilgrims(role).editPersonalDetails) {
    return { ok: false, error: "Your role cannot record consent decisions." };
  }
  if (!input.source.trim()) {
    return { ok: false, error: "Say where this decision came from (e.g. WhatsApp reply, verbal at check-in)." };
  }

  const actorName = name ?? "Staff";
  const outcome = await mutate(input.pilgrimId, (store) =>
    updatePilgrimConsentInStore(
      store,
      {
        pilgrimId: input.pilgrimId,
        consentStatus: input.consentStatus,
        doNotContact: input.doNotContact,
        contactableChannels: input.contactableChannels,
        source: input.source,
        actorName,
      },
      new Date().toISOString(),
    ),
  );
  if (!outcome.ok) return outcome;

  const supabase = await db();
  const { error } = await supabase.from("consent_events").insert({
    subject_type: "PILGRIM",
    subject_id: input.pilgrimId,
    action: input.doNotContact ? "DNC_SET" : input.consentStatus === "OPTED_IN" ? "OPT_IN" : "OPT_OUT",
    channel: null,
    source: input.source.trim(),
    note: input.note?.trim() || null,
    actor_name: actorName,
  });
  if (error) console.error("consent_events insert failed:", error.message);

  revalidatePilgrims(input.pilgrimId);
  return outcome;
}

/* ── Notes ────────────────────────────────────────────────────────────────── */

export async function addPilgrimNoteAction(input: { pilgrimId: string; note: string }): Promise<MutationOutcome> {
  await requireUser();
  if (!input.note.trim()) return { ok: false, error: "The note is empty." };

  const outcome = await mutate(input.pilgrimId, (store, actorName) => {
    pushPilgrimActivity(
      store,
      { pilgrimId: input.pilgrimId, type: "NOTE", message: input.note.trim(), actorName },
      new Date().toISOString(),
    );
    return { ok: true };
  });
  if (outcome.ok) revalidatePilgrims(input.pilgrimId);
  return outcome;
}

/** Logged, no real message send yet — composes the request for a staff member to send by hand. */
export async function requestDocumentAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  documentName: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const outcome = await mutate(input.pilgrimId, (store, actorName) => {
    pushPilgrimActivity(
      store,
      {
        pilgrimId: input.pilgrimId,
        departureGroupId: input.departureGroupId,
        type: "DOCUMENT",
        message: `Requested "${input.documentName}" via WhatsApp.`,
        actorName,
      },
      new Date().toISOString(),
    );
    return { ok: true };
  });
  if (outcome.ok) revalidatePilgrims(input.pilgrimId);
  return outcome;
}

/* ── Documents — delegate to the existing Departure Groups mutators, then log
   a person-level activity row so the timeline stays complete ────────────── */

async function logJourneyEvent(
  pilgrimId: string,
  departureGroupId: string,
  type: "DOCUMENT" | "VISA" | "PAYMENT" | "ROOM" | "FLIGHT",
  message: string,
) {
  await mutate(pilgrimId, (store, actorName) => {
    pushPilgrimActivity(store, { pilgrimId, departureGroupId, type, message, actorName: actorName }, new Date().toISOString());
    return { ok: true };
  });
}

export async function submitDocumentOnBehalfAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  documentId: string;
  documentName: string;
  filePath?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.uploadDocuments) return { ok: false, error: "Your role cannot upload documents." };

  const result = await submitGroupPilgrimDocument({
    documentId: input.documentId,
    departureGroupId: input.departureGroupId,
    filePath: input.filePath,
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
  });
  if (!result.ok) return result;

  await logJourneyEvent(input.pilgrimId, input.departureGroupId, "DOCUMENT", `${input.documentName} uploaded on behalf of the pilgrim.`);
  revalidatePilgrims(input.pilgrimId);
  return { ok: true };
}

export async function verifyPilgrimDocumentAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  documentId: string;
  documentName: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.verifyDocuments) return { ok: false, error: "Your role cannot verify documents." };

  const result = await verifyGroupPilgrimDocument({ documentId: input.documentId, departureGroupId: input.departureGroupId });
  if (!result.ok) return result;

  await logJourneyEvent(input.pilgrimId, input.departureGroupId, "DOCUMENT", `${input.documentName} verified.`);
  revalidatePilgrims(input.pilgrimId);
  return { ok: true };
}

export async function rejectPilgrimDocumentAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  documentId: string;
  documentName: string;
  reason: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.verifyDocuments) return { ok: false, error: "Your role cannot reject documents." };

  const result = await rejectGroupPilgrimDocument({
    documentId: input.documentId,
    departureGroupId: input.departureGroupId,
    reason: input.reason,
  });
  if (!result.ok) return result;

  await logJourneyEvent(input.pilgrimId, input.departureGroupId, "DOCUMENT", `${input.documentName} sent back: ${input.reason}`);
  revalidatePilgrims(input.pilgrimId);
  return { ok: true };
}

export async function waivePilgrimDocumentAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  documentId: string;
  documentName: string;
  reason: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.verifyDocuments) return { ok: false, error: "Your role cannot waive documents." };

  const result = await waiveGroupPilgrimDocument({
    documentId: input.documentId,
    departureGroupId: input.departureGroupId,
    reason: input.reason,
  });
  if (!result.ok) return result;

  await logJourneyEvent(input.pilgrimId, input.departureGroupId, "DOCUMENT", `${input.documentName} marked not required: ${input.reason}`);
  revalidatePilgrims(input.pilgrimId);
  return { ok: true };
}

/* ── Visa ─────────────────────────────────────────────────────────────────── */

export async function markVisaReadyOrSubmittedAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  journeyId: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageVisa) return { ok: false, error: "Your role cannot manage visas." };

  const result = await markGroupApplicationsSubmitted({ departureGroupId: input.departureGroupId, pilgrimIds: [input.journeyId] });
  if (!result.ok) return result as MutationOutcome;

  await logJourneyEvent(input.pilgrimId, input.departureGroupId, "VISA", "Visa application submitted.");
  revalidatePilgrims(input.pilgrimId);
  return { ok: true };
}

export async function markVisaUnderReviewAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  journeyId: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageVisa) return { ok: false, error: "Your role cannot manage visas." };

  const result = await markGroupVisasUnderReview({ departureGroupId: input.departureGroupId, pilgrimIds: [input.journeyId] });
  if (!("ok" in result) || !result.ok) return { ok: false, error: "Could not move the application into review." };

  await logJourneyEvent(input.pilgrimId, input.departureGroupId, "VISA", "Visa moved into consulate review.");
  revalidatePilgrims(input.pilgrimId);
  return { ok: true };
}

export async function uploadPilgrimVisaAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  journeyId: string;
  visaId: string;
  filePath?: string | null;
  expiryDate?: string | null;
  issueNote?: string | null;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageVisa) return { ok: false, error: "Your role cannot manage visas." };
  if (!input.visaId.trim()) return { ok: false, error: "Enter the visa number." };

  const result = await uploadGroupPilgrimVisa({
    id: input.journeyId,
    departureGroupId: input.departureGroupId,
    visaId: input.visaId.trim(),
    filePath: input.filePath,
    expiryDate: input.expiryDate,
    issueNote: input.issueNote,
  });
  if (!result.ok) return result;

  await logJourneyEvent(input.pilgrimId, input.departureGroupId, "VISA", `Visa approved and recorded (${input.visaId.trim()}).`);
  revalidatePilgrims(input.pilgrimId);
  return { ok: true };
}

export async function rejectPilgrimVisaAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  journeyId: string;
  reason: string;
  canReapply: boolean;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.manageVisa) return { ok: false, error: "Your role cannot manage visas." };

  const result = await rejectGroupPilgrimVisa({
    id: input.journeyId,
    departureGroupId: input.departureGroupId,
    reason: input.reason,
    canReapply: input.canReapply,
  });
  if (!result.ok) return result;

  await logJourneyEvent(input.pilgrimId, input.departureGroupId, "VISA", `Visa rejected: ${input.reason}`);
  revalidatePilgrims(input.pilgrimId);
  return { ok: true };
}

/* ── Payments ─────────────────────────────────────────────────────────────── */

export async function recordPilgrimPaymentAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  bookingId: string;
  amount: number;
  note?: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.recordPayments) return { ok: false, error: "Your role cannot record payments." };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Enter a payment amount greater than zero." };
  }

  const bookingResult = await recordBookingPayment({
    bookingId: input.bookingId,
    departureGroupId: input.departureGroupId,
    amount: input.amount,
    note: input.note,
  });
  if (!bookingResult.ok) return bookingResult;

  const outcome = await mutate(input.pilgrimId, (store, actorName) =>
    allocatePaymentToMilestonesInStore(
      store,
      { bookingId: input.bookingId, amount: input.amount, note: input.note, recordedByName: actorName },
      new Date().toISOString(),
    ),
  );
  if (outcome.ok) revalidatePilgrims(input.pilgrimId);
  return outcome;
}

export async function sendPaymentReminderAction(input: {
  pilgrimId: string;
  departureGroupId: string;
  amountDue: number;
}): Promise<MutationOutcome> {
  await requireUser();
  await logJourneyEvent(
    input.pilgrimId,
    input.departureGroupId,
    "PAYMENT",
    `Payment reminder sent for LKR ${input.amountDue.toLocaleString("en-US")}.`,
  );
  revalidatePilgrims(input.pilgrimId);
  return { ok: true };
}

/* ── Cancel ───────────────────────────────────────────────────────────────── */

export async function cancelPilgrimAction(input: {
  pilgrimId: string;
  journeyId: string;
  departureGroupId: string;
  reason: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.moveOrCancelPilgrim) return { ok: false, error: "Your role cannot cancel a pilgrim." };
  if (!input.reason.trim()) return { ok: false, error: "A cancellation reason is required." };

  const now = new Date().toISOString();
  const supabase = await db();
  await updateJourneyFields(supabase, input.journeyId, {
    journey_status: "CANCELLED",
    cancellation_reason: input.reason.trim(),
    cancelled_at: now,
  });

  const outcome = await mutate(input.pilgrimId, (store, actorName) => {
    pushPilgrimActivity(
      store,
      {
        pilgrimId: input.pilgrimId,
        departureGroupId: input.departureGroupId,
        type: "STATUS",
        message: `Marked cancelled: ${input.reason.trim()}`,
        actorName,
      },
      now,
    );
    return { ok: true };
  });
  revalidatePilgrims(input.pilgrimId);
  return outcome;
}

/* ── Manual creation ──────────────────────────────────────────────────────── */

export interface CreatePilgrimResult extends MutationOutcome {
  pilgrimId?: string;
  reference?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Creates a standalone person record — for walk-ins, data migration, and
 * corrections, as the spec describes. Most pilgrims arrive automatically from
 * a Booking (`resolveOrCreatePilgrimPerson`, called from
 * `createGroupBooking()`); this path does not attach a journey.
 */
export async function createPilgrimAction(input: {
  fullName: string;
  whatsappNumber: string;
  passportNumber?: string;
  city?: string;
}): Promise<CreatePilgrimResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.createPilgrim) return { ok: false, error: "Your role cannot create pilgrims." };
  if (!input.fullName.trim()) return { ok: false, error: "Enter the pilgrim's full name." };
  if (!input.whatsappNumber.trim()) return { ok: false, error: "A WhatsApp / mobile number is required." };

  const supabase = await db();
  const pilgrimId = await resolveOrCreatePilgrimPerson(supabase, {
    fullName: input.fullName,
    whatsappNumber: input.whatsappNumber,
    passportNumber: input.passportNumber ?? null,
  });

  if (input.city?.trim()) {
    await supabase.from("pilgrims").update({ city: input.city.trim() }).eq("id", pilgrimId);
  }

  revalidatePilgrims();
  return { ok: true, pilgrimId };
}
