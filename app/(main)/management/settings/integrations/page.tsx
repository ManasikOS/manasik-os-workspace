import { cookies } from "next/headers";
import type { ComponentProps } from "react";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listIntegrations } from "@/lib/data/settings-repository";
import { resolveConnectorAvailability } from "@/lib/setup/connector-availability";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { getGoogleAdsIntegration, getMetaAdsIntegration } from "@/lib/data/ads-integrations-repository";

import { SectionShell } from "../components/section-shell";
import { GoogleAdsConnectCard } from "./google-ads-connect-card";
import { IntegrationCard } from "./integration-card";
import { MetaAdsConnectCard } from "./meta-ads-connect-card";
import { MetaPageChannelCard } from "./meta-page-channel-card";
import { WhatsAppConnectCard } from "./whatsapp-connect-card";

/**
 * Honest status cards, not fake connectors. See the Settings plan §5.7 / D9
 * — no live OAuth connector exists for any provider in V1 except file
 * storage, which is backed by the `agency-assets` bucket (F8).
 */
export const dynamic = "force-dynamic";

type PageChannelCardStatus = ComponentProps<typeof MetaPageChannelCard>["status"];

export default async function IntegrationsSettingsPage() {
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewIntegrations) {
    return <PermissionDenied what="Integrations" />;
  }

  const supabase = createClient(await cookies());
  const [integrations, whatsapp, messenger, instagram, metaAds, googleAds] = await Promise.all([
    listIntegrations(supabase),
    supabase
      .from("whatsapp_integrations")
      .select(
        "status, display_phone_number, business_name, connection_mode, quality_rating, messaging_limit_tier, funding_status, token_expires_at, webhook_verified_at, onboarding_step, last_error",
      )
      .maybeSingle(),
    // The agency's live Messenger connection (RLS scopes it to the agency). No secret column is selected.
    supabase
      .from("channel_connections")
      .select("status, display_name, ai_enabled, last_error, last_inbound_at")
      .eq("provider", "MESSENGER")
      .neq("status", "DISCONNECTED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The agency's live Instagram connection — the same shape, no secret column selected.
    supabase
      .from("channel_connections")
      .select("status, display_name, ai_enabled, last_error, last_inbound_at")
      .eq("provider", "INSTAGRAM")
      .neq("status", "DISCONNECTED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    agencyId ? getMetaAdsIntegration(supabase, agencyId) : Promise.resolve(null),
    agencyId ? getGoogleAdsIntegration(supabase, agencyId) : Promise.resolve(null),
  ]);

  // WHATSAPP_BUSINESS / META_ADS / GOOGLE_ADS each get a dedicated one-click
  // connect card below instead of the generic honest-status card every
  // other provider uses — see §6.0 of docs/modules/whatsapp-ai-agent-implementation-plan.md
  // for the WhatsApp precedent this follows.
  const otherIntegrations = integrations.filter(
    (integration) => !["WHATSAPP_BUSINESS", "META_ADS", "GOOGLE_ADS"].includes(integration.provider),
  );

  // Which connectors this deployment can offer — shared with the guided setup (lib/setup/connector-availability.ts).
  const availability = resolveConnectorAvailability(process.env);

  return (
    <SectionShell
      title="Integrations"
      description="Only the integrations the agency can actually use today. Never shows a full API key after saving."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <WhatsAppConnectCard
          status={
            (whatsapp.data?.status as
              | "NOT_CONNECTED"
              | "CONNECTED"
              | "UNFUNDED"
              | "ERROR"
              | "DISCONNECTED"
              | "PENDING_REVIEW"
              | "RESTRICTED") ?? "NOT_CONNECTED"
          }
          displayPhoneNumber={whatsapp.data?.display_phone_number ?? null}
          businessName={whatsapp.data?.business_name ?? null}
          qualityRating={whatsapp.data?.quality_rating ?? null}
          messagingLimitTier={whatsapp.data?.messaging_limit_tier ?? null}
          fundingStatus={(whatsapp.data?.funding_status as "UNKNOWN" | "FUNDED" | "UNFUNDED" | null) ?? null}
          tokenExpiresAt={whatsapp.data?.token_expires_at ?? null}
          webhookVerifiedAt={whatsapp.data?.webhook_verified_at ?? null}
          onboardingStep={whatsapp.data?.onboarding_step ?? null}
          lastError={whatsapp.data?.last_error ?? null}
          // Passed from the server rather than read from NEXT_PUBLIC_* twins
          // in the client component: the app id and Embedded Signup config id
          // are not secret (they travel in the OAuth URL anyway), but keeping
          // a second copy of each in the environment meant the browser could
          // silently run against a *different* config id than the Server
          // Action — which is exactly what happened. One variable, one value.
          appId={availability.whatsappAppId}
          configId={availability.whatsappConfigId}
          // v21.0 predates Embedded Signup v4 (which needs v25.0+) and is
          // kept ONLY as a last-resort fallback for a completely unset
          // variable — never intentionally rely on this default.
        />
        <MetaPageChannelCard
          channel="MESSENGER"
          status={(messenger.data?.status as PageChannelCardStatus | undefined) ?? "NOT_CONNECTED"}
          accountName={messenger.data?.display_name ?? null}
          assistantEnabled={messenger.data?.ai_enabled ?? false}
          lastError={messenger.data?.last_error ?? null}
          lastInboundAt={messenger.data?.last_inbound_at ?? null}
          configured={availability.messenger}
          canEdit={can.editIntegrations}
        />
        <MetaPageChannelCard
          channel="INSTAGRAM"
          status={(instagram.data?.status as PageChannelCardStatus | undefined) ?? "NOT_CONNECTED"}
          accountName={instagram.data?.display_name ?? null}
          assistantEnabled={instagram.data?.ai_enabled ?? false}
          lastError={instagram.data?.last_error ?? null}
          lastInboundAt={instagram.data?.last_inbound_at ?? null}
          configured={availability.instagram}
          fallbackConfigured={availability.instagramPageFlow}
          canEdit={can.editIntegrations}
        />
        <MetaAdsConnectCard
          status={metaAds?.status ?? "NOT_CONNECTED"}
          adAccountName={metaAds?.ad_account_name ?? null}
          adAccountId={metaAds?.ad_account_id ?? null}
          tokenExpiresAt={metaAds?.token_expires_at ?? null}
          lastSyncedAt={metaAds?.last_synced_at ?? null}
          lastError={metaAds?.last_error ?? null}
          configured={availability.metaAds}
          canEdit={can.editIntegrations}
        />
        <GoogleAdsConnectCard
          status={googleAds?.status ?? "NOT_CONNECTED"}
          accountName={googleAds?.account_name ?? null}
          customerId={googleAds?.customer_id ?? null}
          lastSyncedAt={googleAds?.last_synced_at ?? null}
          lastError={googleAds?.last_error ?? null}
          configured={availability.googleAds}
          canEdit={can.editIntegrations}
        />
        {otherIntegrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} canEdit={can.editIntegrations} />
        ))}
      </div>
    </SectionShell>
  );
}
