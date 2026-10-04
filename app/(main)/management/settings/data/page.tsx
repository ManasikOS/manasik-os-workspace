import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getAgencySettings, loadAuditLog } from "@/lib/data/settings-repository";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { SectionShell } from "../components/section-shell";
import { AuditLogTable } from "./audit-log-table";
import { ExportCard } from "./export-card";
import { ImportCard } from "./import-card";
import { RetentionCard } from "./retention-card";
import { InboxRetentionForm, type InboxRetentionFormValues } from "../inbox-retention-form";
import { UsageAllowanceCard } from "../usage-allowance-card";

/**
 * Audit log, import/export and data retention. See the Settings plan §5.9.
 * The audit log is a read-only union over every append-only activity log in
 * the schema (`audit_log_rows`) — nothing here is duplicated or migrated.
 */
export const dynamic = "force-dynamic";

const AUDIT_LOG_PAGE_SIZE = 300;

export default async function DataSettingsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewAuditLog) {
    return <PermissionDenied what="Data & Audit" />;
  }

  const supabase = createClient(await cookies());
  const [settings, audit, { data: inboxRetention }, { data: subscription }, { data: usage }] = await Promise.all([
    getAgencySettings(supabase),
    loadAuditLog(supabase, { limit: AUDIT_LOG_PAGE_SIZE }),
    supabase.from("agency_settings").select("booking_linked_message_retention_years, enquiry_message_retention_months, inbox_attachment_retention_days, voice_audio_retention_days, intelligence_retention_months, ai_run_retention_months, webhook_payload_retention_days").maybeSingle(),
    supabase.from("agency_subscriptions").select("plan_code, overage_opt_in, ai_conversation_allowance_override, plans(name, ai_conversation_allowance)").maybeSingle(),
    supabase.from("agency_usage_counters").select("used").eq("metric", "AI_CONVERSATIONS").order("period_start", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return (
    <SectionShell
      title="Data & Audit"
      description="Accountability and safe data handling — who changed what, and how long records are kept."
    >
      <AuditLogTable rows={audit.rows} />

      <ExportCard auditLogRows={audit.rows} />
      <ImportCard />
      {can.editData && <RetentionCard settings={settings} canEdit={can.editData} />}
      {inboxRetention && <InboxRetentionForm initial={{ bookingLinkedMessageRetentionYears: Number(inboxRetention.booking_linked_message_retention_years), enquiryMessageRetentionMonths: Number(inboxRetention.enquiry_message_retention_months), inboxAttachmentRetentionDays: Number(inboxRetention.inbox_attachment_retention_days), voiceAudioRetentionDays: Number(inboxRetention.voice_audio_retention_days), intelligenceRetentionMonths: Number(inboxRetention.intelligence_retention_months), aiRunRetentionMonths: Number(inboxRetention.ai_run_retention_months), webhookPayloadRetentionDays: Number(inboxRetention.webhook_payload_retention_days) } satisfies InboxRetentionFormValues} canEdit={can.editData} />}
      {subscription && <UsageAllowanceCard planName={((subscription.plans as unknown as { name?: string } | null)?.name ?? subscription.plan_code) as string} used={Number(usage?.used ?? 0)} allowance={(subscription.ai_conversation_allowance_override as number | null) ?? ((subscription.plans as unknown as { ai_conversation_allowance?: number | null } | null)?.ai_conversation_allowance ?? null)} overageOptIn={Boolean(subscription.overage_opt_in)} />}
    </SectionShell>
  );
}
