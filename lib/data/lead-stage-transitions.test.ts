import { describe, expect, it } from "vitest";

import { checkStageTransition } from "./lead-stage-transitions";
import { changeLeadStageInStore, createLeadInStore, type CreateLeadInput } from "./leads";
import { emptyLeadStore } from "./leads-repository";

describe("checkStageTransition", () => {
  const open = { hasBooking: false, hasAcceptedQuote: false };

  it("allows a move to the same stage", () => {
    expect(checkStageTransition({ from: "QUALIFIED", to: "QUALIFIED", ...open })).toEqual({ ok: true });
  });

  it("never lets a stage change reach Booked", () => {
    for (const from of ["NEW_LEAD", "QUALIFIED", "DEPOSIT_PENDING", "LOST"] as const) {
      const verdict = checkStageTransition({ from, to: "BOOKED", hasBooking: false, hasAcceptedQuote: true });
      expect(verdict.ok).toBe(false);
    }
  });

  it("needs an accepted quote for Deposit Pending", () => {
    expect(checkStageTransition({ from: "NEGOTIATION", to: "DEPOSIT_PENDING", ...open }).ok).toBe(false);
    expect(checkStageTransition({ from: "NEGOTIATION", to: "DEPOSIT_PENDING", hasBooking: false, hasAcceptedQuote: true })).toEqual({ ok: true });
  });

  it("refuses any move once a booking is linked", () => {
    expect(checkStageTransition({ from: "BOOKED", to: "LOST", hasBooking: true, hasAcceptedQuote: true }).ok).toBe(false);
  });

  it("leaves the rest of the pipeline free, including reopening a closed lead", () => {
    expect(checkStageTransition({ from: "LOST", to: "CONTACTED", ...open }).ok).toBe(true);
    expect(checkStageTransition({ from: "NEW_LEAD", to: "NEGOTIATION", ...open }).ok).toBe(true);
    expect(checkStageTransition({ from: "CONTACTED", to: "SPAM", ...open }).ok).toBe(true);
  });
});

describe("changeLeadStageInStore applies the rules", () => {
  const input: CreateLeadInput = {
    fullName: "Test Customer",
    mobile: "771234567",
    email: "",
    city: "Colombo",
    preferredLanguage: "English",
    preferredChannel: "WHATSAPP",
    journeyType: "UMRAH",
    interestedIn: "Umrah",
    packageId: null,
    preferredPeriod: "Ramadan",
    adults: 2,
    children: 0,
    roomPreference: "UNDECIDED",
    departureCity: "Colombo",
    budgetRange: "Not discussed",
    quotaWaitlistInterest: false,
    source: "WHATSAPP",
    campaignReference: "",
    referralName: "",
    assignedToId: "staff-1",
    assignedToName: "Amina",
    stage: "NEW_LEAD",
    temperature: "WARM",
    nextFollowUpAt: "2030-01-01T09:00:00.000Z",
    followUpType: "CALL",
    followUpOwnerId: "staff-1",
    followUpOwnerName: "Amina",
    notes: "",
  };
  const now = "2030-01-01T00:00:00.000Z";

  function storeWithLead() {
    const store = emptyLeadStore();
    const created = createLeadInStore(store, input, now, { reference: "LD-2030-0001" });
    return { store, leadId: created.lead!.id };
  }

  it("uses the reference it is given instead of deriving one", () => {
    const { store } = storeWithLead();
    expect(store.leads[0].reference).toBe("LD-2030-0001");
  });

  it("rejects a manual move to Booked", () => {
    const { store, leadId } = storeWithLead();
    const outcome = changeLeadStageInStore(store, { leadId, stage: "BOOKED", actorName: "Amina" }, now);
    expect(outcome.ok).toBe(false);
    expect(store.leads[0].stage).toBe("NEW_LEAD");
  });

  it("allows Deposit Pending only with an accepted quote on that lead", () => {
    const { store, leadId } = storeWithLead();
    expect(changeLeadStageInStore(store, { leadId, stage: "DEPOSIT_PENDING", actorName: "Amina" }, now).ok).toBe(false);

    store.quotes.push({ id: "q1", lead_id: leadId, status: "ACCEPTED" } as never);
    expect(changeLeadStageInStore(store, { leadId, stage: "DEPOSIT_PENDING", actorName: "Amina" }, now).ok).toBe(true);
    expect(store.leads[0].stage).toBe("DEPOSIT_PENDING");
  });

  it("does not count another lead's accepted quote", () => {
    const { store, leadId } = storeWithLead();
    store.quotes.push({ id: "q1", lead_id: "some-other-lead", status: "ACCEPTED" } as never);
    expect(changeLeadStageInStore(store, { leadId, stage: "DEPOSIT_PENDING", actorName: "Amina" }, now).ok).toBe(false);
  });
});
