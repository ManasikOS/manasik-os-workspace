"use client";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import { ActorChip } from "@/components/ui/copilot-mark";
import SectionHeading from "@/components/section-heading";
import type { PackageActivityLog } from "@/lib/types/packages";
import { ArchiveRestore, Archive, PauseCircle, PlayCircle, Send } from "lucide-react";
import React from "react";

import { PackageStatusBadge } from "../../../components/package-status-badges";

interface ActivityTabProps {
  activity: PackageActivityLog[];
}

const ACTION_ICON: Record<PackageActivityLog["actionType"], React.ReactNode> = {
  PUBLISHED: <Send className="size-3.5" />,
  SALES_CLOSED: <PauseCircle className="size-3.5" />,
  REOPENED: <PlayCircle className="size-3.5" />,
  ARCHIVED: <Archive className="size-3.5" />,
  RESTORED: <ArchiveRestore className="size-3.5" />,
};

function relativeTimestamp(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Lifecycle transition history — publish / close sales / reopen / archive /
 * restore, one row per `package_activity_logs` entry. Previously packages
 * had no audit trail at all (finding F4 in
 * docs/modules/packages-production-readiness-plan.md); the table and the five
 * lifecycle RPCs that write it shipped in Phase 1
 * (`20261006090000_packages_lifecycle_phase1.sql`) — this tab is the first
 * thing that actually reads it.
 */
const ActivityTab = ({ activity }: ActivityTabProps) => {
  return (
    <Card className="gap-4">
      <SectionHeading title="Activity" />

      {activity.length === 0 ? (
        <EmptyState title="No lifecycle activity recorded yet" />
      ) : (
        <div className="flex flex-col">
          {activity.map((entry, index) => (
            <div key={entry.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="size-7 rounded-full flex items-center justify-center shrink-0 bg-primary/10 text-primary">
                  {ACTION_ICON[entry.actionType]}
                </div>
                {index < activity.length - 1 && (
                  <div className="w-px flex-1 bg-border/50 my-1" />
                )}
              </div>

              <div className="flex-1 pb-5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {relativeTimestamp(entry.createdAt)}
                  </span>
                  {entry.beforeStatus && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <PackageStatusBadge value={entry.beforeStatus} />
                      {"→"}
                      <PackageStatusBadge value={entry.afterStatus} />
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground mt-1">
                  <ActorChip name={entry.actorName} inline /> {entry.message}
                </p>
                {entry.reason && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Reason: {entry.reason}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default ActivityTab;
