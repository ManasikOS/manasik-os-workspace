"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  PermissionDenied,
  ProgressBar,
  ToneBadge,
} from "@/components/ui/tone-badge";

import { readinessTone } from "@/lib/data/reports";
import {
  buildCapacityRows,
  buildGroupProfitabilityRows,
  buildReadinessRows,
} from "@/lib/data/reports-groups";

import { useReports } from "../../reports-store";
import { formatCurrency, formatPercent } from "../../utils";

const RISK_LABELS: Record<string, string> = {
  READY: "On Track",
  AT_RISK: "At Risk",
  BLOCKED: "Blocked",
  NOT_STARTED: "Not Started",
};

const RISK_TONES: Record<string, "success" | "warning" | "danger" | "neutral"> =
  {
    READY: "success",
    AT_RISK: "warning",
    BLOCKED: "danger",
    NOT_STARTED: "neutral",
  };

export default function GroupsTab() {
  const { groups, nowIso, can } = useReports();
  const router = useRouter();

  if (!groups) return <PermissionDenied what="Departure Group reports" />;

  const readiness = buildReadinessRows(groups.groups, nowIso);
  const capacity = buildCapacityRows(groups.groups);
  const profitability = can.viewCostAndMargin
    ? buildGroupProfitabilityRows(groups.groups)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">
            Departure readiness
          </CardTitle>
        </CardHeader>
        {readiness.length === 0 ? (
          <EmptyState title="No active departure groups" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>Readiness</TableHead>
                <TableHead>Blockers</TableHead>
                <TableHead>Days to Departure</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {readiness.map((row) => (
                <TableRow
                  key={row.departureGroupId}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() =>
                    router.push(`/departure-groups/${row.departureGroupId}`)
                  }
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{row.groupName}</span>
                      <span className="text-xs text-muted-foreground">
                        {row.groupCode}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-32">
                    <div className="flex items-center gap-2">
                      <ProgressBar
                        percent={row.readinessPercent}
                        tone={readinessTone(row.readinessPercent)}
                        className="w-16"
                      />
                      <span className="text-xs tabular-nums tabular-nums">
                        {row.readinessPercent}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.blockerCount}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.daysToDeparture}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.operationsOwnerName ?? "Unassigned"}
                  </TableCell>
                  <TableCell>
                    <ToneBadge
                      tone={RISK_TONES[row.readinessStatus]}
                      label={RISK_LABELS[row.readinessStatus]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground px-5 pb-4">
          Overall readiness and blocker count only — a per-category breakdown
          (Docs / Visa / Payments / Flight / Hotel / Transport / Guide) is not
          yet available as a reporting fact.
        </p>
      </Card>

      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">
            Capacity and occupancy
          </CardTitle>
        </CardHeader>
        {capacity.length === 0 ? (
          <EmptyState title="No active departure groups" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Booked</TableHead>
                <TableHead>Held</TableHead>
                <TableHead>Waitlist</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Occupancy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {capacity.map((row) => (
                <TableRow key={row.departureGroupId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{row.groupName}</span>
                      <span className="text-xs text-muted-foreground">
                        {row.groupCode}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.capacity}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.bookedSeats}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.heldSeats}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.waitlistedCount}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.availableSeats}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {formatPercent(row.occupancyPercent, 1)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {can.viewCostAndMargin && (
        <Card className="p-0 overflow-hidden">
          <CardHeader className="px-5 pt-5">
            <CardTitle className="text-base font-medium">
              Group profitability
            </CardTitle>
          </CardHeader>
          {profitability.length === 0 ? (
            <EmptyState title="No active departure groups" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>Expected Revenue</TableHead>
                  <TableHead>Collected</TableHead>
                  <TableHead>Supplier Cost</TableHead>
                  <TableHead>Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profitability.map((row) => (
                  <TableRow key={row.departureGroupId}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{row.groupName}</span>
                        <span className="text-xs text-muted-foreground">
                          {row.groupCode}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums tabular-nums">
                      {formatCurrency(row.expectedRevenue)}
                    </TableCell>
                    <TableCell className="tabular-nums tabular-nums">
                      {formatCurrency(row.collectedAmount)}
                    </TableCell>
                    <TableCell className="tabular-nums tabular-nums">
                      {formatCurrency(row.supplierCost)}
                    </TableCell>
                    <TableCell className="tabular-nums tabular-nums">
                      {row.marginPercent === null
                        ? "—"
                        : formatPercent(row.marginPercent, 1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
