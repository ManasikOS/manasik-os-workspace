/**
 * The governed metrics registry — Phase 1 (P1.1) of
 * docs/modules/manasik-intelligence-build-roadmap.md; Plan §3.9. Every finance
 * metric the Overview cockpit (and, later, Analytics/Reports) shows is
 * defined exactly once here, with a one-sentence definition, the capability
 * that must be held to see it, and a drill-down href — never invented ad
 * hoc in a page component, and never computed by an LLM.
 *
 * `compute()` is pure: it re-slices rows the caller already loaded through
 * `lib/data/finance-repository.ts` (the same snapshot `/finance/payments`
 * already fetches), never a second SQL implementation of a number that
 * repository already derives. Metrics that need data this snapshot does
 * not carry yet (agent commissions, expected-vs-actual margin — both wait
 * on modules later phases build) say so honestly via `available: false`
 * rather than fabricating a number.
 *
 * Currency handling follows the master plan's own constraint: there is no
 * FX table in this schema, so every amount metric returns a per-currency
 * breakdown (`Record<currency, amount>`), never a single blended total.
 */

import type {
  FinanceInvoiceRow,
  FinancePaymentRow,
  FinanceReceivableRow,
  FinanceRefundRequestRow,
  FinanceSupplierPayableRow,
} from "@/lib/types/finance";
import type { GroupProfitabilityRow } from "@/lib/data/profitability-repository";
import { INBOX_OUTCOME_METRICS } from "./inbox-outcomes";

export interface FinanceMetricsInput {
  receivables: FinanceReceivableRow[];
  payments: FinancePaymentRow[];
  invoices: FinanceInvoiceRow[];
  supplierPayables: FinanceSupplierPayableRow[];
  refundRequests: FinanceRefundRequestRow[];
  /** Empty when the caller's role can't see margin, or hasn't loaded it — every metric using this degrades to `available: false`, never a guess. */
  groupProfitability: GroupProfitabilityRow[];
  nowIso: string;
}

export interface MetricResult {
  /** false when this metric needs data this snapshot doesn't carry yet (a later phase's module) — the UI must show "not yet available", never a zero that looks like a real answer. */
  available: boolean;
  byCurrency: Record<string, number>;
  /** Sum of `byCurrency` counts, where the metric is inherently a count rather than a currency amount (e.g. "unverified payments: 4"). */
  count?: number;
}

export interface FinanceMetricDefinition {
  key: string;
  label: string;
  /** One sentence, shown verbatim in the UI's "definition" popover — must never drift from what `compute()` actually does. */
  definition: string;
  module: "finance";
  viewerCapability: string;
  drillDownHref: string;
  compute(input: FinanceMetricsInput): MetricResult;
}

const SUPPLIER_PAYABLE_WINDOW_DAYS = 14;
const EXPECTED_INFLOW_WINDOW_DAYS = 30;
const UPCOMING_MARGIN_WINDOW_DAYS = 60;

function sumByCurrency<T>(rows: T[], amountOf: (row: T) => number, currencyOf: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const amount = amountOf(row);
    if (amount === 0) continue;
    const currency = currencyOf(row);
    out[currency] = (out[currency] ?? 0) + amount;
  }
  return out;
}

function monthStartMs(nowIso: string): number {
  const now = new Date(nowIso);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

export const FINANCE_METRICS: readonly FinanceMetricDefinition[] = [
  {
    key: "finance.total_invoiced",
    label: "Total invoiced",
    definition: "Sum of every non-void, non-credit-note invoice amount, by currency.",
    module: "finance",
    viewerCapability: "viewInvoices",
    drillDownHref: "/finance?view=receivables&subview=invoices",
    compute: (input) => ({
      available: true,
      byCurrency: sumByCurrency(
        input.invoices.filter((i) => i.status !== "VOID" && i.invoice_type !== "REFUND_CREDIT_NOTE"),
        (i) => i.amount,
        (i) => i.currency,
      ),
    }),
  },
  {
    key: "finance.collected_this_period",
    label: "Collected this period",
    definition: "Sum of completed payments recorded since the start of the current calendar month, by currency.",
    module: "finance",
    viewerCapability: "viewLedger",
    drillDownHref: "/finance?view=receivables&subview=payments",
    compute: (input) => {
      const start = monthStartMs(input.nowIso);
      return {
        available: true,
        byCurrency: sumByCurrency(
          input.payments.filter((p) => p.status === "COMPLETED" && Date.parse(p.paid_at) >= start),
          (p) => p.amount,
          (p) => p.currency,
        ),
      };
    },
  },
  {
    key: "finance.outstanding_receivables",
    label: "Outstanding receivables",
    definition: "Sum of every booking's outstanding balance where it is greater than zero, by currency.",
    module: "finance",
    viewerCapability: "viewReceivables",
    drillDownHref: "/finance?view=receivables&subview=balances",
    compute: (input) => ({
      available: true,
      byCurrency: sumByCurrency(
        input.receivables.filter((r) => r.outstanding_balance > 0),
        (r) => r.outstanding_balance,
        (r) => r.currency,
      ),
    }),
  },
  {
    key: "finance.overdue_instalments",
    label: "Overdue instalments",
    definition: "Sum of the overdue-instalment amount on every booking with at least one overdue milestone, by currency.",
    module: "finance",
    viewerCapability: "viewReceivables",
    drillDownHref: "/finance?view=receivables&subview=balances",
    compute: (input) => ({
      available: true,
      byCurrency: sumByCurrency(
        input.receivables.filter((r) => r.overdue_milestone_count > 0),
        (r) => r.overdue_amount,
        (r) => r.currency,
      ),
    }),
  },
  {
    key: "finance.unverified_payments",
    label: "Unverified payments",
    definition: "Count and amount of payments still in PENDING_VERIFICATION, by currency.",
    module: "finance",
    viewerCapability: "verifyPayments",
    drillDownHref: "/finance?view=receivables&subview=payments",
    compute: (input) => {
      const rows = input.payments.filter((p) => p.status === "PENDING_VERIFICATION");
      return {
        available: true,
        byCurrency: sumByCurrency(rows, (p) => p.amount, (p) => p.currency),
        count: rows.length,
      };
    },
  },
  {
    key: "finance.refund_liability",
    label: "Refund liability",
    definition: "Sum of refund requests still PENDING_APPROVAL or APPROVED-but-unpaid, by currency.",
    module: "finance",
    viewerCapability: "viewRefunds",
    drillDownHref: "/finance?view=receivables&subview=adjustments",
    compute: (input) => ({
      available: true,
      byCurrency: sumByCurrency(
        input.refundRequests.filter((r) => r.status === "PENDING_APPROVAL" || r.status === "APPROVED"),
        (r) => r.amount,
        (r) => r.currency,
      ),
    }),
  },
  {
    key: "finance.supplier_payables_due",
    label: "Supplier payables due",
    definition: `Sum of supplier commitment balances due within the next ${SUPPLIER_PAYABLE_WINDOW_DAYS} days (or with no due date at all), by currency.`,
    module: "finance",
    viewerCapability: "viewSupplierPayables",
    drillDownHref: "/finance?view=payables",
    compute: (input) => {
      const windowEnd = Date.parse(input.nowIso) + SUPPLIER_PAYABLE_WINDOW_DAYS * 86_400_000;
      return {
        available: true,
        byCurrency: sumByCurrency(
          input.supplierPayables.filter(
            (r) => r.outstanding_amount > 0 && (!r.payment_due_at || Date.parse(r.payment_due_at) <= windowEnd),
          ),
          (r) => r.outstanding_amount,
          (r) => r.currency,
        ),
      };
    },
  },
  {
    key: "finance.agent_commissions_due",
    label: "Agent commissions due",
    definition: "Sum of approved-but-unpaid agent commission accruals, by currency.",
    module: "finance",
    viewerCapability: "viewModule",
    drillDownHref: "/relationships/agent-portal?tab=commissions",
    // Commission accruals live in the Agent Portal module (P4.9 of the
    // roadmap) and are not part of the finance snapshot this registry
    // reads today — honestly unavailable rather than a fabricated zero.
    compute: () => ({ available: false, byCurrency: {} }),
  },
  {
    key: "finance.net_cash_position",
    label: "Net cash position",
    definition: "Total completed customer payments minus total amount paid to suppliers, by currency (all-time, not just this period).",
    module: "finance",
    viewerCapability: "viewLedger",
    drillDownHref: "/finance?view=receivables&subview=payments",
    compute: (input) => {
      const collected = sumByCurrency(
        input.payments.filter((p) => p.status === "COMPLETED"),
        (p) => p.amount,
        (p) => p.currency,
      );
      const paidToSuppliers = sumByCurrency(input.supplierPayables, (r) => r.amount_paid, (r) => r.currency);
      const byCurrency: Record<string, number> = { ...collected };
      for (const [currency, amount] of Object.entries(paidToSuppliers)) {
        byCurrency[currency] = (byCurrency[currency] ?? 0) - amount;
      }
      return { available: true, byCurrency };
    },
  },
  {
    key: "finance.expected_inflow",
    label: "Expected inflow (30 days)",
    definition: `Sum of outstanding balances on bookings whose next instalment falls due within ${EXPECTED_INFLOW_WINDOW_DAYS} days, by currency.`,
    module: "finance",
    viewerCapability: "viewReceivables",
    drillDownHref: "/finance?view=receivables&subview=balances",
    compute: (input) => {
      const windowEnd = Date.parse(input.nowIso) + EXPECTED_INFLOW_WINDOW_DAYS * 86_400_000;
      return {
        available: true,
        byCurrency: sumByCurrency(
          input.receivables.filter((r) => r.next_due_at && Date.parse(r.next_due_at) <= windowEnd && r.outstanding_balance > 0),
          (r) => r.outstanding_balance,
          (r) => r.currency,
        ),
      };
    },
  },
  {
    key: "finance.upcoming_group_margin",
    label: "Upcoming group margin",
    definition: `Sum of estimated gross margin for departure groups leaving within the next ${UPCOMING_MARGIN_WINDOW_DAYS} days, by currency.`,
    module: "finance",
    viewerCapability: "viewSupplierPayables",
    drillDownHref: "/finance?view=departure-pnl",
    compute: (input) => {
      if (input.groupProfitability.length === 0) return { available: false, byCurrency: {} };
      const windowEnd = Date.parse(input.nowIso) + UPCOMING_MARGIN_WINDOW_DAYS * 86_400_000;
      return {
        available: true,
        byCurrency: sumByCurrency(
          input.groupProfitability.filter((g) => Date.parse(g.departureDate) <= windowEnd && Date.parse(g.departureDate) >= Date.parse(input.nowIso)),
          (g) => g.estimatedGrossMargin,
          (g) => g.currency,
        ),
      };
    },
  },
  {
    key: "finance.expected_vs_actual_margin",
    label: "Expected vs actual margin",
    definition: "Difference between estimated and confirmed-actual gross margin for departed groups — requires the confirmed-vs-estimate cost split (Phase 3 of the roadmap).",
    module: "finance",
    viewerCapability: "viewSupplierPayables",
    drillDownHref: "/finance?view=departure-pnl",
    compute: () => ({ available: false, byCurrency: {} }),
  },
] as const;

export function getFinanceMetric(key: string): FinanceMetricDefinition | null {
  return FINANCE_METRICS.find((m) => m.key === key) ?? null;
}

/**
 * The Inbox outcome metrics (OUT-01) live in their own module because they are contracts over queues and counters, not finance
 * rows, but they are one governed registry: a key may exist once across both, so a drill-down or a saved card never means two
 * different numbers.
 */
export { INBOX_OUTCOME_METRICS, getInboxOutcomeMetric, inboxOutcomeMetricsVisibleTo } from "./inbox-outcomes";

/** Every governed metric key across the finance and Inbox outcome registries. */
export function allGovernedMetricKeys(): string[] {
  return [...FINANCE_METRICS.map((metric) => metric.key), ...INBOX_OUTCOME_METRICS.map((metric) => metric.key)];
}
