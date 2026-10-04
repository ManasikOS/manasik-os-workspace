import { describe, expect, it } from "vitest";

import { followupSettingsSchema } from "@/lib/validations/followups";

const valid = {
  followupsEnabled: true,
  followupsDryRun: true,
  followupDelaysHours: [3, 22, 72],
  followupMessageText: "Hi {name}, checking in.",
  followupWhatsappTemplateId: null,
  handoffAlertMinutes: 15,
  handoffEscalationMinutes: 60,
};

describe("followupSettingsSchema", () => {
  it("accepts the defaults", () => {
    expect(followupSettingsSchema.safeParse(valid).success).toBe(true);
  });

  it("requires delays to be strictly increasing", () => {
    expect(followupSettingsSchema.safeParse({ ...valid, followupDelaysHours: [3, 3] }).success).toBe(false);
    expect(followupSettingsSchema.safeParse({ ...valid, followupDelaysHours: [22, 3] }).success).toBe(false);
  });

  it("allows 1 to 3 delays only", () => {
    expect(followupSettingsSchema.safeParse({ ...valid, followupDelaysHours: [] }).success).toBe(false);
    expect(followupSettingsSchema.safeParse({ ...valid, followupDelaysHours: [1, 2, 3, 4] }).success).toBe(false);
    expect(followupSettingsSchema.safeParse({ ...valid, followupDelaysHours: [5] }).success).toBe(true);
  });

  it("bounds each delay to 1–720 hours", () => {
    expect(followupSettingsSchema.safeParse({ ...valid, followupDelaysHours: [0] }).success).toBe(false);
    expect(followupSettingsSchema.safeParse({ ...valid, followupDelaysHours: [721] }).success).toBe(false);
    expect(followupSettingsSchema.safeParse({ ...valid, followupDelaysHours: [720] }).success).toBe(true);
  });

  it("rejects empty, whitespace-only and over-long text", () => {
    expect(followupSettingsSchema.safeParse({ ...valid, followupMessageText: "   " }).success).toBe(false);
    expect(followupSettingsSchema.safeParse({ ...valid, followupMessageText: "a".repeat(501) }).success).toBe(false);
    expect(followupSettingsSchema.safeParse({ ...valid, followupMessageText: "a".repeat(500) }).success).toBe(true);
  });

  it("strips control characters from the text", () => {
    const parsed = followupSettingsSchema.parse({ ...valid, followupMessageText: "Hi\u0000 there\u0007" });
    expect(parsed.followupMessageText).toBe("Hi there");
  });

  it("keeps the escalation time at or above the alert time", () => {
    expect(followupSettingsSchema.safeParse({ ...valid, handoffAlertMinutes: 30, handoffEscalationMinutes: 20 }).success).toBe(false);
    expect(followupSettingsSchema.safeParse({ ...valid, handoffAlertMinutes: 30, handoffEscalationMinutes: 30 }).success).toBe(true);
  });

  it("bounds the alert ranges", () => {
    expect(followupSettingsSchema.safeParse({ ...valid, handoffAlertMinutes: 0 }).success).toBe(false);
    expect(followupSettingsSchema.safeParse({ ...valid, handoffAlertMinutes: 1441, handoffEscalationMinutes: 2000 }).success).toBe(false);
    expect(followupSettingsSchema.safeParse({ ...valid, handoffEscalationMinutes: 10081 }).success).toBe(false);
  });
});
