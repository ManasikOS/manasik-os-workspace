import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";

import type { OperatorSetupSources } from "./operator-setup-progress";
import { summariseOnboardingFunnel, type OnboardingEventRow, type OnboardingFunnelSummary } from "./setup-events";
import type { SetupStateRow } from "./setup-steps";

/**
 * Operator-console reads (service role, so every query names the agency ids it
 * is about). One batched query per source instead of one per agency.
 */
export async function loadOperatorSetupSources(agencyIds: string[], activeStaffByAgency: Map<string, number>): Promise<OperatorSetupSources> {
  const empty: OperatorSetupSources = {
    activeStaffByAgency,
    whatsappConnected: new Set(),
    pageChannelConnected: new Set(),
    smtpSaved: new Set(),
    agenciesWithPaymentAccount: new Set(),
    agenciesWithPackage: new Set(),
    stateByAgency: new Map(),
  };
  if (agencyIds.length === 0) return empty;

  const admin = createAdminClient();
  const [whatsapp, pageChannels, smtp, payments, packages, states] = await Promise.all([
    admin.from("whatsapp_integrations").select("agency_id").in("agency_id", agencyIds).eq("status", "CONNECTED"),
    admin.from("channel_connections").select("agency_id").in("agency_id", agencyIds).eq("status", "CONNECTED"),
    admin.from("agency_smtp_settings").select("agency_id").in("agency_id", agencyIds),
    admin.from("agency_payment_accounts").select("agency_id").in("agency_id", agencyIds).eq("active", true),
    admin.from("packages").select("agency_id").in("agency_id", agencyIds),
    admin
      .from("agency_onboarding_state")
      .select("agency_id, steps, basics_confirmed_at, password_set_at, guide_dismissed_at, last_step")
      .in("agency_id", agencyIds),
  ]);

  const ids = (rows: { agency_id: unknown }[] | null) => new Set((rows ?? []).map((row) => String(row.agency_id)));

  const stateByAgency = new Map<string, SetupStateRow>();
  for (const row of states.data ?? []) {
    stateByAgency.set(String(row.agency_id), {
      steps: (row.steps as Record<string, string> | null) ?? {},
      basicsConfirmedAt: (row.basics_confirmed_at as string | null) ?? null,
      passwordSetAt: (row.password_set_at as string | null) ?? null,
      guideDismissedAt: (row.guide_dismissed_at as string | null) ?? null,
      lastStep: (row.last_step as string | null) ?? null,
    });
  }

  return {
    activeStaffByAgency,
    whatsappConnected: ids(whatsapp.data),
    pageChannelConnected: ids(pageChannels.data),
    smtpSaved: ids(smtp.data),
    agenciesWithPaymentAccount: ids(payments.data),
    agenciesWithPackage: ids(packages.data),
    stateByAgency,
  };
}

/** The setup funnel over the last `days` days, across every agency. */
export async function loadOnboardingFunnel(days: number): Promise<OnboardingFunnelSummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await createAdminClient()
    .from("onboarding_events")
    .select("agency_id, event, step, connector")
    .gte("created_at", since)
    .limit(50000);
  return summariseOnboardingFunnel((data ?? []) as OnboardingEventRow[]);
}

/** Signup requests in the last hour and in the 24 hours before it, for spike detection. */
export async function loadSignupAttemptCounts(): Promise<{ lastHourAttempts: number; previous24hAttempts: number }> {
  const admin = createAdminClient();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAndHourAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

  const [lastHour, previous] = await Promise.all([
    admin.from("signup_attempts").select("id", { count: "exact", head: true }).gte("created_at", hourAgo),
    admin.from("signup_attempts").select("id", { count: "exact", head: true }).gte("created_at", dayAndHourAgo).lt("created_at", hourAgo),
  ]);

  return { lastHourAttempts: lastHour.count ?? 0, previous24hAttempts: previous.count ?? 0 };
}
