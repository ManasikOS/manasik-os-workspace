/**
 * Date and label formatting shared by the Sales Intelligence services.
 * Pure and locale-pinned so the server and the browser always agree.
 */

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function parts(isoDate: string): { day: number; month: number; year: number } {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return { day, month: month - 1, year };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `2026-12-02` → `02 December 2026`. */
export function formatLongDate(isoDate: string): string {
  const { day, month, year } = parts(isoDate);
  return `${pad(day)} ${MONTH_NAMES[month]} ${year}`;
}

/** `2026-12-02`, `2026-12-12` → `02–12 December 2026` (collapses shared month/year). */
export function formatDateRange(startIso: string, endIso: string): string {
  const start = parts(startIso);
  const end = parts(endIso);
  if (start.year === end.year && start.month === end.month) {
    return `${pad(start.day)}–${pad(end.day)} ${MONTH_NAMES[end.month]} ${end.year}`;
  }
  if (start.year === end.year) {
    return `${pad(start.day)} ${MONTH_NAMES[start.month]} – ${pad(end.day)} ${MONTH_NAMES[end.month]} ${end.year}`;
  }
  return `${formatLongDate(startIso)} – ${formatLongDate(endIso)}`;
}

/** `2026-12-02` → `02 Dec`. */
export function formatShortDate(isoDate: string): string {
  const { day, month } = parts(isoDate);
  return `${pad(day)} ${MONTH_NAMES[month].slice(0, 3)}`;
}

/** Zero-based month index of an ISO date. */
export function monthIndexOf(isoDate: string): number {
  return parts(isoDate).month;
}

export function yearOf(isoDate: string): number {
  return parts(isoDate).year;
}

/** `yyyy-mm-dd` shifted by N days (UTC, calendar-safe). */
export function shiftIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` on the calendar. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** `4` → `four`; larger numbers stay numeric. */
export function numberWord(value: number): string {
  return NUMBER_WORDS[value] ?? String(value);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "4 adults · 1 child · 1 infant". */
export function travellersLabel(adults: number, children: number, infants: number): string {
  const segments = [plural(adults, "adult")];
  if (children > 0) segments.push(plural(children, "child", "children"));
  if (infants > 0) segments.push(plural(infants, "infant"));
  return segments.join(" · ");
}

export const OCCUPANCY_LABELS = {
  QUAD: "Quad Sharing",
  TRIPLE: "Triple Sharing",
  DOUBLE: "Double Sharing",
  SINGLE: "Single Room",
} as const;
