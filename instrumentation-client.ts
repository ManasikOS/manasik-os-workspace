// Browser Sentry. Session Replay is deliberately NOT enabled: it would record the Inbox thread, which is customer chat
// (TASK-028 P1.2). Shared settings, scrubbing and sampling live in lib/observability.
import * as Sentry from "@sentry/nextjs";

import { buildSentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(
  buildSentryOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  }),
);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
