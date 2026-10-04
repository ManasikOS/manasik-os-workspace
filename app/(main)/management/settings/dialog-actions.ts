"use server";

/**
 * Per-section data loaders for the settings dialog (`components/settings-
 * dialog.tsx`). Each mirrors the fetch + capability check its full-page
 * counterpart does (e.g. `organisation/page.tsx`) but returns plain data
 * instead of JSX, so the dialog can render the section's existing client
 * Form component itself — no page navigation, no RSC round-trip, just one
 * server action call per tab the first time it's opened.
 */

import { cookies } from "next/headers";

import { capabilitiesForSettings, type SettingsSectionId } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  getAgencySettings,
  listBranches,
  listIntegrations,
  listMessageTemplates,
  listStaffForSessionsCard,
  loadAuditLog,
} from "@/lib/data/settings-repository";
import { isTemplateAssignedToRole } from "@/lib/data/settings";
import { listServiceAddons } from "@/lib/data/service-addons";
import { getBillingSummary } from "@/lib/data/whatsapp-billing-view";
import { createClient } from "@/utils/supabase/server";
import { agencyAssetSignedUrl } from "./branding/logo-storage";
import type { WhatsAppBillingBudgetRow, WhatsAppVolumeTierRow, WhatsAppTemplateRow } from "@/lib/types/whatsapp";

const AUDIT_LOG_PAGE_SIZE = 300;

function cleanEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const unquoted = trimmed.replace(/^['"](.*)['"]$/, "$1").trim();
  return unquoted || null;
}

type Denied = { ok: false };

export async function getOrganisationSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewOrganisation) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const settings = await getAgencySettings(supabase);
  return { ok: true as const, settings, canEdit: can.editOrganisation };
}

export async function getBranchesSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewBranches) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const [branches, settings, managersRes] = await Promise.all([
    listBranches(supabase),
    getAgencySettings(supabase),
    supabase
      .from("staff_profiles")
      .select("id, full_name")
      .eq("status", "ACTIVE")
      .order("full_name", { ascending: true }),
  ]);
  const managers = (managersRes.data ?? []).map((m) => ({ id: m.id as string, name: m.full_name as string }));

  return {
    ok: true as const,
    branches,
    managers,
    branchRules: settings.branch_rules,
    canEdit: can.editBranches,
  };
}

export async function getBrandingSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewBranding) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const settings = await getAgencySettings(supabase);
  const logoUrl = settings.logo_path ? await agencyAssetSignedUrl(settings.logo_path) : null;

  return { ok: true as const, settings, logoUrl, canEdit: can.editBranding };
}

export async function getOperationsSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewOperations) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const settings = await getAgencySettings(supabase);
  return { ok: true as const, settings, canEdit: can.editOperations };
}

export async function getServiceAddonsSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewOperations) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const addons = await listServiceAddons(supabase);
  return { ok: true as const, addons, canEdit: can.editOperations };
}

export async function getCommunicationsSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewCommunications) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const allTemplates = await listMessageTemplates(supabase);
  const templates = can.communicationsScopedToOwnRole
    ? allTemplates.filter((t) => isTemplateAssignedToRole(t.assigned_roles, role))
    : allTemplates;

  return {
    ok: true as const,
    templates,
    canEdit: can.editCommunications,
    scopedRole: can.communicationsScopedToOwnRole ? role : null,
  };
}

export async function getFinanceSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewFinance) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const settings = await getAgencySettings(supabase);
  return { ok: true as const, settings, canEdit: can.editFinance };
}

/** One Page-backed channel's connection for its card (RLS scopes it to the agency; no secret column is selected). */
async function loadPageChannel(supabase: ReturnType<typeof createClient>, provider: "MESSENGER" | "INSTAGRAM", configEnvName: string) {
  const { data } = await supabase
    .from("channel_connections")
    .select("status, display_name, ai_enabled, last_error, last_inbound_at")
    .eq("provider", provider)
    .neq("status", "DISCONNECTED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    status: (data?.status as string | undefined) ?? "NOT_CONNECTED",
    accountName: (data?.display_name as string | null | undefined) ?? null,
    assistantEnabled: Boolean(data?.ai_enabled),
    lastError: (data?.last_error as string | null | undefined) ?? null,
    lastInboundAt: (data?.last_inbound_at as string | null | undefined) ?? null,
    // Each Meta channel has its own Login configuration: it connects only when the app id and THAT id are set.
    configured: Boolean(cleanEnvValue(process.env.META_APP_ID)) && Boolean(cleanEnvValue(process.env[configEnvName])),
  };
}

export async function getIntegrationsSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewIntegrations) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const [integrations, whatsapp, messenger, instagram] = await Promise.all([
    listIntegrations(supabase),
    supabase
      .from("whatsapp_integrations")
      .select(
        "status, display_phone_number, business_name, connection_mode, quality_rating, messaging_limit_tier, funding_status, token_expires_at, webhook_verified_at, onboarding_step, last_error",
      )
      .maybeSingle(),
    loadPageChannel(supabase, "MESSENGER", "META_MESSENGER_CONFIG_ID"),
    loadPageChannel(supabase, "INSTAGRAM", "META_INSTAGRAM_CONFIG_ID"),
  ]);

  const otherIntegrations = integrations.filter((integration) => integration.provider !== "WHATSAPP_BUSINESS");

  return {
    ok: true as const,
    otherIntegrations,
    canEdit: can.editIntegrations,
    messenger,
    instagram,
    whatsapp: {
      status:
        (whatsapp.data?.status as
          | "NOT_CONNECTED"
          | "CONNECTED"
          | "UNFUNDED"
          | "ERROR"
          | "DISCONNECTED"
          | "PENDING_REVIEW"
          | "RESTRICTED") ?? "NOT_CONNECTED",
      displayPhoneNumber: whatsapp.data?.display_phone_number ?? null,
      businessName: whatsapp.data?.business_name ?? null,
      qualityRating: whatsapp.data?.quality_rating ?? null,
      messagingLimitTier: whatsapp.data?.messaging_limit_tier ?? null,
      fundingStatus: (whatsapp.data?.funding_status as "UNKNOWN" | "FUNDED" | "UNFUNDED" | null) ?? null,
      tokenExpiresAt: whatsapp.data?.token_expires_at ?? null,
      webhookVerifiedAt: whatsapp.data?.webhook_verified_at ?? null,
      onboardingStep: whatsapp.data?.onboarding_step ?? null,
      lastError: whatsapp.data?.last_error ?? null,
      appId: cleanEnvValue(process.env.META_APP_ID),
      configId: cleanEnvValue(process.env.META_CONFIG_ID),
    },
  };
}

export async function getWhatsAppTemplatesSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewIntegrations) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const [{ data: templates }, { data: integration }] = await Promise.all([
    supabase.from("whatsapp_templates").select("*").order("created_at", { ascending: false }),
    supabase.from("whatsapp_integrations").select("status").maybeSingle(),
  ]);

  return {
    ok: true as const,
    templates: (templates ?? []) as WhatsAppTemplateRow[],
    canEdit: can.editIntegrations,
    connected: integration?.status === "CONNECTED",
  };
}

export async function getWhatsAppBillingSectionData() {
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewFinance) return { ok: false } satisfies Denied;
  if (!agencyId) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const [summary, { data: budget }, { data: tiers }, { data: integration }] = await Promise.all([
    getBillingSummary(supabase, agencyId),
    supabase.from("whatsapp_billing_budgets").select("*").eq("agency_id", agencyId).maybeSingle(),
    supabase.from("whatsapp_volume_tiers").select("*").eq("agency_id", agencyId),
    supabase.from("whatsapp_integrations").select("status").maybeSingle(),
  ]);

  return {
    ok: true as const,
    summary,
    budget: (budget as WhatsAppBillingBudgetRow | null) ?? null,
    tiers: (tiers ?? []) as WhatsAppVolumeTierRow[],
    canEditBudget: can.editFinance,
    hasData: integration?.status === "CONNECTED",
  };
}

export async function getSecuritySectionData() {
  const { role, staffId } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewSecurity) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const [settings, staff] = await Promise.all([getAgencySettings(supabase), listStaffForSessionsCard(supabase)]);

  return {
    ok: true as const,
    settings,
    staff,
    currentStaffId: staffId,
    canEdit: can.editSecurity,
  };
}

export async function getDataSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewAuditLog) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const [settings, audit] = await Promise.all([
    getAgencySettings(supabase),
    loadAuditLog(supabase, { limit: AUDIT_LOG_PAGE_SIZE }),
  ]);

  return {
    ok: true as const,
    settings,
    auditRows: audit.rows,
    canEditData: can.editData,
  };
}

export async function getDangerSectionData() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.viewDangerZone) return { ok: false } satisfies Denied;

  const supabase = createClient(await cookies());
  const [settings, branches] = await Promise.all([getAgencySettings(supabase), listBranches(supabase)]);
  const archivableBranches = branches
    .filter((b) => b.status !== "ARCHIVED")
    .map((b) => ({ id: b.id, name: b.name, code: b.code }));

  return {
    ok: true as const,
    archivableBranches,
    portalActive: settings.portal_active,
  };
}
