import { describe, expect, it } from "vitest";

import { emptyLeadStore } from "@/lib/data/leads-repository";
import { markQuoteSentInStore, recordQuoteInStore, type RecordQuoteInput } from "@/lib/data/leads";
import type { LeadRow } from "@/lib/types/leads";

/**
 * The Quick Chat popup stores a quote first and records it as sent only after the channel accepted the message. A quote that was
 * never sent must therefore leave no "sent" trace on the lead, and marking it sent must happen exactly once.
 */

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2030-01-10T10:00:00.000Z";

function storeWithLead(stage = "QUALIFIED") {
  const store = emptyLeadStore();
  store.leads.push({ id: LEAD_ID, reference: "LD-1", stage, booking_id: null, updated_at: "2030-01-01T00:00:00.000Z" } as unknown as LeadRow);
  return store;
}

const quote = (overrides: Record<string, unknown> = {}) =>
  ({
    reference: "QT-1",
    status: "DRAFT",
    sent_via: null,
    sent_at: null,
    total_lkr: 1,
    deposit_lkr: 1,
    ...overrides,
  }) as unknown as RecordQuoteInput["quote"];

describe("deferred quote send", () => {
  it("stores a deferred quote without a sent entry or a stage change", () => {
    const store = storeWithLead();
    const outcome = recordQuoteInStore(store, { leadId: LEAD_ID, actorName: "Amina", deferSend: true, quote: quote() }, NOW);

    expect(outcome.ok).toBe(true);
    expect(store.quotes).toHaveLength(1);
    expect(store.activity.filter((entry) => entry.type === "QUOTE_SENT")).toHaveLength(0);
    expect(store.leads[0]?.stage).toBe("QUALIFIED");
  });

  it("marking it sent records the send, the channel and the stage once", () => {
    const store = storeWithLead();
    recordQuoteInStore(store, { leadId: LEAD_ID, actorName: "Amina", deferSend: true, quote: quote() }, NOW);

    const first = markQuoteSentInStore(store, { leadId: LEAD_ID, reference: "QT-1", sentVia: "WHATSAPP", actorName: "Amina" }, NOW);
    const second = markQuoteSentInStore(store, { leadId: LEAD_ID, reference: "QT-1", sentVia: "WHATSAPP", actorName: "Amina" }, NOW);

    expect(first.ok && second.ok).toBe(true);
    expect(store.quotes[0]).toMatchObject({ status: "SENT", sent_via: "WHATSAPP", sent_at: NOW });
    expect(store.activity.filter((entry) => entry.type === "QUOTE_SENT")).toHaveLength(1);
    expect(store.leads[0]?.stage).toBe("PROPOSAL_SENT");
  });

  it("does not move a lead that is already past the early stages", () => {
    const store = storeWithLead("NEGOTIATION");
    recordQuoteInStore(store, { leadId: LEAD_ID, actorName: "Amina", deferSend: true, quote: quote() }, NOW);
    markQuoteSentInStore(store, { leadId: LEAD_ID, reference: "QT-1", sentVia: "WHATSAPP", actorName: "Amina" }, NOW);
    expect(store.leads[0]?.stage).toBe("NEGOTIATION");
  });

  it("refuses an unknown quote and a quote that is not a draft", () => {
    const store = storeWithLead();
    expect(markQuoteSentInStore(store, { leadId: LEAD_ID, reference: "NOPE", sentVia: "WHATSAPP", actorName: "A" }, NOW).ok).toBe(false);

    recordQuoteInStore(store, { leadId: LEAD_ID, actorName: "A", quote: quote({ status: "CANCELLED" }) }, NOW);
    expect(markQuoteSentInStore(store, { leadId: LEAD_ID, reference: "QT-1", sentVia: "WHATSAPP", actorName: "A" }, NOW).ok).toBe(false);
  });

  it("an ordinary quote still records the send straight away", () => {
    const store = storeWithLead();
    recordQuoteInStore(store, { leadId: LEAD_ID, actorName: "A", quote: quote({ status: "SENT", sent_via: "EMAIL", sent_at: NOW }) }, NOW);
    expect(store.activity.filter((entry) => entry.type === "QUOTE_SENT")).toHaveLength(1);
    expect(store.leads[0]?.stage).toBe("PROPOSAL_SENT");
  });
});
