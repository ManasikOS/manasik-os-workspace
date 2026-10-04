/** Test-only builders for `RiskFacts`, so each detector test states only what it cares about. */

import type { MatchedOfferSnapshot } from "@/lib/inbox/intelligence/contracts";

import type { RiskFacts, RiskMessage } from "./types";

export const NOW = "2026-09-21T10:00:00.000Z";
export const MESSAGE_ID = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";

export const customerMessage = (text: string, over: Partial<RiskMessage> = {}): RiskMessage => ({ id: MESSAGE_ID, text, type: "TEXT", createdAt: NOW, attachmentName: null, ...over });

export const facts = (over: Partial<RiskFacts> = {}): RiskFacts => ({
  now: NOW,
  latest: null,
  awaitingReply: true,
  outbound: [],
  intentConfidence: 0.9,
  matchedOffer: null,
  offerCheck: null,
  partySize: null,
  accessibilityNeeds: [],
  requestedGroup: null,
  payments: null,
  approvedAccounts: [],
  passengers: [],
  departureDate: null,
  passportValidityMonths: 6,
  serviceWindowExpiresAt: null,
  composing: null,
  claimedReferences: [],
  ...over,
});

export const offer = (over: Partial<MatchedOfferSnapshot> = {}): MatchedOfferSnapshot => ({
  departureGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  packageId: null,
  seatsMatched: 20,
  roomType: "QUAD",
  pricePerPerson: 420000,
  currency: "LKR",
  pricedAt: "2026-09-01T00:00:00.000Z",
  asOf: "2026-09-10T00:00:00.000Z",
  inclusions: [],
  groupName: "Nov Umrah",
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
  ...over,
});
