/**
 * Supabase persistence for Visa Operations.
 *
 * `visa_application_rows` (the view) is read-only — never diffed, never
 * written. Status transitions continue to run through the existing
 * `lib/data/departure-groups-documents.ts` mutators via
 * `lib/data/departure-groups.ts`'s `markGroupApplicationsSubmitted` /
 * `markGroupVisasUnderReview` / `uploadGroupPilgrimVisa` /
 * `rejectGroupPilgrimVisa` — reusing them rather than re-implementing the
 * guards and the group activity log is what keeps there being only one
 * transition path. This repository owns only the fields those mutators
 * don't touch: batches, assignment, application reference, verification and
 * the append-only event log.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  VisaApplicationEventRow,
  VisaApplicationRow,
  VisaSubmissionBatchRow,
} from "@/lib/types/visa";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class VisaPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Visa: ${operation} on ${table} failed — ${detail}`);
    this.name = "VisaPersistenceError";
  }
}

/** Loads the full active-group visa application queue. Filtered client-side
 *  by the Visa list — row counts (hundreds, not tens of thousands) don't yet
 *  justify server-side filter params. */
export async function loadVisaQueue(db: Db): Promise<VisaApplicationRow[]> {
  const { data, error } = await db
    .from("visa_application_rows")
    .select("*")
    .order("visa_submitted_at", { ascending: true, nullsFirst: true });
  if (error) throw new VisaPersistenceError("visa_application_rows", "select", error);
  return (data ?? []) as VisaApplicationRow[];
}

export async function findVisaRow(db: Db, journeyId: string): Promise<VisaApplicationRow | null> {
  const { data, error } = await db
    .from("visa_application_rows")
    .select("*")
    .eq("journey_id", journeyId)
    .maybeSingle();
  if (error) throw new VisaPersistenceError("visa_application_rows", "select", error);
  return (data ?? null) as VisaApplicationRow | null;
}

/** Direct, single-row updates to the fields this module owns on the
 *  enrolment (assignment, reference, batch, issue and verification detail).
 *  No `departure-groups*.ts` mutator touches these, so a raw update carries
 *  no diff risk. */
export async function updateVisaFields(
  db: Db,
  journeyId: string,
  patch: Partial<{
    visa_type: string | null;
    visa_application_reference: string | null;
    visa_assigned_to: string | null;
    visa_assigned_to_name: string | null;
    visa_assigned_at: string | null;
    visa_batch_id: string | null;
    visa_issue_date: string | null;
    visa_entry_type: string | null;
    visa_valid_until: string | null;
    visa_verified_at: string | null;
    visa_verified_by: string | null;
    visa_verified_by_name: string | null;
    visa_evidence_source: string | null;
    visa_status_checked_at: string | null;
    visa_last_update_at: string | null;
    visa_priority_score: number;
  }>,
): Promise<void> {
  const { error } = await db.from("departure_group_pilgrims").update(patch).eq("id", journeyId);
  if (error) throw new VisaPersistenceError("departure_group_pilgrims", "update", error);
}

export async function insertVisaEvent(
  db: Db,
  event: Omit<VisaApplicationEventRow, "id" | "created_at">,
): Promise<void> {
  const { error } = await db.from("visa_application_events").insert(event);
  if (error) throw new VisaPersistenceError("visa_application_events", "insert", error);
}

export async function loadVisaTimeline(db: Db, journeyId: string): Promise<VisaApplicationEventRow[]> {
  const { data, error } = await db
    .from("visa_application_events")
    .select("*")
    .eq("journey_id", journeyId)
    .order("created_at", { ascending: false });
  if (error) throw new VisaPersistenceError("visa_application_events", "select", error);
  return (data ?? []) as VisaApplicationEventRow[];
}

/* ── Batches ──────────────────────────────────────────────────────────────── */

export async function loadBatchesForGroup(db: Db, departureGroupId: string): Promise<VisaSubmissionBatchRow[]> {
  const { data, error } = await db
    .from("visa_submission_batches")
    .select("*")
    .eq("departure_group_id", departureGroupId)
    .order("created_at", { ascending: false });
  if (error) throw new VisaPersistenceError("visa_submission_batches", "select", error);
  return (data ?? []) as VisaSubmissionBatchRow[];
}

export async function loadBatch(db: Db, batchId: string): Promise<VisaSubmissionBatchRow | null> {
  const { data, error } = await db
    .from("visa_submission_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new VisaPersistenceError("visa_submission_batches", "select", error);
  return (data ?? null) as VisaSubmissionBatchRow | null;
}

export async function nextBatchSequence(db: Db, departureGroupId: string): Promise<number> {
  const { data, error } = await db
    .from("visa_submission_batches")
    .select("sequence_number")
    .eq("departure_group_id", departureGroupId)
    .order("sequence_number", { ascending: false })
    .limit(1);
  if (error) throw new VisaPersistenceError("visa_submission_batches", "select", error);
  const rows = (data ?? []) as { sequence_number: number }[];
  return (rows[0]?.sequence_number ?? 0) + 1;
}

export async function insertBatch(
  db: Db,
  row: Omit<VisaSubmissionBatchRow, "id" | "created_at" | "updated_at">,
): Promise<VisaSubmissionBatchRow> {
  const { data, error } = await db.from("visa_submission_batches").insert(row).select("*").single();
  if (error) throw new VisaPersistenceError("visa_submission_batches", "insert", error);
  return data as VisaSubmissionBatchRow;
}

export async function updateBatch(
  db: Db,
  batchId: string,
  patch: Partial<Omit<VisaSubmissionBatchRow, "id" | "departure_group_id" | "created_at">>,
): Promise<void> {
  const { error } = await db.from("visa_submission_batches").update(patch).eq("id", batchId);
  if (error) throw new VisaPersistenceError("visa_submission_batches", "update", error);
}
