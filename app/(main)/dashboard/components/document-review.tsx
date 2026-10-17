"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DocumentReviewData } from "@/lib/types/dashboard";
import { TONE_CLASS, TONE_STAT_CARD, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

const COUNT_PILLS: { key: keyof DocumentReviewData["counts"]; label: string; tone: Tone }[] = [
  { key: "awaitingReview", label: "Awaiting review", tone: "info" },
  { key: "rejected", label: "Rejected", tone: "danger" },
  { key: "missingDocuments", label: "Missing", tone: "warning" },
  { key: "expiringSoon", label: "Passports expiring", tone: "danger" },
];

/** Tone of a group's call to action, from its own most urgent problem. */
function actionTone(group: DocumentReviewData["groups"][number]): Tone {
  if (group.expiringSoon > 0 || group.rejected > 0) return "danger";
  if (group.awaitingReview > 0) return "info";
  return "warning";
}

/**
 * Document review (spec section 3.2). Groups with documents waiting on
 * someone, soonest departure first, each with the one next verb. Every
 * figure is the Documents module's own derivation; no traveller-level data
 * reaches this block. `/documents` has no URL filters, so rows link to the
 * module unfiltered.
 */
export default function DocumentReview({ data }: { data: DocumentReviewData }) {
  const hiddenGroups = data.actionableGroupCount - data.groups.length;

  return (
    <Card className="flex h-full flex-col gap-4">
      <div>
        <SectionHeading
          title="Document review"
          act={
            <Link href="/documents">
              <Button variant="link" size="sm" className="h-5 gap-1 p-0 text-xs font-medium">
                <span>Open documents</span>
                <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          }
        />
        <p className="mt-0.5 text-xs text-muted-foreground">
          Groups with documents to review or chase, soonest departure first.
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

      {data.totalDocuments === 0 ? (
        <p className="text-sm text-muted-foreground">No documents for upcoming departures yet.</p>
      ) : data.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents need attention right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.groups.map((group) => (
            <li key={group.groupId}>
              <Link
                href="/documents"
                className="flex flex-col gap-2 rounded-lg border bg-card/50 p-3 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-foreground">{group.groupName}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.groupCode} · departs in {group.daysToDeparture} day{group.daysToDeparture === 1 ? "" : "s"} ·{" "}
                    {group.readinessPercent}% verified
                  </span>
                  {group.blockers.length > 0 && (
                    <span className="text-xs text-muted-foreground">{group.blockers.join(" · ")}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 self-start rounded-full px-2.5 py-1 text-xs font-medium sm:self-auto",
                    TONE_CLASS[actionTone(group)],
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
        <Link href="/documents" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          View all {data.actionableGroupCount} groups needing attention →
        </Link>
      )}
    </Card>
  );
}
