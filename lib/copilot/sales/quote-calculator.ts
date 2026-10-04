/**
 * Quote calculations — decimal-safe (integer cents throughout).
 *
 * Price per person comes from the group's resolved price (group override
 * when set, otherwise the package template snapshot — see `groupPrice()`),
 * which the caller passes in. Payment milestones are staged into real due
 * dates from the group's payment schedule, using the same amount semantics
 * as `resolveNextMilestoneDueDate()` in departure-groups-money.ts.
 */

import type { PaymentMilestoneSnapshot } from "@/lib/types/departure-groups";

import { formatLongDate, shiftIsoDate } from "./format";
import { fromCents, percentOfCents, sumCents, toCents } from "./money";
import type { OccupancyType, QuoteMilestone } from "./types";

export interface QuoteCalculationInput {
  occupancyType: OccupancyType;
  adults: number;
  children: number;
  infants: number;
  adultPricePerPerson: number;
  childPrice: number | null;
  infantPrice: number | null;
  depositPerPerson: number | null;
  discountAmount: number;
  schedule: PaymentMilestoneSnapshot[];
  departureDate: string;
  nowIso: string;
}

export interface QuoteLine {
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface QuoteCalculation {
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  total: number;
  deposit: number;
  remainingBalance: number;
  milestones: QuoteMilestone[];
}

function dueFor(
  milestone: PaymentMilestoneSnapshot,
  departureDate: string,
  today: string,
): { dueDate: string | null; dueLabel: string } {
  if (milestone.due_rule === "Fixed Date" && milestone.due_date) {
    const date = milestone.due_date.slice(0, 10);
    return { dueDate: date, dueLabel: date < today ? "Due immediately" : formatLongDate(date) };
  }
  if (milestone.due_rule === "Days Before Departure") {
    const date = shiftIsoDate(departureDate, -(milestone.days_before_departure ?? 0));
    return { dueDate: date, dueLabel: date < today ? "Due immediately" : formatLongDate(date) };
  }
  return { dueDate: null, dueLabel: "On booking" };
}

export function calculateQuote(input: QuoteCalculationInput): QuoteCalculation {
  const today = input.nowIso.slice(0, 10);
  const adultCents = toCents(input.adultPricePerPerson);
  const childCents = toCents(input.childPrice ?? input.adultPricePerPerson);
  const infantCents = toCents(input.infantPrice ?? 0);

  const lines: QuoteLine[] = [
    {
      label: "Adult",
      quantity: input.adults,
      unitPrice: fromCents(adultCents),
      amount: fromCents(adultCents * input.adults),
    },
  ];
  if (input.children > 0) {
    lines.push({
      label: input.childPrice === null ? "Child (adult rate)" : "Child",
      quantity: input.children,
      unitPrice: fromCents(childCents),
      amount: fromCents(childCents * input.children),
    });
  }
  if (input.infants > 0) {
    lines.push({
      label: "Infant",
      quantity: input.infants,
      unitPrice: fromCents(infantCents),
      amount: fromCents(infantCents * input.infants),
    });
  }

  const subtotalCents = sumCents([adultCents * input.adults, childCents * input.children, infantCents * input.infants]);
  const discountCents = Math.min(Math.max(toCents(input.discountAmount), 0), subtotalCents);
  const totalCents = subtotalCents - discountCents;

  const payers = input.adults + input.children;
  const scheduleDeposit = input.schedule[0]?.due_rule === "On Booking" ? input.schedule[0] : null;
  let depositCents: number;
  if (input.depositPerPerson !== null) {
    depositCents = toCents(input.depositPerPerson) * payers;
  } else if (scheduleDeposit) {
    depositCents =
      scheduleDeposit.amount_type === "Percentage"
        ? percentOfCents(totalCents, scheduleDeposit.amount ?? 0)
        : scheduleDeposit.amount_type === "Fixed Amount"
          ? toCents(scheduleDeposit.amount ?? 0)
          : totalCents;
  } else {
    depositCents = 0;
  }
  depositCents = Math.min(depositCents, totalCents);

  /* Milestones */
  const milestones: QuoteMilestone[] = [];
  let allocated = 0;
  if (depositCents > 0) {
    milestones.push({ label: "Deposit", amount: fromCents(depositCents), dueDate: null, dueLabel: "On booking" });
    allocated = depositCents;
  }

  const rest = scheduleDeposit ? input.schedule.slice(1) : input.schedule;
  let instalment = 0;
  for (const milestone of rest) {
    const remaining = totalCents - allocated;
    if (remaining <= 0) break;
    const raw =
      milestone.amount_type === "Remaining Balance"
        ? remaining
        : milestone.amount_type === "Percentage"
          ? percentOfCents(totalCents, milestone.amount ?? 0)
          : toCents(milestone.amount ?? 0);
    const amount = Math.min(Math.max(raw, 0), remaining);
    if (amount === 0) continue;
    const isFinal = amount === remaining;
    instalment += isFinal ? 0 : 1;
    milestones.push({
      label: isFinal ? "Final balance" : milestone.label || `Instalment ${instalment}`,
      amount: fromCents(amount),
      ...dueFor(milestone, input.departureDate, today),
    });
    allocated += amount;
  }

  if (allocated < totalCents) {
    // No schedule (or one that doesn't cover the total): the long-standing
    // fallback of balance due 14 days before departure.
    const dueDate = shiftIsoDate(input.departureDate, -14);
    milestones.push({
      label: "Final balance",
      amount: fromCents(totalCents - allocated),
      dueDate,
      dueLabel: dueDate < today ? "Due immediately" : formatLongDate(dueDate),
    });
  }

  return {
    lines,
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    total: fromCents(totalCents),
    deposit: fromCents(depositCents),
    remainingBalance: fromCents(totalCents - depositCents),
    milestones,
  };
}
