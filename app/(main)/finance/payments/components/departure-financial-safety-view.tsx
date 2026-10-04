"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table/data-table";
import { header } from "@/components/data-table/sortable-header";
import { Button } from "@/components/ui/button";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import type { DepartureFinancialSafetyResult, DepartureFinancialSafetyStatus } from "@/lib/finance/departure-financial-safety";
import type { Tone } from "@/lib/ui/tone";

import { formatDate, formatExactCurrency } from "../utils";

const STATUS_TONE: Record<DepartureFinancialSafetyStatus, Tone> = {
  HEALTHY: "success",
  ATTENTION: "warning",
  CRITICAL: "danger",
  INSUFFICIENT_DATA: "neutral",
};

const STATUS_LABEL: Record<DepartureFinancialSafetyStatus, string> = {
  HEALTHY: "Healthy",
  ATTENTION: "Needs attention",
  CRITICAL: "Critical",
  INSUFFICIENT_DATA: "Data incomplete",
};

const STATUS_ORDER: Record<DepartureFinancialSafetyStatus, number> = {
  CRITICAL: 0,
  INSUFFICIENT_DATA: 1,
  ATTENTION: 2,
  HEALTHY: 3,
};

function primarySafetyAction(result: DepartureFinancialSafetyResult) {
  if (result.status === "INSUFFICIENT_DATA") return result.sources[0];
  if (result.reasonCodes.includes("PAYABLE_CASH_GAP")) return result.sources[2];
  if (result.reasonCodes.includes("COLLECTION_OUTSTANDING")) return result.sources[1];
  return result.sources[3];
}

function collectionCoverageCopy(result: DepartureFinancialSafetyResult): React.ReactNode {
  if (!result.collectionCoverage || !result.currency) return "Not calculated";
  const { booked, collected, outstanding, percent } = result.collectionCoverage;
  return (
    <div className="space-y-0.5">
      <p className="font-number text-sm text-foreground">{percent === null ? "No booked revenue" : `${Math.round(percent)}% collected`}</p>
      <p className="text-[11px] text-muted-foreground">
        {formatExactCurrency(collected, result.currency)} of {formatExactCurrency(booked, result.currency)} · {formatExactCurrency(outstanding, result.currency)} outstanding
      </p>
    </div>
  );
}

function cashGapCopy(result: DepartureFinancialSafetyResult): React.ReactNode {
  if (!result.payableTiming || !result.cashGap || !result.currency) return "Needs source review";
  return (
    <div className="space-y-0.5">
      <p className="font-number text-sm text-foreground">
        {result.cashGap.amount > 0 ? `${formatExactCurrency(result.cashGap.amount, result.currency)} gap` : "Covered before departure"}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {formatExactCurrency(result.payableTiming.dueBeforeDeparture, result.currency)} supplier obligations due before departure
      </p>
    </div>
  );
}

function marginCopy(result: DepartureFinancialSafetyResult): React.ReactNode {
  if (!result.margin || !result.currency) return "Not calculated";
  return (
    <div className="space-y-0.5">
      <p className="font-number text-sm text-foreground">{formatExactCurrency(result.margin.estimatedGrossMargin, result.currency)}</p>
      <p className="text-[11px] text-muted-foreground">
        {result.margin.breakEvenHeadcount === null
          ? "Break-even is not defined"
          : `Break-even: ${result.margin.breakEvenHeadcount} guests · ${result.margin.confirmedPax} confirmed`}
      </p>
    </div>
  );
}

function financialSafetyColumns(): ColumnDef<DepartureFinancialSafetyResult>[] {
  return [
    {
      id: "departure",
      header: header("Departure"),
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">{row.original.groupName}</p>
          <p className="text-[11px] text-muted-foreground">{row.original.groupCode} · {formatDate(row.original.departureDate)}</p>
        </div>
      ),
    },
    {
      id: "status",
      header: header("Safety status"),
      cell: ({ row }) => (
        <div className="space-y-1">
          <ToneBadge tone={STATUS_TONE[row.original.status]} label={STATUS_LABEL[row.original.status]} />
          <p className="max-w-64 text-[11px] text-muted-foreground">{row.original.explanations[0]?.message ?? "Financial sources are in balance."}</p>
        </div>
      ),
    },
    { id: "collections", header: header("Collection coverage"), cell: ({ row }) => collectionCoverageCopy(row.original) },
    { id: "cashGap", header: header("Pre-departure supplier cover"), cell: ({ row }) => cashGapCopy(row.original) },
    { id: "margin", header: header("Margin and break-even"), cell: ({ row }) => marginCopy(row.original) },
    {
      id: "action",
      header: header("Next action"),
      cell: ({ row }) => {
        const action = primarySafetyAction(row.original);
        return <Button size="sm" variant="outline" nativeButton={false} render={<Link href={action.href} />}>{action.label}</Button>;
      },
    },
  ];
}

/** Finance-only, source-linked table of Task 10's per-departure safety results. */
export default function DepartureFinancialSafetyView({ results }: { results: DepartureFinancialSafetyResult[] }) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const columns = useMemo(() => financialSafetyColumns(), []);
  const rows = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    return results
      .filter((result) => !needle || [result.groupName, result.groupCode, STATUS_LABEL[result.status]].join(" ").toLowerCase().includes(needle))
      .toSorted((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.departureDate.localeCompare(right.departureDate));
  }, [deferredSearch, results]);

  if (results.length === 0) {
    return <EmptyState title="No active departures to review" description="Departure safety appears here once an active departure has Finance source data." />;
  }

  return (
    <DataTable
      columns={columns}
      data={rows}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search departure name, code, or safety status…"
      emptyMessage="No departure safety results match this search."
      getRowId={(result) => result.departureGroupId}
      resetPageToken={deferredSearch}
    />
  );
}
