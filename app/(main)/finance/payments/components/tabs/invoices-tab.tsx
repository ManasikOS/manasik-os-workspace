"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import React from "react";

import { INVOICE_STATUS_TONE } from "@/lib/data/finance";
import {
  INVOICE_STATUS_LABELS,
  INVOICE_TYPE_LABELS,
} from "@/lib/data/finance-copy";

import { useFinance } from "../../finance-store";
import { formatDate, formatExactCurrency } from "../../utils";

/**
 * Read-only register for V1. Create / Send / Void actions land with the
 * Create Invoice dialog (plan Phase 4) — generated from a booking milestone,
 * never a disconnected record.
 */
export default function InvoicesTab() {
  const { snapshot } = useFinance();
  const router = useRouter();

  if (snapshot.invoices.length === 0) {
    return (
      <EmptyState
        title="No invoices yet"
        description="Invoices are generated from a booking's payment milestones. Create Invoice arrives in a later phase of this build."
      />
    );
  }

  return (
    <div className="rounded-md bg-card/60 dark:bg-gray-950/10 border border-muted/50 backdrop-blur-lg shadow-lg overflow-hidden">
      <div className="overflow-x-auto no-scrollbar">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-none!">
              {[
                "Invoice Number",
                "Customer / Supplier",
                "Booking / Group",
                "Type",
                "Amount",
                "Due Date",
                "Status",
                "Sent",
              ].map((label) => (
                <TableHead
                  key={label}
                  className="h-11 px-4 text-xs font-medium text-muted-foreground whitespace-nowrap"
                >
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-border/20">
            {snapshot.invoices.map((invoice) => (
              <TableRow
                key={invoice.id}
                className="hover:bg-muted/50 cursor-pointer"
                onClick={() => router.push(`/finance/invoices/${invoice.id}`)}
              >
                <TableCell className="px-4 py-3 text-sm tabular-nums text-foreground">
                  {invoice.invoice_number}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-foreground">
                  {invoice.party_name || "—"}
                </TableCell>
                <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                  {invoice.booking_reference ??
                    invoice.supplier_commitment_reference ??
                    "—"}
                  {invoice.group_name && (
                    <span className="block">{invoice.group_name}</span>
                  )}
                </TableCell>
                <TableCell className="px-4 py-3 text-xs text-foreground">
                  {INVOICE_TYPE_LABELS[invoice.invoice_type]}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm tabular-nums text-foreground">
                  {formatExactCurrency(invoice.amount, invoice.currency)}
                </TableCell>
                <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                  {formatDate(invoice.due_at)}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <ToneBadge
                    tone={INVOICE_STATUS_TONE[invoice.status]}
                    label={INVOICE_STATUS_LABELS[invoice.status]}
                  />
                </TableCell>
                <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                  {invoice.sent_channel
                    ? INVOICE_STATUS_LABELS[invoice.status]
                    : "Not sent"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
