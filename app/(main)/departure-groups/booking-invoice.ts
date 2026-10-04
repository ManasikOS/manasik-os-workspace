/**
 * Turns a booking's live charge lines into the shape the existing
 * `invoices` / `invoice_line_items` tables want — see
 * `createInvoice()` in `lib/data/finance-repository.ts:586-598`, which
 * already inserts `{ description, quantity, unitAmount }` rows unchanged.
 *
 * This is deliberately the only new code the invoice needs: `createInvoice`,
 * `issueInvoice` and the whole invoice lifecycle already exist and work —
 * nothing here talks to the database.
 */

import { describeCharge, type ChargeDescriptionContext } from "./billing-description";
import type { DepartureGroupManifestRow } from "./types";

/**
 * One priced line, still structured (traveller / title / supporting facts)
 * rather than pre-flattened — the invoice PDF groups by traveller and
 * indents the supporting facts, which a flat string can't express reliably.
 * `lineItemDescription()` flattens it only at the point of writing to
 * `invoice_line_items.description`, the one place that needs a single string.
 */
export interface InvoiceLineItem {
  travellerName: string;
  title: string;
  details: string[];
  quantity: number;
  unitAmount: number;
}

/**
 * One line item per live, approved charge across every traveller on the
 * booking. Excluded deliberately:
 *   - voided charges — never billed, that is the point of voiding rather
 *     than deleting;
 *   - charges still `requiresApproval && !approvedAt` — a customer invoice
 *     bills settled money, not a pending discount that might not go through.
 */
export function buildInvoiceLineItems(
  travellers: DepartureGroupManifestRow[],
  context: ChargeDescriptionContext,
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [];

  for (const traveller of travellers) {
    const billable = traveller.charges.filter(
      (c) => c.voidedAt === null && !(c.requiresApproval && !c.approvedAt),
    );

    for (const charge of billable) {
      const deviation = traveller.deviations.find((d) => d.chargeId === charge.id);
      const { title, details } = describeCharge(charge, deviation, context);
      items.push({
        travellerName: traveller.fullName,
        title,
        details,
        quantity: charge.quantity,
        unitAmount: charge.amount,
      });
    }
  }

  return items;
}

export function invoiceLineItemsTotal(items: InvoiceLineItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0);
}

/** Flattens one structured line item into the single string `invoice_line_items.description` stores. */
export function lineItemDescription(item: InvoiceLineItem): string {
  return `${item.travellerName} — ${item.title}${
    item.details.length > 0 ? ` — ${item.details.join("; ")}` : ""
  }`;
}

/** The shape `createInvoiceAction`'s `lineItems` field expects. */
export function toInvoiceLineItemInputs(
  items: InvoiceLineItem[],
): { description: string; quantity: number; unitAmount: number }[] {
  return items.map((item) => ({
    description: lineItemDescription(item),
    quantity: item.quantity,
    unitAmount: item.unitAmount,
  }));
}
