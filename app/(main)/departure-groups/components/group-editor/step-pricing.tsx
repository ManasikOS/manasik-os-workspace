"use client";

import { Badge } from "@/components/ui/badge";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { InputGroupInput } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { TONE_CLASS, TONE_STAT_CARD, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import { formatExactCurrency } from "../../utils";
import { Field, SelectMenu } from "./group-editor-fields";
import {
  CABIN_CLASSES,
  CURRENCIES,
  type CostEstimateState,
  type PricingState,
} from "./group-editor-model";
import type { GroupEditorForm } from "./use-group-editor-form";

const PRICE_FIELDS: [keyof PricingState, string][] = [
  ["quadPrice", "Quad"],
  ["triplePrice", "Triple"],
  ["doublePrice", "Double"],
  ["singlePrice", "Single"],
  ["childPrice", "Child"],
  ["infantPrice", "Infant"],
  ["earlyBirdPrice", "Early bird"],
  ["advanceDeposit", "Advance deposit"],
];

const COST_FIELDS: [keyof CostEstimateState, string][] = [
  ["flightCostPerPilgrim", "Flight"],
  ["accommodationCostPerPilgrim", "Accommodation"],
  ["transportCostPerPilgrim", "Transport"],
  ["visaInsuranceCostPerPilgrim", "Visa / Insurance"],
  ["cateringCostPerPilgrim", "Catering"],
  ["guideOperationsCostPerPilgrim", "Guide / Ops"],
  ["contingencyCostPerPilgrim", "Contingency"],
];

/** The margin badge's wording and tone for a margin percentage. */
export function marginSummary(percent: number | null): { label: string; tone: Tone } {
  if (percent === null)
    return { label: "Enter a quad price and cost estimate to see margin", tone: "neutral" };
  if (percent >= 15)
    return { label: `Healthy margin (${percent.toFixed(1)}%)`, tone: "success" };
  if (percent > 0)
    return { label: `Below 15% threshold (${percent.toFixed(1)}%)`, tone: "warning" };
  return { label: `Selling at a loss (${percent.toFixed(1)}%)`, tone: "danger" };
}

interface StepPricingProps {
  form: GroupEditorForm;
  showErrors: boolean;
}

/** Step 3: this departure's own price, cost estimate and flight routing. */
export default function StepPricing({ form, showErrors }: StepPricingProps) {
  const { pricing, setPricing, costEstimate, setCostEstimate, flightRouting, setFlightRouting } =
    form;
  const { margin, capacity } = form;
  const badge = marginSummary(margin.marginPercent);
  const fixedCost = Number(costEstimate.fixedCostPerDeparture);

  const priceError = (key: keyof PricingState) => {
    if (key === "quadPrice" && form.quadPriceMissing && showErrors)
      return "Required. This is the group's list price.";
    if (key === "advanceDeposit" && form.depositExceedsPrice)
      return "Cannot exceed the Quad price.";
    return undefined;
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        None of this comes from the template; a template is reusable precisely
        because it carries no price of its own. Everything here is editable
        again later from the group.
      </p>

      <Card className="gap-3">
        <h3 className="text-base font-medium">Room occupancy pricing</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Currency">
            <SelectMenu
              value={pricing.currency}
              options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))}
              onChange={(value) => setPricing((previous) => ({ ...previous, currency: value }))}
            />
          </Field>
          {PRICE_FIELDS.map(([key, label]) => (
            <Field
              key={key}
              label={label}
              required={key === "quadPrice"}
              error={priceError(key)}
            >
              <ButtonGroup>
                <InputGroupInput
                  value={pricing.currency}
                  className="flex-1 tabular-nums"
                  readOnly
                  tabIndex={-1}
                  aria-hidden
                />
                <CurrencyInput
                  value={pricing[key] as number | ""}
                  onValueChange={(value) =>
                    setPricing((previous) => ({ ...previous, [key]: value }))
                  }
                  className="flex-6 tabular-nums"
                />
              </ButtonGroup>
            </Field>
          ))}
        </div>
        {pricing.quadPrice ? (
          <p className="text-[11px] text-muted-foreground">
            Quad: {formatExactCurrency(Number(pricing.quadPrice), pricing.currency)}
          </p>
        ) : null}
      </Card>

      <Card className="gap-3">
        <div>
          <h3 className="text-base font-medium">Internal cost estimate (per pilgrim)</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Used for this departure&apos;s margin and break-even calculation on
            the Overview tab. Optional; leave blank if not known yet.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COST_FIELDS.map(([key, label]) => (
            <Field key={key} label={label}>
              <ButtonGroup>
                <InputGroupInput
                  value={pricing.currency}
                  readOnly
                  tabIndex={-1}
                  aria-hidden
                  className="tabular-nums"
                />
                <CurrencyInput
                  value={costEstimate[key] as number | ""}
                  onValueChange={(value) =>
                    setCostEstimate((previous) => ({ ...previous, [key]: value }))
                  }
                  className="flex-6 tabular-nums"
                />
              </ButtonGroup>
            </Field>
          ))}
          <Field
            label="Fixed cost / departure"
            hint="A coach, a guide's fee: costs that don't shrink with headcount."
          >
            <ButtonGroup>
              <InputGroupInput
                value={pricing.currency}
                readOnly
                tabIndex={-1}
                aria-hidden
                className="flex-1 tabular-nums"
              />
              <CurrencyInput
                value={Number.isFinite(fixedCost) ? fixedCost : ""}
                onValueChange={(value) =>
                  setCostEstimate((previous) => ({
                    ...previous,
                    fixedCostPerDeparture: String(value ?? ""),
                  }))
                }
                className="flex-6 tabular-nums"
              />
            </ButtonGroup>
          </Field>
        </div>
      </Card>

      <Card className={cn("gap-3", TONE_STAT_CARD.warning)}>
        <div>
          <h3 className="text-base font-medium">Margin check</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A preview of this departure&apos;s own margin, using the Quad price
            as the list price: the same basis the Overview tab uses once
            bookings exist.
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-card/40 px-3 py-2.5">
            <dt className="text-[11px] text-muted-foreground">Cost / pilgrim</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {formatExactCurrency(margin.costPerPax, pricing.currency)}
            </dd>
          </div>
          <div className="rounded-md bg-card/40 px-3 py-2.5">
            <dt className="text-[11px] text-muted-foreground">Margin / pilgrim</dt>
            <dd
              className={cn(
                "text-sm font-semibold tabular-nums",
                margin.marginPerPax === null
                  ? "text-muted-foreground"
                  : margin.marginPerPax >= 0
                    ? TONE_TEXT.success
                    : TONE_TEXT.danger,
              )}
            >
              {margin.marginPerPax === null
                ? "—"
                : `${formatExactCurrency(margin.marginPerPax, pricing.currency)} (${margin.marginPercent?.toFixed(1)}%)`}
            </dd>
          </div>
          <div className="rounded-md bg-card/40 px-3 py-2.5">
            <dt className="text-[11px] text-muted-foreground">Break-even seats</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {margin.breakEvenHeadcount === null
                ? "—"
                : `${margin.breakEvenHeadcount} of ${capacity || "?"}`}
            </dd>
          </div>
        </dl>
        <Badge
          variant="outline"
          className={cn("w-fit border-none text-xs font-normal", TONE_CLASS[badge.tone])}
        >
          {badge.label}
        </Badge>
        {margin.breakEvenHeadcount !== null &&
        capacity > 0 &&
        margin.breakEvenHeadcount > capacity ? (
          <p className={cn("text-[11px]", TONE_TEXT.warning)}>
            Break-even needs more seats than this group&apos;s capacity ({capacity}).
            This departure cannot cover its fixed cost even if it sells out.
          </p>
        ) : null}
      </Card>

      {form.copyOptions.flights ? (
        <Card className="gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-medium">Flight routing</h3>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Flights included
              <Switch
                checked={flightRouting.flightsIncluded}
                onCheckedChange={(checked) =>
                  setFlightRouting((previous) => ({ ...previous, flightsIncluded: checked }))
                }
              />
            </label>
          </div>
          {flightRouting.flightsIncluded ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Origin">
                <InputGroupInput
                  value={flightRouting.departureOrigin}
                  onChange={(event) =>
                    setFlightRouting((previous) => ({
                      ...previous,
                      departureOrigin: event.target.value,
                    }))
                  }
                  placeholder="Colombo (CMB)"
                />
              </Field>
              <Field label="Arrival gateway">
                <InputGroupInput
                  value={flightRouting.arrivalGateway}
                  onChange={(event) =>
                    setFlightRouting((previous) => ({
                      ...previous,
                      arrivalGateway: event.target.value,
                    }))
                  }
                  placeholder="Jeddah"
                />
              </Field>
              <Field label="Return gateway">
                <InputGroupInput
                  value={flightRouting.returnGateway}
                  onChange={(event) =>
                    setFlightRouting((previous) => ({
                      ...previous,
                      returnGateway: event.target.value,
                    }))
                  }
                  placeholder="Jeddah"
                />
              </Field>
              <Field label="Preferred airline">
                <InputGroupInput
                  value={flightRouting.preferredAirline}
                  onChange={(event) =>
                    setFlightRouting((previous) => ({
                      ...previous,
                      preferredAirline: event.target.value,
                    }))
                  }
                  placeholder="Sri Lankan Airlines"
                />
              </Field>
              <Field label="Cabin class" className="sm:col-span-2">
                <SelectMenu
                  value={flightRouting.cabinClass}
                  options={CABIN_CLASSES.map((cabin) => ({ value: cabin, label: cabin }))}
                  onChange={(value) =>
                    setFlightRouting((previous) => ({ ...previous, cabinClass: value }))
                  }
                />
              </Field>
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            Seeds two draft flights (outbound/return) to book against on the
            Flights tab, never a confirmed schedule.
          </p>
        </Card>
      ) : (
        <p className="text-xs text-muted-foreground">
          Flight routing is skipped: &quot;Flight routing&quot; was unchecked in
          the group details.
        </p>
      )}
    </div>
  );
}
