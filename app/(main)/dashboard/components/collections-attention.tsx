"use client";

import React, { useState } from "react";
import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowRight,
  Bell,
  AlertCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import { CollectionRecord } from "@/lib/types/dashboard";
import PaymentReminderDialog from "./payment-reminder-dialog";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TONE_STAT_CARD, TONE_TEXT, type Tone } from "@/lib/ui/tone";

const STAT_PILLS: {
  label: string;
  tone: Tone;
  key: "thisMonth" | "due7Days" | "overdue";
}[] = [
  { label: "Collected Month", tone: "success", key: "thisMonth" },
  { label: "Due in 7 Days", tone: "info", key: "due7Days" },
  { label: "Overdue", tone: "danger", key: "overdue" },
];

interface CollectionsAttentionProps {
  collections: {
    thisMonth: string;
    due7Days: string;
    overdue: string;
    pendingRefundsCount: number;
    records: CollectionRecord[];
  };
}

export default function CollectionsAttention({
  collections,
}: CollectionsAttentionProps) {
  const [selectedRecord, setSelectedRecord] = useState<CollectionRecord | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleOpenReminder = (record: CollectionRecord) => {
    setSelectedRecord(record);
    setDialogOpen(true);
  };

  return (
    <>
      <Card className=" flex flex-col gap-4 h-full">
        <div>
          <SectionHeading
            title="Collections & Payment Attention"
            act={
              <Link href="/finance?view=receivables&subview=balances">
                <Button
                  variant="link"
                  size="sm"
                  className="h-5 p-0 text-xs font-medium gap-1"
                >
                  <span>Open finance</span>
                  <ArrowRight className="size-3.5" />
                </Button>
              </Link>
            }
          />
          <p className="text-xs text-muted-foreground mt-0.5">
            Monitor revenue flow and overdue accounts.
          </p>
        </div>

        {/* Top Metric Summary Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STAT_PILLS.map((pill) => (
            <Card
              key={pill.key}
              className={cn(
                "p-2.5 flex flex-col gap-0.5",
                TONE_STAT_CARD[pill.tone],
              )}
            >
              <span
                className={cn(
                  "text-[10px] font-medium truncate",
                  TONE_TEXT[pill.tone],
                )}
              >
                {pill.label}
              </span>
              <span
                className={cn(
                  "text-xs font-bold tabular-nums",
                  TONE_TEXT[pill.tone],
                )}
              >
                {collections[pill.key]}
              </span>
            </Card>
          ))}

          <Card
            className={cn(
              "p-2.5 flex flex-col gap-0.5",
              TONE_STAT_CARD.warning,
            )}
          >
            <span
              className={cn(
                "text-[10px] font-medium truncate",
                TONE_TEXT.warning,
              )}
            >
              Refunds Pending
            </span>
            <span
              className={cn(
                "text-xs font-bold tabular-nums",
                TONE_TEXT.warning,
              )}
            >
              {collections.pendingRefundsCount} requests
            </span>
          </Card>
        </div>

        {/* Priority Records List */}
        <div className="flex flex-col gap-2.5 mt-3">
          <span className="text-sm font-medium text-foreground">
            Priority Follow-up Records
          </span>
          {collections.records.map((rec) => (
            <Card
              key={rec.id}
              className=" bg-card/50! hover:bg-accent/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">
                    {rec.pilgrimName}
                  </span>
                  <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-medium">
                    {rec.groupName}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium tabular-nums text-foreground">
                    {rec.amount}
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      rec.severity === "critical"
                        ? cn(TONE_TEXT.danger, "font-semibold")
                        : rec.severity === "warning"
                          ? TONE_TEXT.warning
                          : "text-muted-foreground",
                    )}
                  >
                    • {rec.statusLabel}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <Button
                  variant="link"
                  size="xs"
                  onClick={() => handleOpenReminder(rec)}
                  className="h-7 text-xs font-medium gap-1 text-foreground "
                >
                  <Bell className={cn("size-3", TONE_TEXT.warning)} />
                  <span>Send reminder</span>
                </Button>

                <Link href={`/finance/record/${rec.id}`}>
                  <Button variant="ghost" size="icon-xs" title="Open record">
                    <ExternalLink className="size-3.5 text-muted-foreground" />
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </Card>

      <PaymentReminderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        record={selectedRecord}
      />
    </>
  );
}
