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
import { header, sortableHeader } from "@/components/data-table/sortable-header";
import type { DataTableSort } from "@/components/data-table/data-table";
import { PersonChip, ToneBadge } from "@/components/ui/tone-badge";

import { RELIABILITY_LABELS, SERVICE_CATEGORY_LABELS, SUPPLIER_TYPE_LABELS } from "@/lib/data/suppliers-copy";
import type { SupplierListItem } from "../types";
import {
  confirmationHealthLabel,
  confirmationHealthTone,
  paymentStatusLabel,
  reliabilityTone,
} from "../utils";

export interface SupplierRowActions {
  onOpen: (row: SupplierListItem) => void;
  onAddCommitment: (row: SupplierListItem) => void;
  onSetReliability: (row: SupplierListItem) => void;
}

export function buildSupplierColumns(
  actions: SupplierRowActions,
  nowIso: string,
  canViewCosts: boolean,
  canCreateCommitment: boolean,
  sort: DataTableSort,
  onSortChange: (sort: DataTableSort) => void,
): ColumnDef<SupplierListItem>[] {
  const columns: ColumnDef<SupplierListItem>[] = [
    {
      id: "supplier",
      header: sortableHeader("Supplier", "name", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{item.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {item.supplierCode} · {SUPPLIER_TYPE_LABELS[item.supplierType] ?? item.supplierType}
            </span>
          </div>
        );
      },
    },
    {
      id: "location",
      header: header("Location"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {[row.original.city, row.original.country].filter(Boolean).join(", ") || "—"}
        </span>
      ),
    },
    {
      id: "services",
      header: header("Services"),
      cell: ({ row }) => {
        const categories = row.original.serviceCategories;
        const shown = categories.slice(0, 3);
        return (
          <div className="flex flex-wrap gap-1 max-w-52">
            {shown.map((c) => (
              <ToneBadge key={c} tone="neutral" label={SERVICE_CATEGORY_LABELS[c] ?? c} />
            ))}
            {categories.length > 3 && (
              <span className="text-[11px] text-muted-foreground self-center">+{categories.length - 3}</span>
            )}
            {categories.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
          </div>
        );
      },
    },
    {
      id: "activeGroups",
      header: sortableHeader("Active Groups", "activeGroupCount", sort, onSortChange),
      cell: ({ row }) => <span className="text-sm text-foreground">{row.original.activeGroupCount}</span>,
    },
    {
      id: "confirmationHealth",
      header: header("Confirmation Health"),
      cell: ({ row }) => (
        <ToneBadge tone={confirmationHealthTone(row.original)} label={confirmationHealthLabel(row.original)} />
      ),
    },
  ];

  if (canViewCosts) {
    columns.push({
      id: "paymentStatus",
      header: sortableHeader("Payment Status", "outstandingAmount", sort, onSortChange),
      cell: ({ row }) => <span className="text-sm text-foreground">{paymentStatusLabel(row.original, nowIso)}</span>,
    });
  }

  columns.push(
    {
      id: "reliability",
      header: sortableHeader("Reliability", "reliability", sort, onSortChange),
      cell: ({ row }) => (
        <ToneBadge tone={reliabilityTone(row.original.reliability)} label={RELIABILITY_LABELS[row.original.reliability] ?? row.original.reliability} />
      ),
    },
    {
      id: "contact",
      header: header("Primary Contact"),
      cell: ({ row }) => <PersonChip name={row.original.primaryContactName} fallback="No contact" />,
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            {canCreateCommitment && (
              <Button variant="ghost" size="sm" onClick={() => actions.onAddCommitment(item)}>
                Add Commitment
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => actions.onOpen(item)}>Open Supplier</DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onSetReliability(item)}>Set Reliability</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
      enableSorting: false,
    },
  );

  return columns;
}
