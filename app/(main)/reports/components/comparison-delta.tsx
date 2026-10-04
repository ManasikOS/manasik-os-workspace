import React from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";

import { formatPercentDelta } from "../utils";

/**
 * The `+14% vs previous period` badge, used under every KPI tile and beside
 * every comparable table total. One component so a delta always reads the
 * same way across the module (plan D2/F5).
 */
export function ComparisonDelta({
  delta,
  label = "vs previous period",
  invert = false,
}: {
  /** `null` = no comparison available (point-in-time report, or `Compare With: None`). */
  delta: number | null;
  label?: string;
  /** For metrics where a fall is good (e.g. overdue amount). */
  invert?: boolean;
}) {
  if (delta === null) {
    return <span className="text-muted-foreground">No comparison available</span>;
  }

  const positive = invert ? delta < 0 : delta > 0;
  const negative = invert ? delta > 0 : delta < 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        positive && TONE_TEXT.success,
        negative && TONE_TEXT.danger,
        !positive && !negative && "text-muted-foreground",
      )}
    >
      {positive ? (
        <TrendingUp className="size-3.5" />
      ) : negative ? (
        <TrendingDown className="size-3.5" />
      ) : (
        <Minus className="size-3.5" />
      )}
      {formatPercentDelta(delta)}
      <span className="text-muted-foreground font-normal">{label}</span>
    </span>
  );
}
