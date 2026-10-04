"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PermissionDenied } from "@/components/ui/tone-badge";

import {
  buildCollectionsByBranch,
  buildCollectionsByMethod,
  buildCollectionsSummary,
  buildPackageProfitability,
  buildReceivablesAging,
} from "@/lib/data/reports-finance";

import { useReports } from "../../reports-store";
import { formatCurrency, formatExactCurrency, formatPercent } from "../../utils";

export default function FinanceTab() {
  const { finance, nowIso, can } = useReports();

  if (!finance) return <PermissionDenied what="Finance reports" />;

  const collections = buildCollectionsSummary(finance.bookings, finance.payments, finance.groups);
  const byBranch = buildCollectionsByBranch(finance.bookings, finance.payments);
  const byMethod = buildCollectionsByMethod(finance.payments);
  const aging = buildReceivablesAging(finance.milestones, nowIso);
  const profitability = can.viewCostAndMargin ? buildPackageProfitability(finance.groups) : [];

  const supplierPayablesByCurrency = finance.groups.reduce<Record<string, number>>((totals, g) => {
    const buckets = g.supplier_cost_by_currency;
    if (buckets && Object.keys(buckets).length > 0) {
      for (const [currency, amount] of Object.entries(buckets)) totals[currency] = (totals[currency] ?? 0) + amount;
    } else {
      const currency = g.currency ?? "LKR";
      totals[currency] = (totals[currency] ?? 0) + g.supplier_cost_mixed_currency;
    }
    return totals;
  }, {});
  const supplierPayablesDueLabel = Object.entries(supplierPayablesByCurrency)
    .map(([currency, amount]) => formatExactCurrency(amount, currency))
    .join(" · ") || "—";
  const expectedLabel = Object.entries(collections.expectedByCurrency).map(([currency, amount]) => formatExactCurrency(amount, currency)).join(" · ") || "—";
  const collectedLabel = Object.entries(collections.collectedByCurrency).map(([currency, amount]) => formatExactCurrency(amount, currency)).join(" · ") || "—";
  const outstandingLabel = Object.entries(collections.outstandingByCurrency).map(([currency, amount]) => formatExactCurrency(amount, currency)).join(" · ") || "—";
  const overdueLabel = Object.entries(collections.overdueByCurrency).map(([currency, amount]) => formatExactCurrency(amount, currency)).join(" · ") || "—";

  return (
    <div className="flex flex-col gap-6">
      <KpiRow>
        <KpiCard title="Expected customer payments" value={expectedLabel} />
        <KpiCard title="Collected" value={collectedLabel} />
        <KpiCard title="Outstanding" value={outstandingLabel} />
        <KpiCard title="Overdue" value={overdueLabel} desc={`Collection rate: ${collections.collectionRatePercent === null ? "Multiple currencies" : formatPercent(collections.collectionRatePercent)}`} />
      </KpiRow>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-0 overflow-hidden">
          <CardHeader className="px-5 pt-5">
            <CardTitle className="text-base font-medium">Collections by branch</CardTitle>
          </CardHeader>
          {byBranch.length === 0 ? (
            <EmptyState title="No bookings in this period" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Collected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byBranch.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="font-number tabular-nums">{formatCurrency(row.expected)}</TableCell>
                    <TableCell className="font-number tabular-nums">{formatCurrency(row.collected)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="p-0 overflow-hidden">
          <CardHeader className="px-5 pt-5">
            <CardTitle className="text-base font-medium">Collections by payment method</CardTitle>
          </CardHeader>
          {byMethod.length === 0 ? (
            <EmptyState title="No payments in this period" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Collected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byMethod.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="font-number tabular-nums">{formatCurrency(row.collected)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">Receivables aging</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bucket</TableHead>
              <TableHead>Milestones</TableHead>
              <TableHead>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aging.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="font-number tabular-nums">{row.milestoneCount}</TableCell>
                <TableCell className="font-number tabular-nums">{formatCurrency(row.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {can.viewCostAndMargin && (
        <Card className="p-0 overflow-hidden">
          <CardHeader className="px-5 pt-5">
            <CardTitle className="text-base font-medium">Package profitability</CardTitle>
          </CardHeader>
          {profitability.length === 0 ? (
            <EmptyState title="No active packages" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Estimated Cost</TableHead>
                  <TableHead>Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profitability.map((row) => (
                  <TableRow key={row.packageTemplateId}>
                    <TableCell className="font-medium">{row.packageName}</TableCell>
                    <TableCell className="font-number tabular-nums">{formatCurrency(row.revenue, row.currency)}</TableCell>
                    <TableCell className="font-number tabular-nums">{formatCurrency(row.estimatedCost, row.currency)}</TableCell>
                    <TableCell className="font-number tabular-nums">
                      {row.marginPercent === null ? "—" : formatPercent(row.marginPercent, 1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground px-5 pb-4">
            Profitability is split by package and currency; no FX conversion is implied.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/finance?view=payables" className="block">
          <Card className="hover:bg-muted/40 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm text-muted-foreground">Supplier Payables Due</h2>
                <p className="text-3xl mt-2 font-bold font-number">{supplierPayablesDueLabel}</p>
              </div>
              <ArrowUpRight className="size-5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Open in Payments & Invoices</p>
          </Card>
        </Link>

        <Link href="/finance?view=receivables&subview=adjustments" className="block">
          <Card className="hover:bg-muted/40 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm text-muted-foreground">Refunds Pending</h2>
                <p className="text-3xl mt-2 font-bold font-number">{formatCurrency(finance.refundsPending.amount)}</p>
              </div>
              <ArrowUpRight className="size-5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {finance.refundsPending.count} request{finance.refundsPending.count === 1 ? "" : "s"} — Open in Payments & Invoices
            </p>
          </Card>
        </Link>
      </div>
    </div>
  );
}
