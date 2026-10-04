/**
 * The nightly Finance review agent's tool set — Phase 1 (P1.7), the first
 * true looping agent beyond Departure Ops (plan §3.11). Mirrors
 * `lib/agent/departure-ops/tools/*` in spirit but collapsed into one file
 * per the roadmap's file list: five read tools (nothing here writes to the
 * database), one `raise_finding` tool staging an insight, one
 * `propose_action` tool staging a proposal through the existing kernel,
 * and the terminal `submit_review`.
 *
 * `propose_action` only accepts kinds already registered for a finance-
 * shaped subject (BOOKING/INVOICE) in `lib/agent/kernel/proposals/
 * registry.ts` — this agent creates no new proposal kind of its own, it
 * only ever asks the existing kernel to stage one of:
 * `PAYMENT_PLAN_FLAG_FOR_REVIEW`, `PAYMENT_REMINDER_SEND`,
 * `PAYMENT_PLAN_RESCHEDULE_DRAFT`, `INVOICE_SEND_REMINDER`,
 * `BOOKING_INCONSISTENCY_REVIEW`. Approving any of them still runs through
 * that kind's own capability check and executor — this agent has no more
 * power than the human who would otherwise open the same dialog.
 */

import "server-only";

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
/* eslint-disable @typescript-eslint/no-explicit-any -- BetaRunnableTool<any> is the SDK's own shape for a heterogeneous tool array, same as departure-ops/tools/registry.ts */
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";

import { wrapWithTelemetryAndRedaction, type ToolTelemetry } from "@/lib/agent/kernel/telemetry";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { derivePlanStatus } from "@/lib/data/finance";
import { loadFinanceSupplierPayables, loadPaymentPlanMilestones, type Db } from "@/lib/data/finance-repository";
import { listBankTransactions } from "@/lib/data/reconciliation-repository";
import { listGroupProfitability } from "@/lib/data/profitability-repository";
import { PROPOSAL_KINDS } from "@/lib/agent/kernel/proposals/registry";

/**
 * `db` is the service-role admin client the scheduler passes all the way
 * down (see `scheduler.ts`'s header for why) — every read tool below
 * inherits that file's documented single-agency-in-practice caveat, since
 * they call the same RLS-reliant loaders.
 */
export interface FinanceOpsContext {
  agencyId: string;
  db: Db;
}

export interface StagedFinanceFinding {
  stagedId: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  headline: string;
  detail: string;
  /** A metric key from the pack the corroboration guardrail checks against — required for WARNING/CRITICAL. */
  corroboratingMetricKey: string | null;
  subjectType: "BOOKING" | "INVOICE" | "AGENCY";
  subjectId: string;
}

export interface StagedFinanceProposal {
  stagedId: string;
  kind: string;
  subjectId: string;
  payload: unknown;
  title: string;
  rationale: string;
}

export interface StagedReview {
  summary: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
}

export interface FinanceOpsBuffer {
  findings: StagedFinanceFinding[];
  proposals: StagedFinanceProposal[];
  submitted: StagedReview | null;
}

export function newFinanceOpsBuffer(): FinanceOpsBuffer {
  return { findings: [], proposals: [], submitted: null };
}

/** The only proposal kinds a Finance Ops finding may ask for — every other registered kind belongs to a different surface. */
const ALLOWED_PROPOSAL_KINDS = new Set([
  "PAYMENT_PLAN_FLAG_FOR_REVIEW",
  "PAYMENT_REMINDER_SEND",
  "PAYMENT_PLAN_RESCHEDULE_DRAFT",
  "INVOICE_SEND_REMINDER",
  "BOOKING_INCONSISTENCY_REVIEW",
]);

function createStagedIdGenerator(): (kind: string) => string {
  let counter = 0;
  return (kind: string) => {
    counter += 1;
    return `${kind}-${counter}`;
  };
}

const FULL_FINANCE_CAPABILITIES = capabilitiesForFinance("ADMIN");
const OVERDUE_ACCOUNTS_LIMIT = 50;
const UPCOMING_PAYABLES_WINDOW_DAYS = 14;
const LOW_MARGIN_FLOOR_PERCENT = 15;

/**
 * Five read-only tools. Every one of them queries exactly the same
 * repository functions a human page already reads — this agent sees
 * nothing a Finance staff member with full access couldn't already see on
 * `/finance/payment-plans`, `/finance/reconciliation`, `/finance/payables`
 * or `/finance/departure-profitability`.
 */
function createReadTools(ctx: FinanceOpsContext): BetaRunnableTool<any>[] {
  const getOverdueAccounts = betaTool({
    name: "get_overdue_accounts",
    description:
      "Every payment-plan instalment currently OVERDUE, across every booking — reference, contact, amount, days overdue.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } as const,
    run: async () => {
      const milestones = await loadPaymentPlanMilestones(ctx.db, FULL_FINANCE_CAPABILITIES);
      const nowIso = new Date().toISOString();
      const overdue = milestones
        .filter((m) => derivePlanStatus(m, nowIso) === "OVERDUE")
        .slice(0, OVERDUE_ACCOUNTS_LIMIT)
        .map((m) => ({
          bookingId: m.booking_id,
          bookingReference: m.booking_reference,
          contactName: m.primary_contact_name,
          milestoneLabel: m.label,
          amountOutstanding: m.amount - m.paid_amount,
          currency: m.currency,
          dueAt: m.due_at,
        }));
      return JSON.stringify({ count: overdue.length, accounts: overdue });
    },
  });

  const getUnmatchedTransactions = betaTool({
    name: "get_unmatched_transactions",
    description: "Every UNMATCHED bank statement line, most recent first — date, description, reference, amount, and whether it's flagged as a possible duplicate.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } as const,
    run: async () => {
      const rows = await listBankTransactions(ctx.db, "UNMATCHED");
      return JSON.stringify({
        count: rows.length,
        transactions: rows.map((t) => ({
          id: t.id,
          statementDate: t.statement_date,
          description: t.description,
          reference: t.reference,
          amount: t.amount,
          currency: t.currency,
          possibleDuplicate: t.duplicate_of_id !== null,
        })),
      });
    },
  });

  const getDuplicateCandidates = betaTool({
    name: "get_duplicate_candidates",
    description: "Bank lines flagged as a possible duplicate of an earlier import (same reference and amount within days) — a subset of get_unmatched_transactions, for when you only care about these.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } as const,
    run: async () => {
      const rows = await listBankTransactions(ctx.db, "UNMATCHED");
      const duplicates = rows.filter((t) => t.duplicate_of_id !== null);
      return JSON.stringify({
        count: duplicates.length,
        duplicates: duplicates.map((t) => ({ id: t.id, description: t.description, reference: t.reference, amount: t.amount, duplicateOfId: t.duplicate_of_id })),
      });
    },
  });

  const getMarginMovers = betaTool({
    name: "get_margin_movers",
    description:
      `Departure groups whose estimated gross margin is below ${LOW_MARGIN_FLOOR_PERCENT}% of booked revenue right now. No historical snapshot exists yet to compare against last period, so this is today's low-margin groups, not a true period-over-period "mover" — read it as such.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false } as const,
    run: async () => {
      const rows = await listGroupProfitability(ctx.db);
      const flagged = rows
        .filter((r) => r.bookedRevenue > 0 && r.estimatedGrossMargin / r.bookedRevenue < LOW_MARGIN_FLOOR_PERCENT / 100)
        .map((r) => ({
          departureGroupId: r.departureGroupId,
          groupName: r.groupName,
          groupCode: r.groupCode,
          currency: r.currency,
          estimatedGrossMargin: r.estimatedGrossMargin,
          bookedRevenue: r.bookedRevenue,
          marginPercent: Math.round((r.estimatedGrossMargin / r.bookedRevenue) * 1000) / 10,
        }));
      return JSON.stringify({ count: flagged.length, groups: flagged });
    },
  });

  const getUpcomingPayables = betaTool({
    name: "get_upcoming_payables",
    description: `Supplier payables due within ${UPCOMING_PAYABLES_WINDOW_DAYS} days.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false } as const,
    run: async () => {
      const rows = await loadFinanceSupplierPayables(ctx.db, FULL_FINANCE_CAPABILITIES);
      const nowMs = Date.now();
      const windowMs = UPCOMING_PAYABLES_WINDOW_DAYS * 86_400_000;
      const upcoming = rows.filter((r) => {
        if (!r.payment_due_at) return false;
        const dueMs = Date.parse(r.payment_due_at);
        return dueMs >= nowMs && dueMs - nowMs <= windowMs;
      });
      return JSON.stringify({
        count: upcoming.length,
        payables: upcoming.map((r) => ({
          commitmentId: r.commitment_id,
          supplierName: r.supplier_name,
          referenceCode: r.reference_code,
          outstandingAmount: r.outstanding_amount,
          currency: r.currency,
          dueAt: r.payment_due_at,
        })),
      });
    },
  });

  return [getOverdueAccounts, getUnmatchedTransactions, getDuplicateCandidates, getMarginMovers, getUpcomingPayables];
}

function createFindingAndProposalTools(buffer: FinanceOpsBuffer, nextStagedId: (kind: string) => string): BetaRunnableTool<any>[] {
  const raiseFinding = betaTool({
    name: "raise_finding",
    description:
      "Stages a finding for a human to review — never a write. A WARNING or CRITICAL finding MUST name a corroboratingMetricKey " +
      "from the pack in your system prompt (a key from its `metrics` object) or the guardrail drops it before anything commits; " +
      "an INFO finding may omit it.",
    inputSchema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["INFO", "WARNING", "CRITICAL"] },
        headline: { type: "string", maxLength: 140 },
        detail: { type: "string", maxLength: 600 },
        corroboratingMetricKey: { type: ["string", "null"] },
        subjectType: { type: "string", enum: ["BOOKING", "INVOICE", "AGENCY"] },
        subjectId: { type: "string", description: "A real booking/invoice id from a tool result, or the literal string \"agency\" for an AGENCY-scoped finding." },
      },
      required: ["severity", "headline", "detail", "corroboratingMetricKey", "subjectType", "subjectId"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const stagedId = nextStagedId("finding");
      buffer.findings.push({
        stagedId,
        severity: args.severity,
        headline: args.headline,
        detail: args.detail,
        corroboratingMetricKey: args.corroboratingMetricKey,
        subjectType: args.subjectType,
        subjectId: args.subjectId,
      });
      return JSON.stringify({ ok: true, stagedId });
    },
  });

  const proposeAction = betaTool({
    name: "propose_action",
    description:
      "Stages a proposal for a human to approve — the only route to any change a booking, invoice, or payment plan would " +
      "actually feel. Nothing changes until a capable human approves it. Allowed kinds: " +
      `${[...ALLOWED_PROPOSAL_KINDS].join(", ")}. Payload shape depends on kind — match the executor's own schema ` +
      "(the same one its human-facing dialog uses).",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...ALLOWED_PROPOSAL_KINDS] },
        subjectId: { type: "string", description: "The booking or invoice id this proposal is about." },
        payload: { type: "object", description: "Shape depends on kind." },
        title: { type: "string", maxLength: 120 },
        rationale: { type: "string", maxLength: 600 },
      },
      required: ["kind", "subjectId", "payload", "title", "rationale"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      if (!ALLOWED_PROPOSAL_KINDS.has(args.kind) || !PROPOSAL_KINDS.includes(args.kind)) {
        return JSON.stringify({ ok: false, error: `"${args.kind}" is not a kind this agent may propose.` });
      }
      const stagedId = nextStagedId("proposal");
      buffer.proposals.push({ stagedId, kind: args.kind, subjectId: args.subjectId, payload: args.payload, title: args.title, rationale: args.rationale });
      return JSON.stringify({ ok: true, stagedId });
    },
  });

  const submitReview = betaTool({
    name: "submit_review",
    description:
      "Ends this review and commits everything you staged — findings and proposals. Call this exactly once, as your final " +
      "action. Nothing you staged is saved until you call this.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", maxLength: 400 },
        confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      },
      required: ["summary", "confidence"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      buffer.submitted = { summary: args.summary, confidence: args.confidence };
      return JSON.stringify({ ok: true, staged: { findings: buffer.findings.length, proposals: buffer.proposals.length } });
    },
  });

  return [raiseFinding, proposeAction, submitReview];
}

export function buildFinanceOpsToolSet(
  ctx: FinanceOpsContext,
  telemetry: ToolTelemetry,
): { tools: BetaRunnableTool<any>[]; buffer: FinanceOpsBuffer } {
  const buffer = newFinanceOpsBuffer();
  const nextStagedId = createStagedIdGenerator();
  const tools = [...createReadTools(ctx), ...createFindingAndProposalTools(buffer, nextStagedId)];
  return { tools: tools.map((tool) => wrapWithTelemetryAndRedaction(tool, telemetry)), buffer };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
