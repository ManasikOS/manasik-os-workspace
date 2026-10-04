import type { AutonomyLevel } from "@/lib/inbox/intelligence/contracts";
import type { Db } from "@/lib/ai/db";

export type PlanFeatures = Record<string, boolean | "read_only">;

export interface Entitlements {
  planCode: string;
  aiConversationAllowance: number | null;
  autonomyCeiling: AutonomyLevel;
  overageOptIn: boolean;
  usage: number;
  /** Optional while older callers/tests construct the legacy entitlement shape. */
  features?: PlanFeatures;
  grandfathered?: boolean;
}

export function entitlementUtilisation(entitlements: Entitlements): number {
  if (!entitlements.aiConversationAllowance || entitlements.aiConversationAllowance <= 0) return 0;
  return entitlements.usage / entitlements.aiConversationAllowance;
}

export type AiDegradation = "FULL" | "ON_DEMAND_DRAFTS" | "RULES_AND_MATCHING_ONLY" | "DETERMINISTIC_ONLY";

export function resolveAiDegradation(entitlements: Entitlements): AiDegradation {
  const utilisation = entitlementUtilisation(entitlements);
  if (utilisation >= 1.2) return "DETERMINISTIC_ONLY";
  if (utilisation >= 1 && !entitlements.overageOptIn) return "RULES_AND_MATCHING_ONLY";
  if (utilisation >= 0.8) return "ON_DEMAND_DRAFTS";
  return "FULL";
}

const entitlementCache = new Map<string, { value: Entitlements; expiresAt: number }>();

export async function resolveEntitlements(db: Db, agencyId: string, now = new Date()): Promise<Entitlements | null> {
  const cached = entitlementCache.get(agencyId);
  if (cached && cached.expiresAt > now.getTime()) return cached.value;
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const [{ data: subscription }, { data: usage }] = await Promise.all([
    db.from("agency_subscriptions").select("plan_code,status,overage_opt_in,ai_conversation_allowance_override,plans(ai_conversation_allowance,autonomy_ceiling,features)").eq("agency_id", agencyId).maybeSingle(),
    db.from("agency_usage_counters").select("used,limit").eq("agency_id", agencyId).eq("period_start", period).eq("metric", "AI_CONVERSATIONS").maybeSingle(),
  ]);
  if (!subscription) return null;
  const plan = subscription.plans as unknown as { ai_conversation_allowance: number | null; autonomy_ceiling: AutonomyLevel; features: PlanFeatures | null } | null;
  const value: Entitlements = {
    planCode: subscription.plan_code as string,
    aiConversationAllowance: (subscription.ai_conversation_allowance_override as number | null) ?? (usage?.limit as number | null) ?? plan?.ai_conversation_allowance ?? null,
    autonomyCeiling: plan?.autonomy_ceiling ?? "L1",
    overageOptIn: Boolean(subscription.overage_opt_in),
    usage: Number(usage?.used ?? 0),
    features: plan?.features ?? {},
    grandfathered: subscription.status === "GRANDFATHERED",
  };
  entitlementCache.set(agencyId, { value, expiresAt: now.getTime() + 60_000 });
  return value;
}
