"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plane, ShieldCheck } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { header, sortableHeader } from "@/components/data-table/sortable-header";
import type { DataTableSort } from "@/components/data-table/data-table";
import { PersonChip, ProgressBar, ToneBadge } from "@/components/ui/tone-badge";
import { percentTone } from "@/lib/ui/tone";

import type { PilgrimListItem } from "../types";
import {
  FLIGHT_STATUS_LABELS,
  JOURNEY_STATUS_LABELS,
  JOURNEY_STATUS_TONES,
  JOURNEY_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  ROOM_STATUS_LABELS,
  VISA_STATUS_LABELS,
  VISA_STATUS_TONES,
  daysRemainingLabel,
  formatExactLKR,
  readinessLabel,
  readinessTone,
  type PilgrimSort,
  type PilgrimSortField,
} from "../utils";

export interface PilgrimRowActions {
  onOpen: (item: PilgrimListItem) => void;
  onSendWhatsapp: (item: PilgrimListItem) => void;
  onSendPaymentReminder: (item: PilgrimListItem) => void;
}

export const PILGRIM_COLUMN_SORT_FIELDS: Record<string, PilgrimSortField> = {
  pilgrim: "fullName",
  departureGroup: "departureDate",
  documents: "documentPercent",
  payments: "outstandingBalance",
};

export function buildPilgrimColumns(
  sort: PilgrimSort,
  onSortChange: (sort: DataTableSort) => void,
  actions: PilgrimRowActions,
): ColumnDef<PilgrimListItem>[] {
  return [
    {
      id: "pilgrim",
      header: sortableHeader("Pilgrim", "fullName", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <PersonChip name={item.fullName} />
            <span className="text-[11px] text-muted-foreground pl-8">
              {item.reference} · {item.city || "—"}
            </span>
          </div>
        );
      },
    },
    {
      id: "departureGroup",
      header: sortableHeader("Departure Group", "departureDate", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{item.groupName}</span>
            <span className="text-[11px] text-muted-foreground">{daysRemainingLabel(item.daysToDeparture)}</span>
          </div>
        );
      },
    },
    {
      id: "booking",
      header: header("Booking / Family"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-foreground">{item.bookingReference}</span>
            <span className="text-[11px] text-muted-foreground">{item.primaryContactName}</span>
          </div>
        );
      },
    },
    {
      id: "journey",
      header: header("Journey"),
      cell: ({ row }) => (
        <ToneBadge tone="brand" label={JOURNEY_TYPE_LABELS[row.original.journeyType] ?? row.original.journeyType} />
      ),
    },
    {
      id: "documents",
      header: sortableHeader("Documents", "documentPercent", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-1.5 min-w-28">
            <span className="text-xs text-foreground">
              {item.documentsCompleted} / {item.documentsRequired} Documents
            </span>
            <ProgressBar percent={item.documentPercent} tone={percentTone(item.documentPercent)} className="w-24" />
          </div>
        );
      },
    },
    {
      id: "visa",
      header: header("Visa"),
      cell: ({ row }) => (
        <ToneBadge tone={VISA_STATUS_TONES[row.original.visaStatus] ?? "neutral"} label={VISA_STATUS_LABELS[row.original.visaStatus] ?? row.original.visaStatus} />
      ),
    },
    {
      id: "payments",
      header: sortableHeader("Payments", "outstandingBalance", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        if (item.outstandingBalance <= 0) {
          return <ToneBadge tone="success" label="Paid" />;
        }
        return (
          <div className="flex flex-col gap-0.5">
            <ToneBadge tone={PAYMENT_STATUS_TONES[item.paymentStatus] ?? "warning"} label={PAYMENT_STATUS_LABELS[item.paymentStatus] ?? item.paymentStatus} />
            <span className="text-[11px] text-muted-foreground">{formatExactLKR(item.outstandingBalance)} due</span>
          </div>
        );
      },
    },
    {
      id: "readiness",
      header: header("Readiness"),
      cell: ({ row }) => <ToneBadge tone={readinessTone(row.original.readiness)} label={readinessLabel(row.original.readiness)} />,
    },
    {
      id: "roomFlight",
      header: header("Room / Seat"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5" /> {ROOM_STATUS_LABELS[item.roomAssignmentStatus] ?? item.roomAssignmentStatus}
            </span>
            <span className="inline-flex items-center gap-1">
              <Plane className="size-3.5" /> {FLIGHT_STATUS_LABELS[item.flightStatus] ?? item.flightStatus}
            </span>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => actions.onOpen(item)}>View profile</DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onSendWhatsapp(item)}>Send WhatsApp</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => actions.onSendPaymentReminder(item)}>
                Send payment reminder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}

export const JOURNEY_STATUS_COLUMN_LABELS = JOURNEY_STATUS_LABELS;
export const JOURNEY_STATUS_COLUMN_TONES = JOURNEY_STATUS_TONES;
