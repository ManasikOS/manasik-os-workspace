"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ProgressBar, ToneBadge } from "@/components/ui/tone-badge";
import { PlaneTakeoff } from "lucide-react";

import { buildGroupHealthRows, readinessTone } from "@/lib/data/reports";
import type { ReportGroupFact } from "@/lib/types/reports";

import { formatCurrency, formatShortDate } from "../../utils";

/**
 * The Overview tab's Group Health Summary. Clicking a row opens that
 * Departure Group (plan §Overview reports — "Clicking a row opens that
 * Departure Group").
 */
export function GroupHealthTable({ groups }: { groups: ReportGroupFact[] }) {
  const router = useRouter();
  const rows = buildGroupHealthRows(groups);

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<PlaneTakeoff className="size-8" />} title="No active departure groups" />
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead>Readiness</TableHead>
            <TableHead>Booked</TableHead>
            <TableHead>Revenue</TableHead>
            <TableHead>Departure</TableHead>
            <TableHead>Risk</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.departureGroupId}
              className="cursor-pointer hover:bg-muted/40"
              onClick={() => router.push(`/departure-groups/${row.departureGroupId}`)}
            >
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{row.groupName}</span>
                  <span className="text-xs text-muted-foreground">{row.groupCode}</span>
                </div>
              </TableCell>
              <TableCell className="min-w-32">
                <div className="flex items-center gap-2">
                  <ProgressBar percent={row.readinessPercent} tone={readinessTone(row.readinessPercent)} className="w-16" />
                  <span className="text-xs font-number tabular-nums">{row.readinessPercent}%</span>
                </div>
              </TableCell>
              <TableCell className="font-number tabular-nums">
                {row.bookedSeats}/{row.capacity}
              </TableCell>
              <TableCell className="font-number tabular-nums">{formatCurrency(row.revenue)}</TableCell>
              <TableCell className="text-muted-foreground">{formatShortDate(row.departureDate)}</TableCell>
              <TableCell>
                <ToneBadge tone={row.riskTone} label={row.riskLabel} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
