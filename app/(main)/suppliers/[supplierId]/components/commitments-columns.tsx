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

import { SERVICE_CATEGORY_LABELS } from "@/lib/data/suppliers-copy";
import { commitmentPaymentStatus, commitmentStatusTone, paymentStatusTone } from "@/lib/data/suppliers";
import { COMMITMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS, formatMoney } from "../../utils";
import type { SupplierCommitmentRow } from "../../types";

export interface CommitmentRowActions {
  onOpenGroup: (row: SupplierCommitmentRow) => void;
  onUploadEvidence: (row: SupplierCommitmentRow) => void;
  onConfirm: (row: SupplierCommitmentRow) => void;
  onDispute: (row: SupplierCommitmentRow) => void;
}

export function buildCommitmentColumns(
  actions: CommitmentRowActions,
  nowIso: string,
  canViewCosts: boolean,
  canConfirm: boolean,
  canUploadEvidence: boolean,
  canDispute: boolean,
): ColumnDef<SupplierCommitmentRow>[] {
  const columns: ColumnDef<SupplierCommitmentRow>[] = [
    {
      id: "service",
      header: header("Service"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{item.service_label || SERVICE_CATEGORY_LABELS[item.service_category]}</span>
            <span className="text-[11px] text-muted-foreground">{item.reference_code}</span>
          </div>
        );
      },
    },
    {
      id: "serviceDate",
      header: header("Service Date"),
      cell: ({ row }) => {
        const item = row.original;
        if (!item.service_start_date) return <span className="text-sm text-muted-foreground">—</span>;
        return (
          <span className="text-sm text-foreground">
            {item.service_start_date}
            {item.service_end_date && item.service_end_date !== item.service_start_date ? ` – ${item.service_end_date}` : ""}
          </span>
        );
      },
    },
    {
      id: "reference",
      header: header("Reference"),
      cell: ({ row }) => <span className="text-sm text-foreground">{row.original.booking_reference ?? "—"}</span>,
    },
    {
      id: "status",
      header: header("Status"),
      cell: ({ row }) => (
        <ToneBadge tone={commitmentStatusTone(row.original.status)} label={COMMITMENT_STATUS_LABELS[row.original.status] ?? row.original.status} />
      ),
    },
  ];

  if (canViewCosts) {
    columns.push(
      {
        id: "amount",
        header: header("Amount"),
        cell: ({ row }) =>
          row.original.amount != null ? (
            <span className="text-sm text-foreground">{formatMoney(row.original.amount, row.original.currency)}</span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        id: "paymentStatus",
        header: header("Payment"),
        cell: ({ row }) => {
          const status = commitmentPaymentStatus(row.original, nowIso);
          return <ToneBadge tone={paymentStatusTone(status)} label={PAYMENT_STATUS_LABELS[status]} />;
        },
      },
    );
  }

  columns.push(
    {
      id: "owner",
      header: header("Owner"),
      cell: ({ row }) => <PersonChip name={row.original.owner_name} fallback="Unassigned" />,
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => {
        const item = row.original;
        const canConfirmRow = canConfirm && item.status !== "CONFIRMED" && item.status !== "COMPLETED" && item.status !== "CANCELLED";
        return (
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => actions.onOpenGroup(item)}>Open Departure Group</DropdownMenuItem>
                {canUploadEvidence && <DropdownMenuItem onClick={() => actions.onUploadEvidence(item)}>Upload Evidence</DropdownMenuItem>}
                {canConfirmRow && <DropdownMenuItem onClick={() => actions.onConfirm(item)}>Confirm</DropdownMenuItem>}
                {canDispute && item.status !== "DISPUTED" && (
                  <DropdownMenuItem onClick={() => actions.onDispute(item)}>Mark Disputed</DropdownMenuItem>
                )}
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
