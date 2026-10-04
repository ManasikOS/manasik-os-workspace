import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261204090000_q1_reply_queue.sql"), "utf8");

/** Pins the rules Q1's SQL must keep. How Postgres behaves is proven against a database by scripts/sql/verify-q1-reply-queue.sql. */
describe("Q1 migration content", () => {
  it("adds REPLY to the job kinds without dropping any existing kind", () => {
    const kinds = sql.slice(sql.indexOf("channel_jobs_kind_check check"), sql.indexOf("-- 2."));
    for (const kind of ["ENRICH", "IDENTITY_MATCH", "OFFER_MATCH", "RISK_SCAN", "QUEUE_REFRESH", "HANDOFF_SUMMARY", "TRANSCRIBE_VOICE", "READ_DOCUMENT", "EXTRACT_RECEIPT", "EMBED_KNOWLEDGE", "RETENTION_SWEEP", "USAGE_ROLLUP", "REPLAY", "REPLY"]) {
      expect(kinds).toContain(`'${kind}'`);
    }
  });

  it("keeps both new tables away from tenants: RLS on, no policy, nothing granted to anon or authenticated", () => {
    for (const table of ["inbox_reply_queue_agencies", "reply_intents"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated;`);
    }
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant (all|select|insert|update|delete)[^;]* on table/i);
  });

  it("allows one intent per inbound message per agency, tied to that agency's own conversation and message", () => {
    expect(sql).toContain("unique (agency_id, inbound_message_id)");
    expect(sql).toContain("foreign key (conversation_id, agency_id)");
    expect(sql).toContain("references public.conversations (id, agency_id) on delete cascade");
    expect(sql).toContain("foreign key (inbound_message_id, agency_id)");
    expect(sql).toContain("references public.conversation_messages (id, agency_id) on delete cascade");
  });

  it("limits intent states to the ones the state machine uses", () => {
    expect(sql).toContain("check (status in ('GENERATING', 'GENERATED', 'SENDING', 'SENT', 'SKIPPED', 'UNKNOWN'))");
  });

  it("makes the claim skip a REPLY whose conversation already has one running, and nothing else", () => {
    const claim = sql.slice(sql.indexOf("create or replace function public.claim_channel_jobs"), sql.indexOf("-- 6."));
    expect(claim).toMatch(/j\.kind = 'REPLY'\s+and exists \(\s+select 1 from public\.channel_jobs r\s+where r\.agency_id = j\.agency_id and r\.kind = 'REPLY' and r\.status = 'RUNNING'\s+and r\.coalesce_key = j\.coalesce_key/);
    // Fairness and the lane lock are unchanged.
    expect(claim).toContain("pg_advisory_xact_lock(hashtext('channel_jobs.claim.' || p_lane))");
    expect(claim).toContain("r.rn <= greatest(p_per_agency_cap - coalesce(f.n, 0), 0)");
    expect(claim).toContain("for update of c skip locked");
  });

  it("routes only PROCESS_INBOUND for a listed agency, and leaves voice notes and every other agency on agent_jobs", () => {
    const ingest = sql.slice(sql.indexOf("create or replace function public.ingest_inbound_message_atomic"));
    expect(ingest).toContain("p_agent_job_kind = 'PROCESS_INBOUND'");
    expect(ingest).toContain("from public.inbox_reply_queue_agencies q where q.agency_id = p_agency_id");
    expect(ingest).toContain("insert into public.agent_jobs (agency_id, kind, payload)");
    // Merges a burst on the conversation, waits at most 10 s, and can never be pushed past 20 s after it was queued.
    expect(ingest).toContain("'reply:' || p_conversation_id::text");
    expect(ingest).toContain("least(greatest(coalesce(p_enrich_delay_seconds, 0), 0), 10)");
    expect(ingest).toContain("least(greatest(j.run_after, excluded.run_after), j.created_at + interval '20 seconds')");
    expect(ingest).toContain("on conflict (agency_id, coalesce_key) where status = 'QUEUED' and coalesce_key is not null");
  });

  it("keeps the SC1 guarantees: same signature, agency check first, definer with pinned search_path, service role only", () => {
    const ingest = sql.slice(sql.indexOf("create or replace function public.ingest_inbound_message_atomic"));
    expect(ingest).toContain("returns table (message_id uuid, sequence_number bigint, is_duplicate boolean, agent_job_id uuid, enrich_job_id uuid)");
    expect(ingest.indexOf("does not belong to this agency")).toBeLessThan(ingest.indexOf("insert into public.conversation_messages"));
    expect(sql.match(/security definer/g)).toHaveLength(2);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(2);
    for (const signature of ["ingest_inbound_message_atomic(uuid, uuid, text, text, text, jsonb, text, integer)", "claim_channel_jobs(text, text, integer, integer)"]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(sql).not.toMatch(/grant execute[^;]*to (public|anon|authenticated)/);
    expect(sql).not.toMatch(/net\.http|http_get|http_post|pg_sleep/);
  });

  it("qualifies every table it touches", () => {
    // With comments and string literals removed, no table this file touches may appear without its schema: with an empty
    // search_path an unqualified name would fail (or, worse, resolve somewhere unintended).
    const code = sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    const unqualified = code.match(/(?<!public\.)(?<![a-z_])(channel_jobs|conversations|conversation_messages|agent_jobs|agencies|inbox_reply_queue_agencies|reply_intents)(?![a-z_])/g) ?? [];
    expect(unqualified).toEqual([]);
  });
});
