import { describe, expect, it, vi } from "vitest";
import { buildInboxIntakeToolSet } from "./registry";

vi.mock("server-only", () => ({}));

describe("Inbox intake tool set", () => {
  it("never exposes a booking, inventory-hold or money-writing tool", () => {
    const ctx = { db: {}, agencyId: "a" } as never;
    const tools = buildInboxIntakeToolSet(ctx, { lead_capture_enabled: false, booking_enabled: true, handoff_enabled: false, max_turns_per_conversation: 10, knowledge_base_available: false }, { record: vi.fn() } as never);
    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["start_booking", "record_traveller", "confirm_and_hold_booking"]));
  });
});
