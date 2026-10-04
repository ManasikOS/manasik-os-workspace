import { describe, expect, it } from "vitest";

import { parseWorkingHours } from "./business-hours";
import { formTextToWorkingHours, workingHoursToFormText, type WorkingHoursFormText } from "./working-hours-form";

const blank: WorkingHoursFormText = { days: { mon: "", tue: "", wed: "", thu: "", fri: "", sat: "", sun: "" }, holidays: "" };

describe("formTextToWorkingHours", () => {
  it("turns typed ranges and holidays into the stored shape", () => {
    const result = formTextToWorkingHours({ ...blank, days: { ...blank.days, mon: "09:00-17:00", tue: "09:00-13:00, 14:00-18:00", sat: " 09:00-13:00 " }, holidays: "2027-01-14, 2026-12-25\n2026-12-25" });
    expect(result).toEqual({
      ok: true,
      value: { weekly: { mon: ["09:00-17:00"], tue: ["09:00-13:00", "14:00-18:00"], sat: ["09:00-13:00"] }, holidays: ["2026-12-25", "2027-01-14"] },
    });
    if (result.ok) expect(parseWorkingHours(result.value)).not.toBeNull();
  });

  it("clears the calendar when every day is blank, which means always open", () => {
    expect(formTextToWorkingHours(blank)).toEqual({ ok: true, value: {} });
    expect(parseWorkingHours({})).toBeNull();
  });

  it("names the day and the bad range in plain words", () => {
    const result = formTextToWorkingHours({ ...blank, days: { ...blank.days, mon: "9am-5pm", wed: "17:00-09:00", fri: "09:00-17:00" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(["mon", "wed"]);
      expect(result.fieldErrors.mon).toMatch(/"9am-5pm" is not a time range/);
      expect(result.fieldErrors.wed).toMatch(/end after the start/);
    }
  });

  it("rejects a malformed holiday, naming it", () => {
    const result = formTextToWorkingHours({ ...blank, days: { ...blank.days, mon: "09:00-17:00" }, holidays: "2026-12-25, Christmas" });
    expect(result).toEqual({ ok: false, fieldErrors: { holidays: '"Christmas" is not a date. Write it like 2026-12-25.' } });
  });
});

describe("workingHoursToFormText", () => {
  it("round-trips a saved calendar", () => {
    const stored = { weekly: { mon: ["09:00-17:00"], sat: ["09:00-13:00"] }, holidays: ["2026-12-25"] };
    const text = workingHoursToFormText(stored);
    expect(text.days.mon).toBe("09:00-17:00");
    expect(text.days.sun).toBe("");
    expect(text.holidays).toBe("2026-12-25");
    const back = formTextToWorkingHours(text);
    expect(back).toEqual({ ok: true, value: { weekly: { mon: ["09:00-17:00"], sat: ["09:00-13:00"] }, holidays: ["2026-12-25"] } });
  });

  it("shows an empty form for the empty object every agency has today", () => {
    expect(workingHoursToFormText({})).toEqual(blank);
    expect(workingHoursToFormText(null)).toEqual(blank);
  });
});
