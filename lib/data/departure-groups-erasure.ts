/**
 * Erasing a traveller's sensitive details from Departure Groups.
 *
 * "Sensitive" here means the identity and contact details that have no use once a
 * journey is over: passport number, expiry and issue country, date of birth, phone,
 * emergency contact, the visa number, and every uploaded file (passport scans, visa,
 * ticket) together with what the AI review read off them. The traveller's NAME and the
 * booking, payment and invoice records stay: the agency needs them for its accounts,
 * and an invoice must keep naming who it was issued to.
 *
 * The retention period is 24 months after the group's return date. A person's erasure
 * request can be met earlier, once the trip is over (or was cancelled) - never while a
 * traveller still needs their passport for a trip that has not finished.
 *
 * Pure and store-passing like the other mutators, so the rules are unit-tested without a
 * database. The wrapper that also removes the stored files and the person record is
 * `eraseTravellerSensitiveData()` in `departure-groups.ts`.
 */

import { newId } from "@/lib/data/departure-groups-ids";
import type { DepartureGroupStore, GroupActor } from "@/lib/types/departure-groups";

/** How long after the return date a traveller's sensitive details are kept. */
export const TRAVELLER_DATA_RETENTION_MONTHS = 24;

/** The day (YYYY-MM-DD) before which a group's return date is past retention, at `now`. */
export function retentionCutoffDate(now: Date, months: number = TRAVELLER_DATA_RETENTION_MONTHS): string {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return cutoff.toISOString().slice(0, 10);
}

/** Why a request or the retention sweep started an erasure. */
export type ErasureReason = "REQUEST" | "RETENTION";

export interface ErasureSubject {
  returnDate: string;
  groupStatus: string;
  seatStatus: string;
  bookingStatus: string | null;
  outstandingBalance: number;
  alreadyErased: boolean;
}

export type ErasureCheck = { ok: true } | { ok: false; error: string };

/**
 * May this traveller's details be erased now?
 *
 *   * Already erased: nothing to do.
 *   * REQUEST: only once the trip has ended (return date passed) or the group / booking was cancelled.
 *   * RETENTION: only 24+ months after the return date, and never while the booking still owes money or
 *     a refund is pending - those records are still being worked and may need the details.
 */
export function checkErasure(subject: ErasureSubject, reason: ErasureReason, now: Date): ErasureCheck {
  if (subject.alreadyErased) {
    return { ok: false, error: "This traveller's sensitive details have already been erased." };
  }

  const cancelled =
    subject.groupStatus === "CANCELLED" ||
    subject.seatStatus === "CANCELLED" ||
    subject.bookingStatus === "CANCELLED";
  const today = now.toISOString().slice(0, 10);

  if (reason === "REQUEST") {
    if (!cancelled && subject.returnDate >= today) {
      return {
        ok: false,
        error: "This traveller has not finished their trip yet, so their passport and contact details are still needed.",
      };
    }
    return { ok: true };
  }

  if (subject.returnDate >= retentionCutoffDate(now)) {
    return { ok: false, error: "This traveller is still inside the 24-month retention period." };
  }
  if (subject.outstandingBalance > 0 || subject.seatStatus === "REFUND_PENDING") {
    return { ok: false, error: "This booking still has an unsettled balance or refund." };
  }
  return { ok: true };
}

/** Columns cleared on the traveller's row. */
const PILGRIM_FIELDS_TO_CLEAR = [
  "phone_snapshot",
  "passport_number_snapshot",
  "passport_expiry",
  "passport_issue_country",
  "date_of_birth",
  "visa_id",
  "visa_issue_note",
  "visa_file_path",
  "visa_ai_extracted",
  "visa_ai_issues",
  "visa_ai_error",
  "ticket_file_path",
  "ticket_file_name",
  "ticket_ai_extracted",
  "ticket_ai_issues",
  "ticket_ai_error",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
] as const;

/** Columns cleared on each of the traveller's document records (the status and the requirement stay). */
const DOCUMENT_FIELDS_TO_CLEAR = ["file_path", "file_name", "file_size_bytes", "notes"] as const;

export type EraseOutcome =
  | { ok: true; result: { filePaths: string[]; personId: string | null } }
  | { ok: false; error: string };

/** Every stored file that belongs to this traveller, so the caller can delete them from storage first. */
export function collectTravellerFilePaths(data: DepartureGroupStore, pilgrimId: string): string[] {
  const pilgrim = data.pilgrims.find((row) => row.id === pilgrimId);
  if (!pilgrim) return [];
  const paths = new Set<string>();
  for (const path of [pilgrim.visa_file_path, pilgrim.ticket_file_path]) {
    if (path) paths.add(path);
  }
  for (const document of data.pilgrimDocuments) {
    if (document.pilgrim_id === pilgrimId && document.file_path) paths.add(document.file_path);
  }
  return [...paths];
}

export function eraseTravellerSensitiveFieldsInStore(
  data: DepartureGroupStore,
  input: { departureGroupId: string; pilgrimId: string; reason: ErasureReason },
  actor: GroupActor,
  now: Date = new Date(),
): EraseOutcome {
  const group = data.groups.find((row) => row.id === input.departureGroupId);
  const pilgrim = data.pilgrims.find(
    (row) => row.id === input.pilgrimId && row.departure_group_id === input.departureGroupId,
  );
  if (!group || !pilgrim) {
    return { ok: false, error: "That traveller is no longer on this group." };
  }
  const booking = data.bookings.find((row) => row.id === pilgrim.booking_id) ?? null;

  const check = checkErasure(
    {
      returnDate: group.return_date,
      groupStatus: group.group_status,
      seatStatus: pilgrim.seat_status,
      bookingStatus: booking?.booking_status ?? null,
      outstandingBalance: booking?.outstanding_balance ?? 0,
      alreadyErased: Boolean(pilgrim.sensitive_data_erased_at),
    },
    input.reason,
    now,
  );
  if (!check.ok) return check;

  const filePaths = collectTravellerFilePaths(data, pilgrim.id);

  const row = pilgrim as unknown as Record<string, unknown>;
  for (const field of PILGRIM_FIELDS_TO_CLEAR) row[field] = null;
  pilgrim.sensitive_data_erased_at = now.toISOString();

  for (const document of data.pilgrimDocuments) {
    if (document.pilgrim_id !== pilgrim.id) continue;
    const documentRow = document as unknown as Record<string, unknown>;
    for (const field of DOCUMENT_FIELDS_TO_CLEAR) documentRow[field] = null;
  }

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TRAVELLER_DATA_ERASED",
    entity_type: "PILGRIM",
    entity_id: pilgrim.id,
    before_value: null,
    // Which kinds of detail were erased, never the details themselves.
    after_value: { reason: input.reason, files_removed: filePaths.length },
    message:
      input.reason === "RETENTION"
        ? `Sensitive details for ${pilgrim.full_name_snapshot} were erased after the 24-month retention period.`
        : `Sensitive details for ${pilgrim.full_name_snapshot} were erased at a staff member's request.`,
    is_system: input.reason === "RETENTION",
    is_high_impact: true,
    created_at: now.toISOString(),
  });

  return { ok: true, result: { filePaths, personId: pilgrim.pilgrim_id } };
}
