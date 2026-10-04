"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Wallet, MegaphoneIcon, ExternalLink } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DataTableSort } from "@/components/data-table/data-table";
import { header, sortableHeader } from "@/components/data-table/sortable-header";
import { PersonChip, ToneBadge } from "@/components/ui/tone-badge";

import { RECEIVABLE_STATUS_LABELS } from "@/lib/data/finance-copy";
import { deriveReceivableStatus, RECEIVABLE_STATUS_TONE } from "@/lib/data/finance";
import type { FinanceReceivableRow } from "@/lib/types/finance";
import { departureCountdown, formatDate, formatExactCurrency } from "../utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

export interface ReceivableRowActions {
  onRecordPayment: (row: FinanceReceivableRow) => void;
  onSendReminder: (row: FinanceReceivableRow) => void;
  onOpenBooking: (row: FinanceReceivableRow) => void;
}

function daysUntil(iso: string, nowIso: string): number {
  const ms = Date.parse(iso) - Date.parse(nowIso);
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function buildReceivableColumns(
  actions: ReceivableRowActions,
  nowIso: string,
  canRecordPayments: boolean,
  canSendReminders: boolean,
  moneyVisible: boolean,
  sort: DataTableSort,
  onSortChange: (sort: DataTableSort) => void,
): ColumnDef<FinanceReceivableRow>[] {
  const columns: ColumnDef<FinanceReceivableRow>[] = [
    {
      id: "customer",
      header: sortableHeader("Customer / Booking", "primary_contact_name", sort, onSortChange),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{row.original.primary_contact_name}</span>
          <span className="text-[11px] text-muted-foreground font-number">{row.original.booking_reference}</span>
        </div>
      ),
    },
    {
      id: "group",
      header: header("Departure Group"),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">{row.original.group_name}</span>
          <span className="text-[11px] text-muted-foreground">{departureCountdown(daysUntil(row.original.departure_date, nowIso))}</span>
        </div>
      ),
    },
  ];

  if (moneyVisible) {
    columns.push(
      {
        id: "totalValue",
        header: sortableHeader("Total Value", "total_booking_value", sort, onSortChange),
        cell: ({ row }) => (
          <span className="text-sm font-number text-foreground">
            {formatExactCurrency(row.original.total_booking_value, row.original.currency)}
          </span>
        ),
      },
      {
        id: "paid",
        header: header("Paid"),
        cell: ({ row }) => (
          <span className={cn("text-sm font-number", TONE_TEXT.success)}>
            {formatExactCurrency(row.original.amount_paid, row.original.currency)}
          </span>
        ),
      },
      {
        id: "balance",
        header: sortableHeader("Balance", "outstanding_balance", sort, onSortChange),
        cell: ({ row }) => (
          <span
            className={row.original.outstanding_balance > 0 ? "text-sm font-number text-destructive" : "text-sm font-number text-muted-foreground"}
          >
            {formatExactCurrency(row.original.outstanding_balance, row.original.currency)}
          </span>
        ),
      },
      {
        id: "nextMilestone",
        header: header("Next Milestone"),
        cell: ({ row }) => {
          const r = row.original;
          if (!r.next_milestone_id) return <span className="text-sm text-muted-foreground">—</span>;
          const due = Math.max((r.next_milestone_amount ?? 0) - (r.next_milestone_paid ?? 0), 0);
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-foreground">{r.next_milestone_label}</span>
              <span className="text-[11px] text-muted-foreground font-number">
                {formatExactCurrency(due, r.currency)} · {r.next_milestone_due_at ? formatDate(r.next_milestone_due_at) : "No due date"}
              </span>
            </div>
          );
        },
      },
    );
  }

  columns.push(
    {
      id: "status",
      header: header("Status"),
      cell: ({ row }) => {
        const status = deriveReceivableStatus(row.original, nowIso);
        return <ToneBadge tone={RECEIVABLE_STATUS_TONE[status]} label={RECEIVABLE_STATUS_LABELS[status]} />;
      },
    },
    {
      id: "financeOwner",
      header: header("Finance Owner"),
      cell: ({ row }) => <PersonChip name={row.original.finance_owner_name} />,
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => {
        const canAct = row.original.booking_status !== "CANCELLED" && (canRecordPayments || canSendReminders);
        if (!canAct) {
          return (
            <Button variant="ghost" size="icon" onClick={() => actions.onOpenBooking(row.original)} aria-label="Open booking">
              <ExternalLink />
            </Button>
          );
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" aria-label={`Actions for ${row.original.booking_reference}`}>
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {canRecordPayments && row.original.outstanding_balance > 0 && (
                <DropdownMenuItem onClick={() => actions.onRecordPayment(row.original)}>
                  <Wallet /> Record Payment
                </DropdownMenuItem>
              )}
              {canSendReminders && (
                <DropdownMenuItem onClick={() => actions.onSendReminder(row.original)}>
                  <MegaphoneIcon /> Send Reminder
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => actions.onOpenBooking(row.original)}>
                <ExternalLink /> Open Booking
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  );

  return columns;
}
