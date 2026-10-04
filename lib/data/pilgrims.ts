/**
 * Pure business rules for Pilgrims: row -> view-model mapping, and mutators
 * that operate on an in-memory `PilgrimStore`.
 *
 * Deliberately client-safe — no `next/headers`, no Supabase import — so the
 * same mutators run identically inside a Server Action
 * (`app/(main)/pilgrims/actions.ts`, backed by `lib/data/pilgrims-repository.ts`).
 *
 * Journey-scoped facts (seat, room, visa, documents, booking money) live on
 * `departure_group_pilgrims` / `departure_group_bookings` and are read here as
 * `PilgrimJourneyRow` (the `pilgrim_journey_rows` view) — this module never
 * mutates them. Mutations that belong to Departure Groups continue to run
 * through `lib/data/departure-groups*.ts`; the Server Action layer calls both
 * and logs one `pilgrim_activity_logs` row so the person-level timeline stays
 * complete.
 */

import type { PilgrimStore } from "@/lib/data/pilgrims-repository";
import { newId } from "@/lib/data/pilgrims-ids";
import { derivePilgrimJourneyStatus, nextActionsFor, type NextAction } from "@/lib/data/pilgrims-readiness";
import type {
  PilgrimActivityEntityType,
  PilgrimContactChannel,
  PilgrimGender,
  PilgrimJourneyRow,
  PilgrimJourneyStatus,
  PilgrimMedicalRecordRow,
  PilgrimPaymentMilestoneRow,
  PilgrimRow,
  PilgrimSupportCategory,
  PilgrimSupportPriority,
  PilgrimSupportRequestRow,
  SupportCaseAttachmentRow,
  SupportCaseEventRow,
  SupportCaseEventType,
} from "@/lib/types/pilgrims";
import type { ConsentChannel, ConsentStatus } from "@/lib/types/consent";

/* ── View models ──────────────────────────────────────────────────────────── */

export interface MutationOutcome {
  ok: boolean;
  error?: string;
}

/** Up to two initials — same rule as Leads (`lib/data/leads.ts`). */
export function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** One row per journey — a repeat traveller appears once per journey, as the spec's table implies. */
export interface PilgrimListItem {
  pilgrimId: string;
  journeyId: string;
  reference: string;
  fullName: string;
  initials: string;
  city: string;
  whatsappNumber: string;
  passportNumber: string | null;

  groupId: string;
  groupName: string;
  departureDate: string;
  daysToDeparture: number;

  bookingId: string;
  bookingReference: string;
  primaryContactName: string;

  journeyType: PilgrimJourneyRow["journey_type"];
  journeyStatus: PilgrimJourneyStatus;

  documentsCompleted: number;
  documentsRequired: number;
  documentPercent: number;

  visaStatus: PilgrimJourneyRow["visa_status"];
  paymentStatus: PilgrimJourneyRow["payment_status"];
  outstandingBalance: number;
  totalBookingValue: number;

  roomAssignmentStatus: PilgrimJourneyRow["room_assignment_status"];
  flightStatus: PilgrimJourneyRow["flight_status"];

  branch: string;
  guideName: string | null;

  readiness: "READY" | "AT_RISK" | "BLOCKED";
}

function readinessFor(journeyStatus: PilgrimJourneyStatus): PilgrimListItem["readiness"] {
  if (journeyStatus === "READY_TO_TRAVEL" || journeyStatus === "TRAVELLED" || journeyStatus === "COMPLETED") {
    return "READY";
  }
  if (journeyStatus === "CANCELLED") return "BLOCKED";
  if (journeyStatus === "DOCUMENTS_PENDING" || journeyStatus === "VISA_PROCESSING") return "AT_RISK";
  return "AT_RISK";
}

export function toPilgrimListItem(journey: PilgrimJourneyRow, nowIso: string): PilgrimListItem {
  const daysToDeparture = Math.round(
    (Date.parse(journey.departure_date) - Date.parse(nowIso)) / 86_400_000,
  );

  return {
    pilgrimId: journey.pilgrim_id,
    journeyId: journey.journey_id,
    reference: journey.pilgrim_reference,
    fullName: journey.full_name,
    initials: initialsFor(journey.full_name),
    city: journey.city,
    whatsappNumber: journey.whatsapp_number,
    passportNumber: journey.passport_number,

    groupId: journey.departure_group_id,
    groupName: journey.group_name,
    departureDate: journey.departure_date,
    daysToDeparture,

    bookingId: journey.booking_id,
    bookingReference: journey.booking_reference,
    primaryContactName: journey.primary_contact_name,

    journeyType: journey.journey_type,
    journeyStatus: journey.journey_status,

    documentsCompleted: journey.documents_completed,
    documentsRequired: journey.documents_required,
    documentPercent: journey.document_completion_percent,

    visaStatus: journey.visa_status,
    paymentStatus: journey.payment_status,
    outstandingBalance: journey.outstanding_balance,
    totalBookingValue: journey.total_booking_value,

    roomAssignmentStatus: journey.room_assignment_status,
    flightStatus: journey.flight_status,

    branch: journey.branch,
    guideName: journey.primary_guide_name,

    readiness: readinessFor(journey.journey_status),
  };
}

export function toPilgrimListItems(journeys: PilgrimJourneyRow[], nowIso: string): PilgrimListItem[] {
  return journeys.map((journey) => toPilgrimListItem(journey, nowIso));
}

export interface PilgrimListKpis {
  activePilgrims: number;
  documentsPending: number;
  visaIssues: number;
  paymentAttention: number;
  readyToTravel: number;
}

export function computePilgrimKpis(items: PilgrimListItem[]): PilgrimListKpis {
  return {
    activePilgrims: items.filter(
      (i) => i.journeyStatus !== "CANCELLED" && i.journeyStatus !== "COMPLETED",
    ).length,
    documentsPending: items.filter((i) => i.documentsCompleted < i.documentsRequired).length,
    visaIssues: items.filter((i) =>
      ["REJECTED", "REWORK_REQUIRED"].includes(i.visaStatus),
    ).length,
    paymentAttention: items.filter(
      (i) => i.paymentStatus === "OVERDUE" || (i.outstandingBalance > 0 && i.daysToDeparture <= 14),
    ).length,
    readyToTravel: items.filter((i) => i.journeyStatus === "READY_TO_TRAVEL").length,
  };
}

/* ── Profile view model ───────────────────────────────────────────────────── */

export interface PilgrimActivityItem {
  id: string;
  type: PilgrimActivityEntityType;
  message: string;
  actorName: string;
  createdAt: string;
  isSensitive: boolean;
}

export interface PilgrimProfile {
  person: PilgrimRow;
  initials: string;
  journeys: PilgrimListItem[];
  /** The journey the profile page is currently focused on. */
  activeJourney: PilgrimListItem | null;
  activeJourneyRaw: PilgrimJourneyRow | null;
  medical: PilgrimMedicalRecordRow | null;
  support: PilgrimSupportRequestRow[];
  caseEvents: SupportCaseEventRow[];
  caseAttachments: SupportCaseAttachmentRow[];
  activity: PilgrimActivityItem[];
  paymentMilestones: PilgrimPaymentMilestoneRow[];
  nextActions: NextAction[];
}

export function buildPilgrimProfile(
  person: PilgrimRow,
  allJourneys: PilgrimJourneyRow[],
  store: Pick<PilgrimStore, "medical" | "support" | "caseEvents" | "caseAttachments" | "activity" | "paymentMilestones">,
  nowIso: string,
  activeJourneyId?: string | null,
): PilgrimProfile {
  const journeys = toPilgrimListItems(allJourneys, nowIso);
  const activeRaw =
    allJourneys.find((j) => j.journey_id === activeJourneyId) ??
    allJourneys.find((j) => j.pilgrim_id === person.id && j.journey_status !== "COMPLETED" && j.journey_status !== "CANCELLED") ??
    allJourneys[0] ??
    null;
  const active = activeRaw ? toPilgrimListItem(activeRaw, nowIso) : null;

  return {
    person,
    initials: initialsFor(person.full_name),
    journeys,
    activeJourney: active,
    activeJourneyRaw: activeRaw,
    medical: store.medical.find((m) => m.pilgrim_id === person.id) ?? null,
    support: store.support
      .filter((s) => s.pilgrim_id === person.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    caseEvents: store.caseEvents
      .filter((e) => e.pilgrim_id === person.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    caseAttachments: store.caseAttachments
      .filter((a) => a.pilgrim_id === person.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    activity: store.activity
      .filter((a) => a.pilgrim_id === person.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((a) => ({
        id: a.id,
        type: a.entity_type,
        message: a.message,
        actorName: a.actor_name_snapshot,
        createdAt: a.created_at,
        isSensitive: a.is_sensitive_access,
      })),
    paymentMilestones: store.paymentMilestones
      .filter((m) => (activeRaw ? m.booking_id === activeRaw.booking_id : m.pilgrim_id === person.id))
      .sort((a, b) => a.sequence - b.sequence),
    nextActions: activeRaw ? nextActionsFor(activeRaw, nowIso) : [],
  };
}

/* ── Reference numbering ──────────────────────────────────────────────────── */

/** Next `PL-<year>-NNNN` reference, derived from the highest already in the store. */
export function nextPilgrimReference(store: Pick<PilgrimStore, "pilgrims">, nowIso: string): string {
  const year = nowIso.slice(0, 4);
  const prefix = `PL-${year}-`;
  const highest = store.pilgrims.reduce((max, p) => {
    if (!p.reference.startsWith(prefix)) return max;
    const parsed = Number.parseInt(p.reference.slice(prefix.length), 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

/* ── Activity ─────────────────────────────────────────────────────────────── */

export function pushPilgrimActivity(
  store: PilgrimStore,
  input: {
    pilgrimId: string;
    departureGroupId?: string | null;
    type: PilgrimActivityEntityType;
    message: string;
    actorName: string;
    actorRole?: string | null;
    isSensitive?: boolean;
  },
  nowIso: string,
): void {
  store.activity.push({
    id: newId(),
    pilgrim_id: input.pilgrimId,
    departure_group_id: input.departureGroupId ?? null,
    actor_id: null,
    actor_name_snapshot: input.actorName,
    actor_role: input.actorRole ?? null,
    action_type: input.type,
    entity_type: input.type,
    entity_id: null,
    before_value: null,
    after_value: null,
    message: input.message,
    is_system: false,
    is_sensitive_access: input.isSensitive ?? false,
    created_at: nowIso,
  });
}

/* ── Personal details ─────────────────────────────────────────────────────── */

function findPilgrim(store: PilgrimStore, pilgrimId: string): PilgrimRow | null {
  return store.pilgrims.find((p) => p.id === pilgrimId) ?? null;
}

export interface UpdatePersonalDetailsFields {
  fullName?: string;
  preferredName?: string | null;
  gender?: PilgrimGender;
  dateOfBirth?: string | null;
  nationality?: string;
  nationalId?: string | null;
  countryOfResidence?: string;
  city?: string;
  preferredLanguage?: string;
  whatsappNumber?: string;
  mobileNumber?: string | null;
  email?: string | null;
  preferredChannel?: PilgrimContactChannel;
  passportNumber?: string | null;
  passportExpiry?: string | null;
  passportIssueCountry?: string | null;
  emergencyContactName?: string | null;
  emergencyContactRelationship?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactAltPhone?: string | null;
}

export function updatePersonalDetailsInStore(
  store: PilgrimStore,
  input: { pilgrimId: string; fields: UpdatePersonalDetailsFields; actorName: string },
  nowIso: string,
): MutationOutcome {
  const person = findPilgrim(store, input.pilgrimId);
  if (!person) return { ok: false, error: "That pilgrim no longer exists." };

  const f = input.fields;
  if (f.fullName !== undefined) {
    if (!f.fullName.trim()) return { ok: false, error: "Full name cannot be empty." };
    person.full_name = f.fullName.trim();
  }
  if (f.preferredName !== undefined) person.preferred_name = f.preferredName?.trim() || null;
  if (f.gender !== undefined) person.gender = f.gender;
  if (f.dateOfBirth !== undefined) person.date_of_birth = f.dateOfBirth;
  if (f.nationality !== undefined) person.nationality = f.nationality;
  if (f.nationalId !== undefined) person.national_id = f.nationalId?.trim() || null;
  if (f.countryOfResidence !== undefined) person.country_of_residence = f.countryOfResidence;
  if (f.city !== undefined) person.city = f.city;
  if (f.preferredLanguage !== undefined) person.preferred_language = f.preferredLanguage;
  if (f.whatsappNumber !== undefined) person.whatsapp_number = f.whatsappNumber.trim();
  if (f.mobileNumber !== undefined) person.mobile_number = f.mobileNumber?.trim() || null;
  if (f.email !== undefined) person.email = f.email?.trim() || null;
  if (f.preferredChannel !== undefined) person.preferred_channel = f.preferredChannel;
  if (f.passportNumber !== undefined) person.passport_number = f.passportNumber?.trim().toUpperCase() || null;
  if (f.passportExpiry !== undefined) person.passport_expiry = f.passportExpiry;
  if (f.passportIssueCountry !== undefined) person.passport_issue_country = f.passportIssueCountry?.trim() || null;
  if (f.emergencyContactName !== undefined) person.emergency_contact_name = f.emergencyContactName?.trim() || null;
  if (f.emergencyContactRelationship !== undefined)
    person.emergency_contact_relationship = f.emergencyContactRelationship?.trim() || null;
  if (f.emergencyContactPhone !== undefined) person.emergency_contact_phone = f.emergencyContactPhone?.trim() || null;
  if (f.emergencyContactAltPhone !== undefined)
    person.emergency_contact_alt_phone = f.emergencyContactAltPhone?.trim() || null;

  person.updated_at = nowIso;

  pushPilgrimActivity(
    store,
    { pilgrimId: person.id, type: "PILGRIM", message: "Personal & contact details updated.", actorName: input.actorName },
    nowIso,
  );

  return { ok: true };
}

/* ── Medical ──────────────────────────────────────────────────────────────── */

export interface UpdateMedicalFields {
  mobilitySupport: boolean;
  wheelchairRequired: boolean;
  dietaryRequirement: string;
  allergyInformation: string;
  medicationNote: string;
  accessibilityNote: string;
  specialAssistance: string;
}

export function updateMedicalRecordInStore(
  store: PilgrimStore,
  input: { pilgrimId: string; fields: UpdateMedicalFields; actorName: string },
  nowIso: string,
): MutationOutcome {
  const person = findPilgrim(store, input.pilgrimId);
  if (!person) return { ok: false, error: "That pilgrim no longer exists." };

  const existing = store.medical.find((m) => m.pilgrim_id === input.pilgrimId);
  const row: PilgrimMedicalRecordRow = {
    pilgrim_id: input.pilgrimId,
    mobility_support: input.fields.mobilitySupport,
    wheelchair_required: input.fields.wheelchairRequired,
    dietary_requirement: input.fields.dietaryRequirement.trim() || null,
    allergy_information: input.fields.allergyInformation.trim() || null,
    medication_note: input.fields.medicationNote.trim() || null,
    accessibility_note: input.fields.accessibilityNote.trim() || null,
    special_assistance: input.fields.specialAssistance.trim() || null,
    updated_at: nowIso,
    updated_by: existing?.updated_by ?? null,
  };

  if (existing) {
    Object.assign(existing, row);
  } else {
    store.medical.push(row);
  }

  pushPilgrimActivity(
    store,
    {
      pilgrimId: person.id,
      type: "MEDICAL",
      message: "Medical / accessibility record updated.",
      actorName: input.actorName,
      isSensitive: true,
    },
    nowIso,
  );

  return { ok: true };
}

/** Logs a read of medical data — the audit half normally forgotten. */
export function logMedicalAccess(store: PilgrimStore, pilgrimId: string, actorName: string, nowIso: string): void {
  pushPilgrimActivity(
    store,
    { pilgrimId, type: "MEDICAL", message: "Viewed medical / accessibility record.", actorName, isSensitive: true },
    nowIso,
  );
}

/* ── Support requests ─────────────────────────────────────────────────────── */

export interface CreateSupportRequestFields {
  departureGroupId: string | null;
  title: string;
  detail: string;
  category: PilgrimSupportCategory;
  priority: PilgrimSupportPriority;
  assignedRole: string;
  raisedByPortal?: boolean;
}

/** Hours to resolve by, from creation, per priority. */
const SLA_HOURS: Record<PilgrimSupportPriority, number> = {
  URGENT: 4,
  HIGH: 24,
  NORMAL: 72,
  LOW: 24 * 7,
};

function slaDueAt(priority: PilgrimSupportPriority, nowIso: string): string {
  return new Date(Date.parse(nowIso) + SLA_HOURS[priority] * 3_600_000).toISOString();
}

export function createSupportRequestInStore(
  store: PilgrimStore,
  input: { pilgrimId: string; fields: CreateSupportRequestFields; actorName: string },
  nowIso: string,
): MutationOutcome {
  const person = findPilgrim(store, input.pilgrimId);
  if (!person) return { ok: false, error: "That pilgrim no longer exists." };
  if (!input.fields.title.trim()) return { ok: false, error: "Describe the request." };

  const row: PilgrimSupportRequestRow = {
    id: newId(),
    pilgrim_id: input.pilgrimId,
    departure_group_id: input.fields.departureGroupId,
    title: input.fields.title.trim(),
    detail: input.fields.detail.trim() || null,
    category: input.fields.category,
    priority: input.fields.priority,
    status: "OPEN",
    assigned_role: input.fields.assignedRole,
    raised_by_portal: input.fields.raisedByPortal ?? false,
    created_at: nowIso,
    resolved_at: null,
    sla_due_at: slaDueAt(input.fields.priority, nowIso),
    escalated_at: null,
    escalated_to_role: null,
    supplier_id: null,
  };
  store.support.push(row);

  pushPilgrimActivity(
    store,
    {
      pilgrimId: person.id,
      departureGroupId: input.fields.departureGroupId,
      type: "SUPPORT",
      message: `Support request raised: ${row.title}.`,
      actorName: input.actorName,
    },
    nowIso,
  );

  return { ok: true };
}

function pushCaseEvent(
  store: PilgrimStore,
  input: {
    supportRequestId: string;
    pilgrimId: string;
    eventType: SupportCaseEventType;
    message: string;
    actorName: string;
  },
  nowIso: string,
): void {
  const row: SupportCaseEventRow = {
    id: newId(),
    support_request_id: input.supportRequestId,
    pilgrim_id: input.pilgrimId,
    event_type: input.eventType,
    message: input.message,
    actor_name: input.actorName,
    created_at: nowIso,
  };
  store.caseEvents.push(row);
}

export function updateSupportRequestStatusInStore(
  store: PilgrimStore,
  input: { requestId: string; status: PilgrimSupportRequestRow["status"]; actorName: string },
  nowIso: string,
): MutationOutcome {
  const request = store.support.find((r) => r.id === input.requestId);
  if (!request) return { ok: false, error: "That support request no longer exists." };

  const wasTerminal = request.status === "RESOLVED" || request.status === "CANCELLED";
  const isReopening = wasTerminal && (input.status === "OPEN" || input.status === "IN_PROGRESS");

  request.status = input.status;
  request.resolved_at = input.status === "RESOLVED" || input.status === "CANCELLED" ? nowIso : null;

  const message = `Support request "${request.title}" marked ${input.status.replace(/_/g, " ").toLowerCase()}.`;
  pushPilgrimActivity(
    store,
    {
      pilgrimId: request.pilgrim_id,
      departureGroupId: request.departure_group_id,
      type: "SUPPORT",
      message,
      actorName: input.actorName,
    },
    nowIso,
  );
  pushCaseEvent(
    store,
    {
      supportRequestId: request.id,
      pilgrimId: request.pilgrim_id,
      eventType: isReopening ? "REOPENED" : "STATUS_CHANGE",
      message,
      actorName: input.actorName,
    },
    nowIso,
  );

  return { ok: true };
}

export interface AddSupportCaseCommentInput {
  requestId: string;
  message: string;
  actorName: string;
}

/** Adds a note to a case's own timeline without changing its status. */
export function addSupportCaseCommentInStore(
  store: PilgrimStore,
  input: AddSupportCaseCommentInput,
  nowIso: string,
): MutationOutcome {
  const request = store.support.find((r) => r.id === input.requestId);
  if (!request) return { ok: false, error: "That support request no longer exists." };
  const message = input.message.trim();
  if (!message) return { ok: false, error: "Write a comment before adding it." };

  pushCaseEvent(
    store,
    {
      supportRequestId: request.id,
      pilgrimId: request.pilgrim_id,
      eventType: "COMMENT",
      message,
      actorName: input.actorName,
    },
    nowIso,
  );

  return { ok: true };
}

export interface EscalateSupportRequestInput {
  requestId: string;
  toRole: string;
  reason: string;
  actorName: string;
}

/**
 * Escalates a case to another role. Bumps priority to at least HIGH — an
 * escalation that leaves the case at NORMAL/LOW would still sort behind
 * every already-urgent case in the triage queue, defeating the point of
 * escalating it.
 */
export function escalateSupportRequestInStore(
  store: PilgrimStore,
  input: EscalateSupportRequestInput,
  nowIso: string,
): MutationOutcome {
  const request = store.support.find((r) => r.id === input.requestId);
  if (!request) return { ok: false, error: "That support request no longer exists." };
  if (request.status === "RESOLVED" || request.status === "CANCELLED") {
    return { ok: false, error: "This case is already closed." };
  }
  if (!input.reason.trim()) return { ok: false, error: "Give a reason for the escalation." };

  request.escalated_at = nowIso;
  request.escalated_to_role = input.toRole;
  request.assigned_role = input.toRole;
  if (request.priority !== "URGENT") request.priority = "HIGH";

  const message = `Escalated to ${input.toRole}: ${input.reason.trim()}`;
  pushPilgrimActivity(
    store,
    {
      pilgrimId: request.pilgrim_id,
      departureGroupId: request.departure_group_id,
      type: "SUPPORT",
      message: `Support request "${request.title}" — ${message}`,
      actorName: input.actorName,
    },
    nowIso,
  );
  pushCaseEvent(
    store,
    {
      supportRequestId: request.id,
      pilgrimId: request.pilgrim_id,
      eventType: "ESCALATED",
      message,
      actorName: input.actorName,
    },
    nowIso,
  );

  return { ok: true };
}

export interface LinkSupportCaseSupplierInput {
  requestId: string;
  supplierId: string | null;
  supplierName: string | null;
  actorName: string;
}

/** Links (or clears) the supplier responsible for / involved in an incident. */
export function linkSupportCaseSupplierInStore(
  store: PilgrimStore,
  input: LinkSupportCaseSupplierInput,
  nowIso: string,
): MutationOutcome {
  const request = store.support.find((r) => r.id === input.requestId);
  if (!request) return { ok: false, error: "That support request no longer exists." };

  request.supplier_id = input.supplierId;

  pushCaseEvent(
    store,
    {
      supportRequestId: request.id,
      pilgrimId: request.pilgrim_id,
      eventType: "SUPPLIER_LINKED",
      message: input.supplierId
        ? `Linked supplier: ${input.supplierName ?? input.supplierId}`
        : "Removed supplier link.",
      actorName: input.actorName,
    },
    nowIso,
  );

  return { ok: true };
}

export interface AddSupportCaseAttachmentInput {
  requestId: string;
  filePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  actorName: string;
}

export interface AddSupportCaseAttachmentResult {
  id: string;
}

export type AddSupportCaseAttachmentOutcome =
  | { ok: true; result: AddSupportCaseAttachmentResult }
  | { ok: false; error: string };

/** Records a file already uploaded to storage against a case (see attachment-storage.ts for the upload itself). */
export function addSupportCaseAttachmentInStore(
  store: PilgrimStore,
  input: AddSupportCaseAttachmentInput,
  nowIso: string,
): AddSupportCaseAttachmentOutcome {
  const request = store.support.find((r) => r.id === input.requestId);
  if (!request) return { ok: false, error: "That support request no longer exists." };

  const id = newId();
  const row: SupportCaseAttachmentRow = {
    id,
    support_request_id: request.id,
    pilgrim_id: request.pilgrim_id,
    file_path: input.filePath,
    file_name: input.fileName,
    content_type: input.contentType,
    size_bytes: input.sizeBytes,
    uploaded_by_name: input.actorName,
    created_at: nowIso,
  };
  store.caseAttachments.push(row);

  pushCaseEvent(
    store,
    {
      supportRequestId: request.id,
      pilgrimId: request.pilgrim_id,
      eventType: "ATTACHMENT_ADDED",
      message: `Attached ${input.fileName}`,
      actorName: input.actorName,
    },
    nowIso,
  );

  return { ok: true, result: { id } };
}

export interface RemoveSupportCaseAttachmentInput {
  attachmentId: string;
  requestId: string;
  actorName: string;
}

export type RemoveSupportCaseAttachmentOutcome =
  | { ok: true; filePath: string }
  | { ok: false; error: string };

/** Removes an attachment's record. The underlying storage object is deleted separately (attachment-storage.ts), using the returned filePath. */
export function removeSupportCaseAttachmentInStore(
  store: PilgrimStore,
  input: RemoveSupportCaseAttachmentInput,
  nowIso: string,
): RemoveSupportCaseAttachmentOutcome {
  const index = store.caseAttachments.findIndex(
    (a) => a.id === input.attachmentId && a.support_request_id === input.requestId,
  );
  if (index === -1) return { ok: false, error: "That attachment no longer exists." };

  const [removed] = store.caseAttachments.splice(index, 1);

  pushCaseEvent(
    store,
    {
      supportRequestId: input.requestId,
      pilgrimId: removed.pilgrim_id,
      eventType: "ATTACHMENT_REMOVED",
      message: `Removed attachment ${removed.file_name}`,
      actorName: input.actorName,
    },
    nowIso,
  );

  return { ok: true, filePath: removed.file_path };
}

export interface UpdatePilgrimConsentInput {
  pilgrimId: string;
  consentStatus: ConsentStatus;
  doNotContact: boolean;
  contactableChannels: ConsentChannel[];
  source: string;
  actorName: string;
}

/**
 * Records a pilgrim's consent/do-not-contact decision. Same posture as
 * `updateLeadConsentInStore` — never inferred, only ever an explicit staff
 * action. The matching `consent_events` row is written by the caller
 * (`app/(main)/pilgrims/actions.ts`), outside this diffed store.
 */
export function updatePilgrimConsentInStore(
  store: PilgrimStore,
  input: UpdatePilgrimConsentInput,
  nowIso: string,
): MutationOutcome {
  const pilgrim = store.pilgrims.find((p) => p.id === input.pilgrimId);
  if (!pilgrim) return { ok: false, error: "That pilgrim no longer exists." };

  pilgrim.consent_status = input.consentStatus;
  pilgrim.consent_source = input.source.trim() || null;
  pilgrim.consent_at = nowIso;
  pilgrim.do_not_contact = input.doNotContact;
  pilgrim.contactable_channels = input.contactableChannels;
  pilgrim.updated_at = nowIso;

  pushPilgrimActivity(
    store,
    {
      pilgrimId: pilgrim.id,
      type: "PILGRIM",
      message: `Consent set to ${input.consentStatus.replace("_", " ").toLowerCase()}${
        input.doNotContact ? " · marked do-not-contact" : ""
      }.`,
      actorName: input.actorName,
    },
    nowIso,
  );

  return { ok: true };
}

/* ── Payment milestones ───────────────────────────────────────────────────── */

/**
 * Applies a payment to the earliest unpaid milestone(s) for a booking, in
 * sequence order — the simplification the implementation plan (D4) flags:
 * a family sharing one booking splits its milestones equally by traveller,
 * and a payment is allocated FIFO rather than the payer choosing a milestone.
 */
export function allocatePaymentToMilestonesInStore(
  store: PilgrimStore,
  input: { bookingId: string; amount: number; note?: string; recordedByName: string },
  nowIso: string,
): MutationOutcome {
  let remaining = input.amount;
  const milestones = store.paymentMilestones
    .filter((m) => m.booking_id === input.bookingId)
    .sort((a, b) => a.sequence - b.sequence);

  for (const milestone of milestones) {
    if (remaining <= 0) break;
    const due = milestone.amount - milestone.paid_amount;
    if (due <= 0) continue;
    const applied = Math.min(due, remaining);
    milestone.paid_amount = Math.round((milestone.paid_amount + applied) * 100) / 100;
    remaining = Math.round((remaining - applied) * 100) / 100;
    if (milestone.paid_amount >= milestone.amount) milestone.paid_at = nowIso;
    milestone.note = input.note?.trim() || milestone.note;
    milestone.recorded_by_name = input.recordedByName;

    pushPilgrimActivity(
      store,
      {
        pilgrimId: milestone.pilgrim_id,
        type: "PAYMENT",
        message: `${milestone.label}: LKR ${applied.toLocaleString("en-US")} recorded.`,
        actorName: input.recordedByName,
      },
      nowIso,
    );
  }

  return { ok: true };
}

/**
 * The mirror of `allocatePaymentToMilestonesInStore()` for a reversed
 * payment. Pulls back from the most-recently-settled milestone first
 * (highest sequence with money on it) rather than FIFO — a reversal undoes
 * what was just applied, it does not reopen the earliest instalment a family
 * already considers settled.
 */
export function deallocatePaymentFromMilestonesInStore(
  store: PilgrimStore,
  input: { bookingId: string; amount: number; note?: string; recordedByName: string },
  nowIso: string,
): MutationOutcome {
  let remaining = input.amount;
  const milestones = store.paymentMilestones
    .filter((m) => m.booking_id === input.bookingId && m.paid_amount > 0)
    .sort((a, b) => b.sequence - a.sequence);

  for (const milestone of milestones) {
    if (remaining <= 0) break;
    const applied = Math.min(milestone.paid_amount, remaining);
    milestone.paid_amount = Math.round((milestone.paid_amount - applied) * 100) / 100;
    remaining = Math.round((remaining - applied) * 100) / 100;
    if (milestone.paid_amount < milestone.amount) milestone.paid_at = null;
    milestone.note = input.note?.trim() || milestone.note;
    milestone.recorded_by_name = input.recordedByName;

    pushPilgrimActivity(
      store,
      {
        pilgrimId: milestone.pilgrim_id,
        type: "PAYMENT",
        message: `${milestone.label}: LKR ${applied.toLocaleString("en-US")} reversed.`,
        actorName: input.recordedByName,
      },
      nowIso,
    );
  }

  return { ok: true };
}

/** Seeds a booking's payment milestones from the group's frozen payment schedule, split evenly across travellers. */
export function buildPaymentMilestonesForBooking(
  bookingId: string,
  pilgrimIds: string[],
  schedule: { id: string; label: string; amount: number | null; amountType?: string; dueDate: string | null }[],
  totalPerPerson: number,
  nowIso: string,
): PilgrimPaymentMilestoneRow[] {
  const rows: PilgrimPaymentMilestoneRow[] = [];
  const effectiveSchedule =
    schedule.length > 0
      ? schedule
      : [{ id: "full", label: "Full Balance", amount: totalPerPerson, dueDate: null }];

  for (const pilgrimId of pilgrimIds) {
    let allocated = 0;
    effectiveSchedule.forEach((item, index) => {
      const isLast = index === effectiveSchedule.length - 1;
      const rawAmount = item.amountType === "Percentage"
        ? (totalPerPerson * Math.max(item.amount ?? 0, 0)) / 100
        : item.amount ?? (isLast ? totalPerPerson - allocated : totalPerPerson);
      const amount = isLast
        ? Math.max(totalPerPerson - allocated, 0)
        : Math.max(Math.round(rawAmount * 100) / 100, 0);
      allocated = Math.round((allocated + amount) * 100) / 100;
      rows.push({
        id: newId(),
        pilgrim_id: pilgrimId,
        booking_id: bookingId,
        label: item.label,
        sequence: index,
        amount,
        due_at: item.dueDate,
        paid_amount: 0,
        paid_at: null,
        proof_path: null,
        recorded_by: null,
        recorded_by_name: null,
        note: null,
        created_at: nowIso,
      });
    });
  }
  return rows;
}

export { derivePilgrimJourneyStatus };
