"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useDeferredValue, useMemo, useState } from "react";

import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { header } from "@/components/data-table/sortable-header";
import { ToneBadge } from "@/components/ui/tone-badge";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";
import { TriangleAlert } from "lucide-react";

import { supplierStatusTone } from "@/lib/data/operations";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import { useOperations } from "../../operations-store";
import type { OperationsTransportItem } from "../../types";
import { TRANSPORT_QUEUE_VIEWS, filterTransportQueue } from "../../transport-queue";
import { SUPPLIER_STATUS_LABELS, daysRemainingLabel, formatDateTime } from "../../utils";

const VIEW_LABELS = TRANSPORT_QUEUE_VIEWS.map((entry) => entry.label);

/** Real transport operations across every live group — pickup risk,
 *  capacity mismatches and missing driver contacts, all in one queue. */
const TransportTab = () => {
  const router = useRouter();
  const { snapshot } = useOperations();
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput);

  const [viewLabel, setViewLabel] = useState<(typeof VIEW_LABELS)[number]>("All Routes");
  const view = TRANSPORT_QUEUE_VIEWS.find((entry) => entry.label === viewLabel)?.id ?? "ALL";

  const filtered = useMemo(
    () => filterTransportQueue(snapshot.transports, { view, search }),
    [snapshot.transports, view, search],
  );

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (b.warnings.length - a.warnings.length) || (a.daysUntilDeparture - b.daysUntilDeparture)),
    [filtered],
  );

  const columns: ColumnDef<OperationsTransportItem>[] = [
    {
      id: "group",
      header: header("Group"),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{row.original.groupName}</span>
          <span className="text-[11px] text-muted-foreground">{daysRemainingLabel(row.original.daysUntilDeparture)}</span>
        </div>
      ),
    },
    {
      id: "route",
      header: header("Route"),
      cell: ({ row }) => <span className="text-sm text-foreground">{row.original.routeLabel}</span>,
    },
    {
      id: "supplier",
      header: header("Supplier"),
      cell: ({ row }) => <span className="text-sm text-foreground">{row.original.supplierName ?? "—"}</span>,
    },
    {
      id: "vehicle",
      header: header("Vehicle"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground font-number">
          {row.original.vehicleCapacity ?? "—"} seats / {row.original.passengerCount ?? "—"} pax
        </span>
      ),
    },
    {
      id: "pickup",
      header: header("Pickup Date / Time"),
      cell: ({ row }) => <span className="text-sm text-foreground">{formatDateTime(row.original.pickupAt)}</span>,
    },
    {
      id: "driver",
      header: header("Driver"),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">{row.original.driverName ?? "—"}</span>
          <span className="text-[11px] text-muted-foreground font-number">{row.original.driverPhone ?? "No contact"}</span>
        </div>
      ),
    },
    {
      id: "status",
      header: header("Status"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-1">
            <ToneBadge tone={supplierStatusTone(item.status)} label={SUPPLIER_STATUS_LABELS[item.status] ?? item.status} />
            {item.warnings.map((w, i) => (
              <span key={i} className={cn("flex items-start gap-1 text-[11px]", TONE_TEXT.warning)}>
                <TriangleAlert className="size-3 shrink-0 mt-0.5" /> {w}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/departure-groups/${row.original.groupId}?tab=transport`);
          }}
        >
          Open
        </Button>
      ),
      enableSorting: false,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SavedViewBar views={VIEW_LABELS} active={viewLabel} onChange={setViewLabel} />
      <DataTable
        columns={columns}
        data={sorted}
        search={search}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search group, route, supplier…"
        resetPageToken={`${view}-${search}`}
        emptyMessage="No transport routes match this view."
      />
    </div>
  );
};

export default TransportTab;
