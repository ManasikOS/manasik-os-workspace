import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";

import { computeExecutiveSummary, marginBelowTarget } from "@/lib/data/reports";
import { COLLECTION_RATE_TARGET_PERCENT, GROSS_MARGIN_TARGET_PERCENT } from "@/lib/data/reports-copy";
import type { ReportBookingFact, ReportGroupFact } from "@/lib/types/reports";

import { ComparisonDelta } from "../comparison-delta";
import { formatCurrency, formatExactCurrency, formatPercent } from "../../utils";

/**
 * The CEO-focused Executive Business Summary — six KPI tiles, each with a
 * comparison delta where one is meaningful (plan §Overview reports).
 */
export function ExecutiveSummary({
  bookingsCurrent,
  bookingsPrevious,
  groups,
  hasComparison,
  showMargin,
}: {
  bookingsCurrent: ReportBookingFact[];
  bookingsPrevious: ReportBookingFact[];
  groups: ReportGroupFact[];
  hasComparison: boolean;
  showMargin: boolean;
}) {
  const summary = computeExecutiveSummary(bookingsCurrent, bookingsPrevious, groups);

  return (
    <KpiRow>
      <KpiCard
        title="Revenue"
        value={Object.entries(summary.revenueByCurrency).map(([currency, amount]) => formatExactCurrency(amount, currency)).join(" · ") || formatCurrency(0)}
        desc={hasComparison ? <ComparisonDelta delta={summary.revenueDeltaPercent} /> : undefined}
      />
      <KpiCard
        title="Bookings"
        value={String(summary.bookingsCount)}
        desc={hasComparison ? <ComparisonDelta delta={summary.bookingsDeltaPercent} /> : undefined}
      />
      <KpiCard
        title="Pilgrims"
        value={String(summary.pilgrimsCount)}
        desc={`Across ${summary.activeGroupsCount} active group${summary.activeGroupsCount === 1 ? "" : "s"}`}
      />
      <KpiCard
        title="Collection Rate"
        value={summary.collectionRatePercent === null ? "—" : formatPercent(summary.collectionRatePercent)}
        desc={`Target: ${COLLECTION_RATE_TARGET_PERCENT}%`}
      />
      <KpiCard
        title="Average Group Readiness"
        value={formatPercent(summary.avgGroupReadinessPercent)}
        desc={
          summary.atRiskGroupCount > 0
            ? `${summary.atRiskGroupCount} group${summary.atRiskGroupCount === 1 ? "" : "s"} at risk`
            : "No groups at risk"
        }
      />
      {showMargin && (
        <KpiCard
          title="Projected Gross Margin"
          value={summary.projectedGrossMarginPercent === null ? "—" : formatPercent(summary.projectedGrossMarginPercent)}
          desc={
            marginBelowTarget(summary.projectedGrossMarginPercent)
              ? `Below ${GROSS_MARGIN_TARGET_PERCENT}% target`
              : `Target: ${GROSS_MARGIN_TARGET_PERCENT}%`
          }
        />
      )}
    </KpiRow>
  );
}
