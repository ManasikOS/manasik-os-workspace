"use client";

import { format } from "date-fns";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TONE_CLASS } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import { JOURNEY_TYPE_LABELS, SALES_STATUS_LABELS, formatExactCurrency } from "../../utils";
import { COPY_LABELS, toNullableNumber } from "./group-editor-model";
import { marginSummary } from "./step-pricing";
import type { GroupEditorForm } from "./use-group-editor-form";

function Section({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-medium">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </dl>
    </Card>
  );
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}

interface StepReviewProps {
  form: GroupEditorForm;
  /** 0-based step to jump back to. */
  onEditStep: (index: number) => void;
}

/** Step 4: everything the group will be created with, on one page. */
export default function StepReview({ form, onEditStep }: StepReviewProps) {
  const { selected, details, pricing, margin, flightRouting } = form;
  const badge = marginSummary(margin.marginPercent);
  const money = (value: number | "" | string) => {
    const amount = toNullableNumber(value);
    return amount === null ? "—" : formatExactCurrency(amount, pricing.currency);
  };
  const copied = COPY_LABELS.filter(({ key }) => form.copyOptions[key]);

  return (
    <div className="flex flex-col gap-4">
      <Section title="Package template" onEdit={() => onEditStep(0)}>
        <Item label="Package" value={selected?.name} />
        <Item
          label="Journey"
          value={selected ? JOURNEY_TYPE_LABELS[selected.journeyType] : ""}
        />
        <Item label="Template code" value={selected?.code} />
      </Section>

      <Section title="Group details" onEdit={() => onEditStep(1)}>
        <Item label="Group name" value={details.groupName} />
        <Item label="Group code" value={details.groupCode} />
        <Item label="Branch" value={details.branch} />
        <Item label="Departure" value={format(details.departureDate, "PPP")} />
        <Item label="Return" value={format(details.returnDate, "PPP")} />
        <Item
          label="Duration"
          value={form.durationDays === null ? "" : `${form.durationDays} days`}
        />
        <Item label="Capacity" value={details.capacity} />
        <Item label="Minimum group size" value={details.minimumGroupSize} />
        <Item label="Sales status" value={SALES_STATUS_LABELS[details.salesStatus]} />
        <Item label="Operations owner" value={details.operationsOwnerName} />
        <Item label="Primary guide" value={details.primaryGuideName} />
        <Item label="Waitlist" value={details.waitlistEnabled ? "Enabled" : "Off"} />
      </Section>

      <Section title="Pricing" onEdit={() => onEditStep(2)}>
        <Item label="Quad" value={money(pricing.quadPrice)} />
        <Item label="Triple" value={money(pricing.triplePrice)} />
        <Item label="Double" value={money(pricing.doublePrice)} />
        <Item label="Single" value={money(pricing.singlePrice)} />
        <Item label="Child" value={money(pricing.childPrice)} />
        <Item label="Infant" value={money(pricing.infantPrice)} />
        <Item label="Early bird" value={money(pricing.earlyBirdPrice)} />
        <Item label="Advance deposit" value={money(pricing.advanceDeposit)} />
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">Margin</dt>
          <dd>
            <Badge
              variant="outline"
              className={cn("border-none text-xs font-normal", TONE_CLASS[badge.tone])}
            >
              {badge.label}
            </Badge>
          </dd>
        </div>
      </Section>

      <Card className="gap-2">
        <h3 className="text-base font-medium">What the group is created with</h3>
        <p className="text-xs text-muted-foreground">
          {copied.length > 0
            ? `Copied from the template: ${copied.map(({ label }) => label.toLowerCase()).join(", ")}.`
            : "Nothing is copied from the template."}
        </p>
        {form.copyOptions.flights && flightRouting.flightsIncluded ? (
          <p className="text-xs text-muted-foreground">
            Two draft flights are seeded
            {flightRouting.departureOrigin
              ? ` from ${flightRouting.departureOrigin}`
              : ""}
            {flightRouting.arrivalGateway ? ` to ${flightRouting.arrivalGateway}` : ""}
            .
          </p>
        ) : null}
      </Card>
    </div>
  );
}
