"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useDeferredValue, useMemo, useState } from "react";

import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { header } from "@/components/data-table/sortable-header";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";
import { ToneBadge } from "@/components/ui/tone-badge";

import { useOperations } from "../../operations-store";
import type { FlightRiskState, OperationsFlightItem } from "../../types";
import { daysRemainingLabel, formatDateTime } from "../../utils";

const RISK_TONE: Record<
  FlightRiskState,
  "success" | "warning" | "danger" | "info"
> = {
  OK: "success",
  AT_RISK: "warning",
  OVERDUE: "danger",
  NAME_MISMATCH: "danger",
  SEATS_SHORT: "warning",
};

const RISK_LABEL: Record<FlightRiskState, string> = {
  OK: "OK",
  AT_RISK: "Ticketing Deadline Risk",
  OVERDUE: "Overdue",
  NAME_MISMATCH: "Name Mismatch",
  SEATS_SHORT: "Seats Short",
};

const VIEW_LABELS = [
  "All Flights",
  "Flights Confirmed",
  "Ticketing Deadline Risk",
  "Overdue",
  "Passenger Name Mismatch",
  "Seats Short",
] as const;
type ViewLabel = (typeof VIEW_LABELS)[number];

const VIEW_TO_STATE: Record<ViewLabel, "ALL" | FlightRiskState> = {
  "All Flights": "ALL",
  "Flights Confirmed": "OK",
  "Ticketing Deadline Risk": "AT_RISK",
  Overdue: "OVERDUE",
  "Passenger Name Mismatch": "NAME_MISMATCH",
  "Seats Short": "SEATS_SHORT",
};

/**
 * The cross-group flight risk queue. Route detail and transit legs stay on
 * the Departure Group's own Flights tab — this view is exception-only.
 */
const FlightsTab = () => {
  const router = useRouter();
  const { snapshot } = useOperations();
  const [viewLabel, setViewLabel] = useState<ViewLabel>("All Flights");
  const view = VIEW_TO_STATE[viewLabel];
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput);

  const filtered = useMemo(() => {
    const byView =
      view === "ALL"
        ? snapshot.flights
        : snapshot.flights.filter((f) => f.riskState === view);
    if (!search.trim()) return byView;
    const q = search.trim().toLowerCase();
    return byView.filter(
      (f) =>
        f.groupName.toLowerCase().includes(q) ||
        f.airline.toLowerCase().includes(q) ||
        (f.pnr ?? "").toLowerCase().includes(q) ||
        (f.flightNumber ?? "").toLowerCase().includes(q),
    );
  }, [snapshot.flights, view, search]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture),
    [filtered],
  );

  const columns: ColumnDef<OperationsFlightItem>[] = [
    {
      id: "group",
      header: header("Departure Group"),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            {row.original.groupName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {daysRemainingLabel(row.original.daysUntilDeparture)}
          </span>
        </div>
      ),
    },
    {
      id: "route",
      header: header("Route"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground tabular-nums">
          {row.original.originAirportCode} →{" "}
          {row.original.destinationAirportCode}
        </span>
      ),
    },
    {
      id: "airline",
      header: header("Airline"),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">
            {row.original.airline}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {row.original.flightNumber ?? "—"}
          </span>
        </div>
      ),
    },
    {
      id: "pnr",
      header: header("PNR"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground tabular-nums">
          {row.original.pnr ?? "—"}
        </span>
      ),
    },
    {
      id: "seats",
      header: header("Seats Held / Ticketed"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground tabular-nums">
          {row.original.seatsHeld} held / {row.original.seatsTicketed} ticketed
        </span>
      ),
    },
    {
      id: "deadline",
      header: header("Ticketing Deadline"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {formatDateTime(row.original.ticketingDeadline)}
        </span>
      ),
    },
    {
      id: "status",
      header: header("Status"),
      cell: ({ row }) => (
        <ToneBadge
          tone={RISK_TONE[row.original.riskState]}
          label={RISK_LABEL[row.original.riskState]}
        />
      ),
    },
    {
      id: "issue",
      header: header("Issue"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground max-w-56 block">
          {row.original.issueLabel ?? "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/flights-tickets/${row.original.id}`);
            }}
          >
            Manifest
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              router.push(
                `/departure-groups/${row.original.groupId}?tab=flights`,
              );
            }}
          >
            Open Flight
          </Button>
        </div>
      ),
      enableSorting: false,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SavedViewBar
        views={VIEW_LABELS}
        active={viewLabel}
        onChange={setViewLabel}
      />
      <DataTable
        columns={columns}
        data={sorted}
        search={search}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search group, airline, PNR, flight number…"
        resetPageToken={`${view}-${search}`}
        emptyMessage="No flights match this view."
      />
    </div>
  );
};

export default FlightsTab;
