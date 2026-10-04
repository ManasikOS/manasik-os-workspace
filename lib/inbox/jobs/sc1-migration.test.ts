import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261202094000_sc1_atomic_inbound_persistence.sql"), "utf8");

/** Guards the properties docs/inbox/scaling.md §9 requires of the atomic persistence function; Postgres behaviour is verified against staging. */
describe("SC1 migration content", () => {
  it("pins search_path and is SECURITY DEFINER for both functions", () => {
    expect(sql.match(/security definer/g)).toHaveLength(2);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(2);
  });

  it("revokes execute from public, anon and authenticated and grants only service_role", () => {
    for (const signature of ["ingest_inbound_message_atomic(uuid, uuid, text, text, text, jsonb, text, integer)", "repair_missing_enrich_jobs(uuid, integer, integer)"]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(sql).not.toMatch(/grant execute[^;]*to (public|anon|authenticated)/);
  });

  it("verifies the conversation belongs to the agency before writing anything", () => {
    expect(sql).toMatch(/c\.id = p_conversation_id and c\.agency_id = p_agency_id/);
    expect(sql.indexOf("does not belong to this agency")).toBeLessThan(sql.indexOf("insert into public.conversation_messages"));
  });

  it("relies on the existing unique index as the final race guard and never calls out of the database", () => {
    expect(sql).toContain("on conflict (agency_id, external_message_id) where external_message_id is not null");
    expect(sql).not.toMatch(/net\.http|http_get|http_post|pg_sleep/);
  });

  it("qualifies every table it touches", () => {
    const withoutRevokes = sql.replace(/revoke all on function[^;]*;/g, "");
    const unqualified = withoutRevokes.match(/\b(?:from|into|update|join)\s+(?!public\.|pg_|\()([a-z_]+)/gi) ?? [];
    expect(unqualified.filter((match) => !/into\s+(v_|r_)/i.test(match))).toEqual([]);
  });
});
