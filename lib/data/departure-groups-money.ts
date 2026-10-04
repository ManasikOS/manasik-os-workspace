/**
 * Money rules shared across the Departure Groups data layer.
 *
 * Deliberately a leaf module with no imports beyond types: both the seed and
 * the booking mutations need the same payment-status rule, and having the seed
 * reach into `departure-groups-bookings` created an import cycle
 * (seed → bookings → seed) that blew up at module-init time.
 */

import type {
  DepartureGroupPilgrimChargeRow,
  DepartureGroupPricingRow,
  PaymentMilestoneSnapshot,
  PilgrimPaymentStatus,
  PricingSnapshot,
} from "@/lib/types/departure-groups";

/**
 * The group's current, editable price — resolved view model.
 *
 * `departure_group_pricing` is the source of truth going forward (see
 * migration `20260908090000`); `snapshot` is only consulted for a group whose
 * pricing row has not been created yet (a database this migration's backfill
 * has not reached, or an in-memory seed/test store that predates it) so the
 * price never silently reads as null/zero in the meantime.
 */
export interface ResolvedGroupPricing {
  currency: string;
  quadPrice: number | null;
  triplePrice: number | null;
  doublePrice: number | null;
  singlePrice: number | null;
  childPrice: number | null;
  infantPrice: number | null;
  earlyBirdPrice: number | null;
  advanceDeposit: number | null;
  priceSource: "TEMPLATE" | "OVERRIDDEN";
}

/**
 * Resolves the price to actually charge/display for a group: the
 * `departure_group_pricing` row when one exists, else the frozen template
 * snapshot as a fallback. Every read site that used to reach into
 * `pricing_snapshot` directly for a *current* price (as opposed to the
 * template-comparison dialog's deliberate "what did we promise at sale time"
 * use) should go through this instead.
 */
export function groupPrice(
  pricing: DepartureGroupPricingRow | null | undefined,
  snapshot: PricingSnapshot | null | undefined,
): ResolvedGroupPricing {
  if (pricing) {
    return {
      currency: pricing.currency,
      quadPrice: pricing.quad_price,
      triplePrice: pricing.triple_price,
      doublePrice: pricing.double_price,
      singlePrice: pricing.single_price,
      childPrice: pricing.child_price,
      infantPrice: pricing.infant_price,
      earlyBirdPrice: pricing.early_bird_price,
      advanceDeposit: pricing.advance_deposit,
      priceSource: pricing.price_source,
    };
  }

  return {
    currency: snapshot?.currency ?? "LKR",
    quadPrice: snapshot?.quad_price ?? null,
    triplePrice: snapshot?.triple_price ?? null,
    doublePrice: snapshot?.double_price ?? null,
    singlePrice: snapshot?.single_price ?? null,
    childPrice: snapshot?.child_price ?? null,
    infantPrice: snapshot?.infant_price ?? null,
    earlyBirdPrice: null,
    advanceDeposit: snapshot?.advance_deposit ?? null,
    priceSource: "TEMPLATE",
  };
}

/**
 * Rounds to the precision the money columns actually store.
 *
 * Every amount lands in a `numeric(14, 2)`, so the application has to agree
 * with that: the mutators used to round payments to whole units, which meant a
 * payment of the exact remaining 1,250.50 balance became 1,251 and was refused
 * as "exceeds the outstanding balance". Two decimals throughout, and the
 * float error from repeated addition is squeezed out on every write.
 */
export function money(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * `yyyy-mm-dd` shifted by N days. A local copy of `addDays()` from
 * `departure-groups-copy.ts` rather than an import of it — this module stays
 * a leaf with no imports beyond types (see file header).
 */
function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Which of the group's payment milestones a booking's next payment is
 * actually chasing, and that milestone's due date.
 *
 * Every booking used to get one flat "14 days before departure" due date
 * regardless of what its payment schedule promised — a 30%-on-booking /
 * 40%-at-60-days / 30%-on-arrival plan was stored and shown as policy, but
 * never staged into real due dates. This walks the schedule in order,
 * accumulating each milestone's amount (a flat sum, a % of the total, or
 * "whatever's left" for a `Remaining Balance` milestone) until the running
 * total exceeds what has actually been paid — that first not-yet-covered
 * milestone is the one due next.
 */
export function resolveNextMilestoneDueDate(
  milestones: readonly PaymentMilestoneSnapshot[],
  totalBookingValue: number,
  amountPaid: number,
  departureDate: string,
  bookingCreatedAt: string,
): string | null {
  if (milestones.length === 0) {
    // No schedule to chase against — the old flat rule is still a reasonable
    // fallback (e.g. a built-in template with no payment schedule attached).
    return `${shiftDate(departureDate, -14)}T17:00:00.000Z`;
  }

  let cumulative = 0;
  for (const milestone of milestones) {
    const amount =
      milestone.amount_type === "Remaining Balance"
        ? Math.max(totalBookingValue - cumulative, 0)
        : milestone.amount_type === "Percentage"
          ? money((totalBookingValue * (milestone.amount ?? 0)) / 100)
          : Math.max(milestone.amount ?? 0, 0);
    cumulative = money(cumulative + amount);

    // Values are normalised to cents at every write, so an amount that is one
    // cent short must remain due. Avoid a tolerance here: it turns 299.99
    // into a false settlement of a 300.00 milestone.
    if (money(amountPaid) < cumulative) {
      if (milestone.due_rule === "Fixed Date" && milestone.due_date) {
        return `${milestone.due_date}T17:00:00.000Z`;
      }
      if (milestone.due_rule === "Days Before Departure") {
        return `${shiftDate(departureDate, -(milestone.days_before_departure ?? 0))}T17:00:00.000Z`;
      }
      // "On Booking" — due the moment the booking was made.
      return bookingCreatedAt;
    }
  }

  // Every milestone's cumulative amount is already covered by what's paid.
  return null;
}

/**
 * The single source of truth for a traveller's payment status, so a booking and
 * a recorded payment can never disagree. Overdue only applies while a balance
 * remains and the due date has passed.
 */
export function derivePaymentStatus(
  total: number,
  paid: number,
  nextDueAt: string | null,
  now: number = Date.now(),
): PilgrimPaymentStatus {
  if (total <= 0) return "PAID_IN_FULL";
  if (paid >= total) return "PAID_IN_FULL";
  if (nextDueAt && Date.parse(nextDueAt) < now) return "OVERDUE";
  if (paid <= 0) return "NOT_STARTED";
  return "PARTIAL";
}

/**
 * Sums a traveller's or a booking's live charge lines, the one place the
 * `amount * quantity` roll-up and its rounding happen. Voided lines are
 * excluded — they are corrected, never deleted, so a naive `sum()` over the
 * raw rows would double-count a repriced base fare.
 *
 * Includes lines still awaiting approval — this is the "what has been
 * requested" total shown to staff (e.g. a traveller's `totalPrice` on the
 * manifest). For what the traveller actually owes, use
 * `sumBillableChargeLines` instead.
 */
export function sumChargeLines(
  charges: Pick<DepartureGroupPilgrimChargeRow, "amount" | "quantity" | "voided_at">[],
): number {
  return money(
    charges
      .filter((c) => c.voided_at === null)
      .reduce((total, c) => total + c.amount * c.quantity, 0),
  );
}

/**
 * Sums the lines that are actually owed: live, and not sitting on an
 * unresolved approval. A charge paired with a `REQUESTED` deviation is a
 * quote, not a debt — `requestPilgrimCustomisation` marks it
 * `requires_approval` for exactly this reason, and `decideDeviationInStore`
 * stamps `approved_at` the moment staff say yes. Until then it must not move
 * `total_booking_value` or `outstanding_balance`, or a customer would be
 * billed — and chased — for money nobody has agreed to yet.
 *
 * This is also the exact predicate `buildInvoiceLineItems()` (see
 * `booking-invoice.ts`) already applies when deciding what to put on a
 * customer invoice, so a booking's balance and its invoice subtotal can
 * never disagree.
 */
export function sumBillableChargeLines(
  charges: Pick<
    DepartureGroupPilgrimChargeRow,
    "amount" | "quantity" | "voided_at" | "requires_approval" | "approved_at"
  >[],
): number {
  return money(
    charges
      .filter(
        (c) =>
          c.voided_at === null &&
          !(c.requires_approval && c.approved_at === null),
      )
      .reduce((total, c) => total + c.amount * c.quantity, 0),
  );
}
