import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listApprovedPaymentAccounts, type ApprovedPaymentAccount } from "@/lib/data/agency-payment-accounts-repository";
import { getAgencySettings } from "@/lib/data/settings-repository";
import type { AgencySettingsRow } from "@/lib/types/settings";
import { createClient } from "@/utils/supabase/server";

import type { LocaleDefaultRow } from "./locale-detection";
import { computeSeatCapacity, type SeatCapacity } from "./seat-capacity";

/** Reads for the essentials steps. Every read goes through the session client, so RLS scopes it to the caller's agency. */

export interface BasicsStepData {
  settings: AgencySettingsRow;
  localeRows: LocaleDefaultRow[];
}

export async function loadBasicsStepData(): Promise<BasicsStepData> {
  const supabase = createClient(await cookies());
  const [settings, locale] = await Promise.all([
    getAgencySettings(supabase),
    supabase.from("country_locale_defaults").select("country_code, currency, timezone, supported_languages"),
  ]);

  return {
    settings,
    localeRows: (locale.data ?? []).map((row) => ({
      countryCode: row.country_code as string,
      currency: row.currency as string,
      timezone: row.timezone as string,
      supportedLanguages: (row.supported_languages as string[]) ?? ["en"],
    })),
  };
}

/** Seats used and available on the agency's plan. Also used by the invite action as its server-side guard. */
export const loadSeatCapacity = cache(async (): Promise<SeatCapacity> => {
  const supabase = createClient(await cookies());
  const [subscription, active, invited] = await Promise.all([
    supabase.from("agency_subscriptions").select("seats_purchased, plans(seat_allowance)").maybeSingle(),
    supabase.from("staff_profiles").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
    supabase.from("staff_profiles").select("id", { count: "exact", head: true }).eq("status", "INVITED"),
  ]);

  const plan = subscription.data?.plans as unknown as { seat_allowance: number | null } | null | undefined;

  return computeSeatCapacity({
    planAllowance: subscription.data ? (plan?.seat_allowance ?? null) : undefined,
    seatsPurchased: (subscription.data?.seats_purchased as number | undefined) ?? 0,
    activeStaff: active.count ?? 0,
    pendingInvitations: invited.count ?? 0,
  });
});

export async function loadSetupPaymentAccounts(): Promise<ApprovedPaymentAccount[]> {
  const { agencyId } = await getCurrentStaffRole();
  if (!agencyId) return [];
  return listApprovedPaymentAccounts(createClient(await cookies()), agencyId);
}

/** The agency's head-office branch: where a first-run invitation places the new person. */
export async function loadPrimaryBranchId(): Promise<string | null> {
  const supabase = createClient(await cookies());
  const { data } = await supabase
    .from("branches")
    .select("id")
    .eq("status", "ACTIVE")
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
