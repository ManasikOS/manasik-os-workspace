"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { header } from "@/components/data-table/sortable-header";

import { PilgrimFlightStatusBadge } from "../../../components/status-badges";
import type { DepartureGroupManifestRow } from "../../../types";
import PilgrimTicketCell from "../pilgrim-ticket-cell";

export function buildFlightTicketingColumns({
  departureGroupId,
  canManage,
}: {
  departureGroupId: string;
  canManage: boolean;
}): ColumnDef<DepartureGroupManifestRow>[] {
  return [
    {
      id: "pilgrim",
      header: header("Pilgrim"),
      cell: ({ row }) => (
        <span className="font-medium text-foreground">
          {row.original.fullName}
        </span>
      ),
    },
    {
      id: "passport",
      header: header("Passport"),
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {row.original.passportNumber ?? "Restricted"}
        </span>
      ),
    },
    {
      id: "seatStatus",
      header: header("Seat Status"),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.seatStatus.charAt(0) +
            row.original.seatStatus.slice(1).toLowerCase()}
        </span>
      ),
    },
    {
      id: "ticketStatus",
      header: header("Ticket Status"),
      cell: ({ row }) => (
        <PilgrimFlightStatusBadge value={row.original.flightStatus} />
      ),
    },
    {
      id: "ticketFile",
      header: header("Ticket File"),
      cell: ({ row }) => (
        <PilgrimTicketCell
          departureGroupId={departureGroupId}
          row={row.original}
          canManage={canManage}
        />
      ),
    },
  ];
}
