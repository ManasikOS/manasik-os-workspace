"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { VisaQueueData } from "@/lib/types/dashboard";
import { TONE_CLASS, TONE_STAT_CARD, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

const COUNT_PILLS: { key: keyof VisaQueueData["counts"]; label: string; tone: Tone }[] = [
  { key: "readyToSubmit", label: "Ready to submit", tone: "info" },
  { key: "submittedPending", label: "With embassy", tone: "neutral" },
  { key: "visaIssues", label: "Need rework", tone: "danger" },
  { key: "issued", label: "Issued", tone: "success" },
];

const RISK_TONE = { GREEN: "success", AMBER: "warning", RED: "danger" } as const satisfies Record<string, Tone>;

/**
 * Visa queue (spec section 3.2) — the visa officer's hero block. Groups that
 * need a person, soonest departure first, each with the one next verb.
 * Every figure is the visa module's own derivation; the rows link to the
 * module (`/visa` has no URL filters yet, so the link is unfiltered).
 */
export default function VisaQueue({ data }: { data: VisaQueueData }) {
  const hiddenGroups = data.actionableGroupCount - data.groups.length;

  return (
    <Card className="flex h-full flex-col gap-4">
      <div>
        <SectionHeading
          title="Visa queue"
          act={
            <Link href="/visa">
              <Button variant="link" size="sm" className="h-5 gap-1 p-0 text-xs font-medium">
                <span>Open visa operations</span>
                <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          }
        />
        <p className="mt-0.5 text-xs text-muted-foreground">
          Groups that need a visa action, soonest departure first.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {COUNT_PILLS.map((pill) => (
          <Card key={pill.key} className={cn("flex flex-col gap-0.5 p-2.5", TONE_STAT_CARD[pill.tone])}>
            <span className={cn("truncate text-[10px] font-medium", TONE_TEXT[pill.tone])}>{pill.label}</span>
            <span className={cn("text-sm font-bold tabular-nums", TONE_TEXT[pill.tone])}>{data.counts[pill.key]}</span>
          </Card>
        ))}
      </div>

      {data.totalApplications === 0 ? (
        <p className="text-sm text-muted-foreground">No visa applications for upcoming departures yet.</p>
      ) : data.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs a visa action right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.groups.map((group) => (
            <li key={group.groupId}>
              <Link
                href="/visa"
                className="flex flex-col gap-2 rounded-lg border bg-card/50 p-3 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-foreground">{group.groupName}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.groupCode} · departs in {group.daysToDeparture} day{group.daysToDeparture === 1 ? "" : "s"} ·{" "}
                    {group.issued}/{group.pilgrimCount} issued
                  </span>
                  {group.blockers.length > 0 && (
                    <span className="text-xs text-muted-foreground">{group.blockers.join(" · ")}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 self-start rounded-full px-2.5 py-1 text-xs font-medium sm:self-auto",
                    TONE_CLASS[RISK_TONE[group.riskBand]],
                  )}
                >
                  {group.action}
                  <ArrowRight className="size-3" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hiddenGroups > 0 && (
        <Link href="/visa" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          View all {data.actionableGroupCount} groups needing action →
        </Link>
      )}
    </Card>
  );
}
