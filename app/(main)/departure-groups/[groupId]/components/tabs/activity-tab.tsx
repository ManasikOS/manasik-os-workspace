"use client";

import SectionHeading from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Bot, UserRound } from "lucide-react";
import React, { useMemo, useState } from "react";

import { loadMoreGroupActivityAction } from "../../../actions";
import { EmptyState } from "../../../components/status-badges";
import type { GroupActivityLog } from "../../../types";
import { relativeTimestamp } from "../../../utils";
import { TONE_CLASS } from "@/lib/ui/tone";

import { ActorChip } from "@/components/ui/copilot-mark";
interface ActivityTabProps {
  departureGroupId: string;
  activity: GroupActivityLog[];
}

/**
 * How many rows `getDepartureGroupDetail()` hydrates up front
 * (`activityLimit: 200` in lib/data/departure-groups.ts). A first page
 * shorter than this means the group's whole history already fits, so
 * "Load more" has nothing further to fetch.
 */
const INITIAL_PAGE_SIZE = 200;

const FILTERS = ["All activity", "High impact", "System"] as const;
type Filter = (typeof FILTERS)[number];

/** Formats a before/after JSON delta into a readable "x → y" line. */
function describeChange(entry: GroupActivityLog): string | null {
  if (!entry.beforeValue && !entry.afterValue) return null;

  const keys = new Set([
    ...Object.keys(entry.beforeValue ?? {}),
    ...Object.keys(entry.afterValue ?? {}),
  ]);

  const parts: string[] = [];
  for (const key of keys) {
    const before = entry.beforeValue?.[key];
    const after = entry.afterValue?.[key];
    if (before === undefined && after === undefined) continue;
    const label = key.replace(/_/g, " ");
    if (before === undefined) {
      parts.push(`${label}: ${format(after)}`);
    } else if (after === undefined) {
      parts.push(`${label}: was ${format(before)}`);
    } else {
      parts.push(`${label}: ${format(before)} → ${format(after)}`);
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function format(value: unknown): string {
  if (value === null) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const ActivityTab = ({
  departureGroupId,
  activity: initialActivity,
}: ActivityTabProps) => {
  const [filter, setFilter] = useState<Filter>("All activity");
  const [activity, setActivity] = useState(initialActivity);
  const [hasMore, setHasMore] = useState(
    initialActivity.length >= INITIAL_PAGE_SIZE,
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (filter === "High impact") {
      return activity.filter((entry) => entry.isHighImpact);
    }
    if (filter === "System") {
      return activity.filter((entry) => entry.isSystem);
    }
    return activity;
  }, [activity, filter]);

  const handleLoadMore = async () => {
    const oldest = activity[activity.length - 1];
    if (!oldest) return;

    setIsLoadingMore(true);
    setLoadMoreError(null);
    const result = await loadMoreGroupActivityAction({
      departureGroupId,
      before: oldest.createdAt,
    });
    setIsLoadingMore(false);

    if (!result.ok) {
      setLoadMoreError(result.error);
      return;
    }
    setActivity((prev) => [...prev, ...result.activity]);
    setHasMore(result.activity.length >= 100);
  };

  return (
    <Card className="gap-4">
      <SectionHeading
        title="Activity"
        act={
          <div
            role="group"
            aria-label="Filter group activity"
            className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-lg border border-border/40 bg-card/60 p-1 no-scrollbar"
          >
            {FILTERS.map((entry) => (
              <Button
                key={entry}
                variant={filter === entry ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilter(entry)}
                className={cn(filter !== entry && "text-muted-foreground")}
              >
                {entry}
              </Button>
            ))}
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="No activity recorded for this filter" />
      ) : (
        <div className="flex flex-col">
          {rows.map((entry, index) => {
            const change = describeChange(entry);
            return (
              <div key={entry.id} className="flex gap-3">
                {/* Timeline rail */}
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "size-7 rounded-full flex items-center justify-center shrink-0",
                      entry.isSystem
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {entry.isSystem ? (
                      <Bot className="size-3.5" />
                    ) : (
                      <UserRound className="size-3.5" />
                    )}
                  </div>
                  {index < rows.length - 1 && (
                    <div className="w-px flex-1 bg-border/50 my-1" />
                  )}
                </div>

                <div className="flex-1 pb-5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {relativeTimestamp(entry.createdAt)}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] text-muted-foreground"
                    >
                      {entry.entityType.replace(/_/g, " ")}
                    </Badge>
                    {entry.isSystem && (
                      <Badge className="bg-muted/60 text-muted-foreground border-none text-[10px] rounded-sm">
                        System
                      </Badge>
                    )}
                    {entry.isHighImpact && (
                      <Badge
                        className={cn(
                          TONE_CLASS.warning,
                          "border-none text-[10px] rounded-sm",
                        )}
                      >
                        High impact
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-foreground mt-1">
                    <ActorChip name={entry.actorName} inline /> {entry.message}
                  </p>
                  {change && (
                    <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                      {change}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="flex flex-col items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </Button>
          {loadMoreError && (
            <p className="text-[11px] text-destructive">{loadMoreError}</p>
          )}
        </div>
      )}
    </Card>
  );
};

export default ActivityTab;
