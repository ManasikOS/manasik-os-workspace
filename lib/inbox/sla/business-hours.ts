/**
 * The agency's working calendar and the arithmetic on it — MI2.6 of docs/inbox/implementation-plan.md
 * (Architecture §16 R2). Pure: no I/O, no clock. Times are `Date`s (UTC instants); the calendar is read in the
 * agency's IANA timezone (`agency_settings.timezone`, default Asia/Colombo).
 *
 * THE CALENDAR IS `ai_settings.working_hours` — the plan adds no second one. That column existed but had no defined
 * shape and nothing wrote it (see lib/followups/quiet-lead-sweep.ts), so this file defines it:
 *
 *   {
 *     "weekly":   { "mon": ["09:00-17:00"], "tue": ["09:00-13:00", "14:00-18:00"], "sun": [] },
 *     "holidays": ["2026-12-25", "2027-01-14"]
 *   }
 *
 * Weekday keys are sun..sat; a missing or empty day is closed; a window is "HH:MM-HH:MM" (end after start, no wrapping
 * past midnight — split a night shift into two days); `holidays` are local dates on which the agency is closed all day.
 * Anything that does not parse, or has no open window at all, yields NO calendar (`null`), and null means "always open":
 * the same "no restriction" the rest of the app already applies to an unset working_hours. An agency that has not set
 * its hours therefore gets 24/7 clocks rather than a made-up 9-to-5.
 *
 * Timezone arithmetic uses Intl only (no library). Asia/Colombo has no daylight saving; for zones that do, a wall-clock
 * time that does not exist (the spring-forward gap) resolves to the instant just after it, which is the safe direction
 * for a deadline.
 */

import { z } from "zod";

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export interface OpenWindow {
  /** Minutes after local midnight, inclusive. */
  startMinute: number;
  /** Minutes after local midnight, exclusive. */
  endMinute: number;
}

export interface BusinessCalendar {
  /** Index 0 = Sunday, matching `Date#getDay`. Windows are sorted and do not overlap. */
  weekly: readonly OpenWindow[][];
  /** Local dates (YYYY-MM-DD) the agency is closed. */
  holidays: ReadonlySet<string>;
}

export const DEFAULT_TIMEZONE = "Asia/Colombo";
const MINUTE_MS = 60_000;
const MAX_SEARCH_DAYS = 400;

const windowText = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]|24):([0-5]\d)$/;
const dateText = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** For the settings form: the shape a person may save. */
export const workingHoursSchema = z.object({
  weekly: z.object(Object.fromEntries(WEEKDAY_KEYS.map((day) => [day, z.array(z.string().regex(windowText, "Use HH:MM-HH:MM, for example 09:00-17:00")).max(6).optional()]))).partial(),
  holidays: z.array(z.string().regex(dateText, "Use YYYY-MM-DD")).max(400).optional(),
});
export type WorkingHoursInput = z.infer<typeof workingHoursSchema>;

/** One "HH:MM-HH:MM" window, or null when it is malformed or ends at or before it starts. */
export function parseWindow(text: unknown): OpenWindow | null {
  if (typeof text !== "string") return null;
  const match = windowText.exec(text.trim());
  if (!match) return null;
  const startMinute = Number(match[1]) * 60 + Number(match[2]);
  const endMinute = Number(match[3]) * 60 + Number(match[4]);
  return endMinute > startMinute && endMinute <= 24 * 60 ? { startMinute, endMinute } : null;
}

export function mergeWindows(windows: OpenWindow[]): OpenWindow[] {
  const sorted = [...windows].sort((a, b) => a.startMinute - b.startMinute);
  const merged: OpenWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.startMinute <= last.endMinute) last.endMinute = Math.max(last.endMinute, window.endMinute);
    else merged.push({ ...window });
  }
  return merged;
}

/** Null = no usable calendar = always open. Never throws on a malformed column. */
export function parseWorkingHours(raw: unknown): BusinessCalendar | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as { weekly?: unknown; holidays?: unknown };
  if (!source.weekly || typeof source.weekly !== "object") return null;
  const weeklyInput = source.weekly as Record<string, unknown>;

  const weekly = WEEKDAY_KEYS.map((day) => {
    const value = weeklyInput[day];
    const list = Array.isArray(value) ? value : [];
    return mergeWindows(list.map(parseWindow).filter((window): window is OpenWindow => window !== null));
  });
  if (weekly.every((windows) => windows.length === 0)) return null;

  const holidays = new Set<string>();
  if (Array.isArray(source.holidays)) for (const item of source.holidays) if (typeof item === "string" && dateText.test(item)) holidays.add(item);
  return { weekly, holidays };
}

/* ── Timezone plumbing ────────────────────────────────────────────────────── */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

export interface LocalParts {
  /** YYYY-MM-DD in the agency's timezone. */
  dateKey: string;
  /** 0 = Sunday. */
  weekday: number;
  minuteOfDay: number;
}

export function localParts(at: Date, timezone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timezone).formatToParts(at)) if (part.type !== "literal") parts[part.type] = part.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function offsetMsAt(instant: Date, timezone: string): number {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timezone).formatToParts(instant)) if (part.type !== "literal") parts[part.type] = part.value;
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `timezone` reads `dateKey` + `minuteOfDay`. */
export function localToUtc(dateKey: string, minuteOfDay: number, timezone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  let guess = wallAsUtc - offsetMsAt(new Date(wallAsUtc), timezone);
  guess = wallAsUtc - offsetMsAt(new Date(guess), timezone);
  return new Date(guess);
}

function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function windowsOn(calendar: BusinessCalendar, dateKey: string, weekday: number): readonly OpenWindow[] {
  return calendar.holidays.has(dateKey) ? [] : calendar.weekly[weekday];
}

/* ── Public arithmetic ────────────────────────────────────────────────────── */

export function isWithinBusinessHours(at: Date, calendar: BusinessCalendar | null, timezone: string = DEFAULT_TIMEZONE): boolean {
  if (!calendar) return true;
  const local = localParts(at, timezone);
  return windowsOn(calendar, local.dateKey, local.weekday).some((window) => local.minuteOfDay >= window.startMinute && local.minuteOfDay < window.endMinute);
}

/** `at` itself when the agency is open, otherwise the next moment it opens. */
export function nextOpening(at: Date, calendar: BusinessCalendar | null, timezone: string = DEFAULT_TIMEZONE): Date {
  if (!calendar || isWithinBusinessHours(at, calendar, timezone)) return at;
  const local = localParts(at, timezone);
  let dateKey = local.dateKey;
  let weekday = local.weekday;
  for (let step = 0; step < MAX_SEARCH_DAYS; step += 1) {
    const windows = windowsOn(calendar, dateKey, weekday);
    // On the first day only a window that has not started yet counts; on later days the first window does.
    const next = windows.find((window) => step > 0 || window.startMinute > local.minuteOfDay);
    if (next) return localToUtc(dateKey, next.startMinute, timezone);
    dateKey = nextDateKey(dateKey);
    weekday = (weekday + 1) % 7;
  }
  throw new Error("No opening found within a year: check the working calendar");
}

/**
 * The instant `minutes` of OPEN time after `from`. With no calendar it is plain elapsed time. Time outside the open
 * windows (evenings, days off, holidays) does not count, so a target that starts on a Friday evening runs into the
 * next open day. `minutes <= 0` returns `from`.
 */
export function addBusinessMinutes(from: Date, minutes: number, calendar: BusinessCalendar | null, timezone: string = DEFAULT_TIMEZONE): Date {
  if (minutes <= 0) return from;
  if (!calendar) return new Date(from.getTime() + minutes * MINUTE_MS);

  let cursor = nextOpening(from, calendar, timezone);
  let remaining = minutes;
  for (let guard = 0; guard < MAX_SEARCH_DAYS * 8; guard += 1) {
    const local = localParts(cursor, timezone);
    const window = windowsOn(calendar, local.dateKey, local.weekday).find((candidate) => local.minuteOfDay >= candidate.startMinute && local.minuteOfDay < candidate.endMinute);
    if (!window) {
      cursor = nextOpening(new Date(cursor.getTime() + MINUTE_MS), calendar, timezone);
      continue;
    }
    const windowEnd = localToUtc(local.dateKey, window.endMinute, timezone);
    const availableMinutes = (windowEnd.getTime() - cursor.getTime()) / MINUTE_MS;
    if (remaining <= availableMinutes) return new Date(cursor.getTime() + remaining * MINUTE_MS);
    remaining -= availableMinutes;
    cursor = nextOpening(windowEnd, calendar, timezone);
  }
  throw new Error("Could not place the deadline within the working calendar");
}
