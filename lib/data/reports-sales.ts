/**
 * Client-safe derivations for the Sales & Leads report tab. Pure functions
 * over `ReportLeadFact[]` — no Supabase import (same convention as
 * `lib/data/reports.ts`).
 */

import { LEAD_FUNNEL_STAGES, LEAD_SOURCE_LABELS, LOST_REASON_LABELS } from "@/lib/data/reports-copy";
import { LEAD_STAGE_LABELS } from "@/lib/types/leads";
import type { ReportLeadFact } from "@/lib/types/reports";

/* ── Lead funnel ──────────────────────────────────────────────────────────── */

export interface FunnelStageRow {
  stage: string;
  label: string;
  count: number;
  /** `null` for the first stage — nothing to convert from. */
  conversionFromPreviousPercent: number | null;
}

/**
 * A lead's current `stage` is the only signal available (no
 * `lead_stage_events` history table yet — plan gap, documented on the view).
 * A lead still active at stage X is counted at every stage up to and
 * including X, since it must have passed through each on the way — this
 * yields a monotonically non-increasing funnel instead of a raw snapshot
 * that would understate every stage but the current one. Leads that exited
 * (Lost / Postponed / Duplicate / Spam) are not attributed to any funnel
 * stage, since which stage they exited from is not recorded.
 */
export function buildLeadFunnel(leads: ReportLeadFact[]): FunnelStageRow[] {
  const stageIndex = new Map<string, number>(LEAD_FUNNEL_STAGES.map((stage, i) => [stage, i]));

  const counts = LEAD_FUNNEL_STAGES.map(() => 0);
  for (const lead of leads) {
    const idx = stageIndex.get(lead.stage);
    if (idx === undefined) continue;
    for (let i = 0; i <= idx; i++) counts[i] += 1;
  }

  return LEAD_FUNNEL_STAGES.map((stage, i) => ({
    stage,
    label: LEAD_STAGE_LABELS[stage],
    count: counts[i],
    conversionFromPreviousPercent: i === 0 || counts[i - 1] === 0 ? null : (counts[i] / counts[i - 1]) * 100,
  }));
}

export function lostLeadCount(leads: ReportLeadFact[]): number {
  return leads.filter((l) => l.stage === "LOST").length;
}

/* ── Lead source performance ─────────────────────────────────────────────── */

export interface LeadSourceRow {
  source: string;
  label: string;
  leadCount: number;
  bookingCount: number;
  conversionPercent: number;
  revenue: number;
}

export function buildLeadSourcePerformance(leads: ReportLeadFact[]): LeadSourceRow[] {
  const bySource = new Map<string, ReportLeadFact[]>();
  for (const lead of leads) {
    const bucket = bySource.get(lead.source) ?? [];
    bucket.push(lead);
    bySource.set(lead.source, bucket);
  }

  return Array.from(bySource.entries())
    .map(([source, rows]) => {
      const booked = rows.filter((r) => r.booking_id);
      return {
        source,
        label: LEAD_SOURCE_LABELS[source] ?? source,
        leadCount: rows.length,
        bookingCount: booked.length,
        conversionPercent: rows.length > 0 ? (booked.length / rows.length) * 100 : 0,
        revenue: booked.reduce((total, r) => total + (r.total_booking_value ?? 0), 0),
      };
    })
    .sort((a, b) => b.leadCount - a.leadCount);
}

/* ── Sales team performance ──────────────────────────────────────────────── */

export interface SalesOwnerRow {
  ownerName: string;
  leadCount: number;
  contactRatePercent: number;
  bookingCount: number;
  bookingValue: number;
}

export function buildSalesTeamPerformance(leads: ReportLeadFact[]): SalesOwnerRow[] {
  const byOwner = new Map<string, ReportLeadFact[]>();
  for (const lead of leads) {
    const key = lead.sales_owner_name || "Unassigned";
    const bucket = byOwner.get(key) ?? [];
    bucket.push(lead);
    byOwner.set(key, bucket);
  }

  return Array.from(byOwner.entries())
    .map(([ownerName, rows]) => {
      const contacted = rows.filter((r) => r.first_response_at);
      const booked = rows.filter((r) => r.booking_id);
      return {
        ownerName,
        leadCount: rows.length,
        contactRatePercent: rows.length > 0 ? (contacted.length / rows.length) * 100 : 0,
        bookingCount: booked.length,
        bookingValue: booked.reduce((total, r) => total + (r.total_booking_value ?? 0), 0),
      };
    })
    .sort((a, b) => b.bookingValue - a.bookingValue);
}

/* ── Lost-lead analysis ───────────────────────────────────────────────────── */

export interface LostReasonRow {
  reason: string;
  label: string;
  count: number;
}

export function buildLostLeadAnalysis(leads: ReportLeadFact[]): LostReasonRow[] {
  const byReason = new Map<string, number>();
  for (const lead of leads) {
    if (lead.stage !== "LOST" || !lead.lost_reason) continue;
    byReason.set(lead.lost_reason, (byReason.get(lead.lost_reason) ?? 0) + 1);
  }
  return Array.from(byReason.entries())
    .map(([reason, count]) => ({ reason, label: LOST_REASON_LABELS[reason] ?? reason, count }))
    .sort((a, b) => b.count - a.count);
}
