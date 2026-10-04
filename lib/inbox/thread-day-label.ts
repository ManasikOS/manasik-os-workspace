import { format, isSameDay, isSameYear, subDays } from "date-fns";

/**
 * The divider text above a day's messages: "Today", "Yesterday", "12 Mar", or "12 Mar 2025" for another year.
 * "Today" is the day of `now`, never the system clock, so the label and its tests do not depend on the date they run.
 */
export function threadDayLabel(date: Date, now: Date): string {
  if (isSameDay(date, now)) return "Today";
  if (isSameDay(date, subDays(now, 1))) return "Yesterday";
  return format(date, isSameYear(date, now) ? "d MMM" : "d MMM yyyy");
}

/** A key that is equal for two timestamps on the same local calendar day. */
export function threadDayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}
