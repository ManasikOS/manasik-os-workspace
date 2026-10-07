import { Card } from "@/components/ui/card";
import type { AiMonthToDateUsage } from "@/lib/ai/usage-rollup";

function formatMonthlyUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  }).format(value);
}

/** Month-to-date AI spend for the whole agency, from the nightly `ai_usage_daily` rollup (MI0.1). */
export function AiMonthlyCostCard({ usage }: { usage: AiMonthToDateUsage }) {
  return (
    <Card className="p-4 gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          AI cost so far this month ({usage.month})
        </p>
        <p className="text-3xl font-semibold tabular-nums tracking-tight">
          {formatMonthlyUsd(usage.costUsd)}
        </p>
        <p className="text-xs text-muted-foreground">
          {usage.runs.toLocaleString()} assistant calls across all features.
          Updated hourly, so the last hour may be missing.
        </p>
      </div>

      {usage.unpricedRuns > 0 && (
        <p className="text-xs text-muted-foreground">
          {usage.unpricedRuns.toLocaleString()} calls used a model with no price
          on file and are not in this total, so the real cost is higher.
        </p>
      )}

      {usage.bySurface.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {usage.bySurface.map((entry) => (
            <li
              key={entry.surface}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-muted-foreground">{entry.surface}</span>
              <span className="tabular-nums">
                {formatMonthlyUsd(entry.costUsd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
