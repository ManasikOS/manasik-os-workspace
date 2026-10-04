"use client";

import { Cell, Pie, PieChart } from "recharts";

import SectionHeading from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { formatCurrency } from "@/app/(main)/departure-groups/utils";
import type { BusinessHealthData } from "@/lib/types/dashboard";

/**
 * Aging-bucket colour, by the fixed `AGING_BUCKETS` key order
 * (lib/data/reports-copy.ts) — these buckets *are* a severity signal (how
 * overdue a receivable is), so they route through the same tone hues
 * `TONE_BAR` uses elsewhere, just as literal values because Recharts' `Pie`
 * needs a CSS colour rather than a Tailwind class (same convention
 * `seat-fill-pace.tsx`'s `DOT_COLOR` already uses).
 */
const AGING_BUCKET_COLOR: Record<string, string> = {
  NOT_DUE: "var(--primary)",
  DUE_1_7: "#0ea5e9",
  DUE_8_30: "#f59e0b",
  DUE_31_PLUS: "var(--destructive)",
};

/**
 * Receivables Aging — the other half of the old tabbed "Business Health"
 * panel, now its own always-visible donut card. Same `buildReceivablesAging()`
 * buckets as before (§5.8), just no longer hidden behind a tab.
 */
export default function ReceivablesAgingCard({ data }: { data: BusinessHealthData }) {
  const isEmpty = data.receivablesAging.every((b) => b.amount === 0);

  return (
    <Card className="p-5 flex flex-col gap-3">
      <SectionHeading title="Receivables Aging" act={null} />

      {isEmpty ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No outstanding receivables.</p>
      ) : (
        <div className="flex items-center gap-5">
          <ChartContainer config={{}} className="bg-transparent! aspect-square h-32 w-32 shrink-0">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie
                data={data.receivablesAging}
                dataKey="amount"
                nameKey="label"
                innerRadius={38}
                outerRadius={58}
                strokeWidth={3}
              >
                {data.receivablesAging.map((bucket) => (
                  <Cell key={bucket.key} fill={AGING_BUCKET_COLOR[bucket.key] ?? "var(--muted-foreground)"} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>

          <div className="flex flex-col gap-1.5 w-full">
            {data.receivablesAging.map((bucket) => (
              <div key={bucket.key} className="flex items-center gap-2 text-xs">
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: AGING_BUCKET_COLOR[bucket.key] ?? "var(--muted-foreground)" }}
                />
                <span className="flex-1 text-muted-foreground truncate">{bucket.label}</span>
                <span className="font-number text-foreground font-medium">{formatCurrency(bucket.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
