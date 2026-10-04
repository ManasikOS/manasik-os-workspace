/**
 * Decides whether the Inbox's background machinery is healthy (TASK-028 P1.3). Pure: it takes a snapshot of counts and ages and returns
 * findings, so the thresholds are testable without a database. Findings carry counts, names and ages only, never message content,
 * customer data or agency ids, because they are sent to Sentry.
 *
 * Why these checks exist: the audit of 2026-10-01 found two cron jobs failing for three days with nothing saying so. A message that sits
 * in the outbox, or a job that dead-letters, is a customer left waiting; none of it is visible to staff until someone complains.
 */

export type HealthSeverity = "warning" | "critical";

export interface HealthFinding {
  /** Stable id, the grouping key in Sentry: one issue per check, however often it fires. */
  check: string;
  severity: HealthSeverity;
  summary: string;
}

export type JobLane = "REALTIME" | "STANDARD" | "BULK";

export interface InboxHealthSnapshot {
  cronJobs: Array<{ jobname: string; state: string; reason: string | null }> | null;
  outbox: { oldestQueuedAgeSeconds: number | null; stuckRunning: number; deadLast24h: number } | null;
  jobs: { oldestQueuedAgeSeconds: Record<JobLane, number | null>; deadLast24h: number } | null;
}

/** Seconds a due item may wait before it is reported. Lane limits are a multiple of the lane's latency target in architecture section 12. */
export const HEALTH_THRESHOLDS = {
  outboxAgeSeconds: { warning: 120, critical: 300 },
  outboxStuckRunningMinutes: 10,
  laneAgeSeconds: {
    REALTIME: { warning: 60, critical: 180 },
    STANDARD: { warning: 300, critical: 900 },
    BULK: { warning: 3_600, critical: 14_400 },
  },
} as const;

function severityForAge(age: number, limits: { warning: number; critical: number }): HealthSeverity | null {
  if (age > limits.critical) return "critical";
  if (age > limits.warning) return "warning";
  return null;
}

function describeDuration(seconds: number): string {
  if (seconds < 120) return `${Math.round(seconds)} seconds`;
  if (seconds < 7_200) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds / 3_600)} hours`;
}

export function evaluateInboxHealth(snapshot: InboxHealthSnapshot): HealthFinding[] {
  const findings: HealthFinding[] = [];

  // A part that could not be read is a finding, never silence: unknown must not look like healthy.
  if (snapshot.cronJobs === null) {
    findings.push({ check: "read-failed:cron-jobs", severity: "critical", summary: "The scheduled-job health could not be read." });
  } else {
    for (const job of snapshot.cronJobs) {
      if (job.state === "FAILING" || job.state === "STALE") {
        findings.push({
          check: `cron:${job.jobname}`,
          severity: "critical",
          summary: `Scheduled job ${job.jobname} is ${job.state.toLowerCase()}. ${job.reason ?? ""}`.trim(),
        });
      } else if (job.state === "NEVER_RUN") {
        findings.push({ check: `cron:${job.jobname}`, severity: "warning", summary: `Scheduled job ${job.jobname} is active but has never run.` });
      }
    }
  }

  if (snapshot.outbox === null) {
    findings.push({ check: "read-failed:outbox", severity: "critical", summary: "The outgoing-message queue could not be read." });
  } else {
    const { oldestQueuedAgeSeconds, stuckRunning, deadLast24h } = snapshot.outbox;
    const ageSeverity = oldestQueuedAgeSeconds === null ? null : severityForAge(oldestQueuedAgeSeconds, HEALTH_THRESHOLDS.outboxAgeSeconds);
    if (ageSeverity && oldestQueuedAgeSeconds !== null) {
      findings.push({
        check: "outbox-age",
        severity: ageSeverity,
        summary: `The oldest outgoing message has been waiting ${describeDuration(oldestQueuedAgeSeconds)} past its send time.`,
      });
    }
    if (stuckRunning > 0) {
      findings.push({
        check: "outbox-stuck",
        severity: "warning",
        summary: `${stuckRunning} outgoing message(s) have been marked as sending for over ${HEALTH_THRESHOLDS.outboxStuckRunningMinutes} minutes.`,
      });
    }
    if (deadLast24h > 0) {
      findings.push({
        check: "outbox-dead-letters",
        severity: "critical",
        summary: `${deadLast24h} outgoing message(s) failed permanently in the last 24 hours; each customer did not receive it.`,
      });
    }
  }

  if (snapshot.jobs === null) {
    findings.push({ check: "read-failed:jobs", severity: "critical", summary: "The background-job queue could not be read." });
  } else {
    for (const lane of ["REALTIME", "STANDARD", "BULK"] as const) {
      const age = snapshot.jobs.oldestQueuedAgeSeconds[lane];
      const severity = age === null ? null : severityForAge(age, HEALTH_THRESHOLDS.laneAgeSeconds[lane]);
      if (severity && age !== null) {
        findings.push({ check: `job-age:${lane}`, severity, summary: `The oldest ${lane.toLowerCase()} background job has been waiting ${describeDuration(age)}.` });
      }
    }
    if (snapshot.jobs.deadLast24h > 0) {
      findings.push({
        check: "job-dead-letters",
        severity: "warning",
        summary: `${snapshot.jobs.deadLast24h} background job(s) failed permanently in the last 24 hours.`,
      });
    }
  }

  return findings;
}
