import { describe, expect, it } from "vitest";

import { addBusinessMinutes, isWithinBusinessHours, localParts, localToUtc, nextOpening, parseWorkingHours, workingHoursSchema } from "./business-hours";

const TZ = "Asia/Colombo";
/** An instant written as Colombo wall-clock time (UTC+05:30, no daylight saving). */
const colombo = (text: string) => new Date(`${text}+05:30`);
const show = (date: Date) => date.toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T");

// Mon–Fri 09:00–17:00, Saturday 09:00–13:00, Sunday closed; 25 Dec 2026 (a Friday) is a holiday.
const calendar = parseWorkingHours({
  weekly: { mon: ["09:00-17:00"], tue: ["09:00-17:00"], wed: ["09:00-17:00"], thu: ["09:00-17:00"], fri: ["09:00-17:00"], sat: ["09:00-13:00"], sun: [] },
  holidays: ["2026-12-25"],
});

describe("parseWorkingHours", () => {
  it("reads the documented shape", () => {
    expect(calendar).not.toBeNull();
    expect(calendar?.weekly[1]).toEqual([{ startMinute: 540, endMinute: 1020 }]);
    expect(calendar?.weekly[0]).toEqual([]);
    expect(calendar?.holidays.has("2026-12-25")).toBe(true);
  });

  it("means 'always open' (null) for the empty object every agency has today, and for anything unusable", () => {
    for (const raw of [{}, null, undefined, "9-5", 42, [], { weekly: {} }, { weekly: { mon: [] } }, { weekly: { mon: ["nine to five"] } }, { weekly: { mon: ["17:00-09:00"] } }]) {
      expect(parseWorkingHours(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("ignores a bad window or holiday but keeps the good ones, and merges overlaps", () => {
    const parsed = parseWorkingHours({ weekly: { mon: ["09:00-12:00", "11:00-14:00", "junk", "18:00-17:00"] }, holidays: ["2026-12-25", "25/12/2026", 5] });
    expect(parsed?.weekly[1]).toEqual([{ startMinute: 540, endMinute: 840 }]);
    expect([...(parsed?.holidays ?? [])]).toEqual(["2026-12-25"]);
  });

  it("has a schema for the settings form that rejects a malformed window", () => {
    expect(workingHoursSchema.safeParse({ weekly: { mon: ["09:00-17:00"] }, holidays: ["2026-12-25"] }).success).toBe(true);
    expect(workingHoursSchema.safeParse({ weekly: { mon: ["9am-5pm"] } }).success).toBe(false);
    expect(workingHoursSchema.safeParse({ holidays: ["Christmas"] }).success).toBe(false);
  });
});

describe("timezone plumbing (Asia/Colombo, no daylight saving)", () => {
  it("reads local wall time and converts it back", () => {
    const at = colombo("2026-09-18T18:30:00");
    expect(localParts(at, TZ)).toEqual({ dateKey: "2026-09-18", weekday: 5, minuteOfDay: 18 * 60 + 30 });
    expect(localToUtc("2026-09-18", 18 * 60 + 30, TZ).toISOString()).toBe(at.toISOString());
  });

  it("rolls over midnight: 23:30 UTC on the 17th is 05:00 on the 18th in Colombo", () => {
    expect(localParts(new Date("2026-09-17T23:30:00Z"), TZ)).toMatchObject({ dateKey: "2026-09-18", minuteOfDay: 5 * 60 });
  });
});

describe("isWithinBusinessHours and nextOpening", () => {
  it("is open inside a window, closed at its end, before it, on Sunday and on a holiday", () => {
    expect(isWithinBusinessHours(colombo("2026-09-21T09:00:00"), calendar, TZ)).toBe(true);
    expect(isWithinBusinessHours(colombo("2026-09-21T16:59:00"), calendar, TZ)).toBe(true);
    expect(isWithinBusinessHours(colombo("2026-09-21T17:00:00"), calendar, TZ)).toBe(false);
    expect(isWithinBusinessHours(colombo("2026-09-21T08:59:00"), calendar, TZ)).toBe(false);
    expect(isWithinBusinessHours(colombo("2026-09-20T11:00:00"), calendar, TZ)).toBe(false);
    expect(isWithinBusinessHours(colombo("2026-12-25T11:00:00"), calendar, TZ)).toBe(false);
  });

  it("with no calendar the agency is always open", () => {
    expect(isWithinBusinessHours(colombo("2026-09-20T03:00:00"), null, TZ)).toBe(true);
    expect(nextOpening(colombo("2026-09-20T03:00:00"), null, TZ).toISOString()).toBe(colombo("2026-09-20T03:00:00").toISOString());
  });

  it("finds the next opening: an evening waits for the morning, a Friday night for Saturday, Saturday afternoon for Monday", () => {
    expect(show(nextOpening(colombo("2026-09-16T20:00:00"), calendar, TZ))).toBe("2026-09-17T09:00:00");
    expect(show(nextOpening(colombo("2026-09-18T18:30:00"), calendar, TZ))).toBe("2026-09-19T09:00:00");
    expect(show(nextOpening(colombo("2026-09-19T14:00:00"), calendar, TZ))).toBe("2026-09-21T09:00:00");
    expect(show(nextOpening(colombo("2026-09-21T06:00:00"), calendar, TZ))).toBe("2026-09-21T09:00:00");
  });

  it("skips a public holiday", () => {
    expect(show(nextOpening(colombo("2026-12-24T19:00:00"), calendar, TZ))).toBe("2026-12-26T09:00:00");
  });
});

describe("addBusinessMinutes", () => {
  it("inside the day it is plain elapsed time", () => {
    expect(show(addBusinessMinutes(colombo("2026-09-21T10:00:00"), 30, calendar, TZ))).toBe("2026-09-21T10:30:00");
    expect(show(addBusinessMinutes(colombo("2026-09-21T10:00:00"), 0, calendar, TZ))).toBe("2026-09-21T10:00:00");
  });

  it("a Friday-evening arrival runs into Saturday morning: 30 minutes after it opens", () => {
    expect(show(addBusinessMinutes(colombo("2026-09-18T18:30:00"), 30, calendar, TZ))).toBe("2026-09-19T09:30:00");
  });

  it("spills across the end of the day: 16:30 + 60 min is 09:30 the next morning", () => {
    expect(show(addBusinessMinutes(colombo("2026-09-21T16:30:00"), 60, calendar, TZ))).toBe("2026-09-22T09:30:00");
  });

  it("a deadline that lands exactly on closing time stays on that day", () => {
    expect(show(addBusinessMinutes(colombo("2026-09-21T16:00:00"), 60, calendar, TZ))).toBe("2026-09-21T17:00:00");
  });

  it("closed days and a public-holiday gap do not count: Thursday 16:00 + 2 h skips the holiday Friday and the Saturday half day", () => {
    // Thu 24 Dec: 16:00→17:00 is 1 h; Fri 25 Dec is a holiday; Sat 26 Dec opens 09:00, so the second hour ends 10:00.
    expect(show(addBusinessMinutes(colombo("2026-12-24T16:00:00"), 120, calendar, TZ))).toBe("2026-12-26T10:00:00");
  });

  it("a whole 8-hour business day is exactly one working day later", () => {
    expect(show(addBusinessMinutes(colombo("2026-09-21T09:00:00"), 8 * 60, calendar, TZ))).toBe("2026-09-21T17:00:00");
    expect(show(addBusinessMinutes(colombo("2026-09-21T09:00:00"), 8 * 60 + 1, calendar, TZ))).toBe("2026-09-22T09:01:00");
  });

  it("a long target crosses a weekend: 3 open days from Thursday 09:00 ends Monday 17:00 after Fri 8 h and Sat 4 h", () => {
    // Thu 8 h + Fri 8 h + Sat 4 h = 20 h; the remaining 4 h are Monday 09:00–13:00.
    expect(show(addBusinessMinutes(colombo("2026-09-17T09:00:00"), 24 * 60, calendar, TZ))).toBe("2026-09-21T13:00:00");
  });

  it("handles a split day (lunch closure)", () => {
    const split = parseWorkingHours({ weekly: { mon: ["09:00-12:00", "13:00-17:00"] } });
    expect(show(addBusinessMinutes(colombo("2026-09-21T11:30:00"), 60, split, TZ))).toBe("2026-09-21T13:30:00");
  });

  it("with no calendar it is wall-clock time, overnight included", () => {
    expect(show(addBusinessMinutes(colombo("2026-09-20T23:00:00"), 120, null, TZ))).toBe("2026-09-21T01:00:00");
  });

  it("keeps the arrival's seconds inside the window instead of overrunning closing time", () => {
    const arrival = new Date(colombo("2026-09-21T16:59:30").getTime());
    expect(show(addBusinessMinutes(arrival, 5, calendar, TZ))).toBe("2026-09-22T09:04:30");
  });

  it("finds the opening across a daylight-saving zone too (New York, US spring-forward Sunday)", () => {
    const ny = parseWorkingHours({ weekly: { mon: ["09:00-17:00"], tue: ["09:00-17:00"], sun: [] } });
    // Sun 8 Mar 2026 02:00 clocks jump forward; Monday 09:00 EDT is 13:00Z.
    expect(nextOpening(new Date("2026-03-08T12:00:00Z"), ny, "America/New_York").toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });
});
