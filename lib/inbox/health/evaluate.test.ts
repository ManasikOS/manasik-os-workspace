import { describe, expect, it } from "vitest";

import { evaluateInboxHealth, type InboxHealthSnapshot } from "./evaluate";

const healthy: InboxHealthSnapshot = {
  cronJobs: [
    { jobname: "inbox-sla", state: "OK", reason: null },
    { jobname: "finance-ops-sweep", state: "PAUSED", reason: "The job is paused." },
  ],
  outbox: { oldestQueuedAgeSeconds: 5, stuckRunning: 0, deadLast24h: 0 },
  jobs: { oldestQueuedAgeSeconds: { REALTIME: 2, STANDARD: 10, BULK: null }, deadLast24h: 0 },
};

const withChange = (change: Partial<InboxHealthSnapshot>): InboxHealthSnapshot => ({ ...healthy, ...change });

describe("evaluateInboxHealth", () => {
  it("reports nothing for a healthy system, and ignores paused jobs", () => {
    expect(evaluateInboxHealth(healthy)).toEqual([]);
  });

  it("reports an empty queue as healthy", () => {
    expect(
      evaluateInboxHealth(withChange({ outbox: { oldestQueuedAgeSeconds: null, stuckRunning: 0, deadLast24h: 0 }, jobs: { oldestQueuedAgeSeconds: { REALTIME: null, STANDARD: null, BULK: null }, deadLast24h: 0 } })),
    ).toEqual([]);
  });

  it.each(["FAILING", "STALE"])("reports a %s cron job as critical, with its own check id", (state) => {
    const findings = evaluateInboxHealth(withChange({ cronJobs: [{ jobname: "inbox-sla", state, reason: "Two runs in a row failed." }] }));
    expect(findings).toEqual([{ check: "cron:inbox-sla", severity: "critical", summary: expect.stringContaining("inbox-sla") }]);
    expect(findings[0].summary).toContain("Two runs in a row failed.");
  });

  it("reports an active job that has never run as a warning", () => {
    expect(evaluateInboxHealth(withChange({ cronJobs: [{ jobname: "inbox-health", state: "NEVER_RUN", reason: null }] }))[0]).toMatchObject({ check: "cron:inbox-health", severity: "warning" });
  });

  it("grades the outbox by how long a due message has waited: 120 s warns, 300 s is critical, the limits themselves do not trip", () => {
    const at = (age: number) => evaluateInboxHealth(withChange({ outbox: { oldestQueuedAgeSeconds: age, stuckRunning: 0, deadLast24h: 0 } }))[0]?.severity ?? null;
    expect(at(120)).toBeNull();
    expect(at(121)).toBe("warning");
    expect(at(300)).toBe("warning");
    expect(at(301)).toBe("critical");
  });

  it("treats a permanently failed outgoing message as critical and a stuck one as a warning", () => {
    const findings = evaluateInboxHealth(withChange({ outbox: { oldestQueuedAgeSeconds: null, stuckRunning: 2, deadLast24h: 3 } }));
    expect(findings.find((finding) => finding.check === "outbox-dead-letters")).toMatchObject({ severity: "critical" });
    expect(findings.find((finding) => finding.check === "outbox-stuck")).toMatchObject({ severity: "warning" });
  });

  it("uses a different limit for each background-job lane", () => {
    const findings = evaluateInboxHealth(withChange({ jobs: { oldestQueuedAgeSeconds: { REALTIME: 200, STANDARD: 200, BULK: 200 }, deadLast24h: 0 } }));
    expect(findings).toEqual([{ check: "job-age:REALTIME", severity: "critical", summary: expect.stringContaining("realtime") }]);
  });

  it("warns when background jobs failed permanently", () => {
    expect(evaluateInboxHealth(withChange({ jobs: { oldestQueuedAgeSeconds: { REALTIME: null, STANDARD: null, BULK: null }, deadLast24h: 4 } }))).toEqual([
      { check: "job-dead-letters", severity: "warning", summary: expect.stringContaining("4") },
    ]);
  });

  it("reports a part it could not read as critical instead of treating it as healthy", () => {
    const findings = evaluateInboxHealth({ cronJobs: null, outbox: null, jobs: null });
    expect(findings.map((finding) => finding.check).sort()).toEqual(["read-failed:cron-jobs", "read-failed:jobs", "read-failed:outbox"]);
    expect(findings.every((finding) => finding.severity === "critical")).toBe(true);
  });

  it("states durations in readable units", () => {
    const summary = (age: number) => evaluateInboxHealth(withChange({ outbox: { oldestQueuedAgeSeconds: age, stuckRunning: 0, deadLast24h: 0 } }))[0].summary;
    expect(summary(150)).toContain("3 minutes");
    expect(summary(7_300)).toContain("2 hours");
  });

  it("never puts message content, phone numbers or agency ids in a finding", () => {
    const findings = evaluateInboxHealth({
      cronJobs: [{ jobname: "inbox-sla", state: "FAILING", reason: "The web app answered with an error on the last 3 calls." }],
      outbox: { oldestQueuedAgeSeconds: 900, stuckRunning: 1, deadLast24h: 1 },
      jobs: { oldestQueuedAgeSeconds: { REALTIME: 999, STANDARD: 999, BULK: 99999 }, deadLast24h: 1 },
    });
    expect(findings.length).toBeGreaterThan(4);
    for (const finding of findings) {
      expect(finding.summary).not.toMatch(/\d{7,}|@|[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });
});
