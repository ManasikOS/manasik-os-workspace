import { scrubSentryBreadcrumb, scrubSentryEvent } from "./scrub-event";

/**
 * The Sentry settings every runtime shares (TASK-028 P1.2): web server, edge and browser. The DSN, environment and
 * trace rate come from environment variables so production and the non-production project report to different places
 * without a code change. With no DSN the SDK stays off, which is what local development and tests want.
 */

/** Requests that are machine traffic. Tracing them would spend the quota on about 4,400 scheduler calls a day. */
const UNTRACED_PATH_PATTERN = /\/(?:api\/cron|api\/webhooks|monitoring|_next)(?:\/|$)/;

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

export function resolveTracesSampleRate(raw: string | undefined): number {
  const parsed = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_TRACES_SAMPLE_RATE;
}

interface TraceSamplingContext {
  name?: string;
  attributes?: Record<string, unknown>;
  parentSampled?: boolean;
}

export function sampleTrace(context: TraceSamplingContext, rate: number): number {
  const isMachineTraffic = [context.name, context.attributes?.["url.path"], context.attributes?.["http.target"]].some(
    (candidate) => typeof candidate === "string" && UNTRACED_PATH_PATTERN.test(candidate),
  );
  if (isMachineTraffic) return 0;
  if (context.parentSampled !== undefined) return context.parentSampled ? 1 : 0;
  return rate;
}

const IDENTIFYING_NAME_FRAGMENTS = ["forwarded", "-ip", "remote-", "via", "-user"];

/** Keeps request bodies, cookies and identifying headers out of every report. */
export const sentryDataCollection = {
  userInfo: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  httpBodies: [] as never[],
  httpHeaders: { deny: [...IDENTIFYING_NAME_FRAGMENTS] },
  cookies: { deny: [...IDENTIFYING_NAME_FRAGMENTS] },
  urlQueryParams: { deny: [...IDENTIFYING_NAME_FRAGMENTS] },
};

export function buildSentryOptions(input: { dsn: string | undefined; environment: string | undefined; tracesSampleRate: string | undefined }) {
  const rate = resolveTracesSampleRate(input.tracesSampleRate);
  return {
    dsn: input.dsn || undefined,
    environment: input.environment || "development",
    sendDefaultPii: false,
    tracesSampler: (context: TraceSamplingContext) => sampleTrace(context, rate),
    dataCollection: sentryDataCollection,
    // Strips message text, phone numbers, e-mail addresses and the like from everything that leaves the system.
    beforeSend: <T extends object>(event: T): T => scrubSentryEvent(event),
    beforeSendTransaction: <T extends object>(event: T): T => scrubSentryEvent(event),
    beforeBreadcrumb: <T extends object>(crumb: T): T | null => scrubSentryBreadcrumb(crumb),
  };
}
