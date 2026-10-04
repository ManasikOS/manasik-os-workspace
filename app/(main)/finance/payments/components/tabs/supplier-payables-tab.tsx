"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PersonChip, ToneBadge } from "@/components/ui/tone-badge";
import React from "react";

import { deriveSupplierPayableStatus, SUPPLIER_PAYABLE_STATUS_TONE } from "@/lib/data/finance";
import { SUPPLIER_PAYABLE_STATUS_LABELS } from "@/lib/data/finance-copy";

import { useFinance } from "../../finance-store";
import { formatDate, formatExactCurrency } from "../../utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

/**
 * Reads `finance_supplier_payable_rows` — i.e. `supplier_commitments` — never
 * a second payable model (plan F7). Record Payment for a commitment happens
 * from the Supplier profile until the wrapper dialog for this surface lands.
 */
export default function SupplierPayablesTab() {
  const { snapshot } = useFinance();

  if (snapshot.supplierPayables.length === 0) {
    return <EmptyState title="No supplier payables" description="Supplier obligations appear here once a commitment carries a cost." />;
  }

  return (
    <div className="rounded-md bg-card/60 dark:bg-gray-950/10 border border-muted/50 backdrop-blur-lg shadow-lg overflow-hidden">
      <div className="overflow-x-auto no-scrollbar">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-none!">
              {["Supplier", "Departure Group", "Service", "Reference", "Total Cost", "Paid", "Outstanding", "Due Date", "Status", "Owner"].map(
                (label) => (
                  <TableHead key={label} className="h-11 px-4 text-xs font-medium text-muted-foreground whitespace-nowrap">
                    {label}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-border/20">
            {snapshot.supplierPayables.map((row) => {
              const status = deriveSupplierPayableStatus(row, snapshot.nowIso);
              return (
                <TableRow key={row.commitment_id} className="hover:bg-muted/50">
                  <TableCell className="px-4 py-3 text-sm text-foreground">
                    {row.supplier_name}
                    <span className="block text-[11px] text-muted-foreground font-number">{row.supplier_code}</span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-foreground">{row.group_name}</TableCell>
                  <TableCell className="px-4 py-3 text-xs text-foreground">{row.service_label}</TableCell>
                  <TableCell className="px-4 py-3 text-xs font-number text-muted-foreground">{row.reference_code}</TableCell>
                  <TableCell className="px-4 py-3 text-sm font-number text-foreground">
                    {row.amount === null ? "Restricted" : formatExactCurrency(row.amount, row.currency)}
                  </TableCell>
                  <TableCell className={cn("px-4 py-3 text-sm font-number", TONE_TEXT.success)}>
                    {formatExactCurrency(row.amount_paid, row.currency)}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm font-number text-destructive">
                    {formatExactCurrency(row.outstanding_amount, row.currency)}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground">{formatDate(row.payment_due_at)}</TableCell>
                  <TableCell className="px-4 py-3">
                    <ToneBadge tone={SUPPLIER_PAYABLE_STATUS_TONE[status]} label={SUPPLIER_PAYABLE_STATUS_LABELS[status]} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <PersonChip name={row.owner_name} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
