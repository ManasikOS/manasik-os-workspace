/**
 * Supabase persistence for Pilgrims.
 *
 * Same shape as `lib/data/leads-repository.ts`: the module's rules live in the
 * pure `*InStore` mutators in `lib/data/pilgrims.ts`, which take a
 * `PilgrimStore` — plain arrays of rows for tables this module owns — and
 * mutate it in memory. `loadPilgrimStore()` hydrates it, the mutator runs
 * unchanged, `persistPilgrimStore()` diffs against a pre-mutation snapshot and
 * writes only what changed.
 *
 * Journey-scoped facts (seat, documents, visa, rooming, booking money) belong
 * to `departure_group_pilgrims` / `departure_group_bookings`, which this
 * module does not own — they are read through the `pilgrim_journey_rows` view
 * via `loadPilgrimJourneys()` and never diffed here. Mutations to them run
 * through the existing `lib/data/departure-groups*.ts` functions; the few
 * journey-level fields unique to this module (`journey_status`,
 * `cancellation_reason`, `moved_from_group_id`, `replaced_by_pilgrim_id`) are
 * written directly with `updateJourneyFields()` below, since no existing
 * mutator owns them and they carry no capacity/money side effects.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  PilgrimActivityLogRow,
  PilgrimJourneyRow,
  PilgrimJourneyStatus,
  PilgrimMedicalRecordRow,
  PilgrimPaymentMilestoneRow,
  PilgrimRow,
  PilgrimSupportRequestRow,
  SupportCaseAttachmentRow,
  SupportCaseEventRow,
} from "@/lib/types/pilgrims";
import { newId } from "@/lib/data/pilgrims-ids";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
type Row = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class PilgrimPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Pilgrims: ${operation} on ${table} failed — ${detail}`);
    this.name = "PilgrimPersistenceError";
  }
}

export interface PilgrimStore {
  pilgrims: PilgrimRow[];
  medical: PilgrimMedicalRecordRow[];
  support: PilgrimSupportRequestRow[];
  caseEvents: SupportCaseEventRow[];
  caseAttachments: SupportCaseAttachmentRow[];
  activity: PilgrimActivityLogRow[];
  paymentMilestones: PilgrimPaymentMilestoneRow[];
}

export function emptyPilgrimStore(): PilgrimStore {
  return {
    pilgrims: [],
    medical: [],
    support: [],
    caseEvents: [],
    caseAttachments: [],
    activity: [],
    paymentMilestones: [],
  };
}

async function selectAll(db: Db, table: string, order?: string): Promise<Row[]> {
  let query = db.from(table).select("*");
  if (order) query = query.order(order, { ascending: false });
  const { data, error } = await query;
  if (error) throw new PilgrimPersistenceError(table, "select", error);
  return (data ?? []) as Row[];
}

export interface LoadPilgrimStoreOptions {
  /** Restrict every collection to one person — used by the profile page. */
  pilgrimId?: string;
  only?: readonly (keyof PilgrimStore)[];
}

export async function loadPilgrimStore(
  db: Db,
  options: LoadPilgrimStoreOptions = {},
): Promise<PilgrimStore> {
  const wanted = new Set<keyof PilgrimStore>(
    options.only ?? [
      "pilgrims",
      "medical",
      "support",
      "caseEvents",
      "caseAttachments",
      "activity",
      "paymentMilestones",
    ],
  );

  const scoped = (table: string, order?: string) => {
    let query = db.from(table).select("*");
    if (options.pilgrimId) query = query.eq("pilgrim_id", options.pilgrimId);
    if (order) query = query.order(order, { ascending: false });
    return query.then(({ data, error }) => {
      if (error) throw new PilgrimPersistenceError(table, "select", error);
      return (data ?? []) as Row[];
    });
  };

  const [pilgrims, medical, support, caseEvents, caseAttachments, activity, paymentMilestones] =
    await Promise.all([
      wanted.has("pilgrims")
        ? options.pilgrimId
          ? db
              .from("pilgrims")
              .select("*")
              .eq("id", options.pilgrimId)
              .then(({ data, error }) => {
                if (error) throw new PilgrimPersistenceError("pilgrims", "select", error);
                return (data ?? []) as Row[];
              })
          : selectAll(db, "pilgrims", "created_at")
        : Promise.resolve([]),
      wanted.has("medical") ? scoped("pilgrim_medical_records") : Promise.resolve([]),
      wanted.has("support") ? scoped("pilgrim_support_requests") : Promise.resolve([]),
      wanted.has("caseEvents") ? scoped("support_case_events") : Promise.resolve([]),
      wanted.has("caseAttachments") ? scoped("support_case_attachments") : Promise.resolve([]),
      wanted.has("activity") ? scoped("pilgrim_activity_logs") : Promise.resolve([]),
      wanted.has("paymentMilestones") ? scoped("pilgrim_payment_milestones") : Promise.resolve([]),
    ]);

  return {
    pilgrims: pilgrims as PilgrimRow[],
    medical: medical as PilgrimMedicalRecordRow[],
    support: support as PilgrimSupportRequestRow[],
    caseEvents: caseEvents as SupportCaseEventRow[],
    caseAttachments: caseAttachments as SupportCaseAttachmentRow[],
    activity: activity as PilgrimActivityLogRow[],
    paymentMilestones: paymentMilestones as PilgrimPaymentMilestoneRow[],
  };
}

/** Reads the `pilgrim_journey_rows` view — read-only, never diffed. */
export async function loadPilgrimJourneys(
  db: Db,
  filter: { pilgrimId?: string; departureGroupId?: string } = {},
): Promise<PilgrimJourneyRow[]> {
  let query = db.from("pilgrim_journey_rows").select("*");
  if (filter.pilgrimId) query = query.eq("pilgrim_id", filter.pilgrimId);
  if (filter.departureGroupId) query = query.eq("departure_group_id", filter.departureGroupId);
  const { data, error } = await query.order("departure_date", { ascending: true });
  if (error) throw new PilgrimPersistenceError("pilgrim_journey_rows", "select", error);
  return (data ?? []) as PilgrimJourneyRow[];
}

export function snapshotPilgrimStore(store: PilgrimStore): PilgrimStore {
  return structuredClone(store);
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/;

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "string" && typeof b === "string") {
    if (TIMESTAMP.test(a) && TIMESTAMP.test(b)) return Date.parse(a) === Date.parse(b);
    return false;
  }
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  if (typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function sameRow(a: Row, b: Row): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameValue(a[key], b[key])) return false;
  }
  return true;
}

interface MutableCollectionSpec {
  key: keyof PilgrimStore;
  table: string;
  pk: string;
  appendOnly?: boolean;
}

const MUTABLE_COLLECTIONS: MutableCollectionSpec[] = [
  { key: "pilgrims", table: "pilgrims", pk: "id" },
  { key: "medical", table: "pilgrim_medical_records", pk: "pilgrim_id" },
  { key: "support", table: "pilgrim_support_requests", pk: "id" },
  { key: "caseEvents", table: "support_case_events", pk: "id", appendOnly: true },
  { key: "caseAttachments", table: "support_case_attachments", pk: "id" },
  { key: "activity", table: "pilgrim_activity_logs", pk: "id", appendOnly: true },
  { key: "paymentMilestones", table: "pilgrim_payment_milestones", pk: "id" },
];

const CHUNK = 500;
function chunked<T>(rows: T[]): T[][] {
  if (rows.length <= CHUNK) return [rows];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

export async function persistPilgrimStore(db: Db, before: PilgrimStore, after: PilgrimStore): Promise<void> {
  for (const spec of MUTABLE_COLLECTIONS) {
    const previous = new Map((before[spec.key] as Row[]).map((row) => [String(row[spec.pk]), row]));
    const pending: Row[] = [];
    for (const row of after[spec.key] as Row[]) {
      const key = String(row[spec.pk]);
      const old = previous.get(key);
      if (spec.appendOnly && old) continue;
      if (old && sameRow(old, row)) continue;
      pending.push(row);
    }
    if (pending.length === 0) continue;
    for (const batch of chunked(pending)) {
      const { error } = await db.from(spec.table).upsert(batch, { onConflict: spec.pk });
      if (error) throw new PilgrimPersistenceError(spec.table, "insert", error);
    }
  }

  for (const spec of [...MUTABLE_COLLECTIONS].reverse()) {
    if (spec.appendOnly) continue;
    const surviving = new Set((after[spec.key] as Row[]).map((row) => String(row[spec.pk])));
    const removed = (before[spec.key] as Row[])
      .map((row) => String(row[spec.pk]))
      .filter((key) => !surviving.has(key));
    if (removed.length === 0) continue;
    for (const batch of chunked(removed)) {
      const { error } = await db.from(spec.table).delete().in(spec.pk, batch);
      if (error) throw new PilgrimPersistenceError(spec.table, "delete", error);
    }
  }
}

/* ── Cross-module glue: booking creation resolves/creates the person ────────── */

export interface PersonMatchInput {
  fullName: string;
  whatsappNumber?: string | null;
  passportNumber?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  passportExpiry?: string | null;
  /**
   * Keeps the match (and the new profile) inside one agency. A session client is already scoped by RLS; the service-role client
   * is not, and without this a passport or phone number would match ANOTHER agency's traveller and attach this booking to them.
   */
  agencyId?: string | null;
}

/**
 * Finds an existing person by passport number (exact, case-insensitive) or
 * WhatsApp number, or creates a new one. Called from
 * `createGroupBooking()`/`convertLeadToBookingAction` before the pure
 * `createGroupBookingInStore` mutator runs, so each traveller's
 * `departure_group_pilgrims.pilgrim_id` is set at insert time rather than left
 * null. A repeat traveller is recognised by passport or WhatsApp, so they
 * never get a duplicate profile.
 */
export async function resolveOrCreatePilgrimPerson(db: Db, input: PersonMatchInput): Promise<string> {
  const passport = input.passportNumber?.trim().toUpperCase() || null;
  const whatsapp = input.whatsappNumber?.trim() || null;

  if (passport) {
    let passportQuery = db.from("pilgrims").select("id").ilike("passport_number", passport);
    if (input.agencyId) passportQuery = passportQuery.eq("agency_id", input.agencyId);
    const { data, error } = await passportQuery.limit(1).maybeSingle();
    if (error) throw new PilgrimPersistenceError("pilgrims", "select", error);
    if (data?.id) return data.id as string;
  }

  if (whatsapp) {
    let whatsappQuery = db.from("pilgrims").select("id").eq("whatsapp_number", whatsapp);
    if (input.agencyId) whatsappQuery = whatsappQuery.eq("agency_id", input.agencyId);
    const { data, error } = await whatsappQuery.limit(1).maybeSingle();
    if (error) throw new PilgrimPersistenceError("pilgrims", "select", error);
    if (data?.id) return data.id as string;
  }

  const year = new Date().getFullYear();

  // The reference number is derived from a plain row count rather than a DB
  // sequence, so two inserts racing between the count read and the insert
  // (concurrent bookings, or several new travellers on one booking resolved
  // in parallel) can mint the same "PL-YYYY-NNNN" value and collide on
  // `pilgrims_reference_key`. Re-reading the count and retrying absorbs that
  // race instead of surfacing it as a 500.
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { count, error: countError } = await db
      .from("pilgrims")
      .select("id", { count: "exact", head: true });
    if (countError) throw new PilgrimPersistenceError("pilgrims", "select", countError);

    const reference = `PL-${year}-${String((count ?? 0) + attempt).padStart(4, "0")}`;

    const { data: created, error: insertError } = await db
      .from("pilgrims")
      .insert({
        reference,
        full_name: input.fullName.trim() || "Traveller",
        whatsapp_number: whatsapp ?? "",
        passport_number: passport,
        passport_expiry: input.passportExpiry ?? null,
        emergency_contact_name: input.emergencyContactName?.trim() || null,
        emergency_contact_phone: input.emergencyContactPhone?.trim() || null,
        // Stamped only when the caller named the agency (the service-role path); a session insert takes it from the session.
        ...(input.agencyId ? { agency_id: input.agencyId } : {}),
      })
      .select("id")
      .single();

    if (!insertError) return created.id as string;

    const isReferenceConflict =
      (insertError as { code?: string }).code === "23505" &&
      (insertError as { message?: string }).message?.includes("pilgrims_reference_key");
    if (!isReferenceConflict || attempt === maxAttempts) {
      throw new PilgrimPersistenceError("pilgrims", "insert", insertError);
    }
  }

  throw new PilgrimPersistenceError(
    "pilgrims",
    "insert",
    new Error("Could not generate a unique pilgrim reference after several attempts"),
  );
}

/**
 * Direct, single-row updates to the journey/enrolment fields this module owns
 * on `departure_group_pilgrims` (journey_status and the cancel/replace/move
 * audit columns from the pilgrims migration). No existing Departure Groups
 * mutator touches these, so a raw update carries no diff risk.
 */
export async function updateJourneyFields(
  db: Db,
  journeyId: string,
  patch: Partial<{
    journey_status: PilgrimJourneyStatus;
    relationship_to_primary: string;
    cancellation_reason: string | null;
    cancelled_at: string | null;
    moved_from_group_id: string | null;
    replaced_by_pilgrim_id: string | null;
    replaces_pilgrim_id: string | null;
  }>,
): Promise<void> {
  const { error } = await db.from("departure_group_pilgrims").update(patch).eq("id", journeyId);
  if (error) throw new PilgrimPersistenceError("departure_group_pilgrims", "update", error);
}

/** Recomputes and writes `journey_status` for one enrolment row. */
export async function syncJourneyStatus(
  db: Db,
  journey: PilgrimJourneyRow,
  status: PilgrimJourneyStatus,
): Promise<void> {
  if (journey.journey_status === status) return;
  await updateJourneyFields(db, journey.journey_id, { journey_status: status });
}

/**
 * Reads one journey's document checklist directly from
 * `departure_group_pilgrim_documents` — the table Departure Groups already
 * owns and writes through `lib/data/departure-groups-documents.ts`. The
 * Pilgrims Documents tab reads it the same way
 * `pilgrim-documents-drawer.tsx` already does; only the actions that mutate
 * it stay in the Departure Groups module.
 */
export async function loadJourneyDocuments(db: Db, journeyId: string) {
  const { data, error } = await db
    .from("departure_group_pilgrim_documents")
    .select("*")
    .eq("pilgrim_id", journeyId)
    .order("required_by_stage", { ascending: true });
  if (error) throw new PilgrimPersistenceError("departure_group_pilgrim_documents", "select", error);
  return data ?? [];
}

/** Inserts payment-milestone rows in bulk (used when a booking is first created). */
export async function insertPaymentMilestones(db: Db, rows: PilgrimPaymentMilestoneRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from("pilgrim_payment_milestones").insert(rows);
  if (error) throw new PilgrimPersistenceError("pilgrim_payment_milestones", "insert", error);
}

export { newId };
