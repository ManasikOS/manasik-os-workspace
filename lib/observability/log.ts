import { scrubString } from "./scrub-event";

/**
 * One-line JSON logs for the web app, matching the worker's format (TASK-028 P1.4): `{"ts","level","event",...fields}`. A log platform
 * can then filter on `event` and `level` instead of reading free text. Every string field is scrubbed with the same rules as Sentry
 * reports, so a phone number or e-mail address that reaches a log line does not stay in the logs.
 *
 * `event` is a short stable name such as "inbox.health.checked", never a sentence and never containing ids or customer values. Put
 * variable parts in `fields`. Do not log message text, names or contact details even though the scrubber is there to catch a slip.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function formatLogLine(level: LogLevel, event: string, fields: LogFields = {}, now: Date = new Date()): string {
  const safeFields: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    safeFields[key] = typeof value === "string" ? scrubString(value) : value;
  }
  // Reserved keys come last so a field can never overwrite the timestamp, level or event name.
  return JSON.stringify({ ...safeFields, ts: now.toISOString(), level, event });
}

export function logEvent(level: LogLevel, event: string, fields?: LogFields): void {
  const line = formatLogLine(level, event, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
