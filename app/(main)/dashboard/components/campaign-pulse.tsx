"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CampaignPulseData, CampaignPulseRow } from "@/lib/types/dashboard";
import { TONE_CLASS, TONE_STAT_CARD, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

const COUNT_PILLS: { key: keyof CampaignPulseData["counts"]; label: string; tone: Tone }[] = [
  { key: "active", label: "Active", tone: "success" },
  { key: "scheduled", label: "Scheduled", tone: "info" },
  { key: "paused", label: "Paused", tone: "warning" },
];

function endLabel(row: CampaignPulseRow): string | null {
  if (row.daysToEnd === null) return null;
  if (row.pastEnd) {
    const ago = Math.abs(row.daysToEnd);
    return `ended ${ago} day${ago === 1 ? "" : "s"} ago, still active`;
  }
  return `ends in ${row.daysToEnd} day${row.daysToEnd === 1 ? "" : "s"}`;
}

/** "12 / 40" when the campaign set a target, otherwise just "12". */
function progress(value: number, target: number | null): string {
  return target ? `${value} / ${target}` : String(value);
}

/**
 * Campaign pulse (spec section 3.2) - active campaigns, ending soonest
 * first, with progress against the campaign's own targets and seats left on
 * its linked departure. Counts come straight from the Campaigns module; the
 * block adds no verdict of its own and shows no spend or revenue.
 */
export default function CampaignPulse({ data }: { data: CampaignPulseData }) {
  const hidden = data.counts.active - data.campaigns.length;

  return (
    <Card className="flex h-full flex-col gap-4">
      <div>
        <SectionHeading
          title="Campaign pulse"
          act={
            <Link href="/campaigns">
              <Button variant="link" size="sm" className="h-5 gap-1 p-0 text-xs font-medium">
                <span>Open campaigns</span>
                <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          }
        />
        <p className="mt-0.5 text-xs text-muted-foreground">Live campaigns and how they are tracking to their own targets.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {COUNT_PILLS.map((pill) => (
          <Card key={pill.key} className={cn("flex flex-col gap-0.5 p-2.5", TONE_STAT_CARD[pill.tone])}>
            <span className={cn("truncate text-[10px] font-medium", TONE_TEXT[pill.tone])}>{pill.label}</span>
            <span className={cn("text-sm font-bold tabular-nums", TONE_TEXT[pill.tone])}>{data.counts[pill.key]}</span>
          </Card>
        ))}
      </div>

      {data.total === 0 ? (
        <p className="text-sm text-muted-foreground">No campaigns yet.</p>
      ) : data.campaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No campaigns are active right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.campaigns.map((row) => {
            const ends = endLabel(row);
            return (
              <li key={row.campaignId}>
                <Link
                  href={`/campaigns/${row.campaignId}`}
                  className="flex flex-col gap-1.5 rounded-lg border bg-card/50 p-3 transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="truncate text-sm font-semibold text-foreground">{row.name}</span>
                    {ends && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          TONE_CLASS[row.pastEnd ? "danger" : "neutral"],
                        )}
                      >
                        {ends}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                    <span>Leads {progress(row.leads, row.targetLeads)}</span>
                    <span>Qualified {row.qualifiedLeads}</span>
                    <span>Bookings {progress(row.bookings, row.targetBookings)}</span>
                    {row.seatsLeft !== null && (
                      <span>
                        {row.seatsLeft} seat{row.seatsLeft === 1 ? "" : "s"} left
                        {row.linkedGroupName ? ` on ${row.linkedGroupName}` : ""}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {hidden > 0 && (
        <Link href="/campaigns" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          View all {data.counts.active} active campaigns →
        </Link>
      )}
    </Card>
  );
}
