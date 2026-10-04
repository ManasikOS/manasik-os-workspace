import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261204090100_q2_queue_claim.sql"), "utf8").replace(/\r\n/g, "\n");
const claim = sql.slice(sql.indexOf("create or replace function public.claim_channel_jobs"), sql.indexOf("revoke all on function public.claim_channel_jobs"));

/** Pins the rules Q2's SQL must keep. Behaviour and timing are proven against a database by scripts/sql/verify-q2-queue-claim.sql. */
describe("Q2 migration content", () => {
  it("adds a lease column and the two partial indexes the claim relies on", () => {
    expect(sql).toContain("add column if not exists locked_until timestamptz");
    expect(sql).toContain("on public.channel_jobs (lane, agency_id, priority desc, run_after, id)\n  where status = 'QUEUED'");
    expect(sql).toContain("on public.channel_jobs (lane, agency_id)\n  where status = 'RUNNING'");
  });

  it("replaces the four-argument claim with a five-argument one whose lease defaults, so old callers keep working", () => {
    expect(sql).toContain("drop function if exists public.claim_channel_jobs(text, text, integer, integer);");
    expect(claim).toContain("p_lease_seconds   integer default 300");
    expect(sql).toContain("revoke all on function public.claim_channel_jobs(text, text, integer, integer, integer) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.claim_channel_jobs(text, text, integer, integer, integer) to service_role;");
  });

  it("no longer ranks the whole backlog: it scans agencies and takes only the top rows of each", () => {
    expect(claim).toContain("with recursive agency_scan(agency_id)");
    expect(claim).toContain("limit greatest(p_per_agency_cap - coalesce(f.n, 0), 0)");
    // The old shape was one window function over every due queued job in the lane.
    expect(claim).not.toMatch(/row_number\(\) over \(partition by/);
  });

  it("keeps the rules the claim already had: lane lock, fairness order, skip locked, one reply per conversation", () => {
    expect(claim).toContain("pg_advisory_xact_lock(hashtext('channel_jobs.claim.' || p_lane))");
    expect(claim).toContain("order by q.priority desc, q.run_after, q.id");
    expect(claim).toContain("order by e.rn, e.run_after, e.id");
    expect(claim).toContain("for update of c skip locked");
    expect(claim).toContain("j.kind = 'REPLY'");
    expect(claim).toContain("r.coalesce_key = j.coalesce_key");
  });

  it("stamps the lease on claim and ignores expired leases for both the cap and the reply rule", () => {
    expect(claim).toContain("locked_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 10))");
    expect(claim.match(/coalesce\((?:f|r)\.locked_until, (?:f|r)\.locked_at \+ interval '5 minutes'\) > now\(\)/g)).toHaveLength(2);
  });

  it("clears the lease on every other transition and releases by lease, with the old rule for lease-less rows", () => {
    for (const fn of ["complete_channel_job", "fail_channel_job", "release_channel_job", "release_stale_channel_jobs"]) {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}`));
      expect(body.slice(0, body.indexOf("$$;", 20))).toContain("locked_until = null");
    }
    expect(sql).toContain("coalesce(locked_until, locked_at + make_interval(secs => greatest(p_older_than_seconds, 1))) < now()");
  });

  it("keeps every function a service-role-only definer with a pinned search_path", () => {
    expect(sql.match(/security definer/g)).toHaveLength(5);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(5);
    expect(sql).not.toMatch(/grant execute[^;]*to (public|anon|authenticated)/);
    expect(sql).not.toMatch(/net\.http|http_get|http_post|pg_sleep/);
  });

  it("qualifies every table it touches", () => {
    const code = sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    const unqualified = code.match(/(?<!public\.)(?<![a-z_])(channel_jobs)(?![a-z_])/g) ?? [];
    expect(unqualified).toEqual([]);
  });
});
