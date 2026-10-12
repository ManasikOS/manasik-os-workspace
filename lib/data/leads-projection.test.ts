import { describe, expect, it } from "vitest";

import { capabilitiesForLeads } from "@/lib/access/leads-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { LeadRow } from "@/lib/types/leads";

import { projectLeadStoreForRole } from "./leads-projection";
import { emptyLeadStore, type LeadStore } from "./leads-repository";

function fixture(): LeadStore {
  const store = emptyLeadStore();
  store.leads = [
    { id: "open", reference: "LD-1", booking_id: null, estimated_value_lkr: 900_000 } as LeadRow,
    { id: "booked", reference: "LD-2", booking_id: "b1", estimated_value_lkr: 1_200_000 } as LeadRow,
  ];
  store.activity = [
    { id: "a1", lead_id: "open", message: "open event" },
    { id: "a2", lead_id: "booked", message: "booked event" },
  ] as never;
  store.notes = [
    { id: "n1", lead_id: "open", body: "private open note" },
    { id: "n2", lead_id: "booked", body: "booked note" },
  ] as never;
  store.quotes = [
    { id: "q1", lead_id: "open", total_lkr: 900_000, deposit_lkr: 180_000, price_per_person: 450_000, discount_amount: 0, discount_reason: null, payment_milestones: [] },
    { id: "q2", lead_id: "booked", total_lkr: 1_200_000, deposit_lkr: 240_000, price_per_person: 600_000, discount_amount: 0, discount_reason: null, payment_milestones: [] },
  ] as never;
  store.copilotContexts = [{ lead_id: "open" }, { lead_id: "booked" }] as never;
  store.communicationDrafts = [{ id: "d1", lead_id: "open" }] as never;
  store.packages = [
    { id: "p1", name: "Economy", journey_type: "UMRAH", currency: "LKR", quad_price: 450_000, triple_price: 500_000, double_price: 550_000, single_price: 700_000, price_per_person_lkr: 450_000 },
  ];
  return store;
}

const project = (role: StaffRole) => projectLeadStoreForRole(fixture(), capabilitiesForLeads(role));

describe("projectLeadStoreForRole", () => {
  it("gives an administrator everything", () => {
    const store = project("ADMIN");
    expect(store.leads).toHaveLength(2);
    expect(store.notes).toHaveLength(2);
    expect(store.quotes).toHaveLength(2);
    expect(store.leads[0].estimated_value_lkr).toBe(900_000);
    expect(store.packages[0].quad_price).toBe(450_000);
  });

  it("limits Operations and Visa to converted leads — and to those leads' rows only", () => {
    for (const role of ["OPERATIONS", "VISA"] as const) {
      const store = project(role);
      expect(store.leads.map((lead) => lead.id)).toEqual(["booked"]);
      expect(store.notes.map((note) => note.lead_id)).toEqual(["booked"]);
      expect(store.activity.map((row) => row.lead_id)).toEqual(["booked"]);
      expect(JSON.stringify(store)).not.toContain("private open note");
    }
  });

  it("sends no money to a role that does not see money", () => {
    for (const role of ["OPERATIONS", "VISA"] as const) {
      const store = project(role);
      expect(store.leads[0].estimated_value_lkr).toBe(0);
      expect(store.quotes).toEqual([]);
      expect(store.packages[0]).toMatchObject({ quad_price: null, price_per_person_lkr: 0 });
      expect(JSON.stringify(store)).not.toMatch(/1200000|900000|450000/);
    }
  });

  it("lets Finance see money and quotes, but only for converted leads", () => {
    const store = project("FINANCE");
    expect(store.leads.map((lead) => lead.id)).toEqual(["booked"]);
    expect(store.quotes.map((quote) => quote.id)).toEqual(["q2"]);
    expect(store.leads[0].estimated_value_lkr).toBe(1_200_000);
  });

  it("gives the CEO an overview without the copilot's drafts", () => {
    const store = project("CEO");
    expect(store.leads).toHaveLength(2);
    expect(store.copilotContexts).toHaveLength(2);
    expect(store.communicationDrafts).toEqual([]);
  });

  it("gives Marketing the drafts and contexts", () => {
    const store = project("MARKETING");
    expect(store.communicationDrafts).toHaveLength(1);
    expect(store.copilotContexts).toHaveLength(2);
  });

  it("does not change the store it was given", () => {
    const original = fixture();
    projectLeadStoreForRole(original, capabilitiesForLeads("OPERATIONS"));
    expect(original.leads).toHaveLength(2);
    expect(original.leads[0].estimated_value_lkr).toBe(900_000);
  });
});
