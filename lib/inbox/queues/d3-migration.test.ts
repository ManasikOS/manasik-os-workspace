import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261204090700_d3_single_queue_recompute.sql"), "utf8");
const code = sql.replace(/--.*$/gm, "");
const fn = code.slice(code.indexOf("create or replace function public.refresh_conversation_queues"));

/** Pins the rules D3's SQL must keep. Behaviour and cost are proven against a database by scripts/sql/verify-d3-single-queue-recompute.sql. */
describe("D3 migration content", () => {
  it("drops only the message-insert refresh trigger", () => {
    expect(code).toContain("drop trigger if exists conversation_messages_refresh_queues on public.conversation_messages;");
    expect(code.match(/drop trigger/g)).toHaveLength(1);
  });

  it("computes a conversation's queues exactly once per refresh", () => {
    expect(fn.match(/compute_conversation_queues\(/g)).toHaveLength(1);
  });

  it("takes the rank and activity time from that one result and inserts from the array, not from a second compute", () => {
    expect(fn).toContain("(array_agg(w.priority_rank))[1]");
    expect(fn).toContain("(array_agg(w.last_activity_at))[1]");
    expect(fn).toContain("from unnest(v_new_queue_codes) as q(queue_code)");
  });

  it("keeps the per-conversation advisory lock, the never-lose-a-count counter maintenance, and the service-role-only grants", () => {
    expect(fn).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_conversation_id::text, 0))");
    expect(fn).toContain("insert into public.conversation_queue_counts as q");
    expect(fn).toContain("delete from public.conversation_queue_counts q");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = ''");
    expect(code).toContain("revoke all on function public.refresh_conversation_queues(uuid) from public, anon, authenticated;");
    expect(code).toContain("grant execute on function public.refresh_conversation_queues(uuid) to service_role;");
    expect(code).not.toMatch(/grant execute[^;]*to (public|anon|authenticated)/);
  });

  it("is safe to drop the trigger: the definition never reads messages", () => {
    // The reason the trigger is redundant. If compute ever starts reading conversation_messages, this migration's premise is gone.
    const original = readFileSync(join(process.cwd(), "supabase/migrations/20261202090500_mi2_2_conversation_queues.sql"), "utf8");
    const compute = original.slice(original.indexOf("create or replace function public.compute_conversation_queues"), original.indexOf("revoke all on function public.compute_conversation_queues"));
    expect(compute).not.toContain("conversation_messages");
  });
});
