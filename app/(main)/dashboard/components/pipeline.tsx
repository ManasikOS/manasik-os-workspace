import Link from "next/link";
import { ArrowRight } from "lucide-react";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import { formatCurrency } from "@/app/(main)/departure-groups/utils";
import type { PipelineData } from "@/lib/types/dashboard";
import { PipelineChart } from "./pipeline-chart";

/**
 * Pipeline (§5.9) — replaces the old landing-page leads chart, which
 * ignored its own real `data` prop and rendered a hardcoded bar series
 * (Phase 0). `buildLeadFunnel()` is a monotonic funnel derived from each
 * lead's current stage — there is no `lead_stage_events` history table, so
 * this reads current pipeline shape, not a historical flow.
 */
export default function Pipeline({ data }: { data: PipelineData }) {
  const maxCount = Math.max(...data.funnel.map((s) => s.count), 1);

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <SectionHeading
          title="Pipeline Funnel"
          act={
            <Button
              variant="link"
              size="sm"
              className="h-5 p-0 text-xs font-medium gap-1"
              render={<Link href="/leads" />}
            >
              <span>Open Leads</span>
              <ArrowRight className="size-3.5" />
            </Button>
          }
          description="Current lead funnel and top sources by volume."
        />
      </div>
      <PipelineChart pipelineData={data} />

      {data.funnel.every((s) => s.count === 0) ? (
        <EmptyState
          title="No leads yet"
          description="New inquiries will show up here as they come in."
        />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {data.funnel.map((stage) => (
              <div
                key={stage.stage}
                className="flex items-center gap-3 text-xs"
              >
                <span className="w-32 shrink-0 text-muted-foreground">
                  {stage.label}
                </span>
                <div className="flex-1 bg-muted h-5 rounded-md overflow-hidden">
                  <div
                    className="h-full bg-primary/70 rounded-md flex items-center justify-end px-2"
                    style={{
                      width: `${Math.max(4, (stage.count / maxCount) * 100)}%`,
                    }}
                  >
                    <span className="text-[11px] tabular-nums text-primary-foreground">
                      {stage.count}
                    </span>
                  </div>
                </div>
                <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                  {stage.conversionFromPreviousPercent === null
                    ? "—"
                    : `${Math.round(stage.conversionFromPreviousPercent)}%`}
                </span>
              </div>
            ))}
          </div>

          {data.topSources.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border/40 pt-3">
              <span className="text-[11px] font-medium text-muted-foreground">
                Top sources
              </span>
              {data.topSources.map((source) => (
                <div
                  key={source.source}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-foreground">{source.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {source.leadCount} leads ·{" "}
                    {Math.round(source.conversionPercent)}% conv ·{" "}
                    {formatCurrency(source.revenue)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
