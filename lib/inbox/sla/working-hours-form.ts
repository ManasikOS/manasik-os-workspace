/**
 * The working-hours settings form, as plain text — MI2.6. Pure and client-safe. People type "09:00-17:00, 14:00-18:00" per
 * weekday and "2026-12-25, 2027-01-14" for holidays; this turns that into the `ai_settings.working_hours` shape defined in
 * business-hours.ts (and back), and says which field is wrong in plain words. Leaving every weekday blank clears the
 * calendar, which means "always open" (the same as never having set it).
 */

import { WEEKDAY_KEYS, parseWindow, parseWorkingHours, workingHoursSchema, type WeekdayKey, type WorkingHoursInput } from "@/lib/inbox/sla/business-hours";

export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** Monday first, the way a working week reads. */
export const FORM_WEEKDAY_ORDER: readonly WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface WorkingHoursFormText {
  days: Record<WeekdayKey, string>;
  holidays: string;
}

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function workingHoursToFormText(raw: unknown): WorkingHoursFormText {
  const calendar = parseWorkingHours(raw);
  const days = Object.fromEntries(WEEKDAY_KEYS.map((day, index) => [day, (calendar?.weekly[index] ?? []).map((window) => `${clock(window.startMinute)}-${clock(window.endMinute)}`).join(", ")])) as Record<WeekdayKey, string>;
  return { days, holidays: [...(calendar?.holidays ?? [])].sort().join(", ") };
}

const splitList = (text: string) => text.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);

export type WorkingHoursFormResult = { ok: true; value: WorkingHoursInput | Record<string, never> } | { ok: false; fieldErrors: Record<string, string> };

export function formTextToWorkingHours(text: WorkingHoursFormText): WorkingHoursFormResult {
  const fieldErrors: Record<string, string> = {};
  const weekly: Record<string, string[]> = {};

  for (const day of WEEKDAY_KEYS) {
    const windows = splitList(text.days[day] ?? "");
    const bad = windows.find((window) => parseWindow(window) === null);
    if (bad !== undefined) {
      fieldErrors[day] = `"${bad}" is not a time range. Write it like 09:00-17:00, with the end after the start.`;
      continue;
    }
    if (windows.length > 0) weekly[day] = windows;
  }

  const holidays = splitList(text.holidays);
  const parsed = workingHoursSchema.safeParse({ weekly, holidays });
  if (!parsed.success && !fieldErrors.holidays) {
    const badHoliday = holidays.find((holiday) => !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(holiday));
    if (badHoliday !== undefined) fieldErrors.holidays = `"${badHoliday}" is not a date. Write it like 2026-12-25.`;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  if (Object.keys(weekly).length === 0) return { ok: true, value: {} };
  return { ok: true, value: { weekly, holidays: [...new Set(holidays)].sort() } };
}
