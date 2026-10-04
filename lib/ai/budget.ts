/**
 * The per-agency, per-surface monthly budget gate — checked by
 * `lib/ai/provider.ts`'s `generateStructured()` before every model call.
 *
 * Reads `ai_surface_settings.monthly_budget_usd` (added in
 * `_p0_3_ai_surface_settings`). A surface with no settings row yet, or no
 * budget configured, is treated as unmetered — the same "absent config
 * means don't block" posture `loadDynamicCapabilities()` takes for a
 * missing `role_permissions` row. This is deliberately permissive: a
 * missing budget is a configuration gap for the product owner to fill in,
 * not a reason to silently stop a surface nobody has priced yet.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { resolveAiDegradation, type AiDegradation } from "@/lib/billing/entitlements";

export interface BudgetCheckResult {
  ok: boolean;
  reason?: string;
  degradation?: AiDegradation;
}

interface AiSurfaceSettingsRow {
  enabled: boolean;
  mode: string;
  monthly_budget_usd: number | null;
}

/**
 * Cost accounting is not yet wired to a live per-run figure (see
 * `lib/ai/telemetry.ts`'s `estimateCostUsd` placeholder) — until it is,
 * this only enforces the surface's on/off switch, never a spend ceiling it
 * cannot actually measure. Widen this once `ai_model_rates`-driven cost
 * tracking lands (tracked in the roadmap's Phase 5 learning loop, not
 * scheduled in Phase 0).
 */
export async function checkBudget(agencyId: string, surface: string, db: Db): Promise<BudgetCheckResult> {
  try {
    const { data, error } = await db
      .from("ai_surface_settings")
      .select("enabled, mode, monthly_budget_usd")
      .eq("agency_id", agencyId)
      .eq("surface", surface)
      .maybeSingle();

    if (error || !data) {
      // No settings row for this surface/agency yet — permissive by
      // default, matching every other "absent config" fallback in this
      // codebase. A surface that should be gated needs its
      // `ai_surface_settings` row seeded, not a hard-coded refusal here.
      return { ok: true };
    }

    const settings = data as AiSurfaceSettingsRow;
    if (settings.mode === "OFF" || !settings.enabled) {
      return { ok: false, reason: `AI surface "${surface}" is turned off for this agency.` };
    }

    const periodStart = new Date();
    periodStart.setUTCDate(1);
    const period = periodStart.toISOString().slice(0, 10);
    const [{ data: subscription }, { data: usage }] = await Promise.all([
      db.from("agency_subscriptions").select("plan_code, overage_opt_in, ai_conversation_allowance_override, plans(ai_conversation_allowance, autonomy_ceiling)").eq("agency_id", agencyId).maybeSingle(),
      db.from("agency_usage_counters").select("used, limit").eq("agency_id", agencyId).eq("period_start", period).eq("metric", "AI_CONVERSATIONS").maybeSingle(),
    ]);
    if (!subscription) return { ok: true, degradation: "FULL" };
    const plan = subscription.plans as unknown as { ai_conversation_allowance: number | null; autonomy_ceiling: "L0" | "L1" | "L2" | "L3" } | null;
    const allowance = (subscription.ai_conversation_allowance_override as number | null) ?? (usage?.limit as number | null) ?? plan?.ai_conversation_allowance ?? null;
    const degradation = resolveAiDegradation({ planCode: subscription.plan_code as string, aiConversationAllowance: allowance, autonomyCeiling: plan?.autonomy_ceiling ?? "L1", overageOptIn: Boolean(subscription.overage_opt_in), usage: Number(usage?.used ?? 0) });
    if (degradation === "DETERMINISTIC_ONLY") return { ok: false, degradation, reason: "The agency is above 120% of its AI allowance; deterministic Inbox features remain available." };
    if (degradation === "RULES_AND_MATCHING_ONLY" && /(?:DRAFT|INTENT|REASON|AGENT|REPLY)/i.test(surface)) return { ok: false, degradation, reason: "The AI allowance is exhausted; rules, risk checks and live offer matching remain available." };
    return { ok: true, degradation };
  } catch (error) {
    console.error("checkBudget failed (permissive, non-fatal):", error);
    return { ok: true };
  }
}
