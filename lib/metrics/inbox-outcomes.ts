/**
 * Inbox outcome metric contracts (OUT-01). Each metric is defined once, with its numerator, denominator, source tables, tenant
 * scope, time basis, exclusions, who may see it, and the exact queue or reviewed event set a person lands on when they drill
 * in. Nothing here is a model estimate and nothing reads message content, customer names or document fields.
 *
 * A metric is only MEASURABLE when stored facts support it exactly. The rest are declared BLOCKED with the reason, so a
 * dashboard shows "not measurable yet" instead of a number that looks real. Zero denominators give `NO_DATA`, never 0.
 * Pure: the repository (`lib/data/inbox-commercial-repository.ts`) reads the agency-scoped rows and this computes.
 */

import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { QueueCode } from "@/lib/inbox/intelligence/contracts";
import { inboxPageHref } from "@/lib/inbox/page-request";
import { viewForQueue } from "@/lib/inbox/views";

export type OutcomeMetricFamily = "OPERATIONAL" | "COMMERCIAL" | "SAFETY" | "AI_QUALITY_COST";
export type OutcomeAudience = "INBOX" | "FINANCE_REVIEW" | "OWNER";

export type OutcomeDrillDown =
  | { kind: "QUEUE"; queue: QueueCode; href: string }
  | { kind: "EVENT_SET"; source: string; where: string; href: string | null }
  | { kind: "NONE" };

export interface OutcomeMetricContract {
  key: string;
  family: OutcomeMetricFamily;
  label: string;
  /** One sentence shown verbatim to people; it must not drift from what the computation does. */
  definition: string;
  numerator: string;
  denominator: string | null;
  unit: "COUNT" | "RATIO" | "SECONDS" | "USD";
  /** A stock as of now, or a total over a window of whole UTC days. */
  valueBasis: "NOW_SNAPSHOT" | "WINDOW";
  windowDays: number | null;
  timeBasis: string;
  sources: ReadonlyArray<{ table: string; columns: readonly string[] }>;
  tenantScope: "agency_id";
  exclusions: readonly string[];
  drillDown: OutcomeDrillDown;
  audience: OutcomeAudience;
  /** Literal by contract: no metric exposes message content or sensitive fields. */
  exposesContent: false;
  status: "MEASURABLE" | "BLOCKED";
  blockedBy?: string;
}

const DEFAULT_WINDOW_DAYS = 30;
const FINANCE_REVIEW_KINDS: readonly string[] = ["PAYMENT_CLAIM", "BANK_DETAIL_MISMATCH"];

function queueDrillDown(queue: QueueCode): OutcomeDrillDown {
  const view = viewForQueue(queue);
  if (!view) throw new Error(`No Inbox view exists for queue ${queue}`);
  return { kind: "QUEUE", queue, href: inboxPageHref({ view }) };
}

const QUEUE_SOURCE = { table: "conversation_queue_membership", columns: ["agency_id", "queue_code", "conversation_id"] } as const;
const SNAPSHOT_TIME_BASIS = "As of the moment it is read; membership is kept current by the queue refresh triggers.";
const QUEUE_EXCLUSIONS = ["Conversations in other agencies.", "Conversations outside this queue's own definition (closed and spam chats are excluded by the queue itself)."] as const;

function queueMetric(input: {
  key: string;
  family: OutcomeMetricFamily;
  queue: QueueCode;
  label: string;
  definition: string;
  audience?: OutcomeAudience;
}): OutcomeMetricContract {
  return {
    key: input.key,
    family: input.family,
    label: input.label,
    definition: input.definition,
    numerator: `Conversations currently in the ${input.queue} queue.`,
    denominator: null,
    unit: "COUNT",
    valueBasis: "NOW_SNAPSHOT",
    windowDays: null,
    timeBasis: SNAPSHOT_TIME_BASIS,
    sources: [QUEUE_SOURCE],
    tenantScope: "agency_id",
    exclusions: QUEUE_EXCLUSIONS,
    drillDown: queueDrillDown(input.queue),
    audience: input.audience ?? "INBOX",
    exposesContent: false,
    status: "MEASURABLE",
  };
}

function blockedMetric(input: {
  key: string;
  family: OutcomeMetricFamily;
  label: string;
  definition: string;
  numerator: string;
  denominator: string | null;
  unit: OutcomeMetricContract["unit"];
  source: { table: string; columns: readonly string[] };
  blockedBy: string;
  audience?: OutcomeAudience;
}): OutcomeMetricContract {
  return {
    key: input.key,
    family: input.family,
    label: input.label,
    definition: input.definition,
    numerator: input.numerator,
    denominator: input.denominator,
    unit: input.unit,
    valueBasis: "WINDOW",
    windowDays: DEFAULT_WINDOW_DAYS,
    timeBasis: "Whole UTC days ending today, once the missing fact is stored.",
    sources: [input.source],
    tenantScope: "agency_id",
    exclusions: ["Other agencies."],
    drillDown: { kind: "NONE" },
    audience: input.audience ?? "INBOX",
    exposesContent: false,
    status: "BLOCKED",
    blockedBy: input.blockedBy,
  };
}

export const INBOX_OUTCOME_METRICS: readonly OutcomeMetricContract[] = [
  // ── Operational ────────────────────────────────────────────────────────────────────────────────────────────────────
  queueMetric({ key: "OVERDUE_CONVERSATIONS", family: "OPERATIONAL", queue: "SLA_BREACHED", label: "Overdue conversations", definition: "Open conversations whose reply deadline has passed." }),
  queueMetric({ key: "NEARING_DEADLINE_CONVERSATIONS", family: "OPERATIONAL", queue: "NEARING_DEADLINE", label: "Nearing a deadline", definition: "Open conversations whose reply deadline is within 30 minutes." }),
  queueMetric({ key: "UNASSIGNED_CONVERSATIONS", family: "OPERATIONAL", queue: "UNASSIGNED", label: "Unassigned conversations", definition: "Open conversations that have no owner." }),
  queueMetric({ key: "AWAITING_REPLY_CONVERSATIONS", family: "OPERATIONAL", queue: "NEEDS_REPLY", label: "Waiting for our reply", definition: "Open conversations where the customer wrote last and has not had a reply." }),
  {
    key: "FINANCE_REVIEW_TIME_P50_SECONDS",
    family: "OPERATIONAL",
    label: "Median time to finish a payment review",
    definition: "The middle time between a payment or bank-detail review opening and being resolved, for reviews resolved in the window.",
    numerator: "The 50th-percentile (nearest rank) of resolved minus created time, in seconds.",
    denominator: "Payment and bank-detail reviews resolved in the window.",
    unit: "SECONDS",
    valueBasis: "WINDOW",
    windowDays: DEFAULT_WINDOW_DAYS,
    timeBasis: "Reviews are included when resolved_at falls inside whole UTC days ending today.",
    sources: [{ table: "conversation_interventions", columns: ["agency_id", "kind", "status", "created_at", "resolved_at"] }],
    tenantScope: "agency_id",
    exclusions: ["Reviews of other kinds.", "Reviews still open or dismissed.", "Rows with a missing or negative duration."],
    drillDown: { kind: "EVENT_SET", source: "conversation_interventions", where: "status = RESOLVED, kind in (PAYMENT_CLAIM, BANK_DETAIL_MISMATCH), resolved_at in the window", href: null },
    audience: "FINANCE_REVIEW",
    exposesContent: false,
    status: "MEASURABLE",
  },
  {
    key: "FINANCE_REVIEW_TIME_P95_SECONDS",
    family: "OPERATIONAL",
    label: "Slowest 5% of payment reviews",
    definition: "The time within which 95% of payment and bank-detail reviews resolved in the window were finished.",
    numerator: "The 95th-percentile (nearest rank) of resolved minus created time, in seconds.",
    denominator: "Payment and bank-detail reviews resolved in the window.",
    unit: "SECONDS",
    valueBasis: "WINDOW",
    windowDays: DEFAULT_WINDOW_DAYS,
    timeBasis: "Reviews are included when resolved_at falls inside whole UTC days ending today.",
    sources: [{ table: "conversation_interventions", columns: ["agency_id", "kind", "status", "created_at", "resolved_at"] }],
    tenantScope: "agency_id",
    exclusions: ["Reviews of other kinds.", "Reviews still open or dismissed.", "Rows with a missing or negative duration."],
    drillDown: { kind: "EVENT_SET", source: "conversation_interventions", where: "status = RESOLVED, kind in (PAYMENT_CLAIM, BANK_DETAIL_MISMATCH), resolved_at in the window", href: null },
    audience: "FINANCE_REVIEW",
    exposesContent: false,
    status: "MEASURABLE",
  },
  blockedMetric({
    key: "FIRST_RESPONSE_TIME_P50_SECONDS",
    family: "OPERATIONAL",
    label: "Median first response time",
    definition: "The middle time from a customer's first message to our first staff or assistant reply.",
    numerator: "The 50th-percentile of first reply minus first customer message, in seconds.",
    denominator: "Conversations that received a first reply in the window.",
    unit: "SECONDS",
    source: { table: "conversation_messages", columns: ["agency_id", "conversation_id", "actor_kind", "created_at"] },
    blockedBy: "No first-response timestamp is stored, and deriving it by scanning every thread is not an exact, cheap or reviewable source yet.",
  }),
  blockedMetric({
    key: "FIRST_RESPONSE_TIME_P95_SECONDS",
    family: "OPERATIONAL",
    label: "Slowest 5% first response time",
    definition: "The time within which 95% of conversations received a first reply.",
    numerator: "The 95th-percentile of first reply minus first customer message, in seconds.",
    denominator: "Conversations that received a first reply in the window.",
    unit: "SECONDS",
    source: { table: "conversation_messages", columns: ["agency_id", "conversation_id", "actor_kind", "created_at"] },
    blockedBy: "No first-response timestamp is stored, and deriving it by scanning every thread is not an exact, cheap or reviewable source yet.",
  }),
  blockedMetric({
    key: "WITHIN_SLA_PERCENT",
    family: "OPERATIONAL",
    label: "Replies within the target",
    definition: "The share of conversations first answered before their reply deadline.",
    numerator: "Conversations first answered on or before their deadline.",
    denominator: "Conversations that had a deadline in the window.",
    unit: "RATIO",
    source: { table: "conversations", columns: ["agency_id", "sla_due_at"] },
    blockedBy: "Only the current deadline is stored, not the deadline a conversation had when it was first answered, so past results cannot be reconstructed.",
  }),

  // ── Commercial ─────────────────────────────────────────────────────────────────────────────────────────────────────
  queueMetric({ key: "NEW_ENQUIRY_CONVERSATIONS", family: "COMMERCIAL", queue: "NEW_ENQUIRIES", label: "New enquiries", definition: "Open conversations that are a new sales enquiry not yet qualified." }),
  queueMetric({ key: "QUALIFIED_CONVERSATIONS", family: "COMMERCIAL", queue: "QUALIFIED", label: "Qualified, ready to recommend", definition: "Open conversations ready for a departure recommendation." }),
  queueMetric({ key: "QUOTE_SENT_CONVERSATIONS", family: "COMMERCIAL", queue: "QUOTE_SENT", label: "Quote sent", definition: "Open conversations that have a quote out." }),
  queueMetric({ key: "BOOKING_READY_CONVERSATIONS", family: "COMMERCIAL", queue: "BOOKING_READY", label: "Ready to book", definition: "Open conversations ready for a booking to be created." }),
  blockedMetric({
    key: "ENQUIRY_TO_QUALIFIED_RATE",
    family: "COMMERCIAL",
    label: "Enquiry to qualified",
    definition: "The share of new enquiries that became qualified.",
    numerator: "Enquiries that reached the qualified stage in the window.",
    denominator: "Enquiries that started in the window.",
    unit: "RATIO",
    source: { table: "conversation_intelligence", columns: ["agency_id", "commercial_stage"] },
    blockedBy: "Only the current commercial stage is stored, not when it changed, so a conversion over time cannot be counted exactly.",
  }),
  blockedMetric({
    key: "QUALIFIED_TO_QUOTE_RATE",
    family: "COMMERCIAL",
    label: "Qualified to quote",
    definition: "The share of qualified conversations that received a quote.",
    numerator: "Qualified conversations that reached the quote stage in the window.",
    denominator: "Conversations that became qualified in the window.",
    unit: "RATIO",
    source: { table: "conversation_intelligence", columns: ["agency_id", "commercial_stage"] },
    blockedBy: "Only the current commercial stage is stored, not when it changed, so a conversion over time cannot be counted exactly.",
  }),
  blockedMetric({
    key: "QUOTE_TO_BOOKING_RATE",
    family: "COMMERCIAL",
    label: "Quote to booking",
    definition: "The share of quoted conversations that became a booking.",
    numerator: "Quoted conversations that reached a booking in the window.",
    denominator: "Conversations that were quoted in the window.",
    unit: "RATIO",
    source: { table: "conversation_intelligence", columns: ["agency_id", "commercial_stage"] },
    blockedBy: "Only the current commercial stage is stored, not when it changed, so a conversion over time cannot be counted exactly.",
  }),

  // ── Safety ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    key: "OPEN_BLOCKING_REVIEWS",
    family: "SAFETY",
    label: "Open blocking reviews",
    definition: "Reviews that stop an action until a person resolves them and that are still open.",
    numerator: "Reviews with severity BLOCK that are open or acknowledged.",
    denominator: null,
    unit: "COUNT",
    valueBasis: "NOW_SNAPSHOT",
    windowDays: null,
    timeBasis: SNAPSHOT_TIME_BASIS,
    sources: [{ table: "conversation_interventions", columns: ["agency_id", "severity", "status"] }],
    tenantScope: "agency_id",
    exclusions: ["Reviews that are resolved or dismissed.", "Reviews of other agencies."],
    drillDown: { kind: "EVENT_SET", source: "conversation_interventions", where: "severity = BLOCK and status in (OPEN, ACKNOWLEDGED)", href: null },
    audience: "INBOX",
    exposesContent: false,
    status: "MEASURABLE",
  },
  queueMetric({ key: "PAYMENT_DISCUSSION_CONVERSATIONS", family: "SAFETY", queue: "PAYMENT_DISCUSSIONS", label: "Payment discussions to check", definition: "Open conversations where a customer says they paid or a bank-detail alert is open.", audience: "FINANCE_REVIEW" }),
  queueMetric({ key: "COMPLAINT_CONVERSATIONS", family: "SAFETY", queue: "COMPLAINTS", label: "Complaints and refund requests", definition: "Open conversations that are a complaint or a refund request." }),
  queueMetric({ key: "DOCUMENT_CONVERSATIONS", family: "SAFETY", queue: "DOCUMENTS", label: "Document issues", definition: "Open conversations with a passport or sensitive-document issue." }),
  queueMetric({ key: "ESCALATED_CONVERSATIONS", family: "SAFETY", queue: "ESCALATIONS", label: "Escalated conversations", definition: "Open conversations with a blocking review or critical urgency." }),
  blockedMetric({
    key: "NEVER_AUTONOMOUS_VIOLATIONS",
    family: "SAFETY",
    label: "Never-autonomous violations",
    definition: "Actions the assistant took on its own that it is never allowed to take. This must always be zero.",
    numerator: "Autonomous actions of a never-autonomous kind in the window.",
    denominator: null,
    unit: "COUNT",
    source: { table: "inbox_autonomy_decisions", columns: ["agency_id"] },
    blockedBy: "Waits on AUT-05, the single effective autonomy policy that defines what counts as a violation and records it.",
    audience: "OWNER",
  }),

  // ── AI quality and cost ────────────────────────────────────────────────────────────────────────────────────────────
  {
    key: "AI_COST_PER_ENRICHED_CONVERSATION_USD",
    family: "AI_QUALITY_COST",
    label: "AI cost per analysed conversation",
    definition: "The AI spend on Inbox surfaces divided by the conversations Copilot analysed, over the window.",
    numerator: "Sum of AI cost in USD on Inbox surfaces over the window.",
    denominator: "Sum of conversations enriched over the window.",
    unit: "USD",
    valueBasis: "WINDOW",
    windowDays: DEFAULT_WINDOW_DAYS,
    timeBasis: "Whole UTC days ending today, as bucketed by inbox_intelligence_kpis_daily.",
    sources: [{ table: "inbox_intelligence_kpis_daily", columns: ["agency_id", "day", "ai_cost_usd", "conversations_enriched"] }],
    tenantScope: "agency_id",
    exclusions: [
      "AI surfaces not named INBOX_<name> in capitals: the voice transcript and media reading surfaces (lower-case names) are not counted yet.",
      "Cost the model rate table could not price.",
      "Other agencies.",
    ],
    drillDown: { kind: "EVENT_SET", source: "ai_usage_daily", where: "surface like INBOX_% for the days in the window", href: null },
    audience: "OWNER",
    exposesContent: false,
    status: "MEASURABLE",
  },
  {
    key: "S0_SKIP_RATE",
    family: "AI_QUALITY_COST",
    label: "Messages skipped before AI",
    definition: "The share of customer messages the free first check decided did not need AI, over the window.",
    numerator: "Gate decisions that skipped AI over the window.",
    denominator: "Gate decisions evaluated over the window.",
    unit: "RATIO",
    valueBasis: "WINDOW",
    windowDays: DEFAULT_WINDOW_DAYS,
    timeBasis: "Whole UTC days ending today, as bucketed by inbox_intelligence_kpis_daily.",
    sources: [{ table: "inbox_intelligence_kpis_daily", columns: ["agency_id", "day", "gate_evaluated", "gate_skipped"] }],
    tenantScope: "agency_id",
    exclusions: ["Days with no gate decisions add nothing to either side.", "Other agencies."],
    drillDown: { kind: "EVENT_SET", source: "inbox_gate_decisions", where: "decision = SKIP, by day in the window", href: null },
    audience: "OWNER",
    exposesContent: false,
    status: "MEASURABLE",
  },
  blockedMetric({
    key: "DRAFT_ACCEPTANCE_RATE",
    family: "AI_QUALITY_COST",
    label: "Drafts sent as written",
    definition: "The share of suggested replies staff sent without heavy edits.",
    numerator: "Suggested replies sent unedited or lightly edited.",
    denominator: "Suggested replies staff acted on.",
    unit: "RATIO",
    source: { table: "agent_proposals", columns: ["agency_id", "status"] },
    blockedBy: "There is no recorded measure of how much staff edited a draft before sending it.",
    audience: "OWNER",
  }),
  blockedMetric({
    key: "TRIAGE_CORRECTION_RATE",
    family: "AI_QUALITY_COST",
    label: "Triage corrected by staff",
    definition: "The share of triage readings staff changed.",
    numerator: "Triage readings staff corrected.",
    denominator: "Triage readings staff reviewed.",
    unit: "RATIO",
    source: { table: "conversation_intelligence", columns: ["agency_id", "intent_code"] },
    blockedBy: "Corrections are not stored as a separate fact, only the latest reading.",
    audience: "OWNER",
  }),
  blockedMetric({
    key: "AUTONOMY_DEMOTION_RATE",
    family: "AI_QUALITY_COST",
    label: "Autonomy demotions",
    definition: "How often the assistant's allowed autonomy was lowered after staff rejected its work.",
    numerator: "Autonomy demotions in the window.",
    denominator: "Autonomy-enabled surfaces in the window.",
    unit: "RATIO",
    source: { table: "inbox_autonomy_level_audit", columns: ["agency_id"] },
    blockedBy: "Waits on AUT-05, the single effective autonomy policy that defines and records demotions.",
    audience: "OWNER",
  }),
];

export function getInboxOutcomeMetric(key: string): OutcomeMetricContract | null {
  return INBOX_OUTCOME_METRICS.find((metric) => metric.key === key) ?? null;
}

/** The metrics a role may see. The server filters by this before anything is computed or sent. */
export function inboxOutcomeMetricsVisibleTo(role: StaffRole): OutcomeMetricContract[] {
  const inbox = capabilitiesForInbox(role).viewModule;
  if (!inbox) return [];
  const canSeeFinanceReview = capabilitiesForFinance(role).viewLedger;
  const isOwner = role === "ADMIN" || role === "CEO";
  return INBOX_OUTCOME_METRICS.filter((metric) => {
    switch (metric.audience) {
      case "INBOX":
        return true;
      case "FINANCE_REVIEW":
        return canSeeFinanceReview;
      case "OWNER":
        return isOwner;
    }
  });
}

// ── Computation ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Rows already read for one agency. The repository scopes every read; these carry no content. */
export interface OutcomeSourceData {
  agencyId: string;
  nowIso: string;
  windowDays: number;
  /** Conversations per queue as of now. A queue that was not loaded is absent, which is different from zero. */
  queueCounts: Partial<Record<QueueCode, number>>;
  kpiDays: ReadonlyArray<{ day: string; gateEvaluated: number; gateSkipped: number; aiCostUsd: number; conversationsEnriched: number }>;
  resolvedReviews: ReadonlyArray<{ kind: string; createdAt: string; resolvedAt: string }>;
  /** True when the read hit its row limit, so durations cover only part of the window. */
  resolvedReviewsTruncated: boolean;
  openBlockingReviews: number | null;
}

export interface OutcomeMetricValue {
  key: string;
  status: "OK" | "NO_DATA" | "BLOCKED";
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  reason: string | null;
  /** The source read was cut short, so the value covers part of the window. */
  partial: boolean;
}

/** UTC midnight of the first of `days` whole UTC days ending with the day of `nowIso`. */
export function windowStartIso(nowIso: string, days: number): string {
  const now = new Date(nowIso);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (Math.max(1, days) - 1))).toISOString();
}

export function percentileNearestRank(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function value(key: string, fields: Partial<OutcomeMetricValue> & Pick<OutcomeMetricValue, "status">): OutcomeMetricValue {
  return { key, value: null, numerator: null, denominator: null, reason: null, partial: false, ...fields };
}

export function computeInboxOutcomes(source: OutcomeSourceData): Record<string, OutcomeMetricValue> {
  const result: Record<string, OutcomeMetricValue> = {};
  const startMs = Date.parse(windowStartIso(source.nowIso, source.windowDays));
  const nowMs = Date.parse(source.nowIso);
  const startDay = windowStartIso(source.nowIso, source.windowDays).slice(0, 10);
  const today = source.nowIso.slice(0, 10);

  const days = source.kpiDays.filter((row) => row.day >= startDay && row.day <= today);
  const sum = (pick: (row: (typeof days)[number]) => number) => days.reduce((total, row) => total + (Number.isFinite(pick(row)) ? pick(row) : 0), 0);

  const reviewSeconds = source.resolvedReviews
    .filter((review) => FINANCE_REVIEW_KINDS.includes(review.kind))
    .map((review) => ({ resolved: Date.parse(review.resolvedAt), created: Date.parse(review.createdAt) }))
    .filter((review) => Number.isFinite(review.resolved) && Number.isFinite(review.created) && review.resolved >= startMs && review.resolved <= nowMs && review.resolved >= review.created)
    .map((review) => (review.resolved - review.created) / 1000);

  for (const metric of INBOX_OUTCOME_METRICS) {
    if (metric.status === "BLOCKED") {
      result[metric.key] = value(metric.key, { status: "BLOCKED", reason: metric.blockedBy ?? "Not measurable yet." });
      continue;
    }
    if (metric.drillDown.kind === "QUEUE") {
      const count = source.queueCounts[metric.drillDown.queue];
      result[metric.key] = count === undefined
        ? value(metric.key, { status: "NO_DATA", reason: "This queue's count was not loaded." })
        : value(metric.key, { status: "OK", value: count, numerator: count });
      continue;
    }

    switch (metric.key) {
      case "OPEN_BLOCKING_REVIEWS":
        result[metric.key] = source.openBlockingReviews === null
          ? value(metric.key, { status: "NO_DATA", reason: "The open-review count was not loaded." })
          : value(metric.key, { status: "OK", value: source.openBlockingReviews, numerator: source.openBlockingReviews });
        break;
      case "FINANCE_REVIEW_TIME_P50_SECONDS":
      case "FINANCE_REVIEW_TIME_P95_SECONDS": {
        const percentile = metric.key.includes("P95") ? 95 : 50;
        const found = percentileNearestRank(reviewSeconds, percentile);
        result[metric.key] = found === null
          ? value(metric.key, { status: "NO_DATA", denominator: 0, reason: "No payment review was resolved in this window." })
          : value(metric.key, { status: "OK", value: found, numerator: found, denominator: reviewSeconds.length, partial: source.resolvedReviewsTruncated });
        break;
      }
      case "S0_SKIP_RATE": {
        const evaluated = sum((row) => row.gateEvaluated);
        const skipped = sum((row) => row.gateSkipped);
        result[metric.key] = evaluated === 0
          ? value(metric.key, { status: "NO_DATA", numerator: skipped, denominator: 0, reason: "No messages were evaluated in this window." })
          : value(metric.key, { status: "OK", value: round6(Math.min(1, skipped / evaluated)), numerator: skipped, denominator: evaluated });
        break;
      }
      case "AI_COST_PER_ENRICHED_CONVERSATION_USD": {
        const cost = sum((row) => row.aiCostUsd);
        const enriched = sum((row) => row.conversationsEnriched);
        result[metric.key] = enriched === 0
          ? value(metric.key, { status: "NO_DATA", numerator: round6(cost), denominator: 0, reason: "No conversation was analysed in this window." })
          : value(metric.key, { status: "OK", value: round6(cost / enriched), numerator: round6(cost), denominator: enriched });
        break;
      }
      default:
        result[metric.key] = value(metric.key, { status: "NO_DATA", reason: "No computation is defined for this metric." });
    }
  }
  return result;
}
