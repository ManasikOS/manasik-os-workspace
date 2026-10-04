/**
 * A departure-level financial safety projection. This intentionally is not a
 * cash forecast: it compares recorded collections with known supplier
 * obligations due on or before the departure date, in one currency only.
 */

export type DepartureFinancialSafetyStatus = "HEALTHY" | "ATTENTION" | "CRITICAL" | "INSUFFICIENT_DATA";

export type DepartureFinancialSafetyReasonCode =
  | "PACKAGE_PRICING_UNAVAILABLE"
  | "COSTING_INCOMPLETE"
  | "DEPARTURE_DATE_UNAVAILABLE"
  | "CURRENCY_UNAVAILABLE"
  | "MIXED_CURRENCY"
  | "PAYABLE_AMOUNT_UNAVAILABLE"
  | "PAYABLE_DUE_DATE_UNAVAILABLE"
  | "NO_BOOKED_REVENUE"
  | "COLLECTION_OUTSTANDING"
  | "PAYABLE_CASH_GAP"
  | "MARGIN_NON_POSITIVE"
  | "BREAK_EVEN_UNDEFINED";

export interface DepartureFinancialSafetyGroup {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  groupStatus: string;
  departureDate: string;
  currency: string;
  hasPackagePricingSnapshot: boolean;
  hasCompleteCosting: boolean;
  confirmedPax: number;
  breakEvenHeadcount: number | null;
  estimatedGrossMargin: number;
}

export interface DepartureFinancialSafetyReceivable {
  departure_group_id: string;
  booking_status: string;
  total_booking_value: number;
  amount_paid: number;
  outstanding_balance: number;
  currency: string;
}

export interface DepartureFinancialSafetyPayable {
  departure_group_id: string;
  amount: number | null;
  outstanding_amount: number;
  currency: string;
  payment_due_at: string | null;
}

export interface DepartureFinancialSafetySource {
  label: "Open departure" | "Open receivables" | "Open payables" | "Open departure P&L";
  href: string;
}

export interface DepartureFinancialSafetyExplanation {
  code: DepartureFinancialSafetyReasonCode;
  message: string;
}

export interface DepartureFinancialSafetyResult {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  currency: string | null;
  status: DepartureFinancialSafetyStatus;
  reasonCodes: DepartureFinancialSafetyReasonCode[];
  explanations: DepartureFinancialSafetyExplanation[];
  collectionCoverage: {
    booked: number;
    collected: number;
    outstanding: number;
    percent: number | null;
  } | null;
  payableTiming: {
    dueBeforeDeparture: number;
    undatedOutstanding: number;
  } | null;
  /** Recorded collections minus known obligations due before departure; never a bank-balance forecast. */
  cashGap: {
    collected: number;
    payablesDueBeforeDeparture: number;
    amount: number;
  } | null;
  margin: {
    estimatedGrossMargin: number;
    breakEvenHeadcount: number | null;
    confirmedPax: number;
    state: "POSITIVE" | "NON_POSITIVE" | "BREAK_EVEN_UNDEFINED";
  } | null;
  sources: DepartureFinancialSafetySource[];
}

export interface DepartureFinancialSafetyInput {
  groups: readonly DepartureFinancialSafetyGroup[];
  receivables: readonly DepartureFinancialSafetyReceivable[];
  supplierPayables: readonly DepartureFinancialSafetyPayable[];
}

const INACTIVE_GROUP_STATUSES = new Set(["CANCELLED", "COMPLETED", "CLOSED"]);

const EXPLANATIONS: Record<DepartureFinancialSafetyReasonCode, string> = {
  PACKAGE_PRICING_UNAVAILABLE: "The package pricing snapshot is unavailable, so the departure currency and margin source cannot be verified.",
  COSTING_INCOMPLETE: "The departure cost sheet is incomplete, so margin and cash-gap results are withheld.",
  DEPARTURE_DATE_UNAVAILABLE: "The departure date is unavailable, so supplier obligations cannot be classified by timing.",
  CURRENCY_UNAVAILABLE: "The departure currency is unavailable, so financial amounts cannot be safely compared.",
  MIXED_CURRENCY: "Source records use more than one currency; no conversion or cross-currency total has been applied.",
  PAYABLE_AMOUNT_UNAVAILABLE: "A supplier commitment has no amount, so payable coverage cannot be verified.",
  PAYABLE_DUE_DATE_UNAVAILABLE: "An outstanding supplier commitment has no usable due date, so the pre-departure cash gap is unknown.",
  NO_BOOKED_REVENUE: "There is no booked revenue to use as a collection-coverage denominator.",
  COLLECTION_OUTSTANDING: "Some booked revenue remains uncollected.",
  PAYABLE_CASH_GAP: "Recorded collections do not cover known supplier obligations due on or before departure.",
  MARGIN_NON_POSITIVE: "The estimated gross margin at the current headcount is not positive.",
  BREAK_EVEN_UNDEFINED: "No break-even headcount is defined because the estimated per-seat contribution is not positive.",
};

function isUsableCurrency(currency: string): boolean {
  return currency.trim().length > 0;
}

function isUsableDate(value: string | null): value is string {
  return value !== null && Number.isFinite(Date.parse(value));
}

function dueOnOrBeforeDeparture(dueAt: string, departureDate: string): boolean {
  return dueAt.slice(0, 10) <= departureDate.slice(0, 10);
}

function sourceLinks(departureGroupId: string): DepartureFinancialSafetySource[] {
  return [
    { label: "Open departure", href: `/departure-groups/${departureGroupId}?tab=overview` },
    { label: "Open receivables", href: "/finance?view=receivables&subview=balances" },
    { label: "Open payables", href: "/finance?view=payables" },
    { label: "Open departure P&L", href: "/finance?view=departure-pnl" },
  ];
}

function uniqueReasonCodes(codes: DepartureFinancialSafetyReasonCode[]): DepartureFinancialSafetyReasonCode[] {
  return [...new Set(codes)];
}

/**
 * Calculates each active departure's source-backed safety position. Any
 * incomplete prerequisite wins over a numeric status, preventing a false
 * healthy/critical claim from partial records.
 */
export function computeDepartureFinancialSafety(
  input: DepartureFinancialSafetyInput,
): DepartureFinancialSafetyResult[] {
  return input.groups
    .filter((group) => !INACTIVE_GROUP_STATUSES.has(group.groupStatus))
    .map((group) => {
      const reasonCodes: DepartureFinancialSafetyReasonCode[] = [];
      const receivables = input.receivables.filter(
        (row) => row.departure_group_id === group.departureGroupId && row.booking_status !== "CANCELLED",
      );
      const payables = input.supplierPayables.filter((row) => row.departure_group_id === group.departureGroupId);
      const hasDepartureDate = isUsableDate(group.departureDate);
      const hasCurrency = isUsableCurrency(group.currency);
      const sourceCurrencies = [...receivables, ...payables].map((row) => row.currency);
      const hasMixedCurrencies = sourceCurrencies.some((currency) => !hasCurrency || currency !== group.currency);

      if (!group.hasPackagePricingSnapshot) reasonCodes.push("PACKAGE_PRICING_UNAVAILABLE");
      if (!group.hasCompleteCosting) reasonCodes.push("COSTING_INCOMPLETE");
      if (!hasDepartureDate) reasonCodes.push("DEPARTURE_DATE_UNAVAILABLE");
      if (!hasCurrency) reasonCodes.push("CURRENCY_UNAVAILABLE");
      if (hasMixedCurrencies) reasonCodes.push("MIXED_CURRENCY");

      const hasUnavailablePayableAmount = payables.some((row) => row.amount === null);
      if (hasUnavailablePayableAmount) reasonCodes.push("PAYABLE_AMOUNT_UNAVAILABLE");

      const outstandingPayables = payables.filter((row) => row.outstanding_amount > 0);
      const undatedOutstanding = outstandingPayables
        .filter((row) => !isUsableDate(row.payment_due_at))
        .reduce((total, row) => total + row.outstanding_amount, 0);
      if (undatedOutstanding > 0) reasonCodes.push("PAYABLE_DUE_DATE_UNAVAILABLE");

      const canCompareCurrency = !reasonCodes.some((code) =>
        ["PACKAGE_PRICING_UNAVAILABLE", "DEPARTURE_DATE_UNAVAILABLE", "CURRENCY_UNAVAILABLE", "MIXED_CURRENCY"].includes(code),
      );
      const collectionCoverage = canCompareCurrency
        ? (() => {
            const booked = receivables.reduce((total, row) => total + row.total_booking_value, 0);
            const collected = receivables.reduce((total, row) => total + row.amount_paid, 0);
            const outstanding = receivables.reduce((total, row) => total + row.outstanding_balance, 0);
            return { booked, collected, outstanding, percent: booked > 0 ? (collected / booked) * 100 : null };
          })()
        : null;
      if (collectionCoverage?.booked === 0) reasonCodes.push("NO_BOOKED_REVENUE");
      if ((collectionCoverage?.outstanding ?? 0) > 0) reasonCodes.push("COLLECTION_OUTSTANDING");

      const payableTiming = canCompareCurrency
        ? {
            dueBeforeDeparture: hasDepartureDate
              ? outstandingPayables
                  .filter((row) => isUsableDate(row.payment_due_at) && dueOnOrBeforeDeparture(row.payment_due_at, group.departureDate))
                  .reduce((total, row) => total + row.outstanding_amount, 0)
              : 0,
            undatedOutstanding,
          }
        : null;

      const canCalculate = reasonCodes.every(
        (code) =>
          ![
            "PACKAGE_PRICING_UNAVAILABLE",
            "COSTING_INCOMPLETE",
            "DEPARTURE_DATE_UNAVAILABLE",
            "CURRENCY_UNAVAILABLE",
            "MIXED_CURRENCY",
            "PAYABLE_AMOUNT_UNAVAILABLE",
            "PAYABLE_DUE_DATE_UNAVAILABLE",
          ].includes(code),
      );
      const cashGap = canCalculate && collectionCoverage && payableTiming
        ? {
            collected: collectionCoverage.collected,
            payablesDueBeforeDeparture: payableTiming.dueBeforeDeparture,
            amount: Math.max(payableTiming.dueBeforeDeparture - collectionCoverage.collected, 0),
          }
        : null;
      if ((cashGap?.amount ?? 0) > 0) reasonCodes.push("PAYABLE_CASH_GAP");

      const margin: DepartureFinancialSafetyResult["margin"] = canCalculate
        ? {
            estimatedGrossMargin: group.estimatedGrossMargin,
            breakEvenHeadcount: group.breakEvenHeadcount,
            confirmedPax: group.confirmedPax,
            state: group.breakEvenHeadcount === null
              ? "BREAK_EVEN_UNDEFINED"
              : group.estimatedGrossMargin > 0
                ? "POSITIVE"
                : "NON_POSITIVE",
          }
        : null;
      if (margin?.estimatedGrossMargin !== undefined && margin.estimatedGrossMargin <= 0) reasonCodes.push("MARGIN_NON_POSITIVE");
      if (margin?.state === "BREAK_EVEN_UNDEFINED") reasonCodes.push("BREAK_EVEN_UNDEFINED");

      const finalReasonCodes = uniqueReasonCodes(reasonCodes);
      const status: DepartureFinancialSafetyStatus = !canCalculate
        ? "INSUFFICIENT_DATA"
        : finalReasonCodes.includes("PAYABLE_CASH_GAP") ||
            finalReasonCodes.includes("MARGIN_NON_POSITIVE") ||
            finalReasonCodes.includes("BREAK_EVEN_UNDEFINED")
          ? "CRITICAL"
          : finalReasonCodes.includes("COLLECTION_OUTSTANDING") || finalReasonCodes.includes("NO_BOOKED_REVENUE")
            ? "ATTENTION"
            : "HEALTHY";

      return {
        departureGroupId: group.departureGroupId,
        groupName: group.groupName,
        groupCode: group.groupCode,
        departureDate: group.departureDate,
        currency: hasCurrency ? group.currency : null,
        status,
        reasonCodes: finalReasonCodes,
        explanations: finalReasonCodes.map((code) => ({ code, message: EXPLANATIONS[code] })),
        collectionCoverage,
        payableTiming,
        cashGap,
        margin,
        sources: sourceLinks(group.departureGroupId),
      };
    });
}
