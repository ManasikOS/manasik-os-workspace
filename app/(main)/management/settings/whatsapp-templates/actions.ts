"use server";

/**
 * WhatsApp message template management — §5 E8 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md. Required evidence
 * for App Review (video 2: "your app creating a message template"), and
 * required for any outbound message outside the 24-hour service window.
 */

import { revalidatePath } from "next/cache";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { deleteTemplateRow, upsertTemplateRow } from "@/lib/data/whatsapp-billing-repository";
import { createTemplate, deleteTemplate, listTemplates } from "@/lib/whatsapp/client";
import { readWhatsAppToken } from "@/lib/whatsapp/vault";
import { createAdminClient } from "@/utils/supabase/admin";
import type { WhatsAppTemplateCategory, WhatsAppTemplateRow } from "@/lib/types/whatsapp";

export type TemplateActionResult = { ok: true } | { ok: false; error: string };

async function requireIntegration(agencyId: string) {
  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("whatsapp_integrations")
    .select("business_account_id, credential_ref")
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!integration?.business_account_id || !integration.credential_ref) return null;
  const token = await readWhatsAppToken(admin, integration.credential_ref);
  if (!token) return null;
  return { admin, wabaId: integration.business_account_id as string, token };
}

/** Pulls the agency's live templates from Meta and mirrors them into whatsapp_templates — the source of truth for status is always Meta's. */
export async function syncTemplatesFromMeta(): Promise<TemplateActionResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).viewIntegrations) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  const ctx = await requireIntegration(agencyId);
  if (!ctx) return { ok: false, error: "WhatsApp is not connected." };

  try {
    const templates = await listTemplates(ctx.wabaId, ctx.token);
    for (const t of templates) {
      const category = (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(t.category) ? t.category : "UTILITY") as WhatsAppTemplateCategory;
      const status = (["PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"].includes(t.status) ? t.status : "PENDING") as WhatsAppTemplateRow["status"];
      await upsertTemplateRow(ctx.admin, {
        agencyId,
        name: t.name,
        language: t.language,
        category,
        status,
        components: t.components,
        externalTemplateId: t.id,
        rejectedReason: t.rejected_reason ?? null,
      });
    }
    revalidatePath("/management/settings/whatsapp-templates");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to sync templates from Meta." };
  }
}

export async function createWhatsAppTemplate(input: {
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  bodyText: string;
  headerText?: string;
  footerText?: string;
}): Promise<TemplateActionResult> {
  await requireUser();
  const { role, agencyId, staffId, name: staffName } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  const templateName = input.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!templateName) return { ok: false, error: "Template name is required." };
  if (!input.bodyText.trim()) return { ok: false, error: "Body text is required." };

  const ctx = await requireIntegration(agencyId);
  if (!ctx) return { ok: false, error: "WhatsApp is not connected." };

  const components: unknown[] = [];
  if (input.headerText?.trim()) components.push({ type: "HEADER", format: "TEXT", text: input.headerText.trim() });
  components.push({ type: "BODY", text: input.bodyText.trim() });
  if (input.footerText?.trim()) components.push({ type: "FOOTER", text: input.footerText.trim() });

  try {
    const result = await createTemplate(ctx.wabaId, ctx.token, {
      name: templateName,
      language: input.language,
      category: input.category,
      components,
    });
    await upsertTemplateRow(ctx.admin, {
      agencyId,
      name: templateName,
      language: input.language,
      category: input.category,
      status: (result.status as WhatsAppTemplateRow["status"]) ?? "PENDING",
      components,
      externalTemplateId: result.id,
      createdBy: staffId,
      createdByName: staffName,
    });
    revalidatePath("/management/settings/whatsapp-templates");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to create the template." };
  }
}

export async function deleteWhatsAppTemplate(name: string, language: string): Promise<TemplateActionResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  const ctx = await requireIntegration(agencyId);
  if (!ctx) return { ok: false, error: "WhatsApp is not connected." };

  try {
    await deleteTemplate(ctx.wabaId, ctx.token, name);
    await deleteTemplateRow(ctx.admin, agencyId, name, language);
    revalidatePath("/management/settings/whatsapp-templates");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to delete the template." };
  }
}
