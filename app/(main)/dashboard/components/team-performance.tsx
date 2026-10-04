"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { ArrowRight } from "lucide-react";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { formatCurrency } from "@/app/(main)/departure-groups/utils";
import type { SalesOwnerRow } from "@/lib/data/reports-sales";

function RankTooltip({ active, payload }: { active?: boolean; payload?: { payload: SalesOwnerRow }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium text-foreground">{row.ownerName}</p>
      <p className="text-muted-foreground">
        {row.leadCount} leads · {Math.round(row.contactRatePercent)}% contacted · {formatCurrency(row.bookingValue)}
      </p>
    </div>
  );
}

/**
 * Team Performance (§5.10) — `buildSalesTeamPerformance()`, real per-owner
 * figures, ranked by contact rate as a horizontal bar chart rather than a
 * table — five-to-eight comparable values reads as a ranking at a glance
 * this way, the same reasoning the module plan gives for not rendering it as
 * a pie. Replaces the old table version of this panel.
 */
export default function TeamPerformance({ rows }: { rows: SalesOwnerRow[] }) {
  const ranked = [...rows].sort((a, b) => b.contactRatePercent - a.contactRatePercent).slice(0, 6);
  const rowHeight = 34;

  return (
    <Card className="p-5 flex flex-col gap-3">
      <SectionHeading
        title="Top Performing Agents"
        act={
          <Button variant="link" size="sm" className="h-5 p-0 text-xs font-medium gap-1" render={<Link href="/reports?tab=sales" />}>
            <span>Open Reports</span>
            <ArrowRight className="size-3.5" />
          </Button>
        }
      />
      <p className="text-xs text-muted-foreground -mt-2">Contact rate this period, by owner.</p>

      {ranked.length === 0 ? (
        <EmptyState title="No sales activity yet" description="Owner performance will show up here once leads are assigned." />
      ) : (
        <ChartContainer config={{}} className="bg-transparent! aspect-auto" style={{ height: ranked.length * rowHeight + 20 }}>
          <BarChart data={ranked} layout="vertical" margin={{ left: 0, right: 24 }} barCategoryGap={10}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis
              type="category"
              dataKey="ownerName"
              tickLine={false}
              axisLine={false}
              width={92}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={<RankTooltip />} />
            <Bar dataKey="contactRatePercent" radius={4} barSize={14}>
              {ranked.map((row, index) => (
                <Cell key={row.ownerName} fill="var(--primary)" opacity={1 - index * 0.1} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </Card>
  );
}
