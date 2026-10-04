"use client";

import { PermissionDenied } from "@/components/ui/tone-badge";

import { resolvePeriod } from "@/lib/data/reports-period";

import { useReports } from "../../reports-store";
import { ExecutiveSummary } from "../reports/executive-summary";
import { GroupHealthTable } from "../reports/group-health-table";
import { RevenueTrendChart } from "../reports/revenue-trend-chart";

export default function OverviewTab() {
  const { overview, filters, nowIso, can } = useReports();

  if (!overview) return <PermissionDenied what="The Overview report" />;

  const period = resolvePeriod(filters.period, filters.customFrom, filters.customTo, nowIso);

  return (
    <div className="flex flex-col gap-6">
      <ExecutiveSummary
        bookingsCurrent={overview.bookingsCurrent}
        bookingsPrevious={overview.bookingsPrevious}
        groups={overview.groups}
        hasComparison={filters.compare !== "NONE"}
        showMargin={can.viewCostAndMargin}
      />

      <RevenueTrendChart
        bookings={overview.bookingsCurrent}
        payments={overview.paymentsCurrent}
        groups={overview.groups}
        fromIso={period.fromIso}
        toIso={period.toIso}
      />

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground px-1">Group health summary</h3>
        <GroupHealthTable groups={overview.groups} />
      </div>
    </div>
  );
}
