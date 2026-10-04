import { describe, expect, it } from "vitest";

import { decideLeadLink, type LeadCandidate } from "./lead-link-decision";

function lead(overrides: Partial<LeadCandidate> = {}): LeadCandidate {
  return { id: "lead-1", reference: "LD-2026-0001", full_name: "Jane Doe", mobile: "94770000000", stage: "NEW_LEAD", ...overrides };
}

describe("decideLeadLink", () => {
  it("short-circuits on a conversation already linked to a lead", () => {
    const existing = lead();
    const decision = decideLeadLink({
      existingLead: existing,
      identityMatchedLead: lead({ id: "lead-2" }),
      phoneCandidates: [lead({ id: "lead-3" }), lead({ id: "lead-4" })],
      createIfMissing: true,
    });
    expect(decision).toEqual({ action: "EXISTING", lead: existing, source: "EXISTING_CONVERSATION" });
  });

  it("prefers an exact provider-identity match over a phone match", () => {
    const identityLead = lead({ id: "lead-identity" });
    const decision = decideLeadLink({
      existingLead: null,
      identityMatchedLead: identityLead,
      phoneCandidates: [lead({ id: "lead-phone" })],
      createIfMissing: true,
    });
    expect(decision).toEqual({ action: "ATTACH", lead: identityLead, source: "EXACT_IDENTITY" });
  });

  it("attaches a single exact phone match", () => {
    const phoneLead = lead({ id: "lead-phone" });
    const decision = decideLeadLink({
      existingLead: null,
      identityMatchedLead: null,
      phoneCandidates: [phoneLead],
      createIfMissing: false,
    });
    expect(decision).toEqual({ action: "ATTACH", lead: phoneLead, source: "EXACT_PHONE" });
  });

  it("leaves two or more phone candidates ambiguous rather than guessing", () => {
    const decision = decideLeadLink({
      existingLead: null,
      identityMatchedLead: null,
      phoneCandidates: [lead({ id: "lead-a" }), lead({ id: "lead-b" })],
      createIfMissing: true,
    });
    expect(decision).toEqual({ action: "AMBIGUOUS" });
  });

  it("is ambiguous (not a create) when nothing matched and creation wasn't requested", () => {
    const decision = decideLeadLink({
      existingLead: null,
      identityMatchedLead: null,
      phoneCandidates: [],
      createIfMissing: false,
    });
    expect(decision).toEqual({ action: "AMBIGUOUS" });
  });

  it("creates a lead only when nothing matched and the caller opted in", () => {
    const decision = decideLeadLink({
      existingLead: null,
      identityMatchedLead: null,
      phoneCandidates: [],
      createIfMissing: true,
    });
    expect(decision).toEqual({ action: "CREATE" });
  });
});


describe("decideLeadLink — the identity graph (MI3.3)", () => {
  const base = { existingLead: null, identityMatchedLead: null, phoneCandidates: [] as LeadCandidate[], createIfMissing: true };

  it("a resemblance never links: a proposal creates neither a lead nor a link", () => {
    const candidate = lead({ id: "instagram-lead" });
    expect(decideLeadLink({ ...base, graph: { exact: [], proposals: [candidate] } })).toEqual({ action: "PROPOSE", candidates: [candidate] });
  });

  it("only an exact match from the graph attaches, and only when it is the single one", () => {
    const exact = lead({ id: "by-email" });
    expect(decideLeadLink({ ...base, graph: { exact: [exact], proposals: [lead({ id: "maybe" })] } })).toEqual({ action: "ATTACH", lead: exact, source: "EXACT_IDENTITY" });
    expect(decideLeadLink({ ...base, graph: { exact: [lead({ id: "a" }), lead({ id: "b" })], proposals: [] } })).toEqual({ action: "AMBIGUOUS" });
  });

  it("with nothing found, a new inbound contact still becomes a lead, exactly as before", () => {
    expect(decideLeadLink({ ...base, graph: { exact: [], proposals: [] } })).toEqual({ action: "CREATE" });
    expect(decideLeadLink(base)).toEqual({ action: "CREATE" });
  });

  it("an exact phone or known identity wins before the graph is even consulted", () => {
    const phoneLead = lead({ id: "phone" });
    expect(decideLeadLink({ ...base, phoneCandidates: [phoneLead], graph: { exact: [], proposals: [lead({ id: "maybe" })] } })).toEqual({ action: "ATTACH", lead: phoneLead, source: "EXACT_PHONE" });
  });

  it("does not propose when creation was not asked for", () => {
    expect(decideLeadLink({ ...base, createIfMissing: false, graph: { exact: [], proposals: [lead()] } })).toEqual({ action: "AMBIGUOUS" });
  });
});
