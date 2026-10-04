/**
 * SalesOutcomeLearningService — interface only (V1).
 *
 * The shape the engine will use to learn from past lead outcomes (which
 * packages convert, which lost reasons recur for which offers). There is not
 * enough labelled outcome history yet to learn from honestly, so V1 ships a
 * no-op implementation and nothing in the ranking depends on it.
 */

export interface SalesOutcome {
  leadId: string;
  outcome: "BOOKED" | "LOST";
  lostReason?: string;
  packageTemplateId: string | null;
  departureGroupId: string | null;
  recordedAt: string;
}

export interface OutcomePriors {
  packageTemplateId: string;
  bookedCount: number;
  lostCount: number;
  topLostReasons: string[];
}

export interface SalesOutcomeLearningService {
  recordOutcome(outcome: SalesOutcome): Promise<void>;
  priorsFor(packageTemplateId: string): Promise<OutcomePriors | null>;
}

export const noopSalesOutcomeLearning: SalesOutcomeLearningService = {
  async recordOutcome() {},
  async priorsFor() {
    return null;
  },
};
