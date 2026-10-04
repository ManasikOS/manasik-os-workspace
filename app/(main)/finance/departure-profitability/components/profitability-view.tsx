"use client";

import { useMemo, useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { Tabs, TabsList, TabsTrigger } from "@/components/animate-ui/components/animate/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { TrendingDown, TrendingUp } from "lucide-react";

import { EmptyState } from "@/app/(main)/departure-groups/components/status-badges";
import { formatDate, formatExactCurrency } from "@/app/(main)/departure-groups/utils";
import type { GroupProfitabilityRow } from "@/lib/data/profitability-repository";
import { TONE_TEXT } from "@/lib/ui/tone";

type Filter = "ALL" | "UPCOMING" | "NEGATIVE_MARGIN" | "CASH_NEGATIVE";

const FILTER_LABELS: Record<Filter, string> = {
  ALL: "All",
  UPCOMING: "Upcoming",
  NEGATIVE_MARGIN: "Negative Margin",
  CASH_NEGATIVE: "Cash-Negative Before Departure",
};

interface ProfitabilityViewProps {
  groups: GroupProfitabilityRow[];
  nowIso: string;
}

export default function ProfitabilityView({ groups, nowIso }: ProfitabilityViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("UPCOMING");

  const now = Date.parse(nowIso);
  const isUpcoming = (g: GroupProfitabilityRow) =>
    g.groupStatus !== "CANCELLED" &&
    g.groupStatus !== "COMPLETED" &&
    g.groupStatus !== "CLOSED" &&
    Date.parse(g.departureDate) >= now;

  // Committed cost so far (actual supplier bookings + the fixed cost every
  // departure carries) versus cash actually collected — a group can look
  // profitable on paper while being cash-negative right up to departure.
  // Labeled a scenario derived from stored figures, not a forecast.
  const isCashNegative = (g: GroupProfitabilityRow) =>
    isUpcoming(g) && g.collectedRevenue < g.actualSupplierCost + g.fixedCostPerDeparture;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (filter === "UPCOMING" && !isUpcoming(g)) return false;
      if (filter === "NEGATIVE_MARGIN" && g.estimatedGrossMargin >= 0) return false;
      if (filter === "CASH_NEGATIVE" && !isCashNegative(g)) return false;
      if (!needle) return true;
      return [g.groupName, g.groupCode].join(" ").toLowerCase().includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, search, filter, now]);

  const upcoming = groups.filter(isUpcoming);
  const estimatedMarginByCurrency = upcoming.reduce<Record<string, number>>((totals, g) => {
    totals[g.currency] = (totals[g.currency] ?? 0) + g.estimatedGrossMargin;
    return totals;
  }, {});
  const hasNegativeCurrencyMargin = Object.values(estimatedMarginByCurrency).some((value) => value < 0);
  const estimatedMarginLabel = Object.entries(estimatedMarginByCurrency)
    .map(([currency, value]) => formatExactCurrency(value, currency))
    .join(" · ");
  const negativeMarginCount = upcoming.filter((g) => g.estimatedGrossMargin < 0).length;
  const cashNegativeCount = upcoming.filter(isCashNegative).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Upcoming departures" value={String(upcoming.length)} />
        <KpiCard
          title="Total estimated margin"
          value={estimatedMarginLabel || formatExactCurrency(0)}
          desc={
            hasNegativeCurrencyMargin ? (
              <span className={`flex items-center gap-1 ${TONE_TEXT.danger}`}>
                <TrendingDown className="size-3" /> Negative in the combined displayed currency buckets
              </span>
            ) : (
              <span className={`flex items-center gap-1 ${TONE_TEXT.success}`}>
                <TrendingUp className="size-3" /> Positive in the combined displayed currency buckets
              </span>
            )
          }
        />
        <KpiCard title="Negative margin" value={String(negativeMarginCount)} />
        <KpiCard
          title="Cash-negative before departure"
          value={String(cashNegativeCount)}
          desc={
            cashNegativeCount > 0 ? (
              <span className={TONE_TEXT.warning}>Collected less than committed cost so far</span>
            ) : undefined
          }
        />
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
        <TabsList>
          {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
            <TabsTrigger
              key={key}
              value={key}
            >
              {FILTER_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTableSurface search={search} onSearchChange={setSearch} searchPlaceholder="Search departure group…" rowCount={filtered.length}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<TrendingUp className="size-8" />}
            title="No departures found"
            description="Try a different search or filter."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {[
                  "Group",
                  "Departs",
                  "Confirmed Pax",
                  "Booked Revenue",
                  "Collected",
                  "Outstanding",
                  "Internal Cost",
                  "Supplier Payable",
                  "Break-even Pax",
                  "Est. Gross Margin",
                ].map((label) => (
                  <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {filtered.map((g) => (
                <TableRow
                  key={g.departureGroupId}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => router.push(`/departure-groups/${g.departureGroupId}?tab=overview`)}
                >
                  <TableCell className="px-3 py-3">
                    <p className="text-sm text-foreground">{g.groupName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {g.groupCode}
                      {isCashNegative(g) && (
                        <span className={`ml-1.5 ${TONE_TEXT.warning}`}>· cash-negative</span>
                      )}
                    </p>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {formatDate(g.departureDate)}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {g.confirmedPax}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm text-foreground">
                    {formatExactCurrency(g.bookedRevenue, g.currency)}
                  </TableCell>
                  <TableCell className={`px-3 py-3 text-sm ${TONE_TEXT.success}`}>
                    {formatExactCurrency(g.collectedRevenue, g.currency)}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm">
                    <span className={g.outstandingRevenue > 0 ? "text-destructive" : "text-muted-foreground"}>
                      {formatExactCurrency(g.outstandingRevenue, g.currency)}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm text-foreground">
                    {formatExactCurrency(g.actualSupplierCost, g.currency)}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm text-foreground">
                    <span>{formatExactCurrency(g.committedSupplierCost, g.currency)}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatExactCurrency(g.supplierPayableOutstanding, g.currency)} outstanding
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {g.breakEvenHeadcount ?? "—"}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm">
                    <span className={g.estimatedGrossMargin < 0 ? "text-destructive" : TONE_TEXT.success}>
                      {formatExactCurrency(g.estimatedGrossMargin, g.currency)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableSurface>
    </div>
  );
}
