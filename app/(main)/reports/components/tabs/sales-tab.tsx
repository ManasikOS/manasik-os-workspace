"use client";

import { ArrowDown } from "lucide-react";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, PermissionDenied } from "@/components/ui/tone-badge";

import {
  buildLeadFunnel,
  buildLeadSourcePerformance,
  buildLostLeadAnalysis,
  buildSalesTeamPerformance,
} from "@/lib/data/reports-sales";

import { useReports } from "../../reports-store";
import { formatCurrency, formatPercent } from "../../utils";

export default function SalesTab() {
  const { sales } = useReports();

  if (!sales) return <PermissionDenied what="Sales & Leads reports" />;

  const funnel = buildLeadFunnel(sales.leads);
  const sources = buildLeadSourcePerformance(sales.leads);
  const owners = buildSalesTeamPerformance(sales.leads);
  const lostReasons = buildLostLeadAnalysis(sales.leads);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="px-0 pt-0">
          <CardTitle className="text-base font-medium">Lead funnel</CardTitle>
        </CardHeader>
        {funnel.every((s) => s.count === 0) ? (
          <EmptyState title="No leads in this period" />
        ) : (
          <div className="flex flex-col">
            {funnel.map((stage, i) => (
              <div key={stage.stage} className="flex flex-col items-center">
                {i > 0 && (
                  <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                    <ArrowDown className="size-3.5" />
                    {stage.conversionFromPreviousPercent !== null && (
                      <span>
                        {formatPercent(stage.conversionFromPreviousPercent, 1)}{" "}
                        conversion
                      </span>
                    )}
                  </div>
                )}
                <div className="w-full flex items-center justify-between rounded-md border px-4 py-3">
                  <span className="text-sm font-medium">{stage.label}</span>
                  <span className="text-xl tabular-nums font-semibold tabular-nums">
                    {stage.count}
                  </span>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-3">
              Current pipeline stage only — average time-in-stage requires a
              stage-history table that does not exist yet.
            </p>
          </div>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">
            Lead source performance
          </CardTitle>
        </CardHeader>
        {sources.length === 0 ? (
          <EmptyState title="No leads in this period" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Bookings</TableHead>
                <TableHead>Conversion</TableHead>
                <TableHead>Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((row) => (
                <TableRow key={row.source}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.leadCount}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.bookingCount}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {formatPercent(row.conversionPercent)}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {formatCurrency(row.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">
            Sales team performance
          </CardTitle>
        </CardHeader>
        {owners.length === 0 ? (
          <EmptyState title="No leads in this period" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sales Owner</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Contact Rate</TableHead>
                <TableHead>Bookings</TableHead>
                <TableHead>Booking Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((row) => (
                <TableRow key={row.ownerName}>
                  <TableCell className="font-medium">{row.ownerName}</TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.leadCount}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {formatPercent(row.contactRatePercent)}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.bookingCount}
                  </TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {formatCurrency(row.bookingValue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">
            Lost-lead analysis
          </CardTitle>
        </CardHeader>
        {lostReasons.length === 0 ? (
          <EmptyState title="No lost leads in this period" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lost reason</TableHead>
                <TableHead>Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lostReasons.map((row) => (
                <TableRow key={row.reason}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="tabular-nums tabular-nums">
                    {row.count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
