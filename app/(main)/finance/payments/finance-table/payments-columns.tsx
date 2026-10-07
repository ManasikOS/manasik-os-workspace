"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, ShieldCheck, Undo2, Download } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DataTableSort } from "@/components/data-table/data-table";
import {
  header,
  sortableHeader,
} from "@/components/data-table/sortable-header";
import { PersonChip, ToneBadge } from "@/components/ui/tone-badge";

import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_RECORD_STATUS_LABELS,
} from "@/lib/data/finance-copy";
import { PAYMENT_STATUS_TONE } from "@/lib/data/finance";
import type { FinancePaymentRow } from "@/lib/types/finance";
import { formatDateTime, formatExactCurrency } from "../utils";

export interface PaymentRowActions {
  onVerify: (row: FinancePaymentRow) => void;
  onReverse: (row: FinancePaymentRow) => void;
  onDownloadProof: (row: FinancePaymentRow) => void;
}

export function buildPaymentColumns(
  actions: PaymentRowActions,
  canVerify: boolean,
  canReverse: boolean,
  sort: DataTableSort,
  onSortChange: (sort: DataTableSort) => void,
): ColumnDef<FinancePaymentRow>[] {
  return [
    {
      id: "id",
      header: sortableHeader(
        "Payment ID",
        "payment_reference",
        sort,
        onSortChange,
      ),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm tabular-nums text-foreground">
            {row.original.payment_reference}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatDateTime(row.original.paid_at)}
          </span>
        </div>
      ),
    },
    {
      id: "customer",
      header: header("Customer / Booking"),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">
            {row.original.primary_contact_name}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {row.original.booking_reference}
          </span>
        </div>
      ),
    },
    {
      id: "group",
      header: header("Departure Group"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.group_name}
        </span>
      ),
    },
    {
      id: "amount",
      header: sortableHeader("Amount", "amount", sort, onSortChange),
      cell: ({ row }) => (
        <span
          className={
            row.original.amount < 0
              ? "text-sm tabular-nums text-destructive"
              : "text-sm tabular-nums text-foreground"
          }
        >
          {formatExactCurrency(row.original.amount, row.original.currency)}
        </span>
      ),
    },
    {
      id: "method",
      header: header("Method"),
      cell: ({ row }) => (
        <span className="text-xs text-foreground">
          {PAYMENT_METHOD_LABELS[row.original.method]}
        </span>
      ),
    },
    {
      id: "reference",
      header: header("Reference"),
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {row.original.reference_number ?? "—"}
        </span>
      ),
    },
    {
      id: "allocatedTo",
      header: header("Allocated To"),
      cell: ({ row }) => (
        <span className="text-xs text-foreground">
          {row.original.allocated_to ??
            (row.original.allocated_amount < row.original.amount
              ? "Unallocated"
              : "—")}
        </span>
      ),
    },
    {
      id: "recordedBy",
      header: header("Recorded By"),
      cell: ({ row }) => <PersonChip name={row.original.recorded_by_name} />,
    },
    {
      id: "proof",
      header: header("Proof"),
      cell: ({ row }) =>
        row.original.proof_path ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.onDownloadProof(row.original)}
          >
            <Download /> View
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">None</span>
        ),
    },
    {
      id: "status",
      header: header("Status"),
      cell: ({ row }) => (
        <ToneBadge
          tone={PAYMENT_STATUS_TONE[row.original.status]}
          label={PAYMENT_RECORD_STATUS_LABELS[row.original.status]}
        />
      ),
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => {
        const canAct =
          (canVerify && row.original.status === "PENDING_VERIFICATION") ||
          (canReverse &&
            row.original.status === "COMPLETED" &&
            row.original.amount > 0);
        if (!canAct) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Actions for ${row.original.payment_reference}`}
                >
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {canVerify && row.original.status === "PENDING_VERIFICATION" && (
                <DropdownMenuItem
                  onClick={() => actions.onVerify(row.original)}
                >
                  <ShieldCheck /> Mark Verified
                </DropdownMenuItem>
              )}
              {canReverse &&
                row.original.status === "COMPLETED" &&
                row.original.amount > 0 && (
                  <DropdownMenuItem
                    onClick={() => actions.onReverse(row.original)}
                  >
                    <Undo2 /> Reverse
                  </DropdownMenuItem>
                )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
