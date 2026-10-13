"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { QueueCode } from "@/lib/inbox/intelligence/contracts";
import { openInboxView } from "@/lib/inbox/open-inbox-event";
import { viewForQueue } from "@/lib/inbox/views";
import type { InboxSlaData } from "@/lib/types/dashboard";
import { TONE_STAT_CARD, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface Pill {
  label: string;
  value: number;
  tone: Tone;
  queue: QueueCode;
}

/**
 * Inbox SLA (spec section 3.2) - the Inbox rail's own counts, each one a door
 * into the conversations behind it (the same `openInboxView` event the
 * Inbox intelligence panel uses). SLA figures appear only on a plan that
 * includes SLA. Where a queue has no view yet, the figure is shown but is
 * not clickable.
 */
export default function InboxSla({ data }: { data: InboxSlaData }) {
  const pills: Pill[] = [
    { label: "Assigned to me", value: data.mine, tone: "info", queue: "MINE" },
    { label: "Needs reply", value: data.needsReply, tone: "warning", queue: "NEEDS_REPLY" },
    { label: "Unassigned", value: data.unassigned, tone: "neutral", queue: "UNASSIGNED" },
  ];
  if (data.slaAvailable && data.slaBreached !== null && data.nearingDeadline !== null) {
    pills.push(
      { label: "SLA breached", value: data.slaBreached, tone: "danger", queue: "SLA_BREACHED" },
      { label: "Nearing deadline", value: data.nearingDeadline, tone: "warning", queue: "NEARING_DEADLINE" },
    );
  }

  return (
    <Card className="flex h-full flex-col gap-4">
      <div>
        <SectionHeading
          title="Inbox"
          act={
            <Link href="/inbox">
              <Button variant="link" size="sm" className="h-5 gap-1 p-0 text-xs font-medium">
                <span>Open inbox</span>
                <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          }
        />
        <p className="mt-0.5 text-xs text-muted-foreground">
          {data.slaAvailable
            ? "Conversations waiting on your team, and the ones at risk of missing their reply deadline."
            : "Conversations waiting on your team."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {pills.map((pill) => {
          const view = viewForQueue(pill.queue);
          const body = (
            <>
              <span className={cn("truncate text-[10px] font-medium", TONE_TEXT[pill.tone])}>{pill.label}</span>
              <span className={cn("text-xl font-bold tabular-nums", TONE_TEXT[pill.tone])}>{pill.value}</span>
            </>
          );
          const className = cn("flex flex-col gap-0.5 p-3 text-left", TONE_STAT_CARD[pill.tone]);
          return view ? (
            <button key={pill.queue} type="button" onClick={() => openInboxView(view)} className="text-left">
              <Card className={className}>{body}</Card>
            </button>
          ) : (
            <Card key={pill.queue} className={className}>
              {body}
            </Card>
          );
        })}
      </div>
    </Card>
  );
}
