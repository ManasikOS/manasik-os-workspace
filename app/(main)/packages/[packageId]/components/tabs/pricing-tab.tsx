"use client";

import React from "react";
import { ShieldCheck } from "lucide-react";

import type { PackageRow } from "@/lib/types/database";
import { Badge } from "@/components/ui/badge";
import { DetailSection, Field, FieldGrid, TabEmpty } from "../detail-field";
import { Card } from "@/components/ui/card";

export default function PricingTab({ pkg }: { pkg: PackageRow }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground -mt-1">
        Room-occupancy prices and the internal cost estimate are set per
        Departure Group, not on the template — a template&apos;s price is not
        what every departure actually sells at. Only the reusable payment
        schedule and customer-facing policies live here.
      </p>

      <DetailSection
        title="Payment Milestones"
        icon={<ShieldCheck className="size-4 text-primary" />}
      >
        {pkg.payment_milestones.length === 0 ? (
          <TabEmpty title="No payment milestones defined" />
        ) : (
          <div className="flex flex-col gap-2">
            {pkg.payment_milestones.map((m) => (
              <Card
                key={m.id}
                className="flex flex-row items-center justify-between rounded-sm border border-border/40 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-foreground">{m.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.dueRule}
                    {m.daysBeforeDeparture
                      ? ` · ${m.daysBeforeDeparture} days before`
                      : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-number text-foreground">
                    {m.amountType === "Percentage"
                      ? `${m.amount}%`
                      : m.amountType === "Remaining Balance"
                        ? "Remaining balance"
                        : m.amount
                          ? Number(m.amount).toLocaleString()
                          : "—"}
                  </p>
                  {m.refundable && (
                    <Badge variant="outline" className="text-[10px] mt-0.5">
                      Refundable
                    </Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </DetailSection>

      <DetailSection title="Policies">
        <FieldGrid>
          <Field label="Payment Terms" value={pkg.payment_terms} />
          <Field label="Cancellation Policy" value={pkg.cancellation_policy} />
          <Field label="Late Payment Policy" value={pkg.late_payment_policy} />
          <Field
            label="Price Change Disclaimer"
            value={pkg.price_change_disclaimer}
          />
        </FieldGrid>
      </DetailSection>
    </div>
  );
}
