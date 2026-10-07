"use client";

import React, { useMemo, useState } from "react";
import { CalendarDays, Eye, Users } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import { Button } from "@/components/ui/button";
import { ToneBadge, ProgressBar, EmptyState } from "@/components/ui/tone-badge";
import { cn } from "@/lib/utils";
import type { DepartureGroupUsingPackage } from "@/lib/data/packages-repository";
import {
  GROUP_STATUS_LABELS,
  SALES_STATUS_LABELS,
  groupStatusTone,
  salesTone,
  formatShortDate,
  formatCurrency,
} from "@/app/(main)/departure-groups/utils";
import type {
  DepartureGroupStatus,
  GroupSalesStatus,
} from "@/app/(main)/departure-groups/types";

/**
 * Every group falls into exactly one bucket — `archived` wins over status,
 * and a terminal status wins over "still live" — so the filter pills below
 * always partition the list rather than letting a group double-count under
 * two tabs at once. See docs/modules/packages-production-readiness-plan.md, Phase
 * 3 item 4 (finding C10): previously this tab had no filter at all, mixing
 * groups that departed years ago with the ones actually selling right now.
 */
type GroupBucket = "live" | "completed" | "cancelled" | "archived";

function bucketFor(g: DepartureGroupUsingPackage): GroupBucket {
  if (g.archived) return "archived";
  if (g.groupStatus === "CANCELLED") return "cancelled";
  if (g.groupStatus === "COMPLETED" || g.groupStatus === "CLOSED")
    return "completed";
  return "live";
}

const FILTERS: { key: GroupBucket | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "archived", label: "Archived" },
];

export default function GroupsTab({
  groups,
}: {
  groups: DepartureGroupUsingPackage[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<GroupBucket | "all">("all");

  const counts = useMemo(() => {
    const tally: Record<GroupBucket, number> = {
      live: 0,
      completed: 0,
      cancelled: 0,
      archived: 0,
    };
    for (const g of groups) tally[bucketFor(g)]++;
    return tally;
  }, [groups]);

  const filtered = useMemo(
    () =>
      filter === "all" ? groups : groups.filter((g) => bucketFor(g) === filter),
    [groups, filter],
  );

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-6" />}
        title="No departure groups built from this package yet"
        description="Departure groups created from this template will appear here with their live seat counts and status."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map(({ key, label }) => {
          const count = key === "all" ? groups.length : counts[key];
          const selected = filter === key;
          return (
            <Button
              key={key}
              variant={selected ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={selected}
              onClick={() => setFilter(key)}
              className={cn(!selected && "text-muted-foreground")}
            >
              {label}
              <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </Button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No departure groups in this view.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((g) => {
            const status = g.groupStatus as DepartureGroupStatus;
            const sales = g.salesStatus as GroupSalesStatus;
            const filledPercent =
              g.capacity > 0
                ? Math.round((g.bookedSeats / g.capacity) * 100)
                : 0;
            return (
              <div
                key={g.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border/40 bg-card/50 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {g.groupName}
                    </p>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {g.groupCode}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                    <CalendarDays className="size-3" />{" "}
                    {formatShortDate(g.departureDate)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <ToneBadge
                    tone={groupStatusTone(status)}
                    label={GROUP_STATUS_LABELS[status] ?? g.groupStatus}
                  />
                  <ToneBadge
                    tone={salesTone(sales)}
                    label={SALES_STATUS_LABELS[sales] ?? g.salesStatus}
                  />
                </div>

                <div className="flex flex-col gap-1 w-32">
                  <span className="text-xs tabular-nums text-foreground">
                    {g.bookedSeats} / {g.capacity}
                  </span>
                  <ProgressBar
                    percent={filledPercent}
                    tone="brand"
                    className="h-1"
                  />
                </div>

                <div className="w-28 text-right">
                  <p className="text-xs tabular-nums text-foreground">
                    {formatCurrency(g.expectedRevenue)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">revenue</p>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push(`/departure-groups/${g.id}`)}
                >
                  <Eye className="size-3.5" /> Open
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
