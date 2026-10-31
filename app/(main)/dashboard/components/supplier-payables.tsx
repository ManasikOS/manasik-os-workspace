"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCurrencyCompact } from "@/lib/data/dashboard";
import type { SupplierPayablesData } from "@/lib/types/dashboard";
import { TONE_CLASS, TONE_STAT_CARD, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

/**
 * Supplier payables (spec section 3.2) - what is owed to suppliers inside the
 * Suppliers module's own payment window, soonest (and overdue) first.
 * Amounts stay in their own currency; the dashboard never converts. Rows
 * link to the Suppliers directory, which has no URL filters yet.
 */
export default function SupplierPayables({ data }: { data: SupplierPayablesData }) {
  const currencies = Object.entries(data.paymentsDueByCurrency).sort((a, b) => b[1] - a[1]);
  const hiddenSuppliers = data.dueSupplierCount - data.suppliers.length;

  return (
    <Card className="flex h-full flex-col gap-4">
      <div>
        <SectionHeading
          title="Supplier payables"
          act={
            <Link href="/suppliers">
              <Button variant="link" size="sm" className="h-5 gap-1 p-0 text-xs font-medium">
                <span>Open suppliers</span>
                <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          }
        />
        <p className="mt-0.5 text-xs text-muted-foreground">Payments due to suppliers soon or already overdue.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Card className={cn("flex flex-col gap-0.5 p-2.5", TONE_STAT_CARD.info)}>
          <span className={cn("truncate text-[10px] font-medium", TONE_TEXT.info)}>Due soon</span>
          {currencies.length === 0 ? (
            <span className={cn("text-sm font-bold tabular-nums", TONE_TEXT.info)}>None</span>
          ) : (
            currencies.map(([currency, amount]) => (
              <span key={currency} className={cn("text-sm font-bold tabular-nums", TONE_TEXT.info)}>
                {formatCurrencyCompact(currency, amount)}
              </span>
            ))
          )}
        </Card>
        <Card className={cn("flex flex-col gap-0.5 p-2.5", TONE_STAT_CARD.warning)}>
          <span className={cn("truncate text-[10px] font-medium", TONE_TEXT.warning)}>Confirmations pending</span>
          <span className={cn("text-sm font-bold tabular-nums", TONE_TEXT.warning)}>{data.confirmationsPending}</span>
        </Card>
        <Card className={cn("flex flex-col gap-0.5 p-2.5", TONE_STAT_CARD.danger)}>
          <span className={cn("truncate text-[10px] font-medium", TONE_TEXT.danger)}>Supplier issues</span>
          <span className={cn("text-sm font-bold tabular-nums", TONE_TEXT.danger)}>{data.supplierIssues}</span>
        </Card>
      </div>

      {data.totalSuppliers === 0 ? (
        <p className="text-sm text-muted-foreground">No suppliers yet.</p>
      ) : data.suppliers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No supplier payments are due soon.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.suppliers.map((supplier) => (
            <li key={supplier.supplierId}>
              <Link
                href="/suppliers"
                className="flex flex-col gap-2 rounded-lg border bg-card/50 p-3 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-foreground">{supplier.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {supplier.supplierType.toLowerCase().replace(/_/g, " ")}
                    {supplier.hasIssue ? " · has a disputed commitment" : ""}
                  </span>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 self-start rounded-full px-2.5 py-1 text-xs font-medium tabular-nums sm:self-auto",
                    TONE_CLASS[supplier.overdue ? "danger" : "warning"],
                  )}
                >
                  {formatCurrencyCompact(supplier.currency, supplier.outstandingAmount)} ·{" "}
                  {supplier.overdue
                    ? `${Math.abs(supplier.daysUntilDue)} day${Math.abs(supplier.daysUntilDue) === 1 ? "" : "s"} overdue`
                    : `due in ${supplier.daysUntilDue} day${supplier.daysUntilDue === 1 ? "" : "s"}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hiddenSuppliers > 0 && (
        <Link href="/suppliers" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          View all {data.dueSupplierCount} suppliers with payments due →
        </Link>
      )}
    </Card>
  );
}
