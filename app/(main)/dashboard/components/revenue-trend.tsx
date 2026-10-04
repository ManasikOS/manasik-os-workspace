"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import SectionHeading from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/app/(main)/departure-groups/utils";
import type { BusinessHealthData } from "@/lib/types/dashboard";
import { RevenueChart } from "./revenue-chart";

const revenueChartConfig = {
  bookedValue: { label: "Booked Value", color: "var(--primary)" },
  cashCollected: { label: "Cash Collected", color: "var(--accent)" },
} satisfies ChartConfig;

/**
 * Revenue Trend — one half of what used to be the tabbed "Business Health"
 * panel (§5.8). Split out and always visible, paired with
 * `ReceivablesAgingCard`, so both read at a glance instead of behind a tab
 * click — same `buildRevenueTrend()` series, assembled once in
 * `dashboard-repository.ts`.
 */
export default function RevenueTrendCard({
  data,
}: {
  data: BusinessHealthData;
}) {
  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionHeading title="Revenue &amp; Collections" act={null} />
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Booked value vs. cash collected over the selected period.
      </p>

      {data.revenueTrend.every(
        (point) => point.bookedValue === 0 && point.cashCollected === 0,
      ) ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No booking activity in this period.
        </p>
      ) : (
        <RevenueChart />
      )}
    </Card>
  );
}
