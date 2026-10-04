/**
 * Timezone helpers. The agency operates in Sri Lanka, so "today" for
 * seasonal-access expiry, activity buckets and payment dates is a Colombo
 * calendar day, not a UTC one — `new Date().toISOString().slice(0, 10)`
 * silently shifts the day boundary by up to 5.5 hours (seasonal access can
 * expire, or stay valid, at the wrong instant). Every call site that needs
 * "today's date" as `YYYY-MM-DD` should use `colomboDayKey()` instead.
 */

/** Sri Lanka has no daylight saving, so the offset is a constant. */
export const COLOMBO_TZ = "Asia/Colombo";

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: COLOMBO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeInputFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: COLOMBO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `YYYY-MM-DD` for the given instant, as the calendar reads it in Colombo. */
export function colomboDayKey(value: Date | string = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return dayKeyFormatter.format(date);
}

/** `YYYY-MM-DDTHH:mm` for a datetime-local input, using the agency's Colombo clock. */
export function colomboDateTimeInput(value: Date | string = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = dateTimeInputFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "00";
  const hour = part("hour") === "24" ? "00" : part("hour");
  return `${part("year")}-${part("month")}-${part("day")}T${hour}:${part("minute")}`;
}

/** Converts a Colombo datetime-local value into the instant stored by the server. */
export function colomboLocalDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const seconds = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${seconds}+05:30`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
