import { describe, expect, it } from "vitest";

import {
  assignLeadsActionSchema,
  changeStageActionSchema,
  importLeadsActionSchema,
  leadSourceActionSchema,
  logContactActionSchema,
  MAX_BULK_LEADS,
  MAX_IMPORT_ROWS,
  selectDepartureGroupActionSchema,
  updateConsentActionSchema,
  updateQuoteStatusActionSchema,
} from "./leads";

const ID = "11111111-1111-4111-8111-111111111111";

describe("Server Action input schemas", () => {
  it("caps a bulk selection and requires real ids", () => {
    const ids = (count: number) => Array.from({ length: count }, () => ID);
    expect(changeStageActionSchema.safeParse({ leadIds: ids(MAX_BULK_LEADS), stage: "CONTACTED" }).success).toBe(true);
    expect(changeStageActionSchema.safeParse({ leadIds: ids(MAX_BULK_LEADS + 1), stage: "CONTACTED" }).success).toBe(false);
    expect(changeStageActionSchema.safeParse({ leadIds: [], stage: "CONTACTED" }).success).toBe(false);
    expect(changeStageActionSchema.safeParse({ leadIds: ["not-a-uuid"], stage: "CONTACTED" }).success).toBe(false);
    expect(assignLeadsActionSchema.safeParse({ leadIds: [ID], staffId: "" }).success).toBe(false);
  });

  it("rejects a stage that is not in the pipeline", () => {
    expect(changeStageActionSchema.safeParse({ leadIds: [ID], stage: "SUPER_BOOKED" }).success).toBe(false);
  });

  it("drops fields the server must decide itself", () => {
    const parsed = logContactActionSchema.parse({
      leadId: ID,
      summary: "Called",
      nextFollowUpAt: null,
      followUpType: null,
      followUpOwnerName: "Someone Else",
      actorName: "Boss",
    });
    expect(parsed).not.toHaveProperty("followUpOwnerName");
    expect(parsed).not.toHaveProperty("actorName");

    const selected = selectDepartureGroupActionSchema.parse({ leadId: ID, departureGroupId: ID, groupLabel: "Fake label" });
    expect(selected).not.toHaveProperty("groupLabel");
  });

  it("limits free text", () => {
    expect(logContactActionSchema.safeParse({ leadId: ID, summary: "x".repeat(1001), nextFollowUpAt: null, followUpType: null }).success).toBe(false);
    expect(
      updateConsentActionSchema.safeParse({
        leadId: ID,
        consentStatus: "OPTED_IN",
        doNotContact: false,
        contactableChannels: ["WHATSAPP"],
        source: "x".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("only accepts known consent values and channels", () => {
    const base = { leadId: ID, doNotContact: false, source: "WhatsApp reply" };
    expect(updateConsentActionSchema.safeParse({ ...base, consentStatus: "MAYBE", contactableChannels: [] }).success).toBe(false);
    expect(updateConsentActionSchema.safeParse({ ...base, consentStatus: "OPTED_IN", contactableChannels: ["CARRIER_PIGEON"] }).success).toBe(false);
    expect(updateConsentActionSchema.safeParse({ ...base, consentStatus: "OPTED_IN", contactableChannels: ["WHATSAPP", "CALL"] }).success).toBe(true);
  });

  it("normalises a source label to a code and rejects junk", () => {
    expect(leadSourceActionSchema.parse({ code: " Mosque Event ", label: "Mosque Event", active: true }).code).toBe("MOSQUE_EVENT");
    expect(leadSourceActionSchema.safeParse({ code: "a", label: "A", active: true }).success).toBe(false);
    expect(leadSourceActionSchema.safeParse({ code: "DROP TABLE;--", label: "x", active: true }).success).toBe(false);
    expect(leadSourceActionSchema.safeParse({ code: "OK_CODE", label: "", active: true }).success).toBe(false);
  });

  it("only accepts real quote statuses", () => {
    expect(updateQuoteStatusActionSchema.safeParse({ quoteId: ID, status: "SENT" }).success).toBe(true);
    expect(updateQuoteStatusActionSchema.safeParse({ quoteId: ID, status: "APPROVED_BY_ME" }).success).toBe(false);
  });
});

describe("importLeadsActionSchema", () => {
  const row = {
    fullName: "Ayesha Mariyam",
    mobile: "0772105543",
    email: "",
    city: "Kalutara",
    preferredLanguage: "English",
    preferredChannel: "WHATSAPP",
    journeyType: "UMRAH",
    interestedIn: "Umrah",
    packageId: null,
    preferredPeriod: "Dec",
    adults: 2,
    children: 1,
    roomPreference: "UNDECIDED",
    departureCity: "Colombo",
    budgetRange: "Not discussed",
    quotaWaitlistInterest: false,
    source: "WALK_IN",
    campaignReference: "",
    referralName: "",
    assignedToId: "staff-1",
    stage: "NEW_LEAD",
    temperature: "WARM",
    nextFollowUpAt: "2030-01-01T10:00:00.000Z",
    followUpType: "CALL",
    followUpOwnerId: "staff-1",
    notes: "",
  };

  it("accepts a normal row", () => {
    expect(importLeadsActionSchema.safeParse([row]).success).toBe(true);
  });

  it("rejects an absurd party size, an overlong note and too many rows", () => {
    expect(importLeadsActionSchema.safeParse([{ ...row, adults: 1_000_000_000 }]).success).toBe(false);
    expect(importLeadsActionSchema.safeParse([{ ...row, notes: "x".repeat(2001) }]).success).toBe(false);
    expect(importLeadsActionSchema.safeParse(Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => row)).success).toBe(false);
    expect(importLeadsActionSchema.safeParse([]).success).toBe(false);
  });
});
