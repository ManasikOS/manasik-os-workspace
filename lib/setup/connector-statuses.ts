import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getGoogleAdsIntegration, getMetaAdsIntegration } from "@/lib/data/ads-integrations-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

/** What one connector looks like right now, in its own status vocabulary. No secret is ever selected. */
export interface ConnectorStatusSnapshot {
  rawStatus: string | null;
  /** The connected account's name or number, when there is one. */
  accountLabel: string | null;
  lastError: string | null;
}

export interface ConnectorStatuses {
  whatsapp: ConnectorStatusSnapshot;
  messenger: ConnectorStatusSnapshot;
  instagram: ConnectorStatusSnapshot;
  email: ConnectorStatusSnapshot;
  metaAds: ConnectorStatusSnapshot;
  googleAds: ConnectorStatusSnapshot;
}

const NONE: ConnectorStatusSnapshot = { rawStatus: null, accountLabel: null, lastError: null };

/** True when at least one messaging channel is live — what the "Connect your channels" step counts as done. */
export function hasLiveChannel(statuses: ConnectorStatuses): boolean {
  return [statuses.whatsapp, statuses.messenger, statuses.instagram, statuses.email].some(
    (snapshot) => snapshot.rawStatus === "CONNECTED",
  );
}

/**
 * Live connector status for the caller's agency. Reads go through the session
 * client (RLS-scoped) except SMTP, whose table is service-role only and is
 * filtered to the caller's agency id explicitly. Email counts as connected once
 * SMTP settings are saved; the setup card asks for a test email to confirm.
 */
export const loadConnectorStatuses = cache(async (): Promise<ConnectorStatuses> => {
  const { agencyId } = await getCurrentStaffRole();
  if (!agencyId) {
    return { whatsapp: NONE, messenger: NONE, instagram: NONE, email: NONE, metaAds: NONE, googleAds: NONE };
  }

  const supabase = createClient(await cookies());
  const pageChannel = (provider: "MESSENGER" | "INSTAGRAM") =>
    supabase
      .from("channel_connections")
      .select("status, display_name, last_error")
      .eq("provider", provider)
      .neq("status", "DISCONNECTED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  const [whatsapp, messenger, instagram, smtp, metaAds, googleAds] = await Promise.all([
    supabase
      .from("whatsapp_integrations")
      .select("status, display_phone_number, business_name, last_error")
      .maybeSingle(),
    pageChannel("MESSENGER"),
    pageChannel("INSTAGRAM"),
    createAdminClient().from("agency_smtp_settings").select("from_email").eq("agency_id", agencyId).maybeSingle(),
    getMetaAdsIntegration(supabase, agencyId),
    getGoogleAdsIntegration(supabase, agencyId),
  ]);

  return {
    whatsapp: {
      rawStatus: (whatsapp.data?.status as string | null) ?? null,
      accountLabel: (whatsapp.data?.display_phone_number as string | null) ?? (whatsapp.data?.business_name as string | null) ?? null,
      lastError: (whatsapp.data?.last_error as string | null) ?? null,
    },
    messenger: {
      rawStatus: (messenger.data?.status as string | null) ?? null,
      accountLabel: (messenger.data?.display_name as string | null) ?? null,
      lastError: (messenger.data?.last_error as string | null) ?? null,
    },
    instagram: {
      rawStatus: (instagram.data?.status as string | null) ?? null,
      accountLabel: (instagram.data?.display_name as string | null) ?? null,
      lastError: (instagram.data?.last_error as string | null) ?? null,
    },
    email: {
      rawStatus: smtp.data ? "CONNECTED" : null,
      accountLabel: (smtp.data?.from_email as string | null) ?? null,
      lastError: null,
    },
    metaAds: {
      rawStatus: metaAds?.status ?? null,
      accountLabel: metaAds?.ad_account_name ?? null,
      lastError: metaAds?.last_error ?? null,
    },
    googleAds: {
      rawStatus: googleAds?.status ?? null,
      accountLabel: googleAds?.account_name ?? null,
      lastError: googleAds?.last_error ?? null,
    },
  };
});
