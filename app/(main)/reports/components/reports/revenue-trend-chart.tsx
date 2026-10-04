"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ButtonGroup } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";

import { buildRevenueTrend, type TrendGranularity } from "@/lib/data/reports";
import type { ReportBookingFact, ReportGroupFact, ReportPaymentFact } from "@/lib/types/reports";

import { formatCurrency, formatExactCurrency } from "../../utils";

const chartConfig = {
  bookedValue: { label: "Booked Value", color: "var(--primary)" },
  cashCollected: { label: "Cash Collected", color: "var(--accent)" },
} satisfies ChartConfig;

/**
 * Revenue and collections trend, with a Monthly / Weekly toggle (plan
 * §Overview reports). Outstanding receivables and supplier payables are
 * live balances, not events with a date — they render as a caption rather
 * than an invented per-bucket line (see `buildRevenueTrend`).
 */
export function RevenueTrendChart({
  bookings,
  payments,
  groups,
  fromIso,
  toIso,
}: {
  bookings: ReportBookingFact[];
  payments: ReportPaymentFact[];
  groups: ReportGroupFact[];
  fromIso: string;
  toIso: string;
}) {
  const [granularity, setGranularity] = useState<TrendGranularity>("MONTH");

  const points = useMemo(
    () => buildRevenueTrend(bookings, payments, fromIso, toIso, granularity),
    [bookings, payments, fromIso, toIso, granularity],
  );

  const outstandingByCurrency = groups.reduce<Record<string, number>>((totals, g) => {
    const currency = g.currency ?? "LKR";
    totals[currency] = (totals[currency] ?? 0) + g.outstanding_amount;
    return totals;
  }, {});
  const supplierByCurrency = groups.reduce<Record<string, number>>((totals, g) => {
    const buckets = g.supplier_cost_by_currency;
    if (buckets && Object.keys(buckets).length > 0) {
      for (const [currency, amount] of Object.entries(buckets)) totals[currency] = (totals[currency] ?? 0) + amount;
    } else {
      const currency = g.currency ?? "LKR";
      totals[currency] = (totals[currency] ?? 0) + g.supplier_cost_mixed_currency;
    }
    return totals;
  }, {});
  const outstandingLabel = Object.entries(outstandingByCurrency).map(([currency, amount]) => formatExactCurrency(amount, currency)).join(" · ") || "—";
  const supplierLabel = Object.entries(supplierByCurrency).map(([currency, amount]) => formatExactCurrency(amount, currency)).join(" · ") || "—";

  return (
    <Card className="p-0">
      <CardHeader className="px-5 pt-5 flex flex-row items-center justify-between">
        <CardTitle className="text-base font-medium">Revenue and collections trend</CardTitle>
        <ButtonGroup>
          <Button
            size="sm"
            variant={granularity === "MONTH" ? "secondary" : "outline"}
            onClick={() => setGranularity("MONTH")}
          >
            Monthly
          </Button>
          <Button
            size="sm"
            variant={granularity === "WEEK" ? "secondary" : "outline"}
            onClick={() => setGranularity("WEEK")}
          >
            Weekly
          </Button>
        </ButtonGroup>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="bg-transparent! aspect-auto h-80">
          <LineChart accessibilityLayer data={points} margin={{ left: 15 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="bucketLabel" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrency(v)} width={80} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
            <Line dataKey="bookedValue" type="monotone" stroke="var(--color-bookedValue)" strokeWidth={2} dot={false} />
            <Line dataKey="cashCollected" type="monotone" stroke="var(--color-cashCollected)" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-xs text-muted-foreground border-t pt-3">
          <span>
            Outstanding receivables (current): <span className="font-medium text-foreground">{outstandingLabel}</span>
          </span>
          <span>
            Supplier payables (current): <span className="font-medium text-foreground">{supplierLabel}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
