import { describe, expect, it } from "vitest";

import {
  CONVERSION_CATALOGUE,
  CONVERSION_KINDS,
  conversionBlocker,
  conversionKindSchema,
  conversionTitle,
  offeredConversions,
  type ConversationConversionFacts,
} from "./catalogue";

/** A customer with a lead, a group, a booking with two travellers and a profile — everything a booked customer has. */
const booked = (overrides: Partial<ConversationConversionFacts> = {}): ConversationConversionFacts => ({
  sourceMessageId: "m1",
  leadId: "l1",
  departureGroupId: "g1",
  departureGroupName: "December Umrah",
  bookingId: "b1",
  travellerCount: 2,
  pilgrimId: "p1",
  hasTravellerProfile: true,
  hasContactNumber: true,
  ...overrides,
});

/** An enquiry: a lead and a chosen group, but no booking, no traveller record yet. */
const enquiry = (overrides: Partial<ConversationConversionFacts> = {}): ConversationConversionFacts =>
  booked({ bookingId: null, travellerCount: 0, pilgrimId: null, hasTravellerProfile: false, ...overrides });

const availableKinds = (facts: ConversationConversionFacts) => offeredConversions(facts).filter((option) => option.available).map((option) => option.kind);

describe("conversion catalogue", () => {
  it("describes every kind, and only the kinds the schema accepts", () => {
    expect(Object.keys(CONVERSION_CATALOGUE).sort()).toEqual([...CONVERSION_KINDS].sort());
    for (const kind of CONVERSION_KINDS) expect(conversionKindSchema.safeParse(kind).success).toBe(true);
    expect(conversionKindSchema.safeParse("CONVERSATION_REFUND_PAYMENT").success).toBe(false);
    expect(CONVERSION_KINDS).toHaveLength(12);
  });

  it("offers a booked customer everything that makes sense after a booking — and not a second hold or profile", () => {
    const kinds = availableKinds(booked());
    expect(kinds).toContain("CONVERSATION_TRAVELLER_RELATIONSHIP");
    expect(kinds).toContain("CONVERSATION_COMPLAINT_CASE");
    expect(kinds).not.toContain("CONVERSATION_SEAT_HOLD");
    expect(kinds).not.toContain("CONVERSATION_PILGRIM_PROFILE");
  });

  it("offers an enquiry a seat hold and a profile, but no booking-shaped conversion", () => {
    const kinds = availableKinds(enquiry());
    expect(kinds).toContain("CONVERSATION_SEAT_HOLD");
    expect(kinds).toContain("CONVERSATION_PILGRIM_PROFILE");
    expect(kinds).toContain("CONVERSATION_PACKAGE_RECOMMENDATION");
    expect(kinds).not.toContain("CONVERSATION_TRAVELLER_RELATIONSHIP");
    expect(kinds).not.toContain("CONVERSATION_COMPLAINT_CASE");
  });

  it("says why an option is not available, in words a salesperson can act on", () => {
    expect(conversionBlocker("CONVERSATION_ROOMING_REQUEST", enquiry({ departureGroupId: null }))).toBe("Select a departure group for this customer first.");
    expect(conversionBlocker("CONVERSATION_COMPLAINT_CASE", enquiry())).toContain("no traveller record");
    expect(conversionBlocker("CONVERSATION_TRAVELLER_RELATIONSHIP", enquiry())).toBe("This customer has no booking yet.");
    expect(conversionBlocker("CONVERSATION_TRAVELLER_RELATIONSHIP", booked({ travellerCount: 1 }))).toBe("A relationship needs two travellers on the booking.");
    expect(conversionBlocker("CONVERSATION_SEAT_HOLD", booked())).toBe("This customer already has a booking or a seat hold.");
    expect(conversionBlocker("CONVERSATION_SEAT_HOLD", enquiry({ hasContactNumber: false }))).toBe("Add the customer's phone number to their lead first.");
    expect(conversionBlocker("CONVERSATION_PILGRIM_PROFILE", booked())).toBe("This customer already has a traveller record.");
    expect(conversionBlocker("CONVERSATION_PACKAGE_RECOMMENDATION", enquiry({ leadId: null }))).toBe("Link this conversation to a lead first.");
  });

  it("offers nothing from a conversation with no messages, because there is nothing to point back at", () => {
    for (const option of offeredConversions(booked({ sourceMessageId: null }))) {
      expect(option.available).toBe(false);
      expect(option.reason).toBe("This conversation has no messages to point back at.");
    }
  });

  it("declares what the person must choose, and nothing for a one-tap conversion", () => {
    expect(CONVERSION_CATALOGUE.CONVERSATION_SEAT_HOLD.fields.map((field) => field.name)).toEqual(["seats"]);
    expect(CONVERSION_CATALOGUE.CONVERSATION_TRAVELLER_RELATIONSHIP.fields.map((field) => field.name)).toEqual(["fromTravellerId", "relationship", "toTravellerId", "isMahram"]);
    expect(CONVERSION_CATALOGUE.CONVERSATION_PACKAGE_RECOMMENDATION.fields.map((field) => field.name)).toEqual(["packageId"]);
    expect(CONVERSION_CATALOGUE.CONVERSATION_FEEDBACK_REQUEST.fields.map((field) => field.name)).toEqual(["surveyId"]);
    for (const kind of ["CONVERSATION_DOCUMENT_REQUEST", "CONVERSATION_VISA_TASK", "CONVERSATION_COMPLAINT_CASE", "CONVERSATION_PILGRIM_PROFILE"] as const) {
      expect(CONVERSION_CATALOGUE[kind].fields).toHaveLength(0);
    }
  });

  it("titles the task with the customer and their reference", () => {
    expect(conversionTitle("CONVERSATION_DOCUMENT_REQUEST", "Amina", "LD-1042")).toBe("Request documents — Amina (LD-1042)");
    expect(conversionTitle("CONVERSATION_VISA_TASK", "  ", null)).toBe("Visa follow-up — Customer");
  });

  it("puts each task-shaped conversion on the right team's board", () => {
    expect(CONVERSION_CATALOGUE.CONVERSATION_VISA_TASK.taskCategory).toBe("VISA");
    expect(CONVERSION_CATALOGUE.CONVERSATION_PAYMENT_FOLLOW_UP.taskCategory).toBe("FINANCE");
    expect(CONVERSION_CATALOGUE.CONVERSATION_GUIDE_ESCALATION.taskCategory).toBe("GUIDE");
    expect(CONVERSION_CATALOGUE.CONVERSATION_FEEDBACK_REQUEST.taskCategory).toBe("MARKETING");
    expect(CONVERSION_CATALOGUE.CONVERSATION_COMPLAINT_CASE.taskCategory).toBeUndefined();
  });
});
