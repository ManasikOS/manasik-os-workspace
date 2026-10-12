/**
 * Which pipeline moves a person may make by hand.
 *
 * The stage column has a CHECK constraint on its values and nothing else, so before this a lead could be dragged straight to Booked with no
 * booking behind it — which closes its follow-ups, inflates conversion reports and hides it from the people who should still be chasing it.
 *
 * Two rules, deliberately few:
 *   1. BOOKED is reached only by converting the lead (`markLeadBookedInStore`), never by a stage change.
 *   2. DEPOSIT_PENDING means a customer accepted an offer, so there must be an accepted quote.
 * Everything else — including reopening a lost or postponed lead — stays free; the pipeline is a working tool, not a workflow engine.
 */

import type { LeadStage } from "@/lib/types/leads";

export interface StageTransitionContext {
  from: LeadStage;
  to: LeadStage;
  hasBooking: boolean;
  hasAcceptedQuote: boolean;
}

export type StageTransitionVerdict = { ok: true } | { ok: false; error: string };

export function checkStageTransition(context: StageTransitionContext): StageTransitionVerdict {
  if (context.from === context.to) return { ok: true };

  if (context.hasBooking) {
    return { ok: false, error: "This lead is already linked to a booking." };
  }
  if (context.to === "BOOKED") {
    return { ok: false, error: "A lead becomes Booked when it is converted to a booking, not by moving its stage." };
  }
  if (context.to === "DEPOSIT_PENDING" && !context.hasAcceptedQuote) {
    return { ok: false, error: "Deposit Pending needs an accepted quote. Mark the quote accepted first." };
  }
  return { ok: true };
}
