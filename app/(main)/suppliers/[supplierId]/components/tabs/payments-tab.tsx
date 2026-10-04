"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import React, { useMemo, useState } from "react";

import { commitmentPaymentStatus, paymentStatusTone } from "@/lib/data/suppliers";
import { formatMoney, PAYMENT_STATUS_LABELS } from "../../../utils";
import type { SupplierCommitmentRow, SupplierProfile } from "../../../types";
import RecordPaymentDialog from "../record-payment-dialog";
import RecordRefundDialog from "../record-refund-dialog";

interface PaymentsTabProps {
  profile: SupplierProfile;
  nowIso: string;
}

export default function PaymentsTab({ profile, nowIso }: PaymentsTabProps) {
  const [target, setTarget] = useState<SupplierCommitmentRow | null>(null);
  const [refundTarget, setRefundTarget] = useState<SupplierCommitmentRow | null>(null);

  const priced = useMemo(
    () => profile.commitments.filter((c) => c.status !== "CANCELLED" && c.amount != null),
    [profile.commitments],
  );

  // A cancelled/disputed commitment is the primary refund case (a supplier
  // sending a deposit back), so it stays out of the KPI totals above but
  // must still surface here with a way to record what came back.
  const listed = useMemo(
    () => profile.commitments.filter((c) => c.amount != null || c.amount_paid > 0),
    [profile.commitments],
  );

  const totals = useMemo(() => {
    const totalCommitted: Record<string, number> = {};
    const totalPaid: Record<string, number> = {};
    const dueNext7: Record<string, number> = {};
    const overdue: Record<string, number> = {};
    const in7Days = Date.parse(nowIso) + 7 * 24 * 60 * 60 * 1000;

    for (const c of priced) {
      totalCommitted[c.currency] = (totalCommitted[c.currency] ?? 0) + (c.amount ?? 0);
      totalPaid[c.currency] = (totalPaid[c.currency] ?? 0) + c.amount_paid;
      const outstanding = (c.amount ?? 0) - c.amount_paid;
      if (outstanding <= 0) continue;
      if (c.payment_due_at && Date.parse(c.payment_due_at) < Date.parse(nowIso)) {
        overdue[c.currency] = (overdue[c.currency] ?? 0) + outstanding;
      } else if (c.payment_due_at && Date.parse(c.payment_due_at) <= in7Days) {
        dueNext7[c.currency] = (dueNext7[c.currency] ?? 0) + outstanding;
      }
    }

    return { totalCommitted, totalPaid, dueNext7, overdue };
  }, [priced, nowIso]);

  const currencies = [...new Set(priced.map((c) => c.currency))];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">Recorded here until the Finance module lands.</p>

      {currencies.length === 0 ? (
        <EmptyState title="No priced commitments" description="Record a supplier cost on a commitment to track payments." />
      ) : (
        currencies.map((currency) => (
          <div key={currency} className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="gap-1">
              <span className="text-xs text-muted-foreground">Total Committed ({currency})</span>
              <span className="text-lg font-semibold text-foreground">{formatMoney(totals.totalCommitted[currency] ?? 0, currency)}</span>
            </Card>
            <Card className="gap-1">
              <span className="text-xs text-muted-foreground">Paid ({currency})</span>
              <span className="text-lg font-semibold text-foreground">{formatMoney(totals.totalPaid[currency] ?? 0, currency)}</span>
            </Card>
            <Card className="gap-1">
              <span className="text-xs text-muted-foreground">Due Next 7 Days ({currency})</span>
              <span className="text-lg font-semibold text-foreground">{formatMoney(totals.dueNext7[currency] ?? 0, currency)}</span>
            </Card>
            <Card className="gap-1">
              <span className="text-xs text-muted-foreground">Overdue ({currency})</span>
              <span className="text-lg font-semibold text-destructive">{formatMoney(totals.overdue[currency] ?? 0, currency)}</span>
            </Card>
          </div>
        ))
      )}

      <div className="flex flex-col gap-2">
        {listed.map((c) => {
          const status = commitmentPaymentStatus(c, nowIso);
          const outstanding = (c.amount ?? 0) - c.amount_paid;
          const canPay = c.status !== "CANCELLED" && outstanding > 0;
          const canRefund = c.amount_paid > 0;
          return (
            <Card key={c.id} className="gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{c.service_label || c.reference_code}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatMoney(c.amount ?? 0, c.currency)} · Paid {formatMoney(c.amount_paid, c.currency)}
                    {c.payment_due_at ? ` · Due ${c.payment_due_at}` : ""}
                    {c.status === "CANCELLED" ? " · Cancelled" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <ToneBadge tone={paymentStatusTone(status)} label={PAYMENT_STATUS_LABELS[status]} />
                  {canPay && (
                    <Button variant="ghost" size="sm" onClick={() => setTarget(c)}>
                      Record Payment
                    </Button>
                  )}
                  {canRefund && (
                    <Button variant="ghost" size="sm" onClick={() => setRefundTarget(c)}>
                      Record Refund
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <RecordPaymentDialog commitment={target} onClose={() => setTarget(null)} />
      <RecordRefundDialog commitment={refundTarget} onClose={() => setRefundTarget(null)} />
    </div>
  );
}
