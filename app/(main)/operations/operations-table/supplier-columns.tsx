"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { header } from "@/components/data-table/sortable-header";
import { PersonChip, ToneBadge } from "@/components/ui/tone-badge";

import { supplierStatusTone } from "@/lib/data/operations";
import { SERVICE_KIND_LABELS } from "@/lib/data/operations-copy";
import type { OperationsSupplierRow } from "../types";
import { SUPPLIER_STATUS_LABELS, daysRemainingLabel, formatDate } from "../utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

export interface SupplierRowActions {
  onOpen: (row: OperationsSupplierRow) => void;
  onRecordDetails: (row: OperationsSupplierRow) => void;
  onConfirm: (row: OperationsSupplierRow) => void;
  onOpenGroup: (row: OperationsSupplierRow) => void;
}

export function buildSupplierColumns(actions: SupplierRowActions, canConfirm: boolean): ColumnDef<OperationsSupplierRow>[] {
  return [
    {
      id: "group",
      header: header("Group"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{item.groupName}</span>
            <span className="text-[11px] text-muted-foreground">{daysRemainingLabel(item.daysUntilDeparture)}</span>
          </div>
        );
      },
    },
    {
      id: "service",
      header: header("Service"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-foreground">{item.serviceLabel}</span>
            <span className="text-[11px] text-muted-foreground">{SERVICE_KIND_LABELS[item.serviceKind] ?? item.serviceKind}</span>
          </div>
        );
      },
    },
    {
      id: "supplier",
      header: header("Supplier / Broker"),
      cell: ({ row }) => <span className="text-sm text-foreground">{row.original.supplierName ?? "—"}</span>,
    },
    {
      id: "reference",
      header: header("Reference"),
      cell: ({ row }) => <span className="text-sm text-foreground">{row.original.reference ?? "—"}</span>,
    },
    {
      id: "due",
      header: header("Due"),
      cell: ({ row }) => <span className="text-sm text-foreground">{formatDate(row.original.dueAt)}</span>,
    },
    {
      id: "status",
      header: header("Status"),
      cell: ({ row }) => {
        const item = row.original;
        return <ToneBadge tone={supplierStatusTone(item.status)} label={SUPPLIER_STATUS_LABELS[item.status] ?? item.status} />;
      },
    },
    {
      id: "owner",
      header: header("Owner"),
      cell: ({ row }) => <PersonChip name={row.original.ownerName} fallback="Unassigned" />,
    },
    {
      id: "evidence",
      header: header("Evidence"),
      cell: ({ row }) => (
        <span className={cn("text-xs", row.original.evidencePresent ? TONE_TEXT.success : "text-destructive")}>
          {row.original.evidencePresent ? "On file" : "Missing"}
        </span>
      ),
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => {
        const item = row.original;
        const canConfirmRow =
          canConfirm &&
          item.serviceKind !== "FLIGHT" &&
          item.status !== "CONFIRMED" &&
          item.status !== "COMPLETED" &&
          item.evidencePresent &&
          !!item.supplierName;
        return (
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            {item.serviceKind !== "FLIGHT" && canConfirm && (
              <Button variant="ghost" size="sm" onClick={() => actions.onRecordDetails(item)}>
                Update Supplier
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => actions.onOpenGroup(item)}>Open Group</DropdownMenuItem>
                {canConfirmRow && <DropdownMenuItem onClick={() => actions.onConfirm(item)}>Mark Confirmed</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}
