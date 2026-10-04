"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import {
  createAnnouncement,
  getAnnouncement,
  getWhatsAppTemplateForAnnouncement,
  listDispatchRecipients,
  markRecipientDelivered,
  markRecipientDeliveryFailed,
  previewAnnouncementReach,
  sendAnnouncement,
  updateAnnouncementStatus,
  type CreateAnnouncementInput,
} from "@/lib/data/announcements-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { normaliseMobile } from "@/lib/data/leads";
import { requireUser } from "@/lib/dal";
import type { AnnouncementStatus } from "@/lib/types/announcements";
import { classifyWhatsAppError, sendTemplate } from "@/lib/whatsapp/client";
import { buildTemplateSendComponents } from "@/lib/whatsapp/template-params";
import { testAgencySendRefusal } from "@/lib/inbox/outbound/test-agency-send-guard";
import { outboundRecipientRefusal } from "@/lib/inbox/outbound/outbound-allowlist";
import { readWhatsAppToken } from "@/lib/whatsapp/vault";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function db() {
  return createClient(await cookies());
}

/**
 * Announcements reaches leads/pilgrims the same way Campaigns/Audiences
 * do, so it reuses the same manageSourcesAndAutomation capability rather
 * than inventing RBAC for the "Relationships" nav section — plus
 * Operations, since departure-group announcements are as much theirs as
 * Marketing's.
 */
async function requireCanManage() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  const ok = role === "ADMIN" || role === "CEO" || role === "MARKETING" || role === "OPERATIONS";
  return { ok, name };
}

function revalidateAnnouncements(id?: string) {
  revalidatePath("/relationships/announcements");
  if (id) revalidatePath(`/relationships/announcements/${id}`);
}

export async function createAnnouncementAction(
  input: Omit<CreateAnnouncementInput, "createdByName">,
): Promise<ActionResult & { announcementId?: string }> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot create announcements." };
  if (!input.title.trim() || !input.body.trim()) return { ok: false, error: "Give the announcement a title and body." };
  if (input.targetType === "DEPARTURE_GROUP" && !input.departureGroupId) {
    return { ok: false, error: "Choose a departure group." };
  }
  if (input.targetType === "AUDIENCE" && !input.audienceId) {
    return { ok: false, error: "Choose an audience." };
  }
  if (input.channel === "WHATSAPP" && !input.whatsappTemplateId) {
    return { ok: false, error: "Choose an approved WhatsApp template — WhatsApp only allows free text inside a live conversation." };
  }

  const supabase = await db();
  const created = await createAnnouncement(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateAnnouncements();
  return { ok: true, announcementId: created.id };
}

export async function previewAnnouncementReachAction(
  announcementId: string,
): Promise<ActionResult & { total?: number; contactable?: number }> {
  await requireUser();
  const supabase = await db();
  const announcement = await getAnnouncement(supabase, announcementId);
  if (!announcement) return { ok: false, error: "Announcement not found." };

  const reach = await previewAnnouncementReach(supabase, announcement);
  return { ok: true, ...reach };
}

/**
 * Freezes the recipient snapshot (sendAnnouncement) and, for WHATSAPP,
 * actually dispatches an approved template message to each contactable
 * recipient via the agency's connected WhatsApp Business number — the same
 * Cloud API client and Vault-held token the Inbox's staff-reply path uses
 * (app/inbox/actions.ts). A per-recipient send failure (dead token,
 * number not on WhatsApp, etc) is recorded on that recipient row and does
 * not stop the rest of the batch.
 */
export async function sendAnnouncementAction(announcementId: string): Promise<ActionResult & { sent?: number; failed?: number }> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot send announcements." };

  const supabase = await db();
  await sendAnnouncement(supabase, announcementId);
  revalidateAnnouncements(announcementId);

  const announcement = await getAnnouncement(supabase, announcementId);
  if (!announcement || announcement.channel !== "WHATSAPP" || !announcement.whatsapp_template_id) {
    return { ok: true };
  }

  const admin = createAdminClient();
  const testAgencyRefusal = await testAgencySendRefusal(admin, announcement.agency_id);
  if (testAgencyRefusal) return { ok: false, error: `The recipient list was saved, but nothing was sent. ${testAgencyRefusal}` };
  const { data: integration, error: integrationError } = await admin
    .from("whatsapp_integrations")
    .select("id, phone_number_id, credential_ref, status")
    .eq("agency_id", announcement.agency_id)
    .maybeSingle();
  if (integrationError || !integration || !integration.phone_number_id || !integration.credential_ref) {
    return { ok: false, error: "The recipient list was saved, but WhatsApp is not connected for this agency — nothing was sent." };
  }
  if (integration.status !== "CONNECTED") {
    return { ok: false, error: "The recipient list was saved, but the WhatsApp connection is not active — nothing was sent." };
  }

  const template = await getWhatsAppTemplateForAnnouncement(supabase, announcement.whatsapp_template_id);
  if (!template || template.status !== "APPROVED") {
    return { ok: false, error: "The recipient list was saved, but the chosen WhatsApp template is no longer approved — nothing was sent." };
  }

  const token = await readWhatsAppToken(admin, integration.credential_ref as string);
  if (!token) return { ok: false, error: "The recipient list was saved, but the WhatsApp access token could not be read." };

  const recipients = await listDispatchRecipients(supabase, announcementId);
  const components = buildTemplateSendComponents(template.components, announcement.whatsapp_template_param);

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    if (!recipient.phone) {
      await markRecipientDeliveryFailed(supabase, recipient.recipientRowId, "No phone number on file.");
      failed += 1;
      continue;
    }
    const to = `94${normaliseMobile(recipient.phone)}`;
    const outboundRefusal = outboundRecipientRefusal(to);
    if (outboundRefusal) {
      await markRecipientDeliveryFailed(supabase, recipient.recipientRowId, outboundRefusal);
      failed += 1;
      continue;
    }
    try {
      await sendTemplate(integration.phone_number_id as string, token, to, {
        templateName: template.name,
        languageCode: template.language,
        components,
      });
      await markRecipientDelivered(supabase, recipient.recipientRowId);
      sent += 1;
    } catch (error) {
      const errorClass = classifyWhatsAppError(error);
      const message = error instanceof Error ? error.message : "Unknown WhatsApp send error";
      await markRecipientDeliveryFailed(supabase, recipient.recipientRowId, errorClass === "UNKNOWN" ? message : `${errorClass}: ${message}`);
      failed += 1;
    }
  }

  revalidateAnnouncements(announcementId);
  return { ok: true, sent, failed };
}

export async function cancelAnnouncementAction(announcementId: string): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot cancel this announcement." };

  const supabase = await db();
  await updateAnnouncementStatus(supabase, announcementId, "CANCELLED" satisfies AnnouncementStatus);
  revalidateAnnouncements(announcementId);
  return { ok: true };
}
