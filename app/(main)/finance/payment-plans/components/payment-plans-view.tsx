"use client";

import { useMemo, useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { ToneBadge } from "@/components/ui/tone-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { CalendarClock, History } from "lucide-react";

import { EmptyState } from "@/app/(main)/departure-groups/components/status-badges";
import {
  formatDate,
  formatExactCurrency,
} from "@/app/(main)/finance/payments/utils";
import {
  derivePlanStatus,
  isRescheduledPlan,
  PAYMENT_PLAN_STATUS_LABEL,
  PAYMENT_PLAN_STATUS_TONE,
} from "@/lib/data/finance";
import { computeCollectionRisk } from "@/lib/finance/collection-risk";
import type { FinanceCapabilities } from "@/lib/access/finance-access";
import type {
  FinanceMilestoneRow,
  PaymentPlanStatus,
} from "@/lib/types/finance";

import CollectionRiskBadge from "./collection-risk-badge";
import RescheduleMilestoneDialog from "./reschedule-milestone-dialog";

type FilterId = "ALL" | PaymentPlanStatus | "EXCEPTIONS";

const FILTERS: FilterId[] = [
  "ALL",
  "OVERDUE",
  "DUE_TODAY",
  "DUE_THIS_WEEK",
  "UPCOMING",
  "COMPLETED",
  "WAIVED",
  "EXCEPTIONS",
];

const FILTER_LABELS: Record<FilterId, string> = {
  ALL: "All",
  OVERDUE: "Overdue",
  DUE_TODAY: "Due Today",
  DUE_THIS_WEEK: "Due This Week",
  UPCOMING: "Upcoming",
  COMPLETED: "Completed",
  WAIVED: "Waived",
  CANCELLED: "Cancelled",
  NO_DUE_DATE: "No Due Date",
  EXCEPTIONS: "Rescheduled",
};

interface PaymentPlansViewProps {
  milestones: FinanceMilestoneRow[];
  can: FinanceCapabilities;
  nowIso: string;
}

export default function PaymentPlansView({
  milestones,
  can,
  nowIso,
}: PaymentPlansViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterId>("ALL");
  const [rescheduling, setRescheduling] = useState<FinanceMilestoneRow | null>(
    null,
  );

  const rows = useMemo(
    () =>
      milestones.map((m) => ({
        milestone: m,
        status: derivePlanStatus(m, nowIso),
        rescheduled: isRescheduledPlan(m),
      })),
    [milestones, nowIso],
  );

  // One score per booking, computed live from the milestones already loaded
  // — see `lib/finance/collection-risk.ts`'s header comment for why this
  // page doesn't read the nightly-materialised `booking_collection_risk`
  // table instead.
  const riskByBooking = useMemo(() => {
    const byBooking = new Map<string, FinanceMilestoneRow[]>();
    for (const m of milestones) {
      const list = byBooking.get(m.booking_id) ?? [];
      list.push(m);
      byBooking.set(m.booking_id, list);
    }
    const risks = new Map<string, ReturnType<typeof computeCollectionRisk>>();
    for (const [bookingId, group] of byBooking) {
      risks.set(
        bookingId,
        computeCollectionRisk(
          group.map((m) => ({
            amount: m.amount,
            paidAmount: m.paid_amount,
            dueAt: m.due_at,
            waived: m.waived,
            rescheduled: isRescheduledPlan(m),
          })),
          nowIso,
        ),
      );
    }
    return risks;
  }, [milestones, nowIso]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter(({ milestone, status, rescheduled }) => {
      if (filter === "EXCEPTIONS" && !rescheduled) return false;
      if (filter !== "ALL" && filter !== "EXCEPTIONS" && status !== filter)
        return false;
      if (!needle) return true;
      return [
        milestone.booking_reference,
        milestone.primary_contact_name,
        milestone.label,
        milestone.group_name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, search, filter]);

  const overdueCount = rows.filter((r) => r.status === "OVERDUE").length;
  const dueThisWeekCount = rows.filter(
    (r) => r.status === "DUE_TODAY" || r.status === "DUE_THIS_WEEK",
  ).length;
  const overdueAmount = can.viewReceivables
    ? rows
        .filter((r) => r.status === "OVERDUE")
        .reduce(
          (sum, r) => sum + (r.milestone.amount - r.milestone.paid_amount),
          0,
        )
    : 0;
  const exceptionsCount = rows.filter((r) => r.rescheduled).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Overdue" value={String(overdueCount)} />
        <KpiCard title="Due this week" value={String(dueThisWeekCount)} />
        {can.viewReceivables && (
          <KpiCard
            title="Overdue amount"
            value={formatExactCurrency(overdueAmount)}
          />
        )}
        <KpiCard title="Rescheduled" value={String(exceptionsCount)} />
      </div>

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as FilterId)}
      >
        <TabsList>
          {FILTERS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {FILTER_LABELS[id]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTableSurface
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search reference, contact, or group…"
        rowCount={filtered.length}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-8" />}
            title="No instalments found"
            description="Try a different search or filter."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {[
                  "Booking",
                  "Group",
                  "Instalment",
                  ...(can.viewReceivables ? ["Amount", "Paid"] : []),
                  "Due",
                  "Status",
                  ...(can.viewReceivables ? ["Risk"] : []),
                  "",
                ].map((label) => (
                  <TableHead
                    key={label}
                    className="h-9 px-3 text-xs font-medium text-muted-foreground"
                  >
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {filtered.map(({ milestone: m, status, rescheduled }) => (
                <TableRow
                  key={m.id}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() =>
                    router.push(
                      `/departure-groups/${m.departure_group_id}/bookings/${m.booking_id}`,
                    )
                  }
                >
                  <TableCell className="px-3 py-3">
                    <p className="text-sm text-foreground">
                      {m.booking_reference}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {m.primary_contact_name}
                    </p>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    {m.group_name}{" "}
                    <span className="text-muted-foreground">
                      · {m.group_code}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm text-foreground">
                    {m.label}
                    {rescheduled && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <History className="size-3" /> rescheduled
                      </span>
                    )}
                  </TableCell>
                  {can.viewReceivables && (
                    <>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {formatExactCurrency(m.amount, m.currency)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-sm text-muted-foreground">
                        {formatExactCurrency(m.paid_amount, m.currency)}
                      </TableCell>
                    </>
                  )}
                  <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                    {m.due_at ? formatDate(m.due_at) : "—"}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <ToneBadge
                      tone={PAYMENT_PLAN_STATUS_TONE[status]}
                      label={PAYMENT_PLAN_STATUS_LABEL[status]}
                    />
                  </TableCell>
                  {can.viewReceivables && (
                    <TableCell
                      className="px-3 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const risk = riskByBooking.get(m.booking_id);
                        if (!risk) return null;
                        return (
                          <CollectionRiskBadge
                            bookingId={m.booking_id}
                            band={risk.band}
                            score={risk.score}
                          />
                        );
                      })()}
                    </TableCell>
                  )}
                  <TableCell className="px-3 py-3">
                    {can.changeMilestoneDueDates &&
                      status !== "COMPLETED" &&
                      status !== "CANCELLED" && (
                        <button
                          type="button"
                          className="text-xs text-primary underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRescheduling(m);
                          }}
                        >
                          Change due date
                        </button>
                      )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableSurface>

      <RescheduleMilestoneDialog
        milestone={rescheduling}
        onClose={() => setRescheduling(null)}
      />
    </div>
  );
}
