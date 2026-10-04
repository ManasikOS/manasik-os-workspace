"use client";

import Link from "next/link";
import { CartesianGrid, ComposedChart, Line, Scatter, XAxis, YAxis } from "recharts";
import { ArrowRight } from "lucide-react";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import type { Tone } from "@/lib/ui/tone";
import type { SeatPacePoint } from "@/lib/data/dashboard-pace";

const chartConfig = {
  fillPercent: { label: "Seats sold", color: "var(--primary)" },
  expectedFillPercent: { label: "Target pace", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

const DOT_COLOR: Record<Tone, string> = {
  success: "var(--primary)",
  warning: "#f59e0b",
  danger: "var(--destructive)",
  info: "var(--primary)",
  neutral: "var(--muted-foreground)",
  brand: "var(--primary)",
};

function PaceTooltip({ active, payload }: { active?: boolean; payload?: { payload: SeatPacePoint }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium text-foreground">
        {point.groupName} ({point.groupCode})
      </p>
      <p className="text-muted-foreground">
        T-{point.daysUntilDeparture} · {point.fillPercent}% sold vs {point.expectedFillPercent}% target
      </p>
    </div>
  );
}

/**
 * Seat Fill Pace (§5.6) — the one forward-looking metric a tour operator
 * actually runs on, and the one genuinely new derivation this dashboard
 * adds. Groups plotted against an explicit, editable target line (a
 * straight line by default — see `dashboard-pace.ts` for why it isn't
 * inferred from history), not a historical seasonality model.
 */
export default function SeatFillPace({ points }: { points: SeatPacePoint[] }) {
  const underPace = points.filter((p) => p.paceTone !== "success").sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture);

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div>
        <SectionHeading
          title="Seat Fill Pace"
          act={
            <Button variant="link" size="sm" className="h-5 p-0 text-xs font-medium gap-1" render={<Link href="/departure-groups" />}>
              <span>Open Departure Groups</span>
              <ArrowRight className="size-3.5" />
            </Button>
          }
        />
        <p className="text-xs text-muted-foreground mt-0.5">
          Seats sold vs. an editable target pace, by days until departure. Below the line means under-filling or a discount decision.
        </p>
      </div>

      {points.length === 0 ? (
        <EmptyState title="No active departures" description="Groups will show up here once they have seats booked." />
      ) : (
        <>
          <ChartContainer config={chartConfig} className="bg-transparent! aspect-auto h-64">
            <ComposedChart data={[...points].sort((a, b) => b.daysUntilDeparture - a.daysUntilDeparture)} margin={{ left: 10, right: 10 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="daysUntilDeparture"
                type="number"
                reversed
                tickFormatter={(v) => `T-${v}`}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={40} />
              <ChartTooltip cursor={false} content={<PaceTooltip />} />
              <Line
                dataKey="expectedFillPercent"
                type="monotone"
                stroke="var(--color-expectedFillPercent)"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                dot={false}
                legendType="none"
              />
              <Scatter
                dataKey="fillPercent"
                fill="var(--color-fillPercent)"
                shape={(props: unknown) => {
                  const p = props as { cx: number; cy: number; payload: SeatPacePoint };
                  return <circle cx={p.cx} cy={p.cy} r={4} fill={DOT_COLOR[p.payload.paceTone]} />;
                }}
              />
            </ComposedChart>
          </ChartContainer>

          {underPace.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border/40 pt-3">
              <span className="text-[11px] font-medium text-muted-foreground">Behind pace</span>
              {underPace.slice(0, 5).map((p) => (
                <Link key={p.groupId} href={p.destination} className="flex items-center justify-between text-xs group">
                  <span className="text-foreground group-hover:text-primary transition-colors">
                    {p.groupName} ({p.groupCode})
                  </span>
                  <span className="text-muted-foreground font-number">
                    {p.fillPercent}% vs {p.expectedFillPercent}% · T-{p.daysUntilDeparture}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
