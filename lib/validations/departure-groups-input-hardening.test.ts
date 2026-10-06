import { describe, expect, it } from "vitest";

import {
  addChargeSchema,
  bookingReminderSchema,
  cancelBookingSchema,
  createGroupTaskSchema,
  editBookingSchema,
  entityId,
  groupBookingSchema,
  optionalEntityId,
  phoneNumberSchema,
  recordPaymentSchema,
} from "./departure-groups";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

const validBooking = {
  departureGroupId: ID,
  bookingReference: "ABC-BK001",
  bookingStatus: "HELD" as const,
  primaryContactName: "Aisha Rahman",
  primaryContactPhone: "+94 77 123 4567",
  travellerCount: 2,
  roomOccupancyPreference: "QUAD" as const,
  packagePricePerPerson: 500000,
  amountPaid: 0,
};

describe("entityId", () => {
  it("accepts a uuid, trimmed, and refuses everything else", () => {
    expect(entityId().safeParse(`  ${ID}  `).success).toBe(true);
    for (const bad of ["", "abc", "g1", "'; drop table x;--", `${ID}x`, "../etc/passwd"]) {
      expect(entityId().safeParse(bad).success, bad).toBe(false);
    }
  });

  it("treats a cleared optional picker as none", () => {
    expect(optionalEntityId.safeParse("").success).toBe(true);
    expect(optionalEntityId.safeParse(undefined).success).toBe(true);
    expect(optionalEntityId.safeParse(null).success).toBe(true);
    expect(optionalEntityId.safeParse("nope").success).toBe(false);
  });
});

describe("ids on the mutating schemas", () => {
  it("refuses a malformed group or booking id", () => {
    expect(recordPaymentSchema.safeParse({ bookingId: "b1", departureGroupId: ID, amount: 10 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ bookingId: ID2, departureGroupId: ID, amount: 10 }).success).toBe(true);
    expect(cancelBookingSchema.safeParse({ bookingId: ID2, departureGroupId: "x", reason: "Customer asked" }).success).toBe(false);
    expect(addChargeSchema.safeParse({ departureGroupId: ID, groupPilgrimId: "1", chargeType: "ADDON", label: "Meal", amount: 5 }).success).toBe(false);
  });
});

describe("groupBookingSchema bounds", () => {
  it("accepts a normal booking", () => {
    expect(groupBookingSchema.safeParse(validBooking).success).toBe(true);
  });

  it("caps text lengths", () => {
    expect(groupBookingSchema.safeParse({ ...validBooking, primaryContactName: "x".repeat(121) }).success).toBe(false);
    expect(groupBookingSchema.safeParse({ ...validBooking, bookingReference: "R".repeat(41) }).success).toBe(false);
    const travellers = [{ fullName: "y".repeat(121) }, { fullName: "Second Traveller" }];
    expect(groupBookingSchema.safeParse({ ...validBooking, travellers }).success).toBe(false);
  });

  it("caps money and the traveller list", () => {
    expect(groupBookingSchema.safeParse({ ...validBooking, packagePricePerPerson: 1e12 }).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => ({ fullName: `Traveller ${i + 1}` }));
    expect(groupBookingSchema.safeParse({ ...validBooking, travellerCount: 51, travellers: many }).success).toBe(false);
  });

  it("still requires the traveller list to match the count, and a sane passport", () => {
    expect(groupBookingSchema.safeParse({ ...validBooking, travellers: [{ fullName: "Only One" }] }).success).toBe(false);
    const two = [{ fullName: "First Traveller", passportNumber: "N1234567" }, { fullName: "Second Traveller" }];
    expect(groupBookingSchema.safeParse({ ...validBooking, travellers: two }).success).toBe(true);
    const bad = [{ fullName: "First Traveller", passportNumber: "N12<script>" }, { fullName: "Second Traveller" }];
    expect(groupBookingSchema.safeParse({ ...validBooking, travellers: bad }).success).toBe(false);
  });
});

describe("phone numbers", () => {
  it("accepts typical formats and refuses letters or markup", () => {
    for (const ok of ["+94771234567", "077-123 4567", "(011) 234 5678"]) {
      expect(phoneNumberSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["N/A", "call me", "<b>1234567</b>", "1".repeat(26), "123"]) {
      expect(phoneNumberSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(editBookingSchema.safeParse({ bookingId: ID, departureGroupId: ID2, primaryContactName: "Aisha", primaryContactPhone: "abcdefg" }).success).toBe(false);
  });
});

describe("tasks and reminders", () => {
  it("caps the task owner name", () => {
    const base = { departureGroupId: ID, title: "Confirm hotel", ownerName: "Nimal", dueAt: "2026-12-01T09:00:00Z", category: "OTHER" };
    expect(createGroupTaskSchema.safeParse({ ...base, ownerName: "n".repeat(121) }).success).toBe(false);
  });

  it("caps the reminder recipient", () => {
    const base = { bookingId: ID, departureGroupId: ID2, kind: "PAYMENT", channel: "SMS", message: "Please settle the balance.", recipientName: "Aisha", recipientPhone: "+94771234567" };
    expect(bookingReminderSchema.safeParse(base).success).toBe(true);
    expect(bookingReminderSchema.safeParse({ ...base, recipientPhone: "9".repeat(201) }).success).toBe(false);
  });
});
