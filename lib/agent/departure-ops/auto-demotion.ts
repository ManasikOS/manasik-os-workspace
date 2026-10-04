/**
 * Auto-demotion — the last row of §11's guardrail table: "If a group's or
 * agency's 30-day proposal rejection rate exceeds a threshold (default
 * 40%), mode drops ACTIVE → PROPOSE." Trust is measured, not assumed.
 *
 * Runs once per sweep (drain.ts's DEPARTURE_OPS_SWEEP handler), never per
 * review — this is a slow-moving trend check, not a per-turn guardrail.
 *
 * "An alert lands on the Operations dashboard" (the plan's own wording):
 * built here as the mode flip itself, which is real and already visible —
 * the Agent tab's mode badge and the management panel both read live
 * `mode`/`departure_ops_mode`. A dedicated banner/notification surface is
 * not built; that is additional UI work this module deliberately doesn't
 * invent a workaround for (a `departure_group_agent_findings` row would be
 * the natural place, but that table's `agent_run_id` is NOT NULL — an
 * agency-wide trend has no single run to attach to, and forcing one would
 * misrepresent the finding as something a review turn concluded, which it
 * did not).
 */

import "server-only";

import type { Db } from "@/lib/data/departure-groups-repository";

const THRESHOLD = 0.4;
/** Below this many decided proposals, a rejection rate is noise, not a trend — one bad proposal in a sample of two is not 50% untrustworthy. */
const MIN_SAMPLE = 5;
const WINDOW_DAYS = 30;

interface RejectionSample {
  decided: number;
  rejected: number;
}

async function rejectionRateFor(
  client: Db,
  scope: { agencyId: string; groupId?: string },
): Promise<RejectionSample> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  let query = client
    .from("agent_proposals")
    .select("status")
    .eq("agency_id", scope.agencyId)
    .in("status", ["EXECUTED", "REJECTED"])
    .gte("decided_at", since);
  if (scope.groupId) query = query.eq("departure_group_id", scope.groupId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to compute rejection rate: ${error.message}`);
  const rows = (data ?? []) as { status: string }[];
  return { decided: rows.length, rejected: rows.filter((r) => r.status === "REJECTED").length };
}

function exceedsThreshold(sample: RejectionSample): boolean {
  return sample.decided >= MIN_SAMPLE && sample.rejected / sample.decided > THRESHOLD;
}

export interface AutoDemotionResult {
  agenciesDemoted: number;
  groupsDemoted: number;
}

/**
 * Checks every currently-ACTIVE agency and every currently-ACTIVE
 * per-group override, demoting each that has crossed the threshold. A
 * demoted agency's groups still on INHERIT follow it down automatically —
 * they read `ai_settings.departure_ops_mode` live, nothing per-group needs
 * touching for them.
 */
export async function checkAutoDemotion(client: Db): Promise<AutoDemotionResult> {
  let agenciesDemoted = 0;
  let groupsDemoted = 0;

  const { data: activeAgencies, error: agenciesError } = await client
    .from("ai_settings")
    .select("agency_id")
    .eq("departure_ops_mode", "ACTIVE");
  if (agenciesError) throw new Error(`Failed to load ACTIVE agencies: ${agenciesError.message}`);

  for (const row of (activeAgencies ?? []) as { agency_id: string }[]) {
    const sample = await rejectionRateFor(client, { agencyId: row.agency_id });
    if (!exceedsThreshold(sample)) continue;

    const { error } = await client
      .from("ai_settings")
      .update({ departure_ops_mode: "PROPOSE" })
      .eq("agency_id", row.agency_id)
      .eq("departure_ops_mode", "ACTIVE"); // guards a race against a human changing it in between
    if (!error) {
      agenciesDemoted++;
      console.error(
        `[departure-ops] auto-demoted agency ${row.agency_id} ACTIVE → PROPOSE: ${sample.rejected}/${sample.decided} proposals rejected in the last ${WINDOW_DAYS} days.`,
      );
    }
  }

  const { data: activeGroups, error: groupsError } = await client
    .from("departure_group_agent_state")
    .select("departure_group_id, agency_id")
    .eq("mode", "ACTIVE");
  if (groupsError) throw new Error(`Failed to load ACTIVE group overrides: ${groupsError.message}`);

  for (const row of (activeGroups ?? []) as { departure_group_id: string; agency_id: string }[]) {
    const sample = await rejectionRateFor(client, { agencyId: row.agency_id, groupId: row.departure_group_id });
    if (!exceedsThreshold(sample)) continue;

    const { error } = await client
      .from("departure_group_agent_state")
      .update({ mode: "PROPOSE" })
      .eq("departure_group_id", row.departure_group_id)
      .eq("mode", "ACTIVE");
    if (!error) {
      groupsDemoted++;
      console.error(
        `[departure-ops] auto-demoted group ${row.departure_group_id} ACTIVE → PROPOSE: ${sample.rejected}/${sample.decided} proposals rejected in the last ${WINDOW_DAYS} days.`,
      );
    }
  }

  return { agenciesDemoted, groupsDemoted };
}
