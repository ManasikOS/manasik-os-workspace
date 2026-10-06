import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase/migrations");
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const readMigration = (name: string) => readFileSync(join(migrationsDirectory, name), "utf8");
const cronPathPattern = /'(\/api\/cron\/[a-z0-9-]+)'/g;
const cronPathsIn = (text: string) => [...text.matchAll(cronPathPattern)].map((match) => match[1]);

/** The migration that defines the live `invoke_cron_route`: the last file, in apply order, that redefines it. */
const latestDefinitionFile = [...migrationFiles].reverse().find((name) => /create or replace function public\.invoke_cron_route\(/i.test(readMigration(name)));

function allowListOf(sql: string): string[] {
  const block = sql.match(/if p_path not in \(([\s\S]*?)\) then/i);
  return block ? cronPathsIn(block[1]) : [];
}

describe("invoke_cron_route allow-list", () => {
  it("is defined by the inbox-health migration (TASK-028 P1.3), which is the latest definition", () => {
    expect(latestDefinitionFile).toBe("20261229090000_cron_inbox_health.sql");
  });

  it("accepts every route that any migration has scheduled or ever allowed", () => {
    const allowed = new Set(allowListOf(readMigration(latestDefinitionFile!)));
    const everUsed = new Set<string>();
    for (const name of migrationFiles) {
      const sql = readMigration(name);
      if (!/invoke_cron_route/.test(sql)) continue;
      for (const path of cronPathsIn(sql)) everUsed.add(path);
    }
    const missing = [...everUsed].filter((path) => !allowed.has(path));
    expect(missing).toEqual([]);
  });

  it("restores inbox-sla and inbox-retention, which were failing on every run", () => {
    const allowed = allowListOf(readMigration(latestDefinitionFile!));
    expect(allowed).toContain("/api/cron/inbox-sla");
    expect(allowed).toContain("/api/cron/inbox-retention");
  });

  it("keeps all nine originally allowed paths; the fix added exactly the two that were failing", () => {
    const original = allowListOf(readMigration("20261213090000_em2_inbox_email_poll_cron.sql"));
    const fixed = allowListOf(readMigration("20261223090000_invoke_cron_route_allow_list_fix.sql"));
    expect(original).toHaveLength(9);
    expect(fixed.filter((path) => !original.includes(path)).sort()).toEqual(["/api/cron/inbox-retention", "/api/cron/inbox-sla"]);
    expect(original.filter((path) => !fixed.includes(path))).toEqual([]);
  });

  it("only ever adds to the list: the latest allow-list contains the fix's list, plus finance-ops-sweep, reply-window-sweep and inbox-health", () => {
    const fixed = allowListOf(readMigration("20261223090000_invoke_cron_route_allow_list_fix.sql"));
    const latest = allowListOf(readMigration(latestDefinitionFile!));
    expect(fixed.filter((path) => !latest.includes(path))).toEqual([]);
    expect(latest.filter((path) => !fixed.includes(path)).sort()).toEqual(["/api/cron/finance-ops-sweep", "/api/cron/inbox-health", "/api/cron/reply-window-sweep"]);
  });

  it("never allows a route that does not exist in the app", () => {
    for (const path of allowListOf(readMigration(latestDefinitionFile!))) {
      const routeFile = join(process.cwd(), "app", path.replace(/^\//, ""), "route.ts");
      expect(() => readFileSync(routeFile, "utf8"), `${path} has no route file`).not.toThrow();
    }
  });

  it("covers every cron route in the app, so a new route cannot be added without deciding whether it is scheduled", () => {
    // Routes that exist but are deliberately not scheduled through pg_cron. Add a route here only with a reason.
    const notScheduledThroughPgCron: Record<string, string> = {
      "onboarding-signup-alert": "never scheduled on a timer; no pg_cron job exists for it",
      "traveller-data-retention": "permanent erasure: runs as a dry run until TRAVELLER_RETENTION_LIVE=true, and is scheduled only after a person has read the dry-run numbers (TASK-037, SEC-12)",
    };
    const cronRoutesDirectory = join(process.cwd(), "app/api/cron");
    const routeNames = readdirSync(cronRoutesDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const allowed = new Set(allowListOf(readMigration(latestDefinitionFile!)));
    const unaccountedFor = routeNames.filter((name) => !allowed.has(`/api/cron/${name}`) && !(name in notScheduledThroughPgCron));
    expect(unaccountedFor, "these cron routes are neither in the allow-list nor listed as unscheduled").toEqual([]);
    for (const name of Object.keys(notScheduledThroughPgCron)) {
      expect(allowed.has(`/api/cron/${name}`), `${name} is listed as unscheduled but is allowed; remove it from the list`).toBe(false);
    }
  });

  it("keeps the function private: security definer, fixed search path, no access for public, authenticated or anon", () => {
    const sql = readMigration(latestDefinitionFile!);
    expect(sql).toMatch(/security definer set search_path = public/);
    expect(sql).toContain("revoke all on function public.invoke_cron_route(text) from public, authenticated, anon;");
    expect(sql).not.toMatch(/grant execute[^;]*invoke_cron_route/i);
  });

  it("refuses an unknown path and still sends the bearer secret from Vault", () => {
    const sql = readMigration(latestDefinitionFile!);
    expect(sql).toContain("is not a recognised cron path");
    expect(sql.indexOf("is not a recognised cron path")).toBeLessThan(sql.indexOf("net.http_get"));
    expect(sql).toContain("'Bearer ' || v_secret");
    expect(sql).toMatch(/vault\.decrypted_secrets/);
  });

  it("the allow-list fix changes no schedule: it creates, alters and removes no pg_cron job", () => {
    const sql = readMigration("20261223090000_invoke_cron_route_allow_list_fix.sql").replace(/^--.*$/gm, "");
    expect(sql).not.toMatch(/cron\.(schedule|unschedule|alter_job)/);
  });
});

describe("finance-ops-sweep job (T3)", () => {
  const sql = readMigration("20261224090000_cron_finance_ops_sweep_inactive.sql").replace(/^--.*$/gm, "");

  it("creates the job only when it does not exist, hourly, and leaves it inactive", () => {
    expect(sql).toMatch(/if not exists \(select 1 from cron\.job where jobname = 'finance-ops-sweep'\)/);
    expect(sql).toContain("'0 * * * *'");
    expect(sql).toContain("/api/cron/finance-ops-sweep");
    expect(sql).toMatch(/cron\.alter_job\([^;]*active := false\)/);
    expect(sql.indexOf("cron.schedule(")).toBeLessThan(sql.indexOf("active := false"));
  });

  it("never touches any other job", () => {
    expect(sql).not.toMatch(/cron\.unschedule/);
    expect(sql.match(/cron\.schedule\(/g)).toHaveLength(1);
    expect(sql.match(/cron\.alter_job\(/g)).toHaveLength(1);
  });
});

describe("reply-window sweep job (T9)", () => {
  const sql = readMigration("20261226090000_cron_reply_window_sweep.sql").replace(/^--.*$/gm, "");

  it("schedules the sweep every five minutes, only when it does not already exist", () => {
    expect(sql).toMatch(/if not exists \(select 1 from cron\.job where jobname = 'reply-window-sweep'\)/);
    expect(sql).toContain("'*/5 * * * *'");
    expect(sql).toContain("/api/cron/reply-window-sweep");
    expect(sql.match(/cron\.schedule\(/g)).toHaveLength(1);
    expect(sql).not.toMatch(/cron\.(unschedule|alter_job)/);
  });

  it("adds a partial index limited to the chats the sweep reads, led by the agency", () => {
    expect(sql).toMatch(/create index if not exists conversations_window_closing_idx\s+on public\.conversations \(agency_id, service_window_expires_at\)/);
    expect(sql).toMatch(/where state in \('HUMAN_REQUESTED', 'HUMAN_ACTIVE'\) and service_window_expires_at is not null/);
  });

  it("keeps recording each call, so the sweep shows up in job health like every other job", () => {
    expect(sql).toMatch(/insert into public\.cron_route_calls \(request_id, path\)/);
  });

  it("matches the sweep's own query: same states and the same window column", () => {
    const sweep = readFileSync(join(process.cwd(), "lib/inbox/window-sweep.ts"), "utf8");
    expect(sweep).toContain("service_window_expires_at");
    expect(sweep).toContain("WINDOW_REMINDER_PERSON_STATES");
    const windowReminder = readFileSync(join(process.cwd(), "lib/inbox/window-reminder.ts"), "utf8");
    expect(windowReminder).toMatch(/WINDOW_REMINDER_PERSON_STATES = \["HUMAN_REQUESTED", "HUMAN_ACTIVE"\]/);
  });
});

describe("inbox-health job (TASK-028 P1.3)", () => {
  const sql = readMigration("20261229090000_cron_inbox_health.sql").replace(/^--.*$/gm, "");

  it("schedules the check every five minutes, only when it does not already exist, and touches no other job", () => {
    expect(sql).toMatch(/if not exists \(select 1 from cron\.job where jobname = 'inbox-health'\)/);
    expect(sql).toContain("'*/5 * * * *'");
    expect(sql).toContain("/api/cron/inbox-health");
    expect(sql.match(/cron\.schedule\(/g)).toHaveLength(1);
    expect(sql).not.toMatch(/cron\.(unschedule|alter_job)/);
  });

  it("changes no table, column or index", () => {
    expect(sql).not.toMatch(/(create|alter|drop)\s+(table|index)/i);
  });

  it("is served by a route that checks the cron secret before doing anything", () => {
    const route = readFileSync(join(process.cwd(), "app/api/cron/inbox-health/route.ts"), "utf8");
    expect(route).toContain("hasValidBearerSecret");
    expect(route.indexOf("hasValidBearerSecret")).toBeLessThan(route.indexOf("readInboxHealthSnapshot("));
    expect(route.indexOf("CRON_SECRET")).toBeLessThan(route.indexOf("readInboxHealthSnapshot("));
  });
});
