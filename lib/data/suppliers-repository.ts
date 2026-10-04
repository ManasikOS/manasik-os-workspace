/**
 * Server-only read/write access for the Supplier Directory.
 *
 * Same posture as `lib/data/operations-repository.ts` and
 * `lib/data/pilgrims-repository.ts`: this is the only file that touches
 * Supabase for this module. Capabilities decide what is *fetched*, not merely
 * what is rendered — `stripForCapabilities()` nulls cost, payment-terms,
 * internal-notes and non-emergency contact fields before a row ever reaches a
 * Client Component.
 *
 * Confirming a commitment never writes `departure_group_accommodations` /
 * `_transports` directly — it calls the existing `setGroupAccommodationReference`
 * / `markGroupAccommodationConfirmed` (and the transport equivalents) from
 * `lib/data/departure-groups.ts`, so this module can never disagree with the
 * Departure Group detail page about what counts as confirmed, and group
 * readiness recomputes exactly as it already does today.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SupplierCapabilities } from "@/lib/access/suppliers-access";
import {
  createGroupTask,
  markGroupAccommodationConfirmed,
  markGroupTransportConfirmed,
  setGroupAccommodationInternalCost,
  setGroupAccommodationReference,
  setGroupTransportInternalCost,
  setGroupTransportReference,
} from "@/lib/data/departure-groups";
import type {
  SupplierActivityAction,
  SupplierActivityEventRow,
  SupplierCommitmentRow,
  SupplierContactRow,
  SupplierDirectoryRow,
  SupplierPaymentRow,
  SupplierRow,
  SupplierServiceRow,
} from "@/lib/types/suppliers";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class SupplierPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Suppliers: ${operation} on ${table} failed — ${detail}`);
    this.name = "SupplierPersistenceError";
  }
}

export interface SupplierActor {
  id: string | null;
  name: string;
}

/* ── Field stripping — capability decides what is fetched ────────────────── */

const COST_FIELDS_SUPPLIER = ["payment_terms", "payment_terms_note", "lead_time_days"] as const;

function stripSupplier(row: SupplierRow, can: SupplierCapabilities): SupplierRow {
  const out = { ...row };
  if (!can.viewInternalNotes) out.internal_notes = null;
  if (!can.viewCosts) {
    for (const field of COST_FIELDS_SUPPLIER) (out as Record<string, unknown>)[field] = null;
  }
  return out;
}

function stripDirectoryRow(row: SupplierDirectoryRow, can: SupplierCapabilities): SupplierDirectoryRow {
  const out = { ...row, ...stripSupplier(row, can) } as SupplierDirectoryRow;
  if (!can.viewCosts) {
    out.outstanding_amount = 0;
    out.next_payment_due_at = null;
  }
  if (can.viewEmergencyContactsOnly && !can.viewContacts) {
    out.primary_contact_whatsapp = null;
    out.primary_contact_phone = null;
  }
  return out;
}

function stripService(row: SupplierServiceRow, can: SupplierCapabilities): SupplierServiceRow {
  if (can.viewCosts) return row;
  return { ...row, typical_rate: null, rate_currency: null };
}

function stripContact(row: SupplierContactRow, can: SupplierCapabilities): SupplierContactRow | null {
  if (can.viewContacts) return row;
  if (can.viewEmergencyContactsOnly && row.is_emergency) return row;
  return null;
}

function stripCommitment(row: SupplierCommitmentRow, can: SupplierCapabilities): SupplierCommitmentRow {
  if (can.viewCosts) return row;
  return { ...row, amount: null, amount_paid: 0, payment_due_at: null, payment_terms_note: null };
}

function stripPayment(row: SupplierPaymentRow, can: SupplierCapabilities): SupplierPaymentRow | null {
  return can.viewPayments ? row : null;
}

/* ── Directory + profile reads ───────────────────────────────────────────── */

export async function loadSupplierDirectory(
  db: Db,
  can: SupplierCapabilities,
): Promise<SupplierDirectoryRow[]> {
  const { data, error } = await db
    .from("supplier_directory_rows")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw new SupplierPersistenceError("supplier_directory_rows", "select", error);
  return ((data ?? []) as SupplierDirectoryRow[]).map((row) => stripDirectoryRow(row, can));
}

export interface SupplierProfileBundle {
  supplier: SupplierRow;
  services: SupplierServiceRow[];
  contacts: SupplierContactRow[];
  commitments: SupplierCommitmentRow[];
  payments: SupplierPaymentRow[];
  activity: SupplierActivityEventRow[];
}

export async function loadSupplierProfile(
  db: Db,
  supplierId: string,
  can: SupplierCapabilities,
): Promise<SupplierProfileBundle | null> {
  const { data: supplierRow, error: supplierError } = await db
    .from("suppliers")
    .select("*")
    .eq("id", supplierId)
    .maybeSingle();
  if (supplierError) throw new SupplierPersistenceError("suppliers", "select", supplierError);
  if (!supplierRow) return null;

  const [servicesRes, contactsRes, commitmentsRes, activityRes] = await Promise.all([
    db.from("supplier_services").select("*").eq("supplier_id", supplierId),
    db.from("supplier_contacts").select("*").eq("supplier_id", supplierId).order("is_primary", { ascending: false }),
    db
      .from("supplier_commitments")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false }),
    db
      .from("supplier_activity_events")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (servicesRes.error) throw new SupplierPersistenceError("supplier_services", "select", servicesRes.error);
  if (contactsRes.error) throw new SupplierPersistenceError("supplier_contacts", "select", contactsRes.error);
  if (commitmentsRes.error) throw new SupplierPersistenceError("supplier_commitments", "select", commitmentsRes.error);
  if (activityRes.error) throw new SupplierPersistenceError("supplier_activity_events", "select", activityRes.error);

  const commitments = (commitmentsRes.data ?? []) as SupplierCommitmentRow[];
  const commitmentIds = commitments.map((c) => c.id);

  let payments: SupplierPaymentRow[] = [];
  if (can.viewPayments && commitmentIds.length > 0) {
    const { data, error } = await db
      .from("supplier_payments")
      .select("*")
      .in("commitment_id", commitmentIds)
      .order("paid_at", { ascending: false });
    if (error) throw new SupplierPersistenceError("supplier_payments", "select", error);
    payments = (data ?? []) as SupplierPaymentRow[];
  }

  return {
    supplier: stripSupplier(supplierRow as SupplierRow, can),
    services: ((servicesRes.data ?? []) as SupplierServiceRow[]).map((r) => stripService(r, can)),
    contacts: ((contactsRes.data ?? []) as SupplierContactRow[])
      .map((r) => stripContact(r, can))
      .filter((r): r is SupplierContactRow => r !== null),
    commitments: commitments.map((r) => stripCommitment(r, can)),
    payments: payments.map((r) => stripPayment(r, can)).filter((r): r is SupplierPaymentRow => r !== null),
    activity: activityRes.data as SupplierActivityEventRow[],
  };
}

/** Commitments for one Departure Group — the launch point from a group's tabs. */
export async function loadCommitmentsForGroup(db: Db, departureGroupId: string): Promise<SupplierCommitmentRow[]> {
  const { data, error } = await db
    .from("supplier_commitments")
    .select("*")
    .eq("departure_group_id", departureGroupId)
    .order("created_at", { ascending: false });
  if (error) throw new SupplierPersistenceError("supplier_commitments", "select", error);
  return (data ?? []) as SupplierCommitmentRow[];
}

export async function loadActiveSuppliers(db: Db): Promise<{ id: string; name: string; supplier_type: string }[]> {
  const { data, error } = await db
    .from("suppliers")
    .select("id, name, supplier_type")
    .eq("status", "ACTIVE")
    .order("name", { ascending: true });
  if (error) throw new SupplierPersistenceError("suppliers", "select", error);
  return data ?? [];
}

/** Non-departed groups for the Create Commitment picker — id, name and code only. */
export async function loadDepartureGroupPickerOptions(
  db: Db,
): Promise<{ id: string; group_name: string; group_code: string; departure_date: string }[]> {
  const { data, error } = await db
    .from("departure_groups")
    .select("id, group_name, group_code, departure_date")
    .not("group_status", "in", "(DEPARTED,COMPLETED,CLOSED,CANCELLED)")
    .order("departure_date", { ascending: true });
  if (error) throw new SupplierPersistenceError("departure_groups", "select", error);
  return data ?? [];
}

export interface GroupLinkableEntity {
  id: string;
  label: string;
}

/**
 * A group's own hotel and transport rows, for the "Create Commitment" form's
 * "Link to" picker — the commitment→group direction of keeping the two
 * sides in step (see `syncCommitmentForLinkedEntity()` for the group→
 * commitment direction). Excludes rows that already carry a non-cancelled
 * commitment, since at most one commitment is meant to exist per entity.
 */
export async function loadGroupLinkableEntities(
  db: Db,
  departureGroupId: string,
): Promise<{ accommodations: GroupLinkableEntity[]; transports: GroupLinkableEntity[] }> {
  const [accRes, transRes, linkedRes] = await Promise.all([
    db
      .from("departure_group_accommodations")
      .select("id, hotel_name, city")
      .eq("departure_group_id", departureGroupId),
    db
      .from("departure_group_transports")
      .select("id, route_label")
      .eq("departure_group_id", departureGroupId),
    db
      .from("supplier_commitments")
      .select("linked_entity_id")
      .eq("departure_group_id", departureGroupId)
      .neq("status", "CANCELLED")
      .not("linked_entity_id", "is", null),
  ]);
  if (accRes.error) throw new SupplierPersistenceError("departure_group_accommodations", "select", accRes.error);
  if (transRes.error) throw new SupplierPersistenceError("departure_group_transports", "select", transRes.error);
  if (linkedRes.error) throw new SupplierPersistenceError("supplier_commitments", "select", linkedRes.error);

  const alreadyLinked = new Set((linkedRes.data ?? []).map((r) => r.linked_entity_id as string));

  return {
    accommodations: ((accRes.data ?? []) as { id: string; hotel_name: string; city: string }[])
      .filter((a) => !alreadyLinked.has(a.id))
      .map((a) => ({ id: a.id, label: a.hotel_name ? `${a.hotel_name} (${a.city})` : `Unnamed hotel (${a.city})` })),
    transports: ((transRes.data ?? []) as { id: string; route_label: string }[])
      .filter((t) => !alreadyLinked.has(t.id))
      .map((t) => ({ id: t.id, label: t.route_label })),
  };
}

/* ── Activity logging ────────────────────────────────────────────────────── */

async function logSupplierEvent(
  db: Db,
  input: {
    supplierId: string;
    commitmentId?: string | null;
    actor: SupplierActor;
    action: SupplierActivityAction;
    fromValue?: string | null;
    toValue?: string | null;
    note?: string | null;
    isHighImpact?: boolean;
  },
): Promise<void> {
  const { error } = await db.from("supplier_activity_events").insert({
    supplier_id: input.supplierId,
    commitment_id: input.commitmentId ?? null,
    actor_id: input.actor.id,
    actor_name: input.actor.name,
    action: input.action,
    from_value: input.fromValue ?? null,
    to_value: input.toValue ?? null,
    note: input.note ?? null,
    is_high_impact: input.isHighImpact ?? false,
  });
  if (error) throw new SupplierPersistenceError("supplier_activity_events", "insert", error);
}

/* ── Mutations ────────────────────────────────────────────────────────────── */

export interface CreateSupplierInput {
  name: string;
  supplierCode: string;
  supplierType: string;
  serviceCategories: string[];
  status: string;
  city?: string;
  country?: string;
  contactName?: string;
  whatsappNumber: string;
  email?: string;
  preferredChannel?: string;
  arabicSpeaking: boolean;
  currency: string;
  paymentTerms: string;
  paymentTermsNote?: string;
  leadTimeDays?: number | null;
  internalNotes?: string;
}

export async function createSupplier(
  db: Db,
  input: CreateSupplierInput,
  actor: SupplierActor,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await db
    .from("suppliers")
    .insert({
      name: input.name,
      supplier_code: input.supplierCode,
      supplier_type: input.supplierType,
      status: input.status,
      city: input.city || null,
      country: input.country || null,
      currency: input.currency,
      payment_terms: input.paymentTerms,
      payment_terms_note: input.paymentTermsNote || null,
      lead_time_days: input.leadTimeDays ?? null,
      preferred_channel: input.preferredChannel || null,
      internal_notes: input.internalNotes || null,
      created_by: actor.id,
      created_by_name: actor.name,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, error: "That supplier code is already in use." };
    throw new SupplierPersistenceError("suppliers", "insert", error);
  }

  const supplierId = data.id as string;

  if (input.serviceCategories.length > 0) {
    const { error: serviceError } = await db
      .from("supplier_services")
      .insert(input.serviceCategories.map((category) => ({ supplier_id: supplierId, category })));
    if (serviceError) throw new SupplierPersistenceError("supplier_services", "insert", serviceError);
  }

  if (input.contactName?.trim()) {
    const { error: contactError } = await db.from("supplier_contacts").insert({
      supplier_id: supplierId,
      name: input.contactName.trim(),
      whatsapp_number: input.whatsappNumber || null,
      email: input.email || null,
      languages: input.arabicSpeaking ? "Arabic / English" : null,
      is_primary: true,
    });
    if (contactError) throw new SupplierPersistenceError("supplier_contacts", "insert", contactError);
  }

  await logSupplierEvent(db, {
    supplierId,
    actor,
    action: "SUPPLIER_CREATED",
    toValue: input.name,
    isHighImpact: true,
  });

  return { ok: true, id: supplierId };
}

export async function setSupplierReliability(
  db: Db,
  input: { supplierId: string; reliability: string; reason?: string },
  actor: SupplierActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing, error: readError } = await db
    .from("suppliers")
    .select("reliability")
    .eq("id", input.supplierId)
    .maybeSingle();
  if (readError) throw new SupplierPersistenceError("suppliers", "select", readError);
  if (!existing) return { ok: false, error: "That supplier no longer exists." };

  const { error } = await db
    .from("suppliers")
    .update({
      reliability: input.reliability,
      reliability_reason: input.reason || null,
      reliability_reviewed_at: new Date().toISOString(),
      reliability_reviewed_by: actor.id,
      reliability_reviewed_by_name: actor.name,
    })
    .eq("id", input.supplierId);
  if (error) throw new SupplierPersistenceError("suppliers", "update", error);

  await logSupplierEvent(db, {
    supplierId: input.supplierId,
    actor,
    action: "RELIABILITY_CHANGED",
    fromValue: existing.reliability,
    toValue: input.reliability,
    note: input.reason,
    isHighImpact: true,
  });

  return { ok: true };
}

export async function upsertSupplierContact(
  db: Db,
  input: {
    contactId?: string;
    supplierId: string;
    name: string;
    roleTitle?: string;
    whatsappNumber?: string;
    phoneNumber?: string;
    email?: string;
    languages?: string;
    isPrimary: boolean;
    isEmergency: boolean;
    preferredTimeFrom?: string | null;
    preferredTimeTo?: string | null;
    timezone?: string;
    notes?: string;
  },
  actor: SupplierActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Clearing the existing primary first avoids the partial-unique-index
  // conflict when a new contact takes over the primary slot.
  if (input.isPrimary) {
    const { error: clearError } = await db
      .from("supplier_contacts")
      .update({ is_primary: false })
      .eq("supplier_id", input.supplierId)
      .eq("is_primary", true);
    if (clearError) throw new SupplierPersistenceError("supplier_contacts", "update", clearError);
  }

  const payload = {
    supplier_id: input.supplierId,
    name: input.name,
    role_title: input.roleTitle || null,
    whatsapp_number: input.whatsappNumber || null,
    phone_number: input.phoneNumber || null,
    email: input.email || null,
    languages: input.languages || null,
    is_primary: input.isPrimary,
    is_emergency: input.isEmergency,
    preferred_time_from: input.preferredTimeFrom || null,
    preferred_time_to: input.preferredTimeTo || null,
    timezone: input.timezone || null,
    notes: input.notes || null,
  };

  const { error } = input.contactId
    ? await db.from("supplier_contacts").update(payload).eq("id", input.contactId)
    : await db.from("supplier_contacts").insert(payload);
  if (error) throw new SupplierPersistenceError("supplier_contacts", input.contactId ? "update" : "insert", error);

  await logSupplierEvent(db, {
    supplierId: input.supplierId,
    actor,
    action: input.contactId ? "CONTACT_UPDATED" : "CONTACT_ADDED",
    toValue: input.name,
  });

  return { ok: true };
}

export async function upsertSupplierService(
  db: Db,
  input: {
    supplierId: string;
    category: string;
    typicalService?: string;
    typicalRate?: number | null;
    rateCurrency?: string;
    rateUnit?: string;
    season?: string;
    notes?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db.from("supplier_services").upsert(
    {
      supplier_id: input.supplierId,
      category: input.category,
      typical_service: input.typicalService || null,
      typical_rate: input.typicalRate ?? null,
      rate_currency: input.rateCurrency || null,
      rate_unit: input.rateUnit || null,
      season: input.season || null,
      notes: input.notes || null,
    },
    { onConflict: "supplier_id,category" },
  );
  if (error) throw new SupplierPersistenceError("supplier_services", "insert", error);
  return { ok: true };
}

export interface CreateCommitmentInput {
  supplierId: string;
  departureGroupId: string;
  serviceCategory: string;
  serviceLabel?: string;
  serviceDetails?: string;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
  bookingReference?: string;
  status: string;
  linkedEntityType?: string | null;
  linkedEntityId?: string | null;
  ownerName?: string;
  amount?: number | null;
  currency: string;
  paymentTermsNote?: string;
  paymentDueAt?: string | null;
  notes?: string;
}

async function nextReferenceCode(db: Db): Promise<string> {
  const { count, error } = await db.from("supplier_commitments").select("id", { count: "exact", head: true });
  if (error) throw new SupplierPersistenceError("supplier_commitments", "select", error);
  return `SC-${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function createCommitment(
  db: Db,
  input: CreateCommitmentInput,
  actor: SupplierActor,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const referenceCode = await nextReferenceCode(db);

  const { data, error } = await db
    .from("supplier_commitments")
    .insert({
      supplier_id: input.supplierId,
      departure_group_id: input.departureGroupId,
      reference_code: referenceCode,
      service_category: input.serviceCategory,
      service_label: input.serviceLabel || "",
      service_details: input.serviceDetails || null,
      service_start_date: input.serviceStartDate || null,
      service_end_date: input.serviceEndDate || null,
      booking_reference: input.bookingReference || null,
      status: input.status,
      linked_entity_type: input.linkedEntityType || null,
      linked_entity_id: input.linkedEntityId || null,
      owner_id: null,
      owner_name: input.ownerName || null,
      amount: input.amount ?? null,
      currency: input.currency,
      payment_terms_note: input.paymentTermsNote || null,
      payment_due_at: input.paymentDueAt || null,
      notes: input.notes || null,
      created_by: actor.id,
      created_by_name: actor.name,
    })
    .select("id")
    .single();
  if (error) throw new SupplierPersistenceError("supplier_commitments", "insert", error);

  await logSupplierEvent(db, {
    supplierId: input.supplierId,
    commitmentId: data.id as string,
    actor,
    action: "COMMITMENT_CREATED",
    toValue: input.serviceLabel || input.serviceCategory,
    isHighImpact: true,
  });

  // A commitment's `amount` is otherwise immutable after creation (no
  // `updateCommitmentAmount` exists), so this is the one point the
  // negotiated supplier cost and the linked group row's `internal_cost` —
  // two independently maintained numbers for the same real cost — can
  // actually be kept in step, rather than only ever agreeing by chance.
  // Best-effort: a failure here must not roll back a commitment that
  // already saved.
  if (input.linkedEntityId && input.amount != null) {
    try {
      if (input.linkedEntityType === "ACCOMMODATION") {
        await setGroupAccommodationInternalCost({
          id: input.linkedEntityId,
          departureGroupId: input.departureGroupId,
          internalCost: input.amount,
        });
      } else if (input.linkedEntityType === "TRANSPORT") {
        await setGroupTransportInternalCost({
          id: input.linkedEntityId,
          departureGroupId: input.departureGroupId,
          internalCost: input.amount,
        });
      }
    } catch (syncError) {
      console.error(
        `[suppliers] failed to sync internal_cost for commitment ${data.id} onto ${input.linkedEntityType} ${input.linkedEntityId}:`,
        syncError,
      );
    }
  }

  // The commitment→group direction of keeping supplier links in step (see
  // `syncCommitmentForLinkedEntity()` for the reverse). Both the id and the
  // name are pushed together so the group dialog's own display never shows
  // a picked supplier with a stale or blank printable name.
  if (input.linkedEntityId && (input.linkedEntityType === "ACCOMMODATION" || input.linkedEntityType === "TRANSPORT")) {
    try {
      const { data: supplierRow } = await db.from("suppliers").select("name").eq("id", input.supplierId).maybeSingle();
      const supplierName = (supplierRow as { name?: string } | null)?.name;
      if (input.linkedEntityType === "ACCOMMODATION") {
        await setGroupAccommodationReference({
          id: input.linkedEntityId,
          departureGroupId: input.departureGroupId,
          supplierId: input.supplierId,
          supplierName,
        });
      } else {
        await setGroupTransportReference({
          id: input.linkedEntityId,
          departureGroupId: input.departureGroupId,
          supplierId: input.supplierId,
          supplierName,
        });
      }
    } catch (syncError) {
      console.error(
        `[suppliers] failed to push supplier link for commitment ${data.id} onto ${input.linkedEntityType} ${input.linkedEntityId}:`,
        syncError,
      );
    }
  }

  return { ok: true, id: data.id as string };
}

export interface SyncCommitmentInput {
  supplierId: string;
  departureGroupId: string;
  linkedEntityType: "ACCOMMODATION" | "TRANSPORT";
  linkedEntityId: string;
  serviceCategory: string;
  serviceLabel: string;
}

/**
 * Keeps a group service row's supplier link and its Supplier Commitment in
 * step, from the group side. Called (best-effort — see call sites in
 * `app/(main)/departure-groups/actions.ts`) whenever a hotel or transport
 * route's supplier is set or changed, so `linked_entity_id` actually gets
 * populated instead of staying null forever (the gap that made
 * `confirmCommitment()`'s existing group-sync code never have anything to
 * act on).
 *
 * At most one non-cancelled commitment per linked entity: re-points the
 * existing one to the new supplier rather than creating a second, or
 * creates one (status DRAFT — a link is not yet a request) if none exists.
 * FLIGHT is deliberately not handled here, matching `createCommitment()`'s
 * own cost-sync above, which also only knows ACCOMMODATION/TRANSPORT.
 */
export async function syncCommitmentForLinkedEntity(
  db: Db,
  input: SyncCommitmentInput,
  actor: SupplierActor,
): Promise<{ ok: true; commitmentId: string } | { ok: false; error: string }> {
  const { data: existing, error: findError } = await db
    .from("supplier_commitments")
    .select("id, supplier_id")
    .eq("linked_entity_type", input.linkedEntityType)
    .eq("linked_entity_id", input.linkedEntityId)
    .neq("status", "CANCELLED")
    .maybeSingle();
  if (findError) throw new SupplierPersistenceError("supplier_commitments", "select", findError);

  if (existing) {
    if (existing.supplier_id === input.supplierId) {
      return { ok: true, commitmentId: existing.id as string };
    }
    const { error } = await db
      .from("supplier_commitments")
      .update({ supplier_id: input.supplierId })
      .eq("id", existing.id);
    if (error) throw new SupplierPersistenceError("supplier_commitments", "update", error);
    await logSupplierEvent(db, {
      supplierId: input.supplierId,
      commitmentId: existing.id as string,
      actor,
      action: "NOTE_ADDED",
      note: "Re-linked to a different supplier from the departure group.",
    });
    return { ok: true, commitmentId: existing.id as string };
  }

  const created = await createCommitment(
    db,
    {
      supplierId: input.supplierId,
      departureGroupId: input.departureGroupId,
      serviceCategory: input.serviceCategory,
      serviceLabel: input.serviceLabel,
      status: "DRAFT",
      linkedEntityType: input.linkedEntityType,
      linkedEntityId: input.linkedEntityId,
      currency: "SAR",
    },
    actor,
  );
  return created.ok ? { ok: true, commitmentId: created.id } : created;
}

/**
 * Confirms the commitment linked to a group's hotel or route, when the human
 * confirmed the *group* side directly (the group dialog's own "Mark
 * Confirmed", not `confirmCommitment()`). Deliberately a lighter touch than
 * `confirmCommitment()`: that function's evidence/booking-reference gate is
 * about a supplier-side confirmation being trustworthy on its own; here the
 * group side already ran its own equivalent check before this is called, so
 * re-running a second, differently-shaped gate would only block a
 * legitimate confirmation on a technicality. No-ops if no commitment is
 * linked yet, or it's already confirmed — never called on the human's
 * critical path (see the try/catch at every call site).
 */
export async function confirmLinkedCommitmentBestEffort(
  db: Db,
  input: { linkedEntityType: "ACCOMMODATION" | "TRANSPORT"; linkedEntityId: string },
  actor: SupplierActor,
): Promise<void> {
  const { data: commitment, error } = await db
    .from("supplier_commitments")
    .select("id, supplier_id, status")
    .eq("linked_entity_type", input.linkedEntityType)
    .eq("linked_entity_id", input.linkedEntityId)
    .neq("status", "CANCELLED")
    .maybeSingle();
  if (error) throw new SupplierPersistenceError("supplier_commitments", "select", error);
  if (!commitment || commitment.status === "CONFIRMED") return;

  const { error: updateError } = await db
    .from("supplier_commitments")
    .update({ status: "CONFIRMED", confirmed_at: new Date().toISOString(), confirmed_by_name: actor.name })
    .eq("id", commitment.id);
  if (updateError) throw new SupplierPersistenceError("supplier_commitments", "update", updateError);

  await logSupplierEvent(db, {
    supplierId: commitment.supplier_id as string,
    commitmentId: commitment.id as string,
    actor,
    action: "COMMITMENT_CONFIRMED",
    fromValue: commitment.status as string,
    toValue: "CONFIRMED",
    isHighImpact: true,
  });
}

export async function updateCommitmentStatus(
  db: Db,
  input: { commitmentId: string; status: string; note?: string },
  actor: SupplierActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: commitment, error: readError } = await db
    .from("supplier_commitments")
    .select("*")
    .eq("id", input.commitmentId)
    .maybeSingle();
  if (readError) throw new SupplierPersistenceError("supplier_commitments", "select", readError);
  if (!commitment) return { ok: false, error: "That commitment no longer exists." };

  const { error } = await db
    .from("supplier_commitments")
    .update({ status: input.status })
    .eq("id", input.commitmentId);
  if (error) throw new SupplierPersistenceError("supplier_commitments", "update", error);

  const actionByStatus: Record<string, SupplierActivityAction> = {
    REQUESTED: "COMMITMENT_REQUESTED",
    SUPPLIER_RESPONDED: "SUPPLIER_RESPONDED",
    COMPLETED: "COMMITMENT_COMPLETED",
    CANCELLED: "COMMITMENT_CANCELLED",
    DISPUTED: "COMMITMENT_DISPUTED",
  };

  await logSupplierEvent(db, {
    supplierId: commitment.supplier_id,
    commitmentId: input.commitmentId,
    actor,
    action: actionByStatus[input.status] ?? "COMMITMENT_CREATED",
    fromValue: commitment.status,
    toValue: input.status,
    note: input.note,
    isHighImpact: input.status === "DISPUTED" || input.status === "CANCELLED",
  });

  // A cancelled or disputed commitment does NOT silently reopen the linked
  // group's own hotel/route status — that status is a human's call on the
  // group side, and this module overriding it without them noticing is
  // worse than the disagreement it would "fix" (see the doc comment on
  // `confirmLinkedCommitmentBestEffort` for the confirm-direction version
  // of this same judgment). Instead: raise a visible task, so a human sees
  // it and decides. Best-effort — a failure here must not fail the status
  // change that already saved.
  if (
    (input.status === "CANCELLED" || input.status === "DISPUTED") &&
    commitment.linked_entity_type &&
    commitment.linked_entity_id &&
    commitment.status !== input.status
  ) {
    try {
      const { data: group } = await db
        .from("departure_groups")
        .select("operations_owner_id, operations_owner_name")
        .eq("id", commitment.departure_group_id)
        .maybeSingle();
      const ownerRow = group as { operations_owner_id: string | null; operations_owner_name: string | null } | null;
      await createGroupTask({
        departureGroupId: commitment.departure_group_id,
        title: `Review ${commitment.linked_entity_type.toLowerCase()} — supplier commitment ${input.status.toLowerCase()}`,
        description: `${commitment.service_label || commitment.service_category} commitment (${commitment.reference_code}) was just marked ${input.status}${input.note ? `: ${input.note}` : "."} The group's own status was left as-is — check whether it still reflects reality.`,
        ownerName: ownerRow?.operations_owner_name || "Operations",
        ownerId: ownerRow?.operations_owner_id ?? null,
        dueAt: new Date().toISOString(),
        category: "OPERATIONS",
      });
    } catch (taskError) {
      console.error(
        `[suppliers] failed to raise a review task for commitment ${input.commitmentId} going ${input.status}:`,
        taskError,
      );
    }
  }

  return { ok: true };
}

/**
 * Confirms a commitment. Requires evidence and a booking reference (mirrors
 * the existing rule in `supplier-columns.tsx` / `markAccommodationConfirmedInStore`).
 * When the commitment is linked to an existing group service row, the write
 * always routes through the existing group mutators — never a direct write —
 * so group readiness recomputes exactly as it does today.
 */
export async function confirmCommitment(
  db: Db,
  commitmentId: string,
  actor: SupplierActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: commitment, error: readError } = await db
    .from("supplier_commitments")
    .select("*, suppliers(name)")
    .eq("id", commitmentId)
    .maybeSingle();
  if (readError) throw new SupplierPersistenceError("supplier_commitments", "select", readError);
  if (!commitment) return { ok: false, error: "That commitment no longer exists." };
  if (commitment.status === "CONFIRMED") return { ok: false, error: "This commitment is already confirmed." };
  if (!commitment.evidence_path) return { ok: false, error: "Upload evidence before confirming this commitment." };
  if (!commitment.booking_reference?.trim()) {
    return { ok: false, error: "Enter a booking reference before confirming this commitment." };
  }

  const supplierName = (commitment as { suppliers?: { name?: string } }).suppliers?.name ?? null;

  if (commitment.linked_entity_type === "ACCOMMODATION" && commitment.linked_entity_id) {
    const referenceResult = await setGroupAccommodationReference({
      id: commitment.linked_entity_id,
      departureGroupId: commitment.departure_group_id,
      supplierName: supplierName ?? undefined,
      bookingReference: commitment.booking_reference,
    });
    if (!referenceResult.ok) return { ok: false, error: referenceResult.error };
    const confirmResult = await markGroupAccommodationConfirmed({
      id: commitment.linked_entity_id,
      departureGroupId: commitment.departure_group_id,
    });
    if (!confirmResult.ok) return { ok: false, error: confirmResult.error };
  } else if (commitment.linked_entity_type === "TRANSPORT" && commitment.linked_entity_id) {
    const referenceResult = await setGroupTransportReference({
      id: commitment.linked_entity_id,
      departureGroupId: commitment.departure_group_id,
      supplierName: supplierName ?? undefined,
      bookingReference: commitment.booking_reference,
    });
    if (!referenceResult.ok) return { ok: false, error: referenceResult.error };
    const confirmResult = await markGroupTransportConfirmed({
      id: commitment.linked_entity_id,
      departureGroupId: commitment.departure_group_id,
    });
    if (!confirmResult.ok) return { ok: false, error: confirmResult.error };
  }

  const { error } = await db
    .from("supplier_commitments")
    .update({ status: "CONFIRMED", confirmed_at: new Date().toISOString(), confirmed_by_name: actor.name })
    .eq("id", commitmentId);
  if (error) throw new SupplierPersistenceError("supplier_commitments", "update", error);

  await logSupplierEvent(db, {
    supplierId: commitment.supplier_id,
    commitmentId,
    actor,
    action: "COMMITMENT_CONFIRMED",
    fromValue: commitment.status,
    toValue: "CONFIRMED",
    isHighImpact: true,
  });

  return { ok: true };
}

export async function attachCommitmentEvidence(
  db: Db,
  input: { commitmentId: string; evidencePath: string },
  actor: SupplierActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: commitment, error: readError } = await db
    .from("supplier_commitments")
    .select("supplier_id")
    .eq("id", input.commitmentId)
    .maybeSingle();
  if (readError) throw new SupplierPersistenceError("supplier_commitments", "select", readError);
  if (!commitment) return { ok: false, error: "That commitment no longer exists." };

  const { error } = await db
    .from("supplier_commitments")
    .update({ evidence_path: input.evidencePath, evidence_uploaded_at: new Date().toISOString() })
    .eq("id", input.commitmentId);
  if (error) throw new SupplierPersistenceError("supplier_commitments", "update", error);

  await logSupplierEvent(db, {
    supplierId: commitment.supplier_id,
    commitmentId: input.commitmentId,
    actor,
    action: "EVIDENCE_UPLOADED",
  });

  return { ok: true };
}

export async function recordSupplierPayment(
  db: Db,
  input: { commitmentId: string; amount: number; currency: string; paidAt: string; method?: string; reference?: string },
  actor: SupplierActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: commitment, error: readError } = await db
    .from("supplier_commitments")
    .select("supplier_id")
    .eq("id", input.commitmentId)
    .maybeSingle();
  if (readError) throw new SupplierPersistenceError("supplier_commitments", "select", readError);
  if (!commitment) return { ok: false, error: "That commitment no longer exists." };

  const { error } = await db.from("supplier_payments").insert({
    commitment_id: input.commitmentId,
    amount: input.amount,
    currency: input.currency,
    paid_at: input.paidAt,
    method: input.method || null,
    reference: input.reference || null,
    recorded_by: actor.id,
    recorded_by_name: actor.name,
  });
  if (error) throw new SupplierPersistenceError("supplier_payments", "insert", error);

  await logSupplierEvent(db, {
    supplierId: commitment.supplier_id,
    commitmentId: input.commitmentId,
    actor,
    action: "PAYMENT_RECORDED",
    toValue: `${input.currency} ${input.amount}`,
    isHighImpact: true,
  });

  return { ok: true };
}

/**
 * Records money a supplier refunded back to the agency — the mirror of
 * `recordSupplierPayment()` above. Inserts a negative `supplier_payments`
 * row rather than a separate table: `sync_supplier_commitment_amount_paid()`
 * already sums every row on the commitment unconditionally (see the
 * migration's comment), so a negative row reduces `amount_paid` with no
 * trigger change, exactly mirroring how `payments` already tolerates a
 * negative row for `reversePayment()`/`payRefund()` on the pilgrim side.
 *
 * Capped at what has actually been paid — a supplier can't refund more than
 * they were given.
 */
export async function recordSupplierRefund(
  db: Db,
  input: { commitmentId: string; amount: number; currency: string; refundedAt: string; method?: string; reference?: string; reason?: string },
  actor: SupplierActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: commitment, error: readError } = await db
    .from("supplier_commitments")
    .select("supplier_id, amount_paid")
    .eq("id", input.commitmentId)
    .maybeSingle();
  if (readError) throw new SupplierPersistenceError("supplier_commitments", "select", readError);
  if (!commitment) return { ok: false, error: "That commitment no longer exists." };

  if (input.amount > Number(commitment.amount_paid)) {
    return {
      ok: false,
      error: `Cannot refund more than the ${Number(commitment.amount_paid).toLocaleString("en-US")} already paid on this commitment.`,
    };
  }

  const { error } = await db.from("supplier_payments").insert({
    commitment_id: input.commitmentId,
    amount: -Math.abs(input.amount),
    currency: input.currency,
    paid_at: input.refundedAt,
    method: input.method || null,
    reference: input.reference || null,
    recorded_by: actor.id,
    recorded_by_name: actor.name,
  });
  if (error) throw new SupplierPersistenceError("supplier_payments", "insert", error);

  await logSupplierEvent(db, {
    supplierId: commitment.supplier_id,
    commitmentId: input.commitmentId,
    actor,
    action: "PAYMENT_REFUNDED",
    toValue: `${input.currency} ${input.amount}`,
    note: input.reason,
    isHighImpact: true,
  });

  return { ok: true };
}

export async function addSupplierNote(
  db: Db,
  input: { supplierId: string; note: string },
  actor: SupplierActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await logSupplierEvent(db, {
    supplierId: input.supplierId,
    actor,
    action: "NOTE_ADDED",
    note: input.note,
  });
  return { ok: true };
}
