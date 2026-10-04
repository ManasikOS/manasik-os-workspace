/**
 * The records the commercial stage is worked out from — MI3.4 of docs/inbox/implementation-plan.md. One conversation's lead
 * stage, its booking and its quotes, all scoped to the agency (the pipeline runs on the service-role client).
 * The stage itself is pure and lives in lib/inbox/intelligence/commercial-stage.ts.
 */

import "server-only";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { Db } from "@/lib/ai/db";
import { buildInboxOutcomeCards, metricKeysReadingFrom, type InboxOutcomeCard } from "@/lib/metrics/inbox-outcome-cards";
import {
  INBOX_OUTCOME_METRICS,
  computeInboxOutcomes,
  windowStartIso,
  type OutcomeMetricValue,
  type OutcomeSourceData,
} from "@/lib/metrics/inbox-outcomes";

export interface CommercialRecords {
  leadStage: string | null;
  booking: { status: string } | null;
  quoteStatuses: string[];
}

const NO_RECORDS: CommercialRecords = { leadStage: null, booking: null, quoteStatuses: [] };

export async function loadCommercialRecords(db: Db, agencyId: string, conversationId: string): Promise<CommercialRecords> {
  const { data: conversation, error: conversationError } = await db.from("conversations").select("lead_id").eq("agency_id", agencyId).eq("id", conversationId).maybeSingle();
  if (conversationError) throw new Error(`Could not read the conversation: ${conversationError.message}`);
  const leadId = (conversation as { lead_id: string | null } | null)?.lead_id ?? null;
  if (!leadId) return NO_RECORDS;

  const [lead, quotes] = await Promise.all([
    db.from("leads").select("stage, booking_id").eq("agency_id", agencyId).eq("id", leadId).maybeSingle(),
    db.from("lead_quotes").select("status").eq("agency_id", agencyId).eq("lead_id", leadId),
  ]);
  if (lead.error) throw new Error(`Could not read the lead: ${lead.error.message}`);
  if (quotes.error) throw new Error(`Could not read the lead's quotes: ${quotes.error.message}`);
  const leadRow = lead.data as { stage: string; booking_id: string | null } | null;
  if (!leadRow) return NO_RECORDS;

  let booking: CommercialRecords["booking"] = null;
  if (leadRow.booking_id) {
    const { data, error } = await db.from("departure_group_bookings").select("booking_status").eq("agency_id", agencyId).eq("id", leadRow.booking_id).maybeSingle();
    if (error) throw new Error(`Could not read the booking: ${error.message}`);
    if (data) booking = { status: String((data as { booking_status: string }).booking_status) };
  }

  return { leadStage: leadRow.stage, booking, quoteStatuses: ((quotes.data ?? []) as Array<{ status: string }>).map((row) => row.status) };
}

// ── OUT-01: outcome metric sources ────────────────────────────────────────────────────────────────────────────────────

const OUTCOME_WINDOW_DEFAULT_DAYS = 30;
const OUTCOME_WINDOW_MAX_DAYS = 90;
const OUTCOME_REVIEW_ROW_LIMIT = 5000;

export interface InboxOutcomesResult {
  values: Record<string, OutcomeMetricValue>;
  /** Source tables that could not be read. Their metrics read as no data, never as zero. */
  failures: string[];
}

/**
 * Reads the agency-scoped facts the outcome metrics are computed from and computes them. Every read names the agency. Queue
 * sizes are exact head-only counts (the same set a drill-down opens), the rest are bounded reads of counters and timestamps.
 * It never touches messages, attachments, transcripts or documents. A source that fails to read is reported and its metrics
 * show "no data" instead of failing the others or showing zero.
 */
export async function loadInboxOutcomes(
  db: Db,
  agencyId: string,
  options: { now?: Date; windowDays?: number; reviewRowLimit?: number } = {},
): Promise<InboxOutcomesResult> {
  const now = options.now ?? new Date();
  const windowDays = Math.min(OUTCOME_WINDOW_MAX_DAYS, Math.max(1, Math.trunc(options.windowDays ?? OUTCOME_WINDOW_DEFAULT_DAYS)));
  const reviewLimit = options.reviewRowLimit ?? OUTCOME_REVIEW_ROW_LIMIT;
  const nowIso = now.toISOString();
  const startIso = windowStartIso(nowIso, windowDays);
  const failures: string[] = [];
  const fail = (table: string) => {
    if (!failures.includes(table)) failures.push(table);
  };

  const queues = [...new Set(INBOX_OUTCOME_METRICS.flatMap((metric) => (metric.drillDown.kind === "QUEUE" ? [metric.drillDown.queue] : [])))];
  const queueCounts: OutcomeSourceData["queueCounts"] = {};
  const queueReads = Promise.all(
    queues.map(async (queue) => {
      const { count, error } = await db
        .from("conversation_queue_membership")
        .select("conversation_id", { count: "exact", head: true })
        .eq("agency_id", agencyId)
        .eq("queue_code", queue);
      if (error || count === null) fail("conversation_queue_membership");
      else queueCounts[queue] = count;
    }),
  );

  const kpiRead = db
    .from("inbox_intelligence_kpis_daily")
    .select("day, gate_evaluated, gate_skipped, ai_cost_usd, conversations_enriched")
    .eq("agency_id", agencyId)
    .gte("day", startIso.slice(0, 10));

  const reviewRead = db
    .from("conversation_interventions")
    .select("kind, created_at, resolved_at")
    .eq("agency_id", agencyId)
    .eq("status", "RESOLVED")
    .in("kind", ["PAYMENT_CLAIM", "BANK_DETAIL_MISMATCH"])
    .gte("resolved_at", startIso)
    .limit(reviewLimit + 1);

  const openRead = db
    .from("conversation_interventions")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId)
    .eq("severity", "BLOCK")
    .in("status", ["OPEN", "ACKNOWLEDGED"]);

  const [, kpi, reviews, open] = await Promise.all([queueReads, kpiRead, reviewRead, openRead]);

  let kpiDays: OutcomeSourceData["kpiDays"] = [];
  if (kpi.error) fail("inbox_intelligence_kpis_daily");
  else {
    kpiDays = ((kpi.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      day: String(row.day),
      gateEvaluated: Number(row.gate_evaluated),
      gateSkipped: Number(row.gate_skipped),
      aiCostUsd: Number(row.ai_cost_usd),
      conversationsEnriched: Number(row.conversations_enriched),
    }));
  }

  let resolvedReviews: OutcomeSourceData["resolvedReviews"] = [];
  let truncated = false;
  if (reviews.error) fail("conversation_interventions");
  else {
    const rows = ((reviews.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      kind: String(row.kind),
      createdAt: String(row.created_at),
      resolvedAt: String(row.resolved_at),
    }));
    truncated = rows.length > reviewLimit;
    resolvedReviews = truncated ? rows.slice(0, reviewLimit) : rows;
  }

  let openBlockingReviews: number | null = null;
  if (open.error || open.count === null) fail("conversation_interventions");
  else openBlockingReviews = open.count;

  const values = computeInboxOutcomes({ agencyId, nowIso, windowDays, queueCounts, kpiDays, resolvedReviews, resolvedReviewsTruncated: truncated, openBlockingReviews });
  return { values, failures };
}

/**
 * The outcome cards one role may see. A role with no visible metrics gets none and nothing is read for it. Cards for metrics the
 * role may not see are never built, so they cannot reach that role's page.
 */
export async function loadInboxOutcomeCardsForRole(db: Db, agencyId: string, role: StaffRole, options: { now?: Date } = {}): Promise<{ cards: InboxOutcomeCard[]; failures: string[] }> {
  const probe = buildInboxOutcomeCards({ role, values: {} });
  if (probe.length === 0) return { cards: [], failures: [] };
  const { values, failures } = await loadInboxOutcomes(db, agencyId, options);
  const unreadable = metricKeysReadingFrom(failures, INBOX_OUTCOME_METRICS);
  return { cards: buildInboxOutcomeCards({ role, values, unreadableMetricKeys: unreadable }), failures };
}
