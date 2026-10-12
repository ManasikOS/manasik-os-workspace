/**
 * What a role is allowed to receive of the Leads store.
 *
 * `lib/access/leads-access.ts` promised that capabilities "decide what is fetched, not merely what is rendered". Nothing did: the page filtered the
 * lead list for converted-only roles and then serialised the rest of the store — every lead's notes, quotes and activity — into the browser, and
 * sent each lead's estimated value to roles documented as never seeing money.
 *
 * Pure and applied on the server before the store is handed to a Client Component. Anything removed here never reaches the network.
 */

import type { LeadCapabilities } from "@/lib/access/leads-access";
import type { LeadStore } from "@/lib/data/leads-repository";

export function projectLeadStoreForRole(store: LeadStore, can: LeadCapabilities): LeadStore {
  const leads = (can.convertedOnly ? store.leads.filter((lead) => lead.booking_id !== null) : store.leads).map((lead) =>
    can.viewPipelineValue ? lead : { ...lead, estimated_value_lkr: 0 },
  );

  const visible = new Set(leads.map((lead) => lead.id));
  const ofVisibleLeads = <T extends { lead_id: string }>(rows: T[]): T[] => rows.filter((row) => visible.has(row.lead_id));

  const quotes =
    can.viewQuotes
      ? ofVisibleLeads(store.quotes).map((quote) =>
          can.viewPipelineValue
            ? quote
            : { ...quote, total_lkr: 0, deposit_lkr: 0, price_per_person: null, discount_amount: 0, discount_reason: null, payment_milestones: [] },
        )
      : [];

  return {
    ...store,
    leads,
    activity: ofVisibleLeads(store.activity),
    notes: ofVisibleLeads(store.notes),
    quotes,
    // Saved intents and offers carry prices; replies and alerts are the copilot's, for the roles that use it.
    copilotContexts: can.useCopilot ? ofVisibleLeads(store.copilotContexts) : [],
    copilotDismissals: can.useCopilot ? ofVisibleLeads(store.copilotDismissals) : [],
    communicationDrafts: can.draftCustomerReply ? ofVisibleLeads(store.communicationDrafts) : [],
    packages: can.viewPipelineValue
      ? store.packages
      : store.packages.map((pkg) => ({
          ...pkg,
          quad_price: null,
          triple_price: null,
          double_price: null,
          single_price: null,
          price_per_person_lkr: 0,
        })),
  };
}
