import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const answerCacheSql = readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/20261202092200_mi5_2_conversation_answer_cache.sql"),
  "utf8",
);
const entitlementsSql = readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/20261202092700_mi6_4_plans_entitlements.sql"),
  "utf8",
);
const autonomySql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261202092500_mi6_1_inbox_autonomy.sql"), "utf8");
const mediaSql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261202092400_mi5_4_message_media_analyses.sql"), "utf8");

describe("Phase 5–6 privileged RPC migrations", () => {
  it("checks the caller JWT rather than the SECURITY DEFINER owner", () => {
    expect(answerCacheSql).not.toMatch(/current_user\s*(?:=|<>)/i);
    expect(entitlementsSql).not.toMatch(/current_user\s*(?:=|<>)/i);
    expect(answerCacheSql).toMatch(/auth\.jwt\(\)\s*->>\s*'role'/);
    expect(entitlementsSql).toMatch(/auth\.jwt\(\)\s*->>\s*'role'/);
  });

  it("keeps metering RPCs service-role-only at the execute boundary", () => {
    for (const signature of [
      "increment_agency_usage_counter\\(uuid,date,text,numeric\\)",
      "meter_ai_conversation\\(uuid,uuid,date\\)",
    ]) {
      expect(entitlementsSql).toMatch(new RegExp(`revoke execute on function public\\.${signature} from public, anon, authenticated`));
      expect(entitlementsSql).toMatch(new RegExp(`grant execute on function public\\.${signature} to service_role`));
    }
  });

  it("retains explicit tenant checks for answer-cache writes and hits", () => {
    expect(answerCacheSql).toMatch(/p_agency_id <> public\.current_agency_id\(\)/);
    expect(answerCacheSql).toMatch(/p_agency_id = public\.current_agency_id\(\)/);
    expect(answerCacheSql).toMatch(/revoke execute on function public\.record_conversation_answer_candidate[\s\S]*from public, anon/);
    expect(answerCacheSql).toMatch(/revoke execute on function public\.reject_conversation_answer_cache_hit\(uuid,uuid,text\) from public, anon, authenticated/);
    expect(answerCacheSql).toMatch(/grant execute on function public\.reject_conversation_answer_cache_hit\(uuid,uuid,text\) to service_role/);
  });

  it("schema-qualifies pgvector operators for the locked search path", () => {
    expect(answerCacheSql).toMatch(/operator\(extensions\.<=>\)/);
    expect(answerCacheSql).not.toMatch(/question_embedding\s*<=>/);
  });

  it("makes autonomy level changes atomic and tenant-authorized", () => {
    expect(autonomySql).toMatch(/create or replace function public\.set_inbox_autonomy_level/);
    expect(autonomySql).toMatch(/auth\.jwt\(\)\s*->>\s*'role'/);
    expect(autonomySql).toMatch(/p_agency_id <> public\.current_agency_id\(\)/);
    expect(autonomySql).toMatch(/insert into public\.inbox_autonomy_level_audit/);
    expect(autonomySql).toMatch(/revoke all on function public\.set_inbox_autonomy_level[\s\S]*from public, anon/);
  });

  it("binds the audited autonomy actor to the signed-in caller", () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20260926130557_inbox_autonomy_actor_binding.sql"), "utf8");
    expect(sql).toMatch(/p_actor_id is distinct from auth\.uid\(\)/);
    expect(sql).toMatch(/values \(p_agency_id,p_surface,v_from,p_level/);
    expect(sql).toMatch(/revoke all on function public\.set_inbox_autonomy_level[\s\S]*from public, anon/);
  });

  it("keeps retained media private and scoped by the agency path", () => {
    expect(mediaSql).toMatch(/conversation_interventions_id_agency_unique/);
    expect(mediaSql).toMatch(/values \('inbox-attachments', 'inbox-attachments', false/);
    expect(mediaSql).toMatch(/\(storage\.foldername\(name\)\)\[1\] = \(select public\.current_agency_id\(\)\)::text/);
    expect(mediaSql).not.toMatch(/inbox-attachments'[\s\S]{0,80}public\s*=\s*true/i);
  });

  it("atomically clamps autonomy downward when a plan ceiling is reduced and records why", () => {
    expect(entitlementsSql).toMatch(/trigger agency_subscription_clamp_inbox_autonomy/);
    expect(entitlementsSql).toMatch(/autonomy_ceiling into ceiling/);
    expect(entitlementsSql).toMatch(/clamped_from/);
    expect(entitlementsSql).toMatch(/clamp_reason/);
    expect(entitlementsSql).toMatch(/case autonomy->>'level'[\s\S]*> ceiling_rank/);
  });
});
