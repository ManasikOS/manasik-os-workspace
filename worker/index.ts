/**
 * Entry point of the always-on Inbox worker (Q3). Built by `npm run worker:build` and started by `npm run worker:start`; the container
 * image in worker/Dockerfile does the same. See docs/runbooks/inbox-worker.md.
 *
 *   node --conditions=react-server dist-worker/worker.mjs           run the worker
 *   node --conditions=react-server dist-worker/worker.mjs --check   load everything, report problems as JSON, exit 0 (ok) or 1 (not)
 *
 * `--check` starts nothing and connects to nothing: it proves the configuration parses, the secrets are present (by name only, never
 * their values), and every code path a job runs loads under plain Node. Run it in CI and as the image's smoke test.
 */

import { hostname } from "node:os";

import * as Sentry from "@sentry/node";

import { buildSentryOptions } from "@/lib/observability/sentry-options";

import { createAdminClient } from "@/utils/supabase/admin";
import { processDueJobs } from "@/lib/agent/whatsapp/drain";
import { everyMs, reconcileRawEvents } from "@/lib/inbox/reconcile/raw-events";
import { drainDeliveryEvents } from "@/lib/inbox/delivery/delivery-updates";
import { processDueInboxOutbox } from "@/lib/inbox/outbox/drain";
import "@/lib/inbox/intelligence/register-handlers";
import { getRegisteredLaneJobHandlers } from "@/lib/inbox/jobs/drain";
import { releaseStaleLocks } from "@/lib/inbox/jobs/queue";
import { JOB_KINDS } from "@/lib/inbox/intelligence/contracts";
import { WorkerConfigError, checkWorkerEnvironment, loadWorkerConfig } from "@/lib/inbox/worker/config";
import { createInboxWorker } from "@/lib/inbox/worker/worker-runtime";

/** The job kinds that are enqueued today and so MUST have a handler; the rest are reserved names a later slice will add. */
const KINDS_IN_USE = ["ENRICH", "REPLY", "TRANSCRIBE_VOICE", "READ_DOCUMENT", "EXTRACT_RECEIPT"] as const;

function check(): number {
  const problems: string[] = [];
  let config;
  try {
    config = loadWorkerConfig();
  } catch (cause) {
    if (cause instanceof WorkerConfigError) problems.push(...cause.problems);
    else throw cause;
  }
  const environment = checkWorkerEnvironment();
  for (const name of environment.missing) problems.push(`${name} is not set`);
  const handlers = getRegisteredLaneJobHandlers();
  for (const kind of KINDS_IN_USE) if (!handlers[kind]) problems.push(`no handler is registered for job kind ${kind}`);

  console.log(
    JSON.stringify({
      ok: problems.length === 0,
      problems,
      warnings: environment.warnings,
      handlers: JOB_KINDS.filter((kind) => handlers[kind]),
      ...(config ? { concurrency: config.concurrency, drainOutbox: config.drainOutbox, drainAgentJobs: config.drainAgentJobs } : {}),
    }),
  );
  return problems.length === 0 ? 0 : 1;
}

/** Starts Sentry for the worker (TASK-028 P1.2). Off without a DSN; shares the web app's scrubbing and settings. */
function startErrorReporting(): void {
  Sentry.init({
    ...buildSentryOptions({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
      tracesSampleRate: "0",
    }),
    release: process.env.SENTRY_RELEASE,
    initialScope: { tags: { runtime: "inbox-worker" } },
  });
}

/** Sends pending reports before the process exits; without it a crash on the way out is lost. */
async function exitAfterFlush(code: number): Promise<never> {
  await Sentry.close(2_000).catch(() => false);
  process.exit(code);
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    process.exit(check());
  }
  startErrorReporting();

  const config = loadWorkerConfig();
  const environment = checkWorkerEnvironment();
  if (environment.missing.length > 0) {
    throw new Error(`Missing required environment: ${environment.missing.join(", ")}`);
  }
  for (const warning of environment.warnings) console.warn(JSON.stringify({ level: "warn", message: warning }));

  const db = createAdminClient();
  const worker = createInboxWorker({
    config,
    db,
    handlers: getRegisteredLaneJobHandlers(),
    workerId: `${hostname()}-${process.pid}`,
    drainOutbox: config.drainOutbox ? ({ budgetMs }) => processDueInboxOutbox({ budgetMs }) : undefined,
    drainAgentJobs: config.drainAgentJobs ? ({ budgetMs }) => processDueJobs({ budgetMs }) : undefined,
    drainDeliveryStatus: config.drainDeliveryStatus ? ({ budgetMs }) => drainDeliveryEvents(db, { budgetMs }) : undefined,
    reconcileRawEvents: config.reconcileRawEvents
      ? everyMs(60_000, async () => {
          const result = await reconcileRawEvents(db);
          if (result.replayed > 0 || result.failed > 0) console.log(JSON.stringify({ ts: new Date().toISOString(), event: "raw_events_reconciled", ...result }));
          return { processed: result.replayed, failed: result.failed };
        })
      : undefined,
    releaseStale: (client) => releaseStaleLocks(client),
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "signal", signal }));
    worker.stop().then(
      () => exitAfterFlush(0),
      (cause) => {
        console.error(JSON.stringify({ event: "shutdown_failed", error: cause instanceof Error ? cause.message : String(cause) }));
        Sentry.captureException(cause, { tags: { worker_event: "shutdown_failed" } });
        return exitAfterFlush(1);
      },
    );
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  // A bug in one handler must not take the whole worker down with it; the job's lease returns it to the queue.
  process.on("unhandledRejection", (reason) => {
    console.error(JSON.stringify({ event: "unhandled_rejection", error: reason instanceof Error ? reason.message : String(reason) }));
    Sentry.captureException(reason, { tags: { worker_event: "unhandled_rejection" } });
  });

  await worker.start();
}

main().catch((cause) => {
  console.error(JSON.stringify({ event: "worker_failed_to_start", error: cause instanceof Error ? cause.message : String(cause) }));
  Sentry.captureException(cause, { tags: { worker_event: "worker_failed_to_start" } });
  return exitAfterFlush(1);
});
