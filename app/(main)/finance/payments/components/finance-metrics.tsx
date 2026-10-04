"use client";

import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";
import React from "react";

import { largestCurrencyDue, type FinanceKpis } from "@/lib/data/finance";
import type { FinanceCapabilities } from "@/lib/access/finance-access";
import type { FinanceTabId } from "@/lib/access/finance-access";
import { formatExactCurrency } from "../utils";

interface FinanceMetricsProps {
  kpis: FinanceKpis;
  onOpen: (tab: FinanceTabId) => void;
  can: FinanceCapabilities;
}

export default function FinanceMetrics({ kpis, onOpen, can }: FinanceMetricsProps) {
  const payablesDue = largestCurrencyDue(kpis.supplierPayablesDueByCurrency);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {can.viewLedger && <button className="text-left" onClick={() => onOpen("payments")}>
        <KpiCard
          title="Collected This Month"
          value={formatExactCurrency(
            kpis.collectedThisMonth,
            kpis.collectedThisMonthCurrency,
          )}
          desc="% of expected revenue — no monthly target is configured yet"
        />
      </button>}
      <button className="text-left" onClick={() => onOpen("receivables")}>
        <KpiCard
          title="Outstanding Receivables"
          value={formatExactCurrency(
            kpis.outstandingReceivables,
            kpis.collectedThisMonthCurrency,
          )}
          desc={`${kpis.outstandingReceivablesCount} booking${kpis.outstandingReceivablesCount === 1 ? "" : "s"}`}
        />
      </button>
      <button className="text-left" onClick={() => onOpen("receivables")}>
        <KpiCard
          title="Overdue Amount"
          value={formatExactCurrency(
            kpis.overdueAmount,
            kpis.collectedThisMonthCurrency,
          )}
          desc={
            <span
              className={kpis.overdueCount > 0 ? "text-destructive" : undefined}
            >
              {kpis.overdueCount} booking{kpis.overdueCount === 1 ? "" : "s"}{" "}
              need action
            </span>
          }
        />
      </button>
      {can.viewSupplierPayables && <button className="text-left" onClick={() => onOpen("supplier-payables")}>
        <KpiCard
          title="Supplier Payables Due"
          value={
            payablesDue.currency
              ? formatExactCurrency(payablesDue.amount, payablesDue.currency)
              : "—"
          }
          desc={
            payablesDue.otherCount > 0
              ? `+${payablesDue.otherCount} more currencies · next 14 days`
              : "Next 14 days"
          }
        />
      </button>}
      {can.viewRefunds && <button className="text-left" onClick={() => onOpen("refunds")}>
        <KpiCard
          title="Refunds Pending"
          value={`${kpis.refundsPendingCount} request${kpis.refundsPendingCount === 1 ? "" : "s"}`}
          desc={
            formatExactCurrency(
              kpis.refundsPendingAmount,
              kpis.collectedThisMonthCurrency,
            ) + " exposure"
          }
        />
      </button>}
    </div>
  );
}
