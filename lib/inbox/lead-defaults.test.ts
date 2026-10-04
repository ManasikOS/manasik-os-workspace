import { describe, expect, it } from "vitest";

import { NEW_CHAT_LEAD_FOLLOW_UP_MINUTES, newChatLeadActivity, newChatLeadFollowUpFields } from "@/lib/inbox/lead-defaults";

describe("newChatLeadFollowUpFields", () => {
  it("schedules a WhatsApp follow-up for the owner one hour out", () => {
    const now = new Date("2026-09-19T10:00:00.000Z");
    const fields = newChatLeadFollowUpFields({ id: "staff-1", name: "Afras" }, now);
    expect(NEW_CHAT_LEAD_FOLLOW_UP_MINUTES).toBe(60);
    expect(fields.next_follow_up_at).toBe("2026-09-19T11:00:00.000Z");
    expect(fields.follow_up_type).toBe("WHATSAPP_MESSAGE");
    expect(fields.follow_up_owner_id).toBe("staff-1");
    expect(fields.follow_up_owner_name).toBe("Afras");
  });
});

describe("newChatLeadActivity", () => {
  it("logs creation and the scheduled follow-up, like the Leads page", () => {
    const rows = newChatLeadActivity("agency-1", "lead-1", "Lead captured.", "Inbox");
    expect(rows.map((row) => row.type)).toEqual(["CREATED", "FOLLOW_UP_SCHEDULED"]);
    expect(rows.every((row) => row.lead_id === "lead-1" && row.agency_id === "agency-1")).toBe(true);
  });
});
