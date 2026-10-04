import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MatchedOfferSnapshot, OfferCheckState } from "@/lib/inbox/intelligence/contracts";
import { evaluateProviderSend, mentionsStoredOfferFigure, type ProviderSendAuthor } from "./authorize-provider-send";

const now = new Date("2026-09-23T10:00:00.000Z");
const offer: MatchedOfferSnapshot = {
  departureGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  packageId: null,
  seatsMatched: 3,
  roomType: "QUAD",
  pricePerPerson: 420000,
  currency: "LKR",
  pricedAt: "2026-09-01T00:00:00.000Z",
  asOf: "2026-09-10T00:00:00.000Z",
  inclusions: [],
  groupName: "November Umrah",
  departureDate: "2026-11-12",
  returnDate: "2026-11-22",
  durationDays: 10,
  totalPrice: 1260000,
  party: { adults: 3, children: 0, infants: 0 },
  fitLevel: "STRONG",
  recommendationReason: null,
  reasons: [],
  constraints: [],
  missingInformation: [],
  alternatives: [],
  earlyBirdValidUntil: null,
};

const staff: ProviderSendAuthor = { kind: "STAFF", actorId: "staff-1" };
const ai: ProviderSendAuthor = { kind: "AI", source: "APPROVED_ANSWER", action: "APPROVED_FAQ" };
const aiAllowed = { allowed: true, reasons: [], level: "L2" as const, surface: "INBOX_REPLY" as const };

function facts(overrides: Partial<Parameters<typeof evaluateProviderSend>[0]["facts"]> = {}) {
  return {
    agencyIsTest: false,
    channel: "WHATSAPP",
    state: "HUMAN_ACTIVE",
    handlingMode: "HUMAN_ACTIVE",
    assignedToId: "staff-1",
    serviceWindowExpiresAt: "2026-09-23T11:00:00.000Z",
    humanAgentWindowExpiresAt: "2026-09-29T10:00:00.000Z",
    hasOpenSupportCase: false,
    offer: null,
    offerCheck: null,
    protection: { openReviews: [], approvedAccountDigits: [] },
    ...overrides,
  };
}

describe("FIX1 provider-send authorization", () => {
  it.each([
    ["WhatsApp inside 24 hours", staff, facts(), null, true, undefined],
    ["legacy state after staff takes control", staff, facts({ handlingMode: "AI_ACTIVE" }), null, true, undefined],
    ["WhatsApp outside 24 hours", staff, facts({ serviceWindowExpiresAt: "2026-09-23T09:59:59.999Z" }), null, false, undefined],
    ["Messenger HUMAN_AGENT staff support", staff, facts({ channel: "MESSENGER", serviceWindowExpiresAt: "2026-09-23T09:00:00.000Z", hasOpenSupportCase: true }), null, true, "HUMAN_AGENT"],
    ["Instagram HUMAN_AGENT automation refusal", ai, facts({ channel: "INSTAGRAM", state: "AI_ACTIVE", handlingMode: "AI_ACTIVE", assignedToId: null, serviceWindowExpiresAt: "2026-09-23T09:00:00.000Z", hasOpenSupportCase: true }), aiAllowed, false, undefined],
    ["Messenger after seven days", staff, facts({ channel: "MESSENGER", serviceWindowExpiresAt: "2026-09-23T09:00:00.000Z", humanAgentWindowExpiresAt: "2026-09-23T09:59:59.999Z", hasOpenSupportCase: true }), null, false, undefined],
  ] as const)("handles %s", (_name, author, sendFacts, automatedAuthorization, allowed, metaTag) => {
    const result = evaluateProviderSend({ text: "We will help you.", author, now, facts: sendFacts, automatedAuthorization });
    expect(result.allowed).toBe(allowed);
    expect(result.command.metaTag).toBe(metaTag);
    if (author.kind === "AI") expect(result.automatedAuthorization?.allowed).toBe(allowed);
  });

  it("marks every send for a disposable test agency as simulated, for staff and for automation, and still applies the normal policy", () => {
    for (const [author, automatedAuthorization] of [[staff, null], [ai, aiAllowed]] as const) {
      const inside = evaluateProviderSend({ text: "We will help you.", author, now, facts: facts({ agencyIsTest: true, state: author.kind === "AI" ? "AI_ACTIVE" : "HUMAN_ACTIVE", handlingMode: author.kind === "AI" ? "AI_ACTIVE" : "HUMAN_ACTIVE", assignedToId: author.kind === "AI" ? null : "staff-1" }), automatedAuthorization });
      expect(inside.simulated).toBe(true);
      expect(inside.allowed).toBe(true);
      const outside = evaluateProviderSend({ text: "We will help you.", author, now, facts: facts({ agencyIsTest: true, serviceWindowExpiresAt: "2026-09-23T09:00:00.000Z" }), automatedAuthorization });
      expect(outside.simulated).toBe(true);
      expect(outside.allowed).toBe(false);
    }
  });

  it("refuses a send to a recipient the outbound allow-list forbids, for staff and for automation, with the reason", () => {
    const reason = "This is not the production environment and it only sends to approved test contacts; this recipient is not one of them.";
    for (const [author, automatedAuthorization] of [[staff, null], [ai, aiAllowed]] as const) {
      const aiFacts = author.kind === "AI" ? { state: "AI_ACTIVE", handlingMode: "AI_ACTIVE", assignedToId: null } : {};
      const result = evaluateProviderSend({ text: "We will help you.", author, now, facts: facts({ ...aiFacts, recipientRefusal: reason }), automatedAuthorization });
      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain(reason);
    }
  });

  it("ignores the allow-list for a test agency, whose sends never leave the process", () => {
    const result = evaluateProviderSend({ text: "We will help you.", author: staff, now, facts: facts({ agencyIsTest: true, recipientRefusal: "not approved" }), automatedAuthorization: null });
    expect(result.allowed).toBe(true);
    expect(result.simulated).toBe(true);
  });

  it("sends to an approved recipient and when there is no allow-list refusal at all", () => {
    for (const recipientRefusal of [null, undefined]) {
      expect(evaluateProviderSend({ text: "We will help you.", author: staff, now, facts: facts({ recipientRefusal }), automatedAuthorization: null }).allowed).toBe(true);
    }
  });

  it("does not mark a normal agency as simulated", () => {
    const result = evaluateProviderSend({ text: "We will help you.", author: staff, now, facts: facts({ agencyIsTest: false }), automatedAuthorization: null });
    expect(result.allowed).toBe(true);
    expect(result.simulated).toBe(false);
  });

  it("fails closed for stale price and insufficient-seat figures", () => {
    for (const offerCheck of ["PRICE_CHANGED", "SEATS_INSUFFICIENT", "NO_LONGER_AVAILABLE", null] as const satisfies readonly (OfferCheckState | null)[]) {
      const result = evaluateProviderSend({
        text: "The price is LKR 420,000 for 3 seats.",
        author: staff,
        now,
        facts: facts({ offer, offerCheck }),
        automatedAuthorization: null,
      });
      expect(result.allowed, String(offerCheck)).toBe(false);
    }
  });

  it("allows current offer figures and ignores unrelated numbers", () => {
    expect(evaluateProviderSend({ text: "LKR 420,000 for 3 seats.", author: staff, now, facts: facts({ offer, offerCheck: "FRESH" }), automatedAuthorization: null }).allowed).toBe(true);
    expect(evaluateProviderSend({ text: "Call extension 9999.", author: staff, now, facts: facts({ offer, offerCheck: "PRICE_CHANGED" }), automatedAuthorization: null }).allowed).toBe(true);
    expect(mentionsStoredOfferFigure("Total 1,260,000", offer)).toBe(true);
  });

  it("refuses staff who do not own the active conversation", () => {
    const result = evaluateProviderSend({ text: "Hello", author: { kind: "STAFF", actorId: "staff-2" }, now, facts: facts(), automatedAuthorization: null });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/assigned to another staff member/i);
  });

  it("refuses protected claims for staff and all denied automation", () => {
    const protectedFacts = facts({
      protection: {
        approvedAccountDigits: [],
        openReviews: [{ kind: "PAYMENT_CLAIM", severity: "BLOCK", headline: "Payment needs Finance review" }],
      },
    });
    expect(evaluateProviderSend({ text: "We received your payment", author: staff, now, facts: protectedFacts, automatedAuthorization: null }).allowed).toBe(false);
    expect(evaluateProviderSend({ text: "Hello", author: ai, now, facts: facts({ state: "AI_ACTIVE", handlingMode: "AI_ACTIVE", assignedToId: null }), automatedAuthorization: { ...aiAllowed, allowed: false, reasons: ["Entitlement clamp"] } }).allowed).toBe(false);
  });
});
