import { describe, expect, it } from "vitest";

import type { LeadStore } from "@/lib/data/leads-repository";
import { emptyLeadStore } from "@/lib/data/leads-repository";
import type { LeadQuoteRow } from "@/lib/types/leads";

import { updateQuoteStatusInStore } from "./leads";
import { checkQuoteTransition } from "./quote-transitions";

describe("checkQuoteTransition", () => {
  const as = (from: Parameters<typeof checkQuoteTransition>[0]["from"], to: Parameters<typeof checkQuoteTransition>[0]["to"], isApprover = false) =>
    checkQuoteTransition({ from, to, isApprover });

  it("holds a discounted quote until an approver releases it", () => {
    expect(as("PENDING_APPROVAL", "SENT").ok).toBe(false);
    expect(as("PENDING_APPROVAL", "DRAFT").ok).toBe(false);
    expect(as("PENDING_APPROVAL", "SENT", true).ok).toBe(true);
  });

  it("lets anyone withdraw a quote that is waiting", () => {
    expect(as("PENDING_APPROVAL", "CANCELLED").ok).toBe(true);
  });

  it("will not take a quote out of a final state", () => {
    for (const from of ["DECLINED", "EXPIRED", "SUPERSEDED", "CANCELLED"] as const) {
      expect(as(from, "SENT", true).ok).toBe(false);
      expect(as(from, "ACCEPTED", true).ok).toBe(false);
    }
  });

  it("will not accept a quote that was never sent", () => {
    expect(as("DRAFT", "ACCEPTED").ok).toBe(false);
    expect(as("PENDING_APPROVAL", "ACCEPTED", true).ok).toBe(false);
  });

  it("follows the normal customer journey", () => {
    expect(as("DRAFT", "SENT").ok).toBe(true);
    expect(as("SENT", "VIEWED").ok).toBe(true);
    expect(as("VIEWED", "ACCEPTED").ok).toBe(true);
    expect(as("SENT", "DECLINED").ok).toBe(true);
    expect(as("ACCEPTED", "DECLINED").ok).toBe(true);
  });

  it("treats the same status as a no-op", () => {
    expect(as("CANCELLED", "CANCELLED").ok).toBe(true);
  });
});

describe("updateQuoteStatusInStore", () => {
  const now = "2030-01-01T00:00:00.000Z";

  function storeWith(status: LeadQuoteRow["status"]): LeadStore {
    const store = emptyLeadStore();
    store.quotes = [
      {
        id: "q1",
        lead_id: "l1",
        reference: "QT-2030-0001",
        status,
        discount_amount: 50_000,
        discount_approved_by: null,
        discount_approved_at: null,
        supersedes_quote_id: null,
      } as unknown as LeadQuoteRow,
    ];
    return store;
  }

  it("refuses to release a held quote without approval, and changes nothing", () => {
    const store = storeWith("PENDING_APPROVAL");
    const outcome = updateQuoteStatusInStore(store, { quoteId: "q1", status: "SENT", actorName: "Marketing" }, now);

    expect(outcome.ok).toBe(false);
    expect(store.quotes[0].status).toBe("PENDING_APPROVAL");
    expect(store.activity).toHaveLength(0);
  });

  it("releases it for an approver and records who approved", () => {
    const store = storeWith("PENDING_APPROVAL");
    const outcome = updateQuoteStatusInStore(
      store,
      { quoteId: "q1", status: "SENT", actorName: "Admin", approval: { approvedById: "admin-1", approvedByName: "Admin" } },
      now,
    );

    expect(outcome.ok).toBe(true);
    expect(store.quotes[0]).toMatchObject({ status: "SENT", discount_approved_by: "admin-1", discount_approved_at: now });
  });

  it("does not stamp an approval on an ordinary status change", () => {
    const store = storeWith("SENT");
    updateQuoteStatusInStore(store, { quoteId: "q1", status: "ACCEPTED", actorName: "Admin", approval: { approvedById: "admin-1", approvedByName: "Admin" } }, now);
    expect(store.quotes[0].discount_approved_by).toBeNull();
  });

  it("is a no-op, with no timeline entry, for the status it already has", () => {
    const store = storeWith("SENT");
    expect(updateQuoteStatusInStore(store, { quoteId: "q1", status: "SENT", actorName: "Marketing" }, now).ok).toBe(true);
    expect(store.activity).toHaveLength(0);
  });
});
