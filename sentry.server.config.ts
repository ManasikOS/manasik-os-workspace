// Server-side Sentry. Shared settings, scrubbing and sampling live in lib/observability (TASK-028 P1.2).
import * as Sentry from "@sentry/nextjs";

import { buildSentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(
  buildSentryOptions({
    dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
  }),
);
