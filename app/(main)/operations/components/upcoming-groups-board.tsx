"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ProgressBar, ToneBadge } from "@/components/ui/tone-badge";
import { percentTone } from "@/lib/ui/tone";

import { readinessStatusTone, supplierStatusTone } from "@/lib/data/operations";
import type { OperationsGroupSummary } from "../types";
import { daysRemainingLabel } from "../utils";

const STATUS_LABELS: Record<string, string> = {
  READY: "Ready",
  AT_RISK: "At Risk",
  BLOCKED: "Blocked",
  NOT_STARTED: "Not Started",
};

const GROUP_STATUS_LABELS: Record<string, string> = {
  PLANNING: "Planning",
  PREPARING: "Preparing",
  READY_TO_DEPART: "Ready to Depart",
};

function toneLabel(status: string): string {
  return status === "CONFIRMED" ||
    status === "COMPLETED" ||
    status === "TICKETED"
    ? status.charAt(0) + status.slice(1).toLowerCase()
    : status
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase());
}

interface UpcomingGroupsBoardProps {
  groups: OperationsGroupSummary[];
  limit?: number;
  onSeeAll?: () => void;
}

/** Compact cards, sorted by departure date — the Overview tab's mission
 *  control board. Deeper than the Dashboard's upcoming-departures widget:
 *  every line is a live status, not a summary sentence. */
const UpcomingGroupsBoard = ({
  groups,
  limit,
  onSeeAll,
}: UpcomingGroupsBoardProps) => {
  const router = useRouter();
  const shown = limit ? groups.slice(0, limit) : groups;

  if (groups.length === 0) {
    return (
      <EmptyState
        title="No active groups"
        description="Nothing is currently in Planning, Preparing or Ready to Depart."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-1 xl:grid-cols-1 gap-4">
        {shown.map((g) => (
          <Card key={g.id} className="gap-3">
            <div>
              <p className="text-lg font-semibold text-foreground">
                {g.groupName}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {daysRemainingLabel(g.daysUntilDeparture)} · {g.pilgrimCount} /{" "}
                {g.capacity} pilgrims
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {GROUP_STATUS_LABELS[g.groupStatus] ?? g.groupStatus}
              </Badge>
              <span className="text-xs text-muted-foreground">Readiness</span>
              <span className="text-xs font-medium tabular-nums text-foreground">
                {g.readinessScore}%
              </span>
            </div>
            <ProgressBar
              percent={g.readinessScore}
              tone={percentTone(g.readinessScore)}
              className="mt-1"
            />

            <div className="flex flex-col gap-4">
              {g.serviceLines.slice(0, 3).map((line) => (
                <div
                  key={line.label}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">{line.label}</span>
                  <ToneBadge
                    tone={supplierStatusTone(line.status)}
                    label={toneLabel(line.status)}
                    className="px-2 py-1 text-xs"
                  />
                </div>
              ))}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Documents</span>
                <ToneBadge
                  tone={g.documentsMissingCount === 0 ? "success" : "warning"}
                  label={
                    g.documentsMissingCount === 0
                      ? "On track"
                      : `${g.documentsMissingCount} missing`
                  }
                  className="px-2 py-1 text-xs"
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Visa</span>
                <ToneBadge
                  tone={g.visaPendingCount === 0 ? "success" : "warning"}
                  label={
                    g.visaPendingCount === 0
                      ? "On track"
                      : `${g.visaPendingCount} pending`
                  }
                  className="px-2 py-1 text-xs"
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Payments</span>
                <ToneBadge
                  tone={g.paymentsOverdueCount === 0 ? "success" : "warning"}
                  label={
                    g.paymentsOverdueCount === 0
                      ? "On track"
                      : `${g.paymentsOverdueCount} overdue`
                  }
                  className="px-2 py-1 text-xs"
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Guide</span>
                <ToneBadge
                  tone={g.primaryGuideName ? "success" : "danger"}
                  label={g.primaryGuideName ? "Assigned" : "Unassigned"}
                  className="px-2 py-1 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <ToneBadge
                tone={readinessStatusTone(g.readinessStatus)}
                label={STATUS_LABELS[g.readinessStatus] ?? g.readinessStatus}
              />
              <Button
                variant="outline_without_border"
                size="sm"
                onClick={() => router.push(`/departure-groups/${g.id}`)}
              >
                Open Group
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {onSeeAll && limit && groups.length > limit && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          onClick={onSeeAll}
        >
          Show all {groups.length} groups →
        </Button>
      )}
    </div>
  );
};

export default UpcomingGroupsBoard;
