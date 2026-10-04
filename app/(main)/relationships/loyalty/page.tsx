import { cookies } from "next/headers";

import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  listLoyaltyPilgrimSummaries,
  listLoyaltyTiers,
  listRedemptionsWithPilgrim,
} from "@/lib/data/loyalty-repository";
import { createClient } from "@/utils/supabase/server";

import LoyaltyView from "./components/loyalty-view";

/**
 * Loyalty & Repeat Umrah (Phase C9). "Repeat" status, points balance and
 * tier are all computed live — see lib/data/loyalty-repository.ts. Only
 * tiers, the points ledger, and redemption requests are actually stored.
 */
export default async function LoyaltyPage() {
  const { role } = await getCurrentStaffRole();
  const canManage = role === "ADMIN" || role === "CEO" || role === "OPERATIONS";

  const supabase = createClient(await cookies());
  const [pilgrims, tiers, redemptions] = await Promise.all([
    listLoyaltyPilgrimSummaries(supabase).catch(() => []),
    listLoyaltyTiers(supabase).catch(() => []),
    listRedemptionsWithPilgrim(supabase).catch(() => []),
  ]);

  return (
    <LoyaltyView
      pilgrims={pilgrims}
      tiers={tiers}
      redemptions={redemptions}
      canManage={canManage}
    />
  );
}
