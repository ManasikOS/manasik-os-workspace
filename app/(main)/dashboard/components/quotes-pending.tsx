"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { QuotePipelineData } from "@/lib/types/dashboard";
import { TONE_CLASS, TONE_STAT_CARD, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

const COUNT_PILLS: { key: keyof QuotePipelineData["counts"]; label: string; tone: Tone }[] = [
  { key: "drafts", label: "Drafts unsent", tone: "neutral" },
  { key: "awaitingApproval", label: "Awaiting approval", tone: "warning" },
  { key: "awaitingReply", label: "Awaiting reply", tone: "info" },
  { key: "expiringSoon", label: "Expiring soon", tone: "danger" },
];

/**
 * Quotes pending (spec section 3.2) - where the quote pipeline needs a
 * person: unsent drafts, discounts waiting for approval, quotes out with a
 * customer and the ones about to lapse. Each figure is the Quotes page's own
 * definition. Carries no customer or price data.
 */
export default function QuotesPending({ data }: { data: QuotePipelineData }) {
  const hidden = data.counts.expiringSoon - data.expiring.length;

  return (
    <Card className="flex h-full flex-col gap-4">
      <div>
        <SectionHeading
          title="Quotes pending"
          act={
            <Link href="/quotes">
              <Button variant="link" size="sm" className="h-5 gap-1 p-0 text-xs font-medium">
                <span>Open quotes</span>
                <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          }
        />
        <p className="mt-0.5 text-xs text-muted-foreground">Quotes that need a follow-up before they lapse.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {COUNT_PILLS.map((pill) => (
          <Card key={pill.key} className={cn("flex flex-col gap-0.5 p-2.5", TONE_STAT_CARD[pill.tone])}>
            <span className={cn("truncate text-[10px] font-medium", TONE_TEXT[pill.tone])}>{pill.label}</span>
            <span className={cn("text-sm font-bold tabular-nums", TONE_TEXT[pill.tone])}>{data.counts[pill.key]}</span>
          </Card>
        ))}
      </div>

      {data.total === 0 ? (
        <p className="text-sm text-muted-foreground">No quotes yet.</p>
      ) : data.expiring.length === 0 ? (
        <p className="text-sm text-muted-foreground">No quotes are about to lapse.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.expiring.map((quote) => (
            <li key={quote.quoteId}>
              <Link
                href={`/quotes/${quote.quoteId}`}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card/50 p-3 transition-colors hover:bg-accent/40"
              >
                <span className="truncate text-sm font-semibold text-foreground">{quote.reference}</span>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                    TONE_CLASS.danger,
                  )}
                >
                  {quote.daysLeft === 0 ? "lapses today" : `lapses in ${quote.daysLeft} day${quote.daysLeft === 1 ? "" : "s"}`}
                  <ArrowRight className="size-3" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 && (
        <Link href="/quotes" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          View all {data.counts.expiringSoon} expiring quotes →
        </Link>
      )}
    </Card>
  );
}
