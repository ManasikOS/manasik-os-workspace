/**
 * The Inbox health check, every five minutes (pg_cron -> public.invoke_cron_route, see
 * supabase/migrations/20261229090000_cron_inbox_health.sql). Reads the scheduled-job health, the outgoing-message queue and the
 * background-job queue, and reports every problem to Sentry (TASK-028 P1.3). Sentry's alert rules decide who is told and how.
 *
 * Two safeguards: each run also sends a Sentry cron check-in, so Sentry alerts if THIS check stops running (the database scheduler
 * being down would otherwise silence every alert), and an unreadable part of the system is reported rather than treated as healthy.
 *
 * Authenticated by `Authorization: Bearer $CRON_SECRET` alone; proxy.ts lets /api/cron/* through without a session. The response and
 * the reports carry counts, job names and ages only. An unhealthy system still answers 200: the route did its job, and answering 5xx
 * would also mark this job failing in cron_job_health.
 */

import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";

import { evaluateInboxHealth } from "@/lib/inbox/health/evaluate";
import { readInboxHealthSnapshot } from "@/lib/inbox/health/snapshot";
import { logEvent } from "@/lib/observability/log";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";
import { createAdminClient } from "@/utils/supabase/admin";

const MONITOR_SLUG = "inbox-health";
const MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "*/5 * * * *" },
  checkinMargin: 5,
  maxRuntime: 2,
  failureIssueThreshold: 1,
  recoveryThreshold: 1,
} as const;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const checkInId = Sentry.captureCheckIn({ monitorSlug: MONITOR_SLUG, status: "in_progress" }, MONITOR_CONFIG);
  try {
    const snapshot = await readInboxHealthSnapshot(createAdminClient());
    const findings = evaluateInboxHealth(snapshot);
    for (const finding of findings) {
      Sentry.captureMessage(`Inbox health: ${finding.summary}`, {
        level: finding.severity === "critical" ? "error" : "warning",
        fingerprint: ["inbox-health", finding.check],
        tags: { inbox_health_check: finding.check, inbox_health_severity: finding.severity },
      });
    }
    logEvent(findings.length === 0 ? "info" : "warn", "inbox.health.checked", {
      findings: findings.length,
      critical: findings.filter((finding) => finding.severity === "critical").length,
      checks: findings.map((finding) => finding.check).join(",") || null,
    });
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: "ok" });
    return NextResponse.json({ status: findings.length === 0 ? "healthy" : "unhealthy", findings });
  } catch (cause) {
    Sentry.captureException(cause, { tags: { inbox_health_check: "check-crashed" } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: "error" });
    logEvent("error", "inbox.health.check_crashed", { error: cause instanceof Error ? cause.message : String(cause) });
    return NextResponse.json({ error: "The health check could not run" }, { status: 500 });
  }
}
