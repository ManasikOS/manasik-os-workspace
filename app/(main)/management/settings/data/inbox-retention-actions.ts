"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { inboxRetentionSettingsSchema } from "@/lib/validations/inbox-retention";
import { createClient } from "@/utils/supabase/server";

export async function updateInboxRetentionSettingsAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const parsed = inboxRetentionSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the retention periods." };
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForSettings(role).editData) return { ok: false, error: "Your role cannot edit Inbox retention." };
  const value = parsed.data;
  const { error } = await createClient(await cookies()).from("agency_settings").update({ booking_linked_message_retention_years: value.bookingLinkedMessageRetentionYears, enquiry_message_retention_months: value.enquiryMessageRetentionMonths, inbox_attachment_retention_days: value.inboxAttachmentRetentionDays, voice_audio_retention_days: value.voiceAudioRetentionDays, intelligence_retention_months: value.intelligenceRetentionMonths, ai_run_retention_months: value.aiRunRetentionMonths, webhook_payload_retention_days: value.webhookPayloadRetentionDays }).eq("agency_id", agencyId);
  if (error) return { ok: false, error: "Could not save Inbox retention settings." };
  revalidatePath("/management/settings/data");
  return { ok: true };
}
