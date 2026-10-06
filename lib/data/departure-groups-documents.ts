/**
 * Traveller documents and the visa stage machine, kept pure and store-passing
 * so it can be unit-tested without the Next server runtime (mirroring
 * `departure-groups-transport.ts` and `departure-groups-rooming.ts`). The thin
 * wrappers in `departure-groups.ts` supply the live store.
 *
 * The shape of this module changed for one reason: a pilgrim's paperwork used
 * to be two integers. `documents_completed = 4` of `documents_required = 8`
 * could not say *which* four were done, who verified them, or why one came
 * back — even though the package template names all eight, with the stage each
 * is due at and the role that signs it off. `departure_group_pilgrim_documents`
 * now holds one row per requirement, the counters are derived caches of those
 * rows, and the visa status is derived from them too.
 *
 * That last part answers the question the old design could not: *when does the
 * visa stage arrive?* It arrives on its own, the moment every required
 * `BEFORE_VISA_SUBMISSION` document is verified and the passport clears the
 * six-month rule. Nobody flips it by hand, because a human flipping it was
 * exactly how an incomplete file reached a consulate.
 */

import { newId } from "@/lib/data/departure-groups-ids";
import { refuseFileOutsidePilgrimFolder } from "@/lib/data/departure-groups-upload-guard";
import { groupPrice } from "@/lib/data/departure-groups-money";
import type {
  DepartureGroupPilgrimDocumentRow,
  DepartureGroupPilgrimRow,
  DepartureGroupRow,
  DocumentStatus,
  EmergencyContactStatus,
  GroupActor,
  PilgrimVisaStatus,
  DepartureGroupStore,
} from "@/lib/types/departure-groups";

/* ── Shared lookups ───────────────────────────────────────────────────────── */

function findPilgrim(
  data: DepartureGroupStore,
  id: string,
  departureGroupId: string,
): DepartureGroupPilgrimRow | undefined {
  return data.pilgrims.find(
    (p) => p.id === id && p.departure_group_id === departureGroupId,
  );
}

function documentsFor(
  data: DepartureGroupStore,
  pilgrimId: string,
): DepartureGroupPilgrimDocumentRow[] {
  return data.pilgrimDocuments.filter((d) => d.pilgrim_id === pilgrimId);
}

/** A document that is required and has not been waived as inapplicable. */
function counts(documents: DepartureGroupPilgrimDocumentRow[]) {
  const applicable = documents.filter(
    (d) => d.required && d.status !== "NOT_APPLICABLE",
  );
  return {
    applicable,
    verified: applicable.filter((d) => d.status === "VERIFIED"),
  };
}

/* ── Six-month passport rule ──────────────────────────────────────────────── */

/**
 * Saudi entry requires a passport valid for at least six months beyond the date
 * of travel. The rule is checked against the group's *return* date rather than
 * its departure date — a passport that expires mid-journey is refused just as
 * firmly as one that has already lapsed.
 */
export const PASSPORT_VALIDITY_MONTHS = 6;

export type PassportValidity =
  | { ok: true }
  | { ok: false; reason: string };

export function checkPassportValidity(
  pilgrim: DepartureGroupPilgrimRow,
  group: Pick<DepartureGroupRow, "return_date">,
): PassportValidity {
  if (!pilgrim.passport_number_snapshot?.trim()) {
    return { ok: false, reason: "No passport number has been recorded." };
  }
  if (!pilgrim.passport_expiry) {
    return {
      ok: false,
      reason: "No passport expiry date has been recorded, so the six-month rule cannot be checked.",
    };
  }

  const required = new Date(`${group.return_date}T00:00:00.000Z`);
  required.setUTCMonth(required.getUTCMonth() + PASSPORT_VALIDITY_MONTHS);
  const expiry = Date.parse(`${pilgrim.passport_expiry}T00:00:00.000Z`);

  if (Number.isNaN(expiry)) {
    return { ok: false, reason: "The recorded passport expiry date is not a valid date." };
  }
  if (expiry < required.getTime()) {
    return {
      ok: false,
      reason: `Passport expires ${pilgrim.passport_expiry}, inside the ${PASSPORT_VALIDITY_MONTHS}-month window after the ${group.return_date} return. It must be renewed before the visa can be submitted.`,
    };
  }
  return { ok: true };
}

/* ── Documents the system can evaluate for itself ─────────────────────────── */

/**
 * Three of the template's standard requirements are not really uploads — they
 * are assertions about data the CRM already holds, and leaving them as manual
 * ticks meant the checklist could disagree with the booking beside it.
 */
type DerivableRule =
  | "PASSPORT_VALIDITY"
  | "EMERGENCY_CONTACT"
  | "DEPOSIT_THRESHOLD";

const DERIVABLE_KEYWORDS: [RegExp, DerivableRule][] = [
  [/passport\s*validity|valid.*\d+\s*month/i, "PASSPORT_VALIDITY"],
  [/emergency\s*contact|next\s*of\s*kin/i, "EMERGENCY_CONTACT"],
  [/deposit\s*threshold|booking\s*deposit/i, "DEPOSIT_THRESHOLD"],
];

function derivableRuleFor(
  document: DepartureGroupPilgrimDocumentRow,
): DerivableRule | null {
  for (const [pattern, rule] of DERIVABLE_KEYWORDS) {
    if (pattern.test(document.name)) return rule;
  }
  return null;
}

/**
 * Re-evaluates every document whose answer is already in the database.
 *
 * Run after any mutation that could change one of the underlying facts —
 * a payment, a passport edit, an emergency contact being captured — so the
 * checklist never asks an operator to tick something the system can see.
 *
 * A derivable document is only ever moved between `NOT_SUBMITTED` and
 * `VERIFIED` (or `REJECTED` with the reason the rule failed). A human decision
 * — `NOT_APPLICABLE` — is left alone.
 */
export function evaluateDerivableDocuments(
  data: DepartureGroupStore,
  pilgrim: DepartureGroupPilgrimRow,
  now: string,
): void {
  const group = data.groups.find((g) => g.id === pilgrim.departure_group_id);
  const booking = data.bookings.find((b) => b.id === pilgrim.booking_id);
  const snapshot = data.snapshots.find(
    (s) => s.departure_group_id === pilgrim.departure_group_id,
  );
  const pricingRow = data.pricing.find(
    (p) => p.departure_group_id === pilgrim.departure_group_id,
  );

  for (const document of documentsFor(data, pilgrim.id)) {
    if (document.status === "NOT_APPLICABLE") continue;
    const rule = derivableRuleFor(document);
    if (!rule) continue;

    let verdict: { ok: true } | { ok: false; reason: string } | null = null;

    switch (rule) {
      case "PASSPORT_VALIDITY": {
        if (!group) break;
        verdict = checkPassportValidity(pilgrim, group);
        break;
      }
      case "EMERGENCY_CONTACT": {
        verdict =
          deriveEmergencyContactStatus(pilgrim) === "COMPLETE"
            ? { ok: true }
            : {
                ok: false,
                reason:
                  "A next-of-kin name and a reachable phone number are both required.",
              };
        break;
      }
      case "DEPOSIT_THRESHOLD": {
        if (!booking) break;
        // The deposit is a per-person figure on the group's CURRENT price
        // (never the frozen snapshot — a reprice must move this gate too);
        // the booking pays it for everyone it carries.
        const perPerson =
          groupPrice(pricingRow, snapshot?.pricing_snapshot).advanceDeposit ??
          0;
        const due = perPerson * booking.traveller_count;
        verdict =
          booking.amount_paid >= due
            ? { ok: true }
            : {
                ok: false,
                reason: `Deposit of ${due.toLocaleString("en-US")} not yet met — ${booking.amount_paid.toLocaleString("en-US")} received.`,
              };
        break;
      }
    }

    if (!verdict) continue;

    if (verdict.ok) {
      if (document.status === "VERIFIED") continue;
      document.status = "VERIFIED";
      document.verified_at = now;
      document.verified_by = null;
      document.verified_by_name = "System";
      document.rejection_reason = null;
      document.submitted_at ??= now;
    } else {
      // Never demote a file a person actually inspected and signed off.
      if (document.verified_by !== null) continue;
      if (
        document.status === "REJECTED" &&
        document.rejection_reason === verdict.reason
      ) {
        continue;
      }
      document.status = "REJECTED";
      document.rejection_reason = verdict.reason;
      document.verified_at = null;
      document.verified_by_name = "System";
    }
  }
}

/* ── Derived pilgrim fields ───────────────────────────────────────────────── */

export function deriveEmergencyContactStatus(
  pilgrim: DepartureGroupPilgrimRow,
): EmergencyContactStatus {
  const name = pilgrim.emergency_contact_name?.trim();
  const phone = pilgrim.emergency_contact_phone?.trim();
  if (name && phone) return "COMPLETE";
  if (name || phone) return "INCOMPLETE";
  return "MISSING";
}

/**
 * Visa states the pilgrim reaches by paperwork alone.
 *
 * Everything from `SUBMITTED` onwards is an external fact — a file lodged with
 * a consulate, a decision returned — so those are never inferred here; they are
 * written by the explicit transitions further down. This function only decides
 * where a pilgrim sits *before* the file leaves the building, which is the part
 * that used to require someone to notice and click.
 */
function derivePreSubmissionVisaStatus(
  pilgrim: DepartureGroupPilgrimRow,
  documents: DepartureGroupPilgrimDocumentRow[],
  group: Pick<DepartureGroupRow, "return_date"> | undefined,
): PilgrimVisaStatus {
  const gating = documents.filter(
    (d) =>
      d.required &&
      d.status !== "NOT_APPLICABLE" &&
      (d.required_by_stage === "ON_BOOKING" ||
        d.required_by_stage === "BEFORE_VISA_SUBMISSION"),
  );

  const anyProgress = documents.some(
    (d) => d.status !== "NOT_SUBMITTED" && d.status !== "NOT_APPLICABLE",
  );
  if (!anyProgress) return "NOT_STARTED";

  const allVerified =
    gating.length > 0 && gating.every((d) => d.status === "VERIFIED");
  if (!allVerified) return "DOCUMENTS_PENDING";

  // A complete file with an expiring passport is still not submittable.
  if (group && !checkPassportValidity(pilgrim, group).ok) {
    return "DOCUMENTS_PENDING";
  }
  return "READY_TO_SUBMIT";
}

/** States that mean the file has already left the building. */
const IN_FLIGHT_VISA_STATES = new Set<PilgrimVisaStatus>([
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
]);

/**
 * Recomputes one pilgrim's document counters and visa stage from their document
 * rows.
 *
 * Called after every mutation that touches a document, so the two caches on the
 * pilgrim row and the stage the Visa tab filters on can never drift from the
 * rows underneath them.
 */
export function syncPilgrimDerivedState(
  data: DepartureGroupStore,
  pilgrim: DepartureGroupPilgrimRow,
  now: string,
): void {
  evaluateDerivableDocuments(data, pilgrim, now);

  const documents = documentsFor(data, pilgrim.id);
  const { applicable, verified } = counts(documents);

  pilgrim.documents_required = applicable.length;
  pilgrim.documents_completed = verified.length;
  pilgrim.document_completion_percent =
    applicable.length === 0
      ? 100
      : Math.round((verified.length / applicable.length) * 100);

  pilgrim.emergency_contact_status = deriveEmergencyContactStatus(pilgrim);

  // A rejected document on a file already lodged means rework, whatever the
  // pre-submission derivation would otherwise say.
  const rejected = documents.some((d) => d.required && d.status === "REJECTED");
  if (
    rejected &&
    (pilgrim.visa_status === "SUBMITTED" || pilgrim.visa_status === "UNDER_REVIEW")
  ) {
    pilgrim.visa_status = "REWORK_REQUIRED";
    return;
  }

  if (IN_FLIGHT_VISA_STATES.has(pilgrim.visa_status)) return;

  const group = data.groups.find((g) => g.id === pilgrim.departure_group_id);
  const derived = derivePreSubmissionVisaStatus(pilgrim, documents, group);

  // Rework is cleared by fixing the documents, which is exactly what a
  // derivation reaching READY_TO_SUBMIT means.
  if (pilgrim.visa_status === "REWORK_REQUIRED" && derived !== "READY_TO_SUBMIT") {
    return;
  }
  pilgrim.visa_status = derived;
}

/** Re-derives every pilgrim on a group. Used after group-wide mutations. */
export function syncGroupDerivedState(
  data: DepartureGroupStore,
  departureGroupId: string,
  now: string = new Date().toISOString(),
): void {
  for (const pilgrim of data.pilgrims) {
    if (pilgrim.departure_group_id !== departureGroupId) continue;
    if (pilgrim.seat_status === "CANCELLED") continue;
    syncPilgrimDerivedState(data, pilgrim, now);
  }
}

/* ── Per-document mutations ───────────────────────────────────────────────── */

export type DocumentOutcome =
  | {
      ok: true;
      result: {
        fullName: string;
        documentName: string;
        status: DocumentStatus;
        documentsCompleted: number;
        documentsRequired: number;
        visaStatus: PilgrimVisaStatus;
      };
    }
  | { ok: false; error: string };

interface DocumentContext {
  pilgrim: DepartureGroupPilgrimRow;
  document: DepartureGroupPilgrimDocumentRow;
}

function resolveDocument(
  data: DepartureGroupStore,
  input: { documentId: string; departureGroupId: string },
): DocumentContext | { error: string } {
  const document = data.pilgrimDocuments.find(
    (d) =>
      d.id === input.documentId &&
      d.departure_group_id === input.departureGroupId,
  );
  if (!document) {
    return { error: "That document is no longer on this group." };
  }
  const pilgrim = findPilgrim(data, document.pilgrim_id, input.departureGroupId);
  if (!pilgrim) {
    return { error: "That pilgrim is no longer on this group." };
  }
  if (pilgrim.seat_status === "CANCELLED") {
    return {
      error: `${pilgrim.full_name_snapshot}'s booking has been cancelled — their paperwork is closed.`,
    };
  }
  return { pilgrim, document };
}

function success(
  pilgrim: DepartureGroupPilgrimRow,
  document: DepartureGroupPilgrimDocumentRow,
): DocumentOutcome {
  return {
    ok: true,
    result: {
      fullName: pilgrim.full_name_snapshot,
      documentName: document.name,
      status: document.status,
      documentsCompleted: pilgrim.documents_completed,
      documentsRequired: pilgrim.documents_required,
      visaStatus: pilgrim.visa_status,
    },
  };
}

function logDocument(
  data: DepartureGroupStore,
  pilgrim: DepartureGroupPilgrimRow,
  document: DepartureGroupPilgrimDocumentRow,
  actor: GroupActor,
  now: string,
  actionType: string,
  message: string,
  before: Record<string, unknown>,
  highImpact: boolean,
): void {
  data.activity.push({
    id: newId(),
    departure_group_id: pilgrim.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: actionType,
    entity_type: "DOCUMENT",
    entity_id: document.id,
    before_value: before,
    after_value: {
      status: document.status,
      documents_completed: pilgrim.documents_completed,
      visa_status: pilgrim.visa_status,
    },
    message,
    is_system: false,
    is_high_impact: highImpact,
    created_at: now,
  });
}

/* Record a received file ─────────────────────────────────────────────────── */

export interface SubmitDocumentInput {
  documentId: string;
  departureGroupId: string;
  /** Object path inside the private `pilgrim-documents` bucket. */
  filePath?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  notes?: string | null;
}

/**
 * Records that a document has been received from the traveller.
 *
 * Receiving is deliberately separate from verifying: the person who collects a
 * passport scan on WhatsApp is rarely the person whose sign-off the requirement
 * names, and collapsing the two is what let a whole checklist be cleared with
 * one click.
 */
export function submitPilgrimDocumentInStore(
  data: DepartureGroupStore,
  input: SubmitDocumentInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): DocumentOutcome {
  const resolved = resolveDocument(data, input);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const { pilgrim, document } = resolved;

  if (document.status === "NOT_APPLICABLE") {
    return {
      ok: false,
      error: `${document.name} is marked not applicable for ${pilgrim.full_name_snapshot}.`,
    };
  }
  if (derivableRuleFor(document)) {
    return {
      ok: false,
      error: `${document.name} is verified from the record the CRM already holds, not from an upload.`,
    };
  }

  const misplacedFile = refuseFileOutsidePilgrimFolder(input.filePath, actor.agencyId, input.departureGroupId, pilgrim.id);
  if (misplacedFile) return { ok: false, error: misplacedFile };

  const before = { status: document.status, file_path: document.file_path };

  document.status = "SUBMITTED";
  document.submitted_at = now;
  // A resubmission answers the previous refusal, so the old reason is cleared.
  document.rejection_reason = null;
  document.verified_at = null;
  document.verified_by = null;
  document.verified_by_name = null;
  if (input.filePath !== undefined) document.file_path = input.filePath;
  if (input.fileName !== undefined) document.file_name = input.fileName;
  if (input.fileSizeBytes !== undefined) {
    document.file_size_bytes = input.fileSizeBytes;
  }
  if (input.notes !== undefined) document.notes = input.notes?.trim() || null;

  syncPilgrimDerivedState(data, pilgrim, now);
  logDocument(
    data,
    pilgrim,
    document,
    actor,
    now,
    "DOCUMENT_SUBMITTED",
    `${document.name} received for ${pilgrim.full_name_snapshot}. Awaiting ${document.verified_by_role.toLowerCase()} verification.`,
    before,
    false,
  );

  return success(pilgrim, document);
}

/* Verify one document ────────────────────────────────────────────────────── */

export interface VerifyDocumentInput {
  documentId: string;
  departureGroupId: string;
  notes?: string | null;
}

/**
 * Signs off a single document.
 *
 * The template names the role that verifies each requirement — Visa for the
 * passport checks, Finance for the deposit, Admin for the NIC — and that is
 * enforced here rather than being decorative metadata. Admin may sign off
 * anything, because somebody has to be able to unblock a group at 2am.
 */
export function verifyPilgrimDocumentInStore(
  data: DepartureGroupStore,
  input: VerifyDocumentInput,
  actor: GroupActor,
  actorRole: string,
  now: string = new Date().toISOString(),
): DocumentOutcome {
  const resolved = resolveDocument(data, input);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const { pilgrim, document } = resolved;

  if (document.status === "VERIFIED") {
    return {
      ok: false,
      error: `${document.name} is already verified for ${pilgrim.full_name_snapshot}.`,
    };
  }
  if (document.status === "NOT_APPLICABLE") {
    return {
      ok: false,
      error: `${document.name} is marked not applicable for ${pilgrim.full_name_snapshot}.`,
    };
  }
  if (!canRoleVerify(actorRole, document.verified_by_role)) {
    return {
      ok: false,
      error: `${document.name} is verified by ${titleCase(document.verified_by_role)}, not ${titleCase(actorRole)}.`,
    };
  }

  const rule = derivableRuleFor(document);
  if (rule) {
    return {
      ok: false,
      error: `${document.name} is verified from the record itself — update the ${describeRule(rule)} and it clears on its own.`,
    };
  }
  if (!document.file_path) {
    return {
      ok: false,
      error: `Nothing has been received for ${document.name} yet — record the file before verifying it.`,
    };
  }

  const before = { status: document.status };

  document.status = "VERIFIED";
  document.verified_at = now;
  document.verified_by = actor.id;
  document.verified_by_name = actor.name;
  document.rejection_reason = null;
  document.submitted_at ??= now;
  if (input.notes !== undefined) document.notes = input.notes?.trim() || null;

  const visaBefore = pilgrim.visa_status;
  syncPilgrimDerivedState(data, pilgrim, now);

  const advanced =
    visaBefore !== pilgrim.visa_status && pilgrim.visa_status === "READY_TO_SUBMIT"
      ? ` ${pilgrim.full_name_snapshot} is now ready to submit.`
      : "";

  logDocument(
    data,
    pilgrim,
    document,
    actor,
    now,
    "DOCUMENT_VERIFIED",
    `${document.name} verified for ${pilgrim.full_name_snapshot} (${pilgrim.documents_completed}/${pilgrim.documents_required}).${advanced}`,
    before,
    false,
  );

  return success(pilgrim, document);
}

/* Reject one document ────────────────────────────────────────────────────── */

export interface RejectDocumentInput {
  documentId: string;
  departureGroupId: string;
  reason: string;
}

/**
 * Sends one document back, naming it and saying why.
 *
 * The predecessor of this function decremented a counter by one, which told
 * nobody which document was wrong — so the traveller was chased for "a
 * document" and the agency guessed. A refusal without a reason is refused here
 * for the same reason the database refuses it.
 */
export function rejectPilgrimDocumentInStore(
  data: DepartureGroupStore,
  input: RejectDocumentInput,
  actor: GroupActor,
  actorRole: string,
  now: string = new Date().toISOString(),
): DocumentOutcome {
  const resolved = resolveDocument(data, input);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const { pilgrim, document } = resolved;

  const reason = input.reason?.trim();
  if (!reason) {
    return {
      ok: false,
      error: "Say what is wrong with the document — the traveller has to act on it.",
    };
  }
  if (document.status === "NOT_SUBMITTED") {
    return {
      ok: false,
      error: `Nothing has been received for ${document.name} yet — there is nothing to send back.`,
    };
  }
  if (document.status === "NOT_APPLICABLE") {
    return {
      ok: false,
      error: `${document.name} is marked not applicable for ${pilgrim.full_name_snapshot}.`,
    };
  }
  if (!canRoleVerify(actorRole, document.verified_by_role)) {
    return {
      ok: false,
      error: `${document.name} is verified by ${titleCase(document.verified_by_role)}, not ${titleCase(actorRole)}.`,
    };
  }

  const before = { status: document.status };

  document.status = "REJECTED";
  document.rejection_reason = reason;
  document.verified_at = null;
  document.verified_by = actor.id;
  document.verified_by_name = actor.name;

  const visaBefore = pilgrim.visa_status;
  syncPilgrimDerivedState(data, pilgrim, now);

  const lodged =
    visaBefore === "SUBMITTED" || visaBefore === "UNDER_REVIEW"
      ? " The application is already lodged, so it moves to rework."
      : "";

  logDocument(
    data,
    pilgrim,
    document,
    actor,
    now,
    "DOCUMENT_REJECTED",
    `${document.name} rejected for ${pilgrim.full_name_snapshot}: ${reason}${lodged}`,
    before,
    true,
  );

  return success(pilgrim, document);
}

/* Waive one document ─────────────────────────────────────────────────────── */

export interface WaiveDocumentInput {
  documentId: string;
  departureGroupId: string;
  reason: string;
}

/**
 * Marks a requirement inapplicable to this traveller — an infant with no NIC,
 * a pilgrim whose insurance the agency is providing directly.
 *
 * It leaves the required flag alone and simply drops out of both the numerator
 * and the denominator, so the completion percentage stays honest rather than
 * being inflated by a waiver.
 */
export function waivePilgrimDocumentInStore(
  data: DepartureGroupStore,
  input: WaiveDocumentInput,
  actor: GroupActor,
  actorRole: string,
  now: string = new Date().toISOString(),
): DocumentOutcome {
  const resolved = resolveDocument(data, input);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const { pilgrim, document } = resolved;

  const reason = input.reason?.trim();
  if (!reason) {
    return { ok: false, error: "Say why this requirement does not apply." };
  }
  if (document.status === "NOT_APPLICABLE") {
    return { ok: false, error: `${document.name} is already waived.` };
  }
  if (!canRoleVerify(actorRole, document.verified_by_role)) {
    return {
      ok: false,
      error: `${document.name} is owned by ${titleCase(document.verified_by_role)}, not ${titleCase(actorRole)}.`,
    };
  }

  const before = { status: document.status };

  document.status = "NOT_APPLICABLE";
  document.notes = reason;
  document.rejection_reason = null;
  document.verified_at = now;
  document.verified_by = actor.id;
  document.verified_by_name = actor.name;

  syncPilgrimDerivedState(data, pilgrim, now);
  logDocument(
    data,
    pilgrim,
    document,
    actor,
    now,
    "DOCUMENT_WAIVED",
    `${document.name} waived for ${pilgrim.full_name_snapshot}: ${reason}`,
    before,
    true,
  );

  return success(pilgrim, document);
}

/* ── Traveller record edits that feed the derivable documents ─────────────── */

export interface UpdatePilgrimRecordInput {
  id: string;
  departureGroupId: string;
  passportNumber?: string | null;
  passportExpiry?: string | null;
  passportIssueCountry?: string | null;
  dateOfBirth?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
}

export type UpdatePilgrimRecordOutcome =
  | {
      ok: true;
      result: {
        fullName: string;
        changedFields: string[];
        documentsCompleted: number;
        documentsRequired: number;
        visaStatus: PilgrimVisaStatus;
      };
    }
  | { ok: false; error: string };

/**
 * Captures the traveller facts the checklist is checked against.
 *
 * Passport expiry and the next-of-kin contact are not paperwork to be uploaded
 * and eyeballed — they are fields, and once they are present the two
 * requirements that depend on them clear themselves through
 * `evaluateDerivableDocuments`.
 */
export function updatePilgrimRecordInStore(
  data: DepartureGroupStore,
  input: UpdatePilgrimRecordInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UpdatePilgrimRecordOutcome {
  const pilgrim = findPilgrim(data, input.id, input.departureGroupId);
  if (!pilgrim) {
    return { ok: false, error: "That pilgrim is no longer on this group." };
  }
  if (pilgrim.seat_status === "CANCELLED") {
    return {
      ok: false,
      error: `${pilgrim.full_name_snapshot}'s booking has been cancelled.`,
    };
  }

  const group = data.groups.find((g) => g.id === input.departureGroupId);
  const before: Record<string, unknown> = {};
  const changedFields: string[] = [];

  const set = <K extends keyof DepartureGroupPilgrimRow>(
    key: K,
    value: DepartureGroupPilgrimRow[K],
    label: string,
  ) => {
    if (pilgrim[key] === value) return;
    before[key] = pilgrim[key];
    pilgrim[key] = value;
    changedFields.push(label);
  };

  const text = (value: string | null | undefined) => value?.trim() || null;

  if (input.passportNumber !== undefined) {
    set("passport_number_snapshot", text(input.passportNumber), "passport number");
  }
  if (input.passportExpiry !== undefined) {
    const expiry = text(input.passportExpiry);
    // A passport that has already lapsed is a data-entry error worth catching
    // at the point of entry, not at the consulate.
    if (expiry && group && expiry <= group.departure_date) {
      return {
        ok: false,
        error: `That passport expires ${expiry}, before the ${group.departure_date} departure. Check the date on the bio-page.`,
      };
    }
    set("passport_expiry", expiry, "passport expiry");
  }
  if (input.passportIssueCountry !== undefined) {
    set("passport_issue_country", text(input.passportIssueCountry), "passport country");
  }
  if (input.dateOfBirth !== undefined) {
    set("date_of_birth", text(input.dateOfBirth), "date of birth");
  }
  if (input.emergencyContactName !== undefined) {
    set("emergency_contact_name", text(input.emergencyContactName), "emergency contact");
  }
  if (input.emergencyContactPhone !== undefined) {
    set("emergency_contact_phone", text(input.emergencyContactPhone), "emergency phone");
  }
  if (input.emergencyContactRelationship !== undefined) {
    set(
      "emergency_contact_relationship",
      text(input.emergencyContactRelationship),
      "relationship",
    );
  }

  if (changedFields.length === 0) {
    return {
      ok: true,
      result: {
        fullName: pilgrim.full_name_snapshot,
        changedFields: [],
        documentsCompleted: pilgrim.documents_completed,
        documentsRequired: pilgrim.documents_required,
        visaStatus: pilgrim.visa_status,
      },
    };
  }

  syncPilgrimDerivedState(data, pilgrim, now);

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PILGRIM_RECORD_UPDATED",
    entity_type: "PILGRIM",
    entity_id: pilgrim.id,
    before_value: before,
    after_value: {
      documents_completed: pilgrim.documents_completed,
      visa_status: pilgrim.visa_status,
    },
    message: `${pilgrim.full_name_snapshot}: ${changedFields.join(", ")} updated.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      fullName: pilgrim.full_name_snapshot,
      changedFields,
      documentsCompleted: pilgrim.documents_completed,
      documentsRequired: pilgrim.documents_required,
      visaStatus: pilgrim.visa_status,
    },
  };
}

/* ── Bulk: mark visa applications submitted ──────────────────────────────── */

export type MarkApplicationsSubmittedOutcome =
  | {
      ok: true;
      result: {
        submittedCount: number;
        /** Named so the operator can act, rather than told "some were skipped". */
        skipped: { fullName: string; reason: string }[];
      };
    }
  | { ok: false; error: string };

/**
 * Lodges the selected pilgrims' applications.
 *
 * `READY_TO_SUBMIT` is now a derived fact — every gating document verified and
 * the passport clear of the six-month rule — so this checks that one state
 * rather than re-deriving the rules a second time. Anyone not ready is returned
 * with the reason, because "no selected pilgrim is ready" left the operator
 * with nowhere to go.
 */
export function markApplicationsSubmittedInStore(
  data: DepartureGroupStore,
  input: { departureGroupId: string; pilgrimIds: string[] },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): MarkApplicationsSubmittedOutcome {
  const selected = data.pilgrims.filter(
    (p) =>
      p.departure_group_id === input.departureGroupId &&
      input.pilgrimIds.includes(p.id),
  );
  if (selected.length === 0) {
    return { ok: false, error: "None of those pilgrims are on this group." };
  }

  const targets: DepartureGroupPilgrimRow[] = [];
  const skipped: { fullName: string; reason: string }[] = [];

  for (const pilgrim of selected) {
    // Keep each pilgrim's derived state current before judging it, so a
    // document verified moments ago is not missed.
    if (pilgrim.seat_status !== "CANCELLED") {
      syncPilgrimDerivedState(data, pilgrim, now);
    }

    if (pilgrim.seat_status === "CANCELLED") {
      skipped.push({
        fullName: pilgrim.full_name_snapshot,
        reason: "Booking cancelled.",
      });
      continue;
    }
    if (pilgrim.visa_status === "APPROVED") {
      skipped.push({
        fullName: pilgrim.full_name_snapshot,
        reason: "Visa already issued.",
      });
      continue;
    }
    if (
      pilgrim.visa_status === "SUBMITTED" ||
      pilgrim.visa_status === "UNDER_REVIEW"
    ) {
      skipped.push({
        fullName: pilgrim.full_name_snapshot,
        reason: "Application already lodged.",
      });
      continue;
    }
    if (pilgrim.visa_status !== "READY_TO_SUBMIT") {
      skipped.push({
        fullName: pilgrim.full_name_snapshot,
        reason: outstandingSummary(data, pilgrim),
      });
      continue;
    }
    targets.push(pilgrim);
  }

  if (targets.length === 0) {
    const first = skipped[0];
    return {
      ok: false,
      error: first
        ? `Nobody selected is ready to submit. ${first.fullName}: ${first.reason}`
        : "Nobody selected is ready to submit.",
    };
  }

  for (const pilgrim of targets) {
    pilgrim.visa_status = "SUBMITTED";
    pilgrim.visa_submitted_at = now;
    pilgrim.visa_rejection_reason = null;
    pilgrim.visa_rejected_at = null;
  }

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "VISA_APPLICATIONS_SUBMITTED",
    entity_type: "VISA",
    entity_id: null,
    before_value: null,
    after_value: { submitted_count: targets.length },
    message: `${targets.length} visa application${targets.length === 1 ? "" : "s"} lodged.${
      skipped.length > 0
        ? ` ${skipped.length} skipped: ${skipped
            .slice(0, 3)
            .map((s) => s.fullName)
            .join(", ")}${skipped.length > 3 ? "…" : ""}.`
        : ""
    }`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return { ok: true, result: { submittedCount: targets.length, skipped } };
}

/** The shortest useful answer to "why can't this pilgrim be submitted?". */
function outstandingSummary(
  data: DepartureGroupStore,
  pilgrim: DepartureGroupPilgrimRow,
): string {
  const group = data.groups.find((g) => g.id === pilgrim.departure_group_id);
  if (group) {
    const passport = checkPassportValidity(pilgrim, group);
    if (!passport.ok) return passport.reason;
  }

  const outstanding = documentsFor(data, pilgrim.id).filter(
    (d) =>
      d.required &&
      d.status !== "VERIFIED" &&
      d.status !== "NOT_APPLICABLE" &&
      (d.required_by_stage === "ON_BOOKING" ||
        d.required_by_stage === "BEFORE_VISA_SUBMISSION"),
  );

  if (outstanding.length === 0) return "Documents are still being verified.";
  const names = outstanding.slice(0, 2).map((d) => d.name).join(", ");
  return outstanding.length > 2
    ? `${names} and ${outstanding.length - 2} more outstanding.`
    : `${names} outstanding.`;
}

/* ── Visa decisions ───────────────────────────────────────────────────────── */

export type VisaDecisionOutcome =
  | {
      ok: true;
      result: { fullName: string; visaStatus: PilgrimVisaStatus };
    }
  | { ok: false; error: string };

/**
 * Acknowledges that the consulate has the file and is working it.
 *
 * `UNDER_REVIEW` was a declared, rendered and filterable state that no code
 * path could ever produce, so the "Under Review" queue showed lodged-but-
 * untouched applications and there was no way to tell the two apart.
 */
export function markVisaUnderReviewInStore(
  data: DepartureGroupStore,
  input: { departureGroupId: string; pilgrimIds: string[]; note?: string | null },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): { ok: true; result: { movedCount: number } } | { ok: false; error: string } {
  const targets = data.pilgrims.filter(
    (p) =>
      p.departure_group_id === input.departureGroupId &&
      input.pilgrimIds.includes(p.id) &&
      p.visa_status === "SUBMITTED",
  );

  if (targets.length === 0) {
    return {
      ok: false,
      error: "Only lodged applications can move to review — none of those are lodged.",
    };
  }

  for (const pilgrim of targets) {
    pilgrim.visa_status = "UNDER_REVIEW";
    pilgrim.visa_reviewed_at = now;
    if (input.note !== undefined) {
      pilgrim.visa_issue_note = input.note?.trim() || null;
    }
  }

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "VISA_UNDER_REVIEW",
    entity_type: "VISA",
    entity_id: null,
    before_value: null,
    after_value: { moved_count: targets.length },
    message: `${targets.length} application${targets.length === 1 ? " is" : "s are"} under review with the consulate.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { movedCount: targets.length } };
}

export interface UploadVisaInput {
  id: string;
  departureGroupId: string;
  visaId: string;
  /** Object path in the private bucket; the issued visa is itself a document. */
  filePath?: string | null;
  expiryDate?: string | null;
  issueNote?: string | null;
}

/** Records an issued visa for one pilgrim ("Upload Visa"). */
export function uploadPilgrimVisaInStore(
  data: DepartureGroupStore,
  input: UploadVisaInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): VisaDecisionOutcome {
  const pilgrim = findPilgrim(data, input.id, input.departureGroupId);
  if (!pilgrim) {
    return { ok: false, error: "That pilgrim is no longer on this group." };
  }
  if (pilgrim.seat_status === "CANCELLED") {
    return {
      ok: false,
      error: `${pilgrim.full_name_snapshot}'s booking has been cancelled.`,
    };
  }
  if (pilgrim.visa_status === "APPROVED") {
    return {
      ok: false,
      error: `${pilgrim.full_name_snapshot} already has an issued visa on file.`,
    };
  }
  // A visa can only come back from an application that went out. This used to
  // reject only NOT_STARTED, which let an issued visa be recorded against a
  // pilgrim whose file was still sitting in the office.
  if (
    pilgrim.visa_status !== "SUBMITTED" &&
    pilgrim.visa_status !== "UNDER_REVIEW" &&
    pilgrim.visa_status !== "REJECTED"
  ) {
    return {
      ok: false,
      error: `${pilgrim.full_name_snapshot}'s application has not been lodged yet — mark it submitted first.`,
    };
  }

  const visaId = input.visaId.trim();
  if (!visaId) {
    return { ok: false, error: "Enter the visa number as issued." };
  }
  const misplacedFile = refuseFileOutsidePilgrimFolder(input.filePath, actor.agencyId, input.departureGroupId, pilgrim.id);
  if (misplacedFile) return { ok: false, error: misplacedFile };

  const group = data.groups.find((g) => g.id === input.departureGroupId);
  const expiry = input.expiryDate?.trim() || null;
  if (expiry && group && expiry < group.return_date) {
    return {
      ok: false,
      error: `That visa expires ${expiry}, before the ${group.return_date} return date. Check the number and the expiry.`,
    };
  }

  const before = { visa_status: pilgrim.visa_status };
  pilgrim.visa_status = "APPROVED";
  pilgrim.visa_id = visaId;
  pilgrim.visa_file_path = input.filePath?.trim() || pilgrim.visa_file_path;
  pilgrim.visa_expiry_date = expiry;
  pilgrim.visa_issue_note = input.issueNote?.trim() || null;
  pilgrim.visa_rejection_reason = null;
  pilgrim.visa_rejected_at = null;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "VISA_UPLOADED",
    entity_type: "VISA",
    entity_id: pilgrim.id,
    before_value: before,
    after_value: { visa_status: pilgrim.visa_status, visa_id: pilgrim.visa_id },
    message: `Visa ${pilgrim.visa_id} issued for ${pilgrim.full_name_snapshot}.`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: { fullName: pilgrim.full_name_snapshot, visaStatus: "APPROVED" },
  };
}

export interface RecordVisaAiResultInput {
  departureGroupId: string;
  pilgrimId: string;
  status: "COMPLETE" | "FAILED";
  extracted: Record<string, string>;
  issues: { code: string; severity: "INFO" | "WARNING" | "CRITICAL"; message: string }[];
  error: string | null;
}

/**
 * Records the outcome of an AI visa review. Deliberately never touches
 * `visa_status` — unlike the ticket review's name-mismatch case, there is no
 * visa status that means "AI found a possible mismatch"; `REWORK_REQUIRED`
 * already means something specific (a document rejected after submission),
 * and overloading it here would blur that. A finding is surfaced for a human
 * to read and, if it holds up, act on through the existing reject/reissue
 * flow themselves.
 */
export function recordVisaAiResultInStore(
  data: DepartureGroupStore,
  input: RecordVisaAiResultInput,
  now: string = new Date().toISOString(),
): void {
  const pilgrim = findPilgrim(data, input.pilgrimId, input.departureGroupId);
  if (!pilgrim) return;

  pilgrim.visa_ai_status = input.status;
  pilgrim.visa_ai_extracted = input.extracted;
  pilgrim.visa_ai_issues = input.issues;
  pilgrim.visa_ai_analyzed_at = now;
  pilgrim.visa_ai_error = input.error;
}

export interface RejectVisaInput {
  id: string;
  departureGroupId: string;
  reason: string;
  /** True when the file can be corrected and lodged again. */
  canReapply: boolean;
}

/**
 * Records a refused visa.
 *
 * `REJECTED` was declared, rendered, filtered on and reachable from no code
 * path at all, which meant the single most expensive event in the visa process
 * — the one that decides whether a seat has to be released and a refund
 * raised — could not be entered into the system. A refusal that can be
 * corrected becomes rework so the documents queue picks it up; one that cannot
 * stays rejected and shows up on the Overview as a seat at risk.
 */
export function rejectPilgrimVisaInStore(
  data: DepartureGroupStore,
  input: RejectVisaInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): VisaDecisionOutcome {
  const pilgrim = findPilgrim(data, input.id, input.departureGroupId);
  if (!pilgrim) {
    return { ok: false, error: "That pilgrim is no longer on this group." };
  }

  const reason = input.reason?.trim();
  if (!reason) {
    return {
      ok: false,
      error: "Record the refusal reason — it decides whether the file can be corrected.",
    };
  }
  if (
    pilgrim.visa_status !== "SUBMITTED" &&
    pilgrim.visa_status !== "UNDER_REVIEW"
  ) {
    return {
      ok: false,
      error: `${pilgrim.full_name_snapshot} has no application awaiting a decision.`,
    };
  }

  const before = { visa_status: pilgrim.visa_status };
  pilgrim.visa_status = input.canReapply ? "REWORK_REQUIRED" : "REJECTED";
  pilgrim.visa_rejected_at = now;
  pilgrim.visa_rejection_reason = reason;
  pilgrim.visa_issue_note = reason;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "VISA_REJECTED",
    entity_type: "VISA",
    entity_id: pilgrim.id,
    before_value: before,
    after_value: {
      visa_status: pilgrim.visa_status,
      visa_rejection_reason: reason,
    },
    message: `Visa refused for ${pilgrim.full_name_snapshot}: ${reason}${
      input.canReapply
        ? " The file can be corrected and lodged again."
        : " This seat cannot travel — cancel or move the booking."
    }`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      fullName: pilgrim.full_name_snapshot,
      visaStatus: pilgrim.visa_status,
    },
  };
}

/* ── Role helpers ─────────────────────────────────────────────────────────── */

/**
 * Admin signs off anything; everyone else signs off only what the template
 * assigned them. Operations doubles as the fallback owner for requirements a
 * template left unassigned, matching `toResponsibleRole`'s default.
 */
function canRoleVerify(actorRole: string, documentRole: string): boolean {
  const actor = actorRole.toUpperCase();
  if (actor === "ADMIN") return true;
  return actor === documentRole.toUpperCase();
}

function titleCase(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

function describeRule(rule: DerivableRule): string {
  switch (rule) {
    case "PASSPORT_VALIDITY":
      return "passport expiry on the traveller record";
    case "EMERGENCY_CONTACT":
      return "next-of-kin contact on the traveller record";
    case "DEPOSIT_THRESHOLD":
      return "payments on the booking";
  }
}
