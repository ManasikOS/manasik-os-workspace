/**
 * Removes customer content from anything sent to Sentry (TASK-028 P1.2). The Inbox handles chat text, phone numbers,
 * e-mail addresses, passport and payment details; none of it may leave the system inside an error report. Two defences:
 * a value that looks like personal data is replaced wherever it appears, and a field whose NAME says it holds content is
 * replaced whatever it contains. Free prose inside an error message cannot be recognised, so code must never put chat text
 * into a message it throws; this scrubber is the safety net for what slips through, not a licence. Pure and dependency-free so the web app, the edge runtime and the worker all share it.
 */

export const REDACTED = "[redacted]";

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Seven or more digits, allowing a leading + and the spaces, dashes, dots and brackets people type inside a number. */
const PHONE_OR_ACCOUNT_PATTERN = /\+?\d(?:[\d\s().-]{5,}\d)/g;
const BEARER_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
/** Postgres error details quote the offending value: `Key (phone)=(0771234567) already exists`. */
const DATABASE_DETAIL_VALUE_PATTERN = /=\(([^)]*)\)/g;
/** A UUID is an opaque id we WANT to keep for debugging, so its digit runs must not be mistaken for a phone number. */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Field names that hold customer content or credentials. Matched anywhere in the name, case-insensitively. */
const SENSITIVE_KEY_PATTERN =
  /(body|text|caption|subject|content|transcript|phone|msisdn|whatsapp|email|passport|visa|account|iban|card|amount|name|address|birth|dob|nationality|token|secret|password|authorization|cookie|apikey|api_key|key|signature)/i;
/** Names that look sensitive to the pattern above but are the opaque ids and codes this system sends on purpose. */
const SAFE_KEYS = new Set(["agency_id", "agencyId", "conversation_id", "conversationId", "inbox_context", "runtime", "digest"]);

export function scrubString(value: string): string {
  const keptIds: string[] = [];
  const withoutIds = value.replace(UUID_PATTERN, (id) => {
    keptIds.push(id);
    return `\u0000${keptIds.length - 1}\u0000`;
  });
  const scrubbed = withoutIds
    .replace(DATABASE_DETAIL_VALUE_PATTERN, `=(${REDACTED})`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_OR_ACCOUNT_PATTERN, REDACTED);
  return scrubbed.replace(/\u0000(\d+)\u0000/g, (_match, index) => keptIds[Number(index)] ?? "");
}

const MAX_DEPTH = 8;

export function scrubValue(value: unknown, key?: string, depth = 0): unknown {
  if (key && !SAFE_KEYS.has(key) && SENSITIVE_KEY_PATTERN.test(key)) {
    return value === null || value === undefined ? value : REDACTED;
  }
  if (typeof value === "string") return scrubString(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, undefined, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = scrubValue(childValue, childKey, depth + 1);
  }
  return out;
}

/** The query string can carry a search term or a phone number, so only the path survives. */
function pathOnly(url: string): string {
  const cut = url.search(/[?#]/);
  return scrubString(cut === -1 ? url : url.slice(0, cut));
}

interface ScrubbableBreadcrumb {
  category?: string;
  message?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

interface ScrubbableEvent {
  message?: unknown;
  exception?: { values?: Array<{ value?: unknown } & Record<string, unknown>> };
  request?: { url?: unknown; method?: unknown } & Record<string, unknown>;
  user?: unknown;
  breadcrumbs?: unknown;
  extra?: unknown;
  contexts?: unknown;
  tags?: unknown;
  [key: string]: unknown;
}

/** Console output is where log lines carrying chat text end up, so it is dropped outright; the rest is scrubbed. */
export function scrubSentryBreadcrumb<T extends object>(input: T): T | null {
  const crumb = input as ScrubbableBreadcrumb;
  if (crumb.category === "console") return null;
  const copy: ScrubbableBreadcrumb = { ...crumb };
  if (typeof copy.message === "string") copy.message = scrubString(copy.message);
  if (copy.data && typeof copy.data === "object") {
    const data = { ...(copy.data as Record<string, unknown>) };
    for (const field of ["url", "to", "from"]) {
      if (typeof data[field] === "string") data[field] = pathOnly(data[field] as string);
    }
    copy.data = scrubValue(data);
  }
  return copy as T;
}

export function scrubSentryEvent<T extends object>(input: T): T {
  const copy: ScrubbableEvent = { ...(input as ScrubbableEvent) };

  if (typeof copy.message === "string") copy.message = scrubString(copy.message);
  if (copy.exception?.values) {
    copy.exception = {
      ...copy.exception,
      values: copy.exception.values.map((entry) => ({
        ...entry,
        value: typeof entry.value === "string" ? scrubString(entry.value) : entry.value,
      })),
    };
  }

  // A request body, header or cookie is never needed to debug; keep the method and the path.
  if (copy.request) {
    const { url, method } = copy.request;
    copy.request = { ...(typeof url === "string" ? { url: pathOnly(url) } : {}), ...(typeof method === "string" ? { method } : {}) };
  }

  delete copy.user;
  if (copy.extra) copy.extra = scrubValue(copy.extra);
  if (copy.contexts) copy.contexts = scrubValue(copy.contexts);
  if (copy.tags) copy.tags = scrubValue(copy.tags);
  if (Array.isArray(copy.breadcrumbs)) {
    copy.breadcrumbs = copy.breadcrumbs
      .map((crumb) => scrubSentryBreadcrumb(crumb as ScrubbableBreadcrumb))
      .filter((crumb) => crumb !== null);
  }
  return copy as T;
}
