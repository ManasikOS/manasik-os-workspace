"use client";

import { DataTable, type DataTableSort } from "@/components/data-table/data-table";
import { FilterSelect, type FilterOption } from "@/components/data-table/filter-select";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, X } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useDeferredValue, useMemo, useState } from "react";

import { MILESTONE_TYPE_LABELS, FINANCE_SAVED_VIEWS } from "@/lib/data/finance-copy";
import type { FinanceReceivableRow } from "@/lib/types/finance";

import { useFinance } from "../../finance-store";
import { buildReceivableColumns } from "../../finance-table/receivables-columns";
import {
  activeFilterCount,
  applyFinanceSavedView,
  EMPTY_FINANCE_FILTERS,
  matchesFinanceFilters,
  matchesFinanceSearch,
  type FinanceFilters,
} from "../../utils";
import RecordPaymentDialog from "../record-payment-dialog";

const ReceivableTypeOptions: FilterOption[] = Object.entries(MILESTONE_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export default function ReceivablesTab() {
  const { snapshot, currentStaffName, can } = useFinance();
  const router = useRouter();

  const [view, setView] = useState<(typeof FINANCE_SAVED_VIEWS)[number]>("All Receivables");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filters, setFilters] = useState<FinanceFilters>(EMPTY_FINANCE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<DataTableSort>({ field: "next_milestone_due_at", direction: "asc" });
  const [paymentTarget, setPaymentTarget] = useState<FinanceReceivableRow | null>(null);

  const groupOptions: FilterOption[] = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of snapshot.receivables) seen.set(r.departure_group_id, r.group_name);
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [snapshot.receivables]);

  const ownerOptions: FilterOption[] = useMemo(() => {
    const seen = new Set<string>();
    for (const r of snapshot.receivables) if (r.finance_owner_name) seen.add(r.finance_owner_name);
    return Array.from(seen).map((v) => ({ value: v, label: v }));
  }, [snapshot.receivables]);

  const branchOptions: FilterOption[] = useMemo(() => {
    const seen = new Set<string>();
    for (const r of snapshot.receivables) if (r.branch) seen.add(r.branch);
    return Array.from(seen).map((v) => ({ value: v, label: v }));
  }, [snapshot.receivables]);

  const rows = useMemo(() => {
    let result = applyFinanceSavedView(snapshot.receivables, view, snapshot.nowIso, currentStaffName);
    result = result.filter((r) => matchesFinanceSearch(r, deferredSearch));
    result = result.filter((r) => matchesFinanceFilters(r, filters, snapshot.nowIso));

    return [...result].sort((a, b) => {
      const field = sort.field as keyof FinanceReceivableRow;
      const av = a[field];
      const bv = b[field];
      let cmp = 0;
      if (av === null && bv === null) cmp = 0;
      else if (av === null) cmp = 1;
      else if (bv === null) cmp = -1;
      else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [snapshot.receivables, snapshot.nowIso, view, deferredSearch, filters, sort, currentStaffName]);

  const columns = useMemo(
    () =>
      buildReceivableColumns(
        {
          onRecordPayment: (row) => setPaymentTarget(row),
          onSendReminder: (row) =>
            router.push(`/departure-groups/${row.departure_group_id}?tab=payments`),
          onOpenBooking: (row) => router.push(`/departure-groups/${row.departure_group_id}?tab=payments`),
        },
        snapshot.nowIso,
        can.recordPayments,
        can.sendReminders,
        !can.viewPaymentStatusOnly,
        sort,
        setSort,
      ),
    [snapshot.nowIso, can.recordPayments, can.sendReminders, can.viewPaymentStatusOnly, sort, router],
  );

  return (
    <div className="flex flex-col gap-4">
      <SavedViewBar views={FINANCE_SAVED_VIEWS} active={view} onChange={setView} />

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Departure Group"
          value={filters.departureGroupId}
          options={groupOptions}
          onChange={(v) => setFilters((f) => ({ ...f, departureGroupId: v }))}
        />
        <FilterSelect
          label="Milestone Type"
          value={filters.milestoneType}
          options={ReceivableTypeOptions}
          onChange={(v) => setFilters((f) => ({ ...f, milestoneType: v }))}
        />
        <FilterSelect
          label="Finance Owner"
          value={filters.financeOwner}
          options={ownerOptions}
          onChange={(v) => setFilters((f) => ({ ...f, financeOwner: v }))}
        />
        {filtersOpen && (
          <FilterSelect
            label="Branch"
            value={filters.branch}
            options={branchOptions}
            onChange={(v) => setFilters((f) => ({ ...f, branch: v }))}
          />
        )}
        <Button variant="outline_without_border" size="sm" onClick={() => setFiltersOpen((o) => !o)}>
          <SlidersHorizontal /> More Filters
        </Button>
        {activeFilterCount(filters) > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FINANCE_FILTERS)}>
            <X /> Clear filters
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search customer, booking ID, pilgrim, invoice number..."
        emptyMessage="No receivables match this view."
        resetPageToken={`${view}-${deferredSearch}-${JSON.stringify(filters)}`}
        sort={sort}
        sortFieldByColumnId={{ customer: "primary_contact_name", totalValue: "total_booking_value", balance: "outstanding_balance" }}
      />

      {can.recordPayments && (
        <RecordPaymentDialog
          booking={
            paymentTarget
              ? {
                  id: paymentTarget.booking_id,
                  bookingReference: paymentTarget.booking_reference,
                  primaryContactName: paymentTarget.primary_contact_name,
                  departureGroupId: paymentTarget.departure_group_id,
                  outstandingBalance: paymentTarget.outstanding_balance,
                  currency: paymentTarget.currency,
                }
              : null
          }
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </div>
  );
}
