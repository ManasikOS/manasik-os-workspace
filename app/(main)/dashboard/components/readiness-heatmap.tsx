import Link from "next/link";

import SectionHeading from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import { cn } from "@/lib/utils";
import { TONE_CLASS, type Tone } from "@/lib/ui/tone";
import type { UpcomingDepartureGroup } from "@/lib/types/dashboard";

function completionTone(completed: number, total: number): Tone {
  if (total <= 0) return "neutral";
  const ratio = completed / total;
  if (ratio >= 0.9) return "success";
  if (ratio >= 0.6) return "warning";
  return "danger";
}

const OPERATIONS_TONE: Record<UpcomingDepartureGroup["readinessState"], Tone> = {
  Ready: "success",
  "Needs Attention": "warning",
  "At Risk": "danger",
  Selling: "info",
};

/**
 * Readiness Heatmap — one row per upcoming departure, one cell per readiness
 * category, coloured by the same completion ratios `UpcomingDepartures`
 * already renders as progress bars (`group.readiness`). No new derivation:
 * this is the same `data.departureGroups` slice as the hero panel, read a
 * second way — "glance at all of them at once" instead of "read one card in
 * full" — not a wider set of groups than that panel already shows.
 */
export default function ReadinessHeatmap({ groups }: { groups: UpcomingDepartureGroup[] }) {
  return (
    <Card className="p-5 flex flex-col gap-4">
      <div>
        <SectionHeading title="Readiness at a Glance" act={null} />
        <p className="text-xs text-muted-foreground mt-0.5">Same upcoming departures, one cell per category.</p>
      </div>

      {groups.length === 0 ? (
        <EmptyState title="No active departures" description="Groups will show up here once they're planned." />
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,44px)] gap-x-2 gap-y-2 items-center">
            <div />
            <div className="text-[10px] text-muted-foreground text-center font-medium">Docs</div>
            <div className="text-[10px] text-muted-foreground text-center font-medium">Visa</div>
            <div className="text-[10px] text-muted-foreground text-center font-medium">Pay</div>
            <div className="text-[10px] text-muted-foreground text-center font-medium">Ops</div>

            {groups.map((group) => {
              const docsTone = completionTone(group.readiness.documents.completed, group.readiness.documents.total);
              const visaTone = completionTone(group.readiness.visas.completed, group.readiness.visas.total);
              const paymentsTone = completionTone(group.readiness.payments.completed, group.readiness.payments.total);
              const opsTone = OPERATIONS_TONE[group.readinessState] ?? "neutral";

              return (
                <div key={group.id} className="contents">
                  <Link href={group.destination} className="text-xs text-foreground font-medium truncate hover:underline">
                    {group.name}
                  </Link>
                  <span className={cn("h-6 rounded-md", TONE_CLASS[docsTone])} title="Documents" />
                  <span className={cn("h-6 rounded-md", TONE_CLASS[visaTone])} title="Visas" />
                  <span className={cn("h-6 rounded-md", TONE_CLASS[paymentsTone])} title="Payments" />
                  <span className={cn("h-6 rounded-md", TONE_CLASS[opsTone])} title="Operations" />
                </div>
              );
            })}
          </div>

          <div className="flex gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-xs", TONE_CLASS.success)} /> Ready
            </span>
            <span className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-xs", TONE_CLASS.warning)} /> Needs attention
            </span>
            <span className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-xs", TONE_CLASS.danger)} /> At risk
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
