import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const file = "20261225090000_cron_job_health_and_cleanup.sql";
const sql = readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8");
const code = sql.replace(/^--.*$/gm, "");

/**
 * T6 (tasks/plan.md): the pg_cron monitoring migration. The classification logic (OK, STALE, FAILING, PAUSED, NEVER_RUN), the collector
 * and the cleanup were proven against Manasik OS in a rolled-back transaction with synthetic jobs; these tests guard the properties
 * that must not drift afterwards.
 */
describe("cron monitoring migration", () => {
  it("keeps the monitoring table private: RLS on, no policy, no access for public, anon or authenticated", () => {
    expect(code).toMatch(/alter table public\.cron_route_calls enable row level security/i);
    expect(code).not.toMatch(/create policy/i);
    expect(code).toMatch(/revoke all on table public\.cron_route_calls from public, anon, authenticated/i);
    expect(code).not.toMatch(/grant [^;]*on (table )?public\.cron_route_calls/i);
  });

  it("stores no message content, names or secrets: route, request id, status and timing only", () => {
    const table = code.match(/create table if not exists public\.cron_route_calls \(([\s\S]*?)\);/i)?.[1] ?? "";
    const columns = [...table.matchAll(/^\s*([a-z_]+)\s+[a-z]/gim)].map((match) => match[1]);
    // error_message is the transport error pg_net reports (for example a timeout), cut to 200 characters; it is never a response body.
    expect(columns).toEqual(["request_id", "path", "called_at", "status_code", "timed_out", "error_message", "collected_at"]);
  });

  it("pins the search path on every new function and makes the data functions security definer", () => {
    for (const name of ["cron_collect_route_results", "cron_history_cleanup", "cron_job_health"]) {
      const definition = code.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`, "i"))?.[0] ?? "";
      expect(definition, name).toMatch(/security definer set search_path = ''/i);
    }
    expect(code).toMatch(/cron_expected_interval_seconds[\s\S]*?immutable set search_path = ''/i);
  });

  it("lets only the service role read job health, and nobody but the owner run the collector or cleanup", () => {
    expect(code).toContain("grant execute on function public.cron_job_health() to service_role;");
    expect(code.match(/grant execute/gi)).toHaveLength(1);
    for (const signature of ["cron_collect_route_results()", "cron_history_cleanup()", "cron_expected_interval_seconds(text)", "cron_job_health()"]) {
      expect(code).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
    }
  });

  it("never lets recording a call stop the call: the insert is wrapped and only warns on failure", () => {
    const body = code.match(/create or replace function public\.invoke_cron_route[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(body.indexOf("net.http_get")).toBeLessThan(body.indexOf("insert into public.cron_route_calls"));
    expect(body).toMatch(/begin\s+insert into public\.cron_route_calls[\s\S]*?exception when others then\s+raise warning/i);
    expect(body).not.toMatch(/raise exception 'invoke_cron_route: could not record/i);
  });

  it("keeps the same twelve allowed routes as before, so recording adds no new reachable path", () => {
    const body = code.match(/if p_path not in \(([\s\S]*?)\) then/i)?.[1] ?? "";
    const paths = [...body.matchAll(/'(\/api\/cron\/[a-z0-9-]+)'/g)].map((match) => match[1]);
    expect(paths).toHaveLength(12);
    expect(paths).toContain("/api/cron/inbox-sla");
    expect(paths).toContain("/api/cron/inbox-retention");
    expect(paths).toContain("/api/cron/finance-ops-sweep");
  });

  it("trims history to seven days and collects answers before pg_net discards them", () => {
    expect(code).toMatch(/delete from cron\.job_run_details where start_time < now\(\) - interval '7 days'/i);
    expect(code).toMatch(/delete from public\.cron_route_calls where called_at < now\(\) - interval '7 days'/i);
    expect(code).toContain("'*/5 * * * *'"); // pg_net keeps answers for about six hours; collecting every five minutes is far inside that
    expect(code).toContain("'37 3 * * *'");
  });

  it("creates the two housekeeping jobs only when missing, and touches no other job", () => {
    expect(code).toMatch(/if not exists \(select 1 from cron\.job where jobname = 'cron-route-results'\)/);
    expect(code).toMatch(/if not exists \(select 1 from cron\.job where jobname = 'cron-history-cleanup'\)/);
    expect(code.match(/cron\.schedule\(/g)).toHaveLength(2);
    expect(code).not.toMatch(/cron\.(unschedule|alter_job)/);
  });

  it("reports the five states and treats a paused job as paused, not as stale", () => {
    for (const state of ["PAUSED", "NEVER_RUN", "FAILING", "STALE", "OK"]) expect(code).toContain(`'${state}'`);
    expect(code.indexOf("'PAUSED'")).toBeLessThan(code.indexOf("'STALE'"));
    expect(code).toMatch(/consecutive_failures, 0\) >= 2 or coalesce\(c\.consecutive_http_failures, 0\) >= 2/);
    expect(code).toMatch(/j\.interval_seconds \* 2 \+ 60/);
  });

  it("cannot raise a false stale alert for a schedule it does not understand", () => {
    expect(code).toMatch(/else null\s+end;/i);
    expect(code).toMatch(/j\.interval_seconds is not null\s+and coalesce\(r\.last_success_at/i);
  });
});
