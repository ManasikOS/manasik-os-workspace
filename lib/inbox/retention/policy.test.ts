import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRetention, shouldDeleteConversationMessage } from "./policy";

describe("Inbox retention", () => {
  it("clamps settings to platform bounds", () => expect(resolveRetention({ bookingLinkedMessageRetentionYears: 1, inboxAttachmentRetentionDays: 999, webhookPayloadRetentionDays: 999 })).toMatchObject({ bookingLinkedMessageRetentionYears: 3, inboxAttachmentRetentionDays: 365, webhookPayloadRetentionDays: 90 }));
  it("does not sweep a booking-linked conversation at 24 months", () => expect(shouldDeleteConversationMessage({ lastActivityAt: new Date("2024-09-21"), now: new Date("2026-09-21"), linkedToBooking: true }, resolveRetention({}))).toBe(false));
  it("sweeps an unconverted enquiry after its window", () => expect(shouldDeleteConversationMessage({ lastActivityAt: new Date("2024-01-01"), now: new Date("2026-09-21"), linkedToBooking: false }, resolveRetention({}))).toBe(true));
  it("is identical across plan tiers because plan is not an input", () => expect(resolveRetention({})).toEqual(resolveRetention({})));
  it("enforces every platform retention bound in the database migration too", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261202092800_mi6_6_conversation_retention.sql"), "utf8");
    expect(sql).toMatch(/booking_linked_message_retention_years[^;]+between 3 and 10/);
    expect(sql).toMatch(/enquiry_message_retention_months[^;]+between 1 and 120/);
    expect(sql).toMatch(/inbox_attachment_retention_days[^;]+between 1 and 365/);
    expect(sql).toMatch(/voice_audio_retention_days[^;]+between 1 and 365/);
    expect(sql).toMatch(/intelligence_retention_months[^;]+between 1 and 120/);
    expect(sql).toMatch(/ai_run_retention_months[^;]+between 1 and 60/);
    expect(sql).toMatch(/webhook_payload_retention_days[^;]+between 1 and 90/);
  });

  it("keeps intervention evidence records when their source message expires", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261202090400_mi2_1_conversation_intelligence.sql"), "utf8");
    expect(sql).toMatch(/conversation_messages \(id, agency_id\) on delete set null \(message_id\)/);
  });
});
