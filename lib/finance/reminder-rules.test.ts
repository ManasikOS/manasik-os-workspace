import { describe, expect, it } from "vitest";

import { defaultChannelForOffset, reminderOffsetsDueOn, scheduledForFromOffset } from "./reminder-rules";

const DUE_AT = "2026-09-15T00:00:00.000Z";

describe("reminderOffsetsDueOn", () => {
  it("fires T-3 three days before the due date", () => {
    expect(reminderOffsetsDueOn(DUE_AT, "2026-09-12T00:00:00.000Z")).toEqual([-3]);
  });

  it("fires T0 on the due date itself", () => {
    expect(reminderOffsetsDueOn(DUE_AT, "2026-09-15T00:00:00.000Z")).toEqual([0]);
  });

  it("fires T+3 three days after the due date", () => {
    expect(reminderOffsetsDueOn(DUE_AT, "2026-09-18T00:00:00.000Z")).toEqual([3]);
  });

  it("fires T+10 ten days after the due date", () => {
    expect(reminderOffsetsDueOn(DUE_AT, "2026-09-25T00:00:00.000Z")).toEqual([10]);
  });

  it("fires nothing on a day that matches no cadence offset", () => {
    expect(reminderOffsetsDueOn(DUE_AT, "2026-09-16T00:00:00.000Z")).toEqual([]);
  });

  it("is insensitive to time-of-day, only the calendar date", () => {
    expect(reminderOffsetsDueOn(DUE_AT, "2026-09-15T23:59:00.000Z")).toEqual([0]);
  });
});

describe("defaultChannelForOffset", () => {
  it("uses WhatsApp for T-3 and T0", () => {
    expect(defaultChannelForOffset(-3)).toBe("WHATSAPP");
    expect(defaultChannelForOffset(0)).toBe("WHATSAPP");
  });

  it("escalates to email at T+10", () => {
    expect(defaultChannelForOffset(10)).toBe("EMAIL");
  });
});

describe("scheduledForFromOffset", () => {
  it("computes the calendar date the offset points to", () => {
    expect(scheduledForFromOffset(DUE_AT, -3)).toBe("2026-09-12T00:00:00.000Z");
    expect(scheduledForFromOffset(DUE_AT, 10)).toBe("2026-09-25T00:00:00.000Z");
  });
});
