"use client";

import Link from "next/link";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import type { FinanceExceptionItem } from "@/lib/finance/finance-exception-projection";

import { formatExactCurrency } from "../utils";

const REASON_LABEL: Record<string, string> = {
  OVERDUE_RECEIVABLE: "Payment is overdue",
  DUE_SOON_RECEIVABLE: "Payment is due within 7 days",
  PENDING_REFUND: "Refund needs approval",
  OVERDUE_SUPPLIER: "Supplier payment is overdue",
  DISPUTED_SUPPLIER: "Supplier commitment is disputed",
  MULTIPLE_OVERDUE_MILESTONES: "Multiple payments are overdue",
  OVERDUE_DATE_UNAVAILABLE: "Due date needs checking",
};

function exceptionTone(item: FinanceExceptionItem): "danger" | "warning" {
  return item.priorityScore >= 80 ? "danger" : "warning";
}

/** The deterministic, source-linked queue that drives Finance follow-up. */
export default function FinanceExceptionQueue({
  items,
}: {
  items: FinanceExceptionItem[];
}) {
  return (
    <Card className="gap-4">
      <SectionHeading
        title="Priority exceptions"
        description="Ordered by the approved Finance policy. Amounts remain separate by currency."
      />
      {items.length === 0 ? (
        <EmptyState
          title="No Finance exceptions"
          description="Current receivables, refunds, and supplier commitments need no follow-up."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  <ToneBadge
                    tone={exceptionTone(item)}
                    label={REASON_LABEL[item.reasonCodes[0]]}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {item.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.reasonCodes
                    .map((code) => REASON_LABEL[code])
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-3 sm:shrink-0">
                {item.amount !== null && (
                  <span className="tabular-nums text-sm text-foreground">
                    {formatExactCurrency(item.amount, item.currency)}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={item.href} />}
                >
                  {item.actionLabel}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
