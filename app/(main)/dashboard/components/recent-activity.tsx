"use client";

import React from "react";
import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowRight,
  Clock,
  ShieldCheck,
  CreditCard,
  FileText,
  UserPlus,
  Compass,
} from "lucide-react";
import { RecentActivityItem } from "@/lib/types/dashboard";
import Link from "next/link";

interface RecentActivityProps {
  activities: RecentActivityItem[];
}

export default function RecentActivity({ activities }: RecentActivityProps) {
  // A fixed 5-way category legend (document/payment/visa/lead/operations),
  // not a status/severity signal — kept on its own distinct hues rather
  // than routed through the tone system.
  /* eslint-disable no-restricted-syntax */
  const getTypeIcon = (type: RecentActivityItem["type"]) => {
    switch (type) {
      case "document":
        return <FileText className="size-3.5 text-sky-500 shrink-0" />;
      case "payment":
        return <CreditCard className="size-3.5 text-emerald-500 shrink-0" />;
      case "visa":
        return <ShieldCheck className="size-3.5 text-purple-500 shrink-0" />;
      case "lead":
        return <UserPlus className="size-3.5 text-amber-500 shrink-0" />;
      case "operations":
      default:
        return <Compass className="size-3.5 text-primary shrink-0" />;
    }
  };
  /* eslint-enable no-restricted-syntax */

  return (
    <Card className=" flex flex-col gap-4 h-full">
      <div>
        <SectionHeading
          title="Recent Activity"
          act={
            <Button
              variant="link"
              size="sm"
              className="h-5 p-0 text-xs font-medium gap-1"
            >
              <span>View activity log</span>
              <ArrowRight className="size-3.5" />
            </Button>
          }
        />
        <p className="text-xs text-muted-foreground mt-0.5">
          Live audit log across sales and operations.
        </p>
      </div>

      <div className="flex flex-col gap-3 relative before:absolute before:left-4 before:top-2 before:bottom-2 before:w-px before:bg-border/60">
        {activities.map((act) => (
          <div key={act.id} className="flex items-start gap-3 relative z-10">
            {/* Actor Initials Badge */}
            <div className="size-8 rounded-full bg-accent border border-border flex items-center justify-center text-[11px] font-bold text-foreground tabular-nums shrink-0 shadow-xs">
              {act.avatarInitials}
            </div>

            <div className="flex flex-col gap-0.5 flex-1 min-w-0 pt-0.5">
              <div className="flex items-center gap-1.5 text-xs text-foreground flex-wrap">
                <span className="font-semibold text-foreground">
                  {act.actor}
                </span>
                <span className="text-muted-foreground">{act.action}</span>
                <strong className="font-semibold text-foreground">
                  {act.target}
                </strong>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                <div className="flex items-center gap-1">
                  {getTypeIcon(act.type)}
                  <span className="capitalize">{act.type}</span>
                </div>
                <span>•</span>
                <span className="flex items-center gap-1 tabular-nums">
                  <Clock className="size-2.5" />
                  {act.timeAgo}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
