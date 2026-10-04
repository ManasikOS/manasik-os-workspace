"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  PermissionDenied,
  ToneBadge,
} from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState } from "react";

import type { PilgrimCapabilities } from "@/lib/access/pilgrims-access";
import type { PilgrimProfile } from "../../../types";
import {
  recordPilgrimPaymentAction,
  sendPaymentReminderAction,
} from "../../../actions";
import { formatExactLKR } from "../../../utils";
import SectionHeading from "@/components/section-heading";

export default function PaymentsTab({
  profile,
  can,
}: {
  profile: PilgrimProfile;
  can: PilgrimCapabilities;
}) {
  const router = useRouter();
  const journey = profile.activeJourneyRaw;
  const [recordOpen, setRecordOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!can.viewPayments) return <PermissionDenied what="Payments" />;
  if (!journey)
    return (
      <EmptyState
        title="No active journey"
        description="Payments apply once this pilgrim is enrolled on a group."
      />
    );

  const refresh = () => router.refresh();

  const recordPayment = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    const result = await recordPilgrimPaymentAction({
      pilgrimId: profile.person.id,
      departureGroupId: journey.departure_group_id,
      bookingId: journey.booking_id,
      amount: value,
      note,
    });
    setBusy(false);
    if (!result.ok)
      return toast.add({
        title: "Could not record payment",
        description: result.error,
      });
    toast.add({ title: "Payment recorded" });
    setRecordOpen(false);
    setAmount("");
    setNote("");
    refresh();
  };

  const remind = async () => {
    await sendPaymentReminderAction({
      pilgrimId: profile.person.id,
      departureGroupId: journey.departure_group_id,
      amountDue: journey.outstanding_balance,
    });
    toast.add({ title: "Reminder logged" });
    refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-3">
        <SectionHeading title="Summary" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">
              Total Booking Value
            </span>
            {formatExactLKR(journey.total_booking_value)}
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Paid</span>
            {formatExactLKR(journey.amount_paid)}
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">
              Outstanding
            </span>
            {formatExactLKR(journey.outstanding_balance)}
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">
              Next Due
            </span>
            {journey.next_due_at
              ? new Date(journey.next_due_at).toLocaleDateString()
              : "—"}
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Status</span>
            <ToneBadge
              tone={
                journey.payment_status === "OVERDUE"
                  ? "danger"
                  : journey.outstanding_balance > 0
                    ? "warning"
                    : "success"
              }
              label={journey.payment_status.replace(/_/g, " ")}
            />
          </div>
        </div>
        {can.recordPayments && (
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={() => setRecordOpen(true)}>
              Record Payment
            </Button>
            <Button size="sm" variant="outline_without_border" onClick={remind}>
              Send Payment Reminder
            </Button>
          </div>
        )}
      </Card>

      <Card className="gap-3">
        <SectionHeading title="Payment Milestones" />
        {profile.paymentMilestones.length === 0 ? (
          <EmptyState
            title="No milestones recorded"
            description="Milestones are seeded from the package's payment schedule when a booking is created."
          />
        ) : (
          <div className="flex flex-col divide-y divide-border/40">
            {profile.paymentMilestones.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between py-3"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-foreground">{m.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.paid_amount >= m.amount
                      ? `Paid${m.paid_at ? ` · ${new Date(m.paid_at).toLocaleDateString()}` : ""}`
                      : m.due_at
                        ? `Due ${new Date(m.due_at).toLocaleDateString()}`
                        : "Due on booking"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium text-foreground">
                    {formatExactLKR(m.amount)}
                  </span>
                  <ToneBadge
                    tone={
                      m.paid_amount >= m.amount
                        ? "success"
                        : m.paid_amount > 0
                          ? "warning"
                          : "neutral"
                    }
                    label={
                      m.paid_amount >= m.amount
                        ? "Paid"
                        : m.paid_amount > 0
                          ? "Partial"
                          : "Due"
                    }
                    className="ml-2"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              type="number"
              placeholder="Amount (LKR)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordOpen(false)}>
              Cancel
            </Button>
            <Button onClick={recordPayment} disabled={busy || !amount}>
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
