import "server-only";

import { retentionCutoffDate, TRAVELLER_DATA_RETENTION_MONTHS } from "@/lib/data/departure-groups-erasure";
import { eraseTravellerSensitiveData } from "@/lib/data/departure-groups";
import type { Db } from "@/lib/data/departure-groups-repository";

/**
 * The nightly retention pass for one agency: erases the sensitive details of travellers whose group
 * returned more than 24 months ago, and trims the document access log to the same age.
 *
 * `dryRun` does everything except change data, and reports what it would have done - run it first,
 * read the numbers, and only then let the live sweep run. A traveller the rules refuse (money or a
 * refund still open) is counted as skipped, not as a failure, and is looked at again next night.
 *
 * Work is capped per run so a large backlog clears over several nights instead of one long call.
 */

export interface TravellerRetentionSummary {
  agencyId: string;
  dryRun: boolean;
  cutoffDate: string;
  travellersConsidered: number;
  travellersErased: number;
  travellersSkipped: number;
  filesRemoved: number;
  accessLogRowsRemoved: number;
  failures: number;
}

export const RETENTION_MAX_TRAVELLERS_PER_RUN = 50;

export async function runTravellerRetentionForAgency(
  db: Db,
  agencyId: string,
  options: { dryRun: boolean; now?: Date; maxTravellers?: number },
): Promise<TravellerRetentionSummary> {
  const now = options.now ?? new Date();
  const cutoffDate = retentionCutoffDate(now);
  const limit = options.maxTravellers ?? RETENTION_MAX_TRAVELLERS_PER_RUN;
  const summary: TravellerRetentionSummary = {
    agencyId,
    dryRun: options.dryRun,
    cutoffDate,
    travellersConsidered: 0,
    travellersErased: 0,
    travellersSkipped: 0,
    filesRemoved: 0,
    accessLogRowsRemoved: 0,
    failures: 0,
  };

  const { data: groups, error: groupsError } = await db
    .from("departure_groups")
    .select("id")
    .eq("agency_id", agencyId)
    .lt("return_date", cutoffDate)
    .order("return_date", { ascending: true })
    .limit(500);
  if (groupsError) {
    console.error("traveller retention: could not list groups", groupsError.message);
    summary.failures += 1;
  }
  const groupIds = ((groups ?? []) as { id: string }[]).map((row) => row.id);

  if (groupIds.length > 0) {
    const { data: travellers, error: travellersError } = await db
      .from("departure_group_pilgrims")
      .select("id, departure_group_id")
      .in("departure_group_id", groupIds)
      .is("sensitive_data_erased_at", null)
      .limit(limit);
    if (travellersError) {
      console.error("traveller retention: could not list travellers", travellersError.message);
      summary.failures += 1;
    }

    const actor = { id: null, name: "Retention sweep", agencyId };
    for (const traveller of (travellers ?? []) as { id: string; departure_group_id: string }[]) {
      summary.travellersConsidered += 1;
      try {
        const outcome = await eraseTravellerSensitiveData(
          { departureGroupId: traveller.departure_group_id, pilgrimId: traveller.id, reason: "RETENTION" },
          { client: db, actor, dryRun: options.dryRun },
        );
        if (outcome.ok) {
          summary.travellersErased += 1;
          summary.filesRemoved += outcome.filesRemoved;
        } else if (/unsettled|retention period|already been erased/i.test(outcome.error)) {
          summary.travellersSkipped += 1;
        } else {
          summary.failures += 1;
          console.error(`traveller retention: ${traveller.id}: ${outcome.error}`);
        }
      } catch (cause) {
        summary.failures += 1;
        console.error(`traveller retention: ${traveller.id} threw:`, cause instanceof Error ? cause.message : cause);
      }
    }
  }

  // The access log is kept for the same 24 months, counted from when each row was written.
  const logCutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - TRAVELLER_DATA_RETENTION_MONTHS, now.getUTCDate()),
  ).toISOString();
  if (options.dryRun) {
    const { count, error } = await db
      .from("departure_group_document_access_log")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agencyId)
      .lt("created_at", logCutoff);
    if (error) summary.failures += 1;
    else summary.accessLogRowsRemoved = count ?? 0;
  } else {
    const { data, error } = await db
      .from("departure_group_document_access_log")
      .delete()
      .eq("agency_id", agencyId)
      .lt("created_at", logCutoff)
      .select("id");
    if (error) summary.failures += 1;
    else summary.accessLogRowsRemoved = (data ?? []).length;
  }

  return summary;
}
