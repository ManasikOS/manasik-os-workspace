import { Suspense } from "react";
import { cookies } from "next/headers";

import { capabilitiesForAiAgent } from "@/lib/access/ai-agent-access";
import { isAgentChannel } from "@/lib/agent/whatsapp/analytics";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";
import { TONE_BADGE_BORDER, TONE_CLASS } from "@/lib/ui/tone";

import { AiAgentForm } from "./ai-agent-form";
import { AiAgentActivity } from "./ai-agent-activity";
import { AiAgentAnalyticsSection, AiAgentAnalyticsSkeleton } from "./ai-agent-analytics-section";
import { DepartureOpsSettingsForm } from "./departure-ops-settings-form";
import { DepartureOpsActivity } from "./departure-ops-activity";
import { FollowupSettingsForm } from "./followup-settings-form";
import type { AgentRunRow, AiSettingsRow, DepartureOpsRunRow, DepartureOpsSettingsRow, FollowupSettingsRow, FollowupTemplateOption } from "./types";
import { countBodyVariables } from "@/lib/whatsapp/template-params";
import { loadInboxAutonomyEvidence } from "@/lib/inbox/autonomy/evidence";
import type { AutonomyLevel } from "@/lib/inbox/intelligence/contracts";
import { InboxAutonomyControl } from "./inbox-autonomy-control";

export const dynamic = "force-dynamic";

const DEFAULT_SETTINGS: Omit<AiSettingsRow, "agency_id"> = {
  enabled: false,
  agent_name: "Assistant",
  persona_instructions: "",
  languages: ["en"],
  tone: "FRIENDLY_PROFESSIONAL",
  lead_capture_enabled: true,
  booking_enabled: false,
  handoff_enabled: true,
  behaviour: {},
  seat_hold_hours: 24,
  max_turns_per_conversation: 40,
  escalate_after_failed_turns: 3,
  out_of_hours_message: "",
};

const DEFAULT_FOLLOWUP_SETTINGS: FollowupSettingsRow = {
  followups_enabled: false,
  followups_dry_run: true,
  followup_delays_hours: [3, 22, 72],
  followup_message_text:
    "Hi {name}, just checking in — would you like me to help with anything else about your trip? I am happy to answer questions or connect you with our team.",
  followup_whatsapp_template_id: null,
  handoff_alert_minutes: 15,
  handoff_escalation_minutes: 60,
};

const DEFAULT_DEPARTURE_OPS_SETTINGS: DepartureOpsSettingsRow = {
  departure_ops_enabled: false,
  departure_ops_mode: "SHADOW",
  departure_ops_max_proposals_per_run: 5,
  departure_ops_max_tasks_per_run: 10,
  departure_ops_high_risk_roles: ["ADMIN", "CEO"],
  departure_ops_rejection_cooldown_days: 14,
};

export default async function AiAgentPage({ searchParams }: { searchParams: Promise<{ channel?: string | string[] }> }) {
  const channelParam = (await searchParams).channel;
  const channelFilter = typeof channelParam === "string" && isAgentChannel(channelParam) ? channelParam : null;
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForAiAgent(role);

  if (!can.viewModule) {
    return <PermissionDenied what="Manasik Copilot" />;
  }

  const supabase = createClient(await cookies());
  const [{ data: settingsRow }, { data: whatsapp }, { data: otherChannels }, { data: runs }, { data: departureOpsRuns }, { data: inboxSurface }] = await Promise.all([
    supabase
      .from("ai_settings")
      .select(
        "agency_id, enabled, agent_name, persona_instructions, languages, tone, lead_capture_enabled, booking_enabled, handoff_enabled, behaviour, seat_hold_hours, max_turns_per_conversation, escalate_after_failed_turns, out_of_hours_message, departure_ops_enabled, departure_ops_mode, departure_ops_max_proposals_per_run, departure_ops_max_tasks_per_run, departure_ops_high_risk_roles, departure_ops_rejection_cooldown_days, followups_enabled, followups_dry_run, followup_delays_hours, followup_message_text, followup_whatsapp_template_id, handoff_alert_minutes, handoff_escalation_minutes",
      )
      .eq("agency_id", agencyId ?? "")
      .maybeSingle(),
    supabase.from("whatsapp_integrations").select("status, display_phone_number").maybeSingle(),
    // Messenger and Instagram connections (RLS scopes them to the agency); only whether one is live matters here.
    supabase.from("channel_connections").select("provider").in("provider", ["MESSENGER", "INSTAGRAM"]).eq("status", "CONNECTED"),
    // agent_runs is the WhatsApp agent's own table — it never carries a
    // Departure Ops row, so this needs no surface filter (F-DRIFT: the two
    // agents' observability tables are separate, not one shared table
    // distinguished by a column).
    can.viewAnalytics
      ? supabase
          .from("agent_runs")
          .select("id, channel, status, model, effort, input_tokens, output_tokens, latency_ms, created_at, error")
          .order("created_at", { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [] }),
    can.viewAnalytics
      ? supabase
          .from("departure_ops_runs")
          .select("id, departure_group_id, status, model, effort, input_tokens, output_tokens, latency_ms, created_at, error")
          .order("created_at", { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [] }),
    supabase.from("ai_surface_settings").select("autonomy").eq("agency_id", agencyId ?? "").eq("surface", "INBOX_REPLY").maybeSingle(),
  ]);

  const autonomyEvidence = agencyId
    ? await loadInboxAutonomyEvidence(supabase, agencyId).catch(() => ({ decision: { eligible: false, blockers: ["Apply the Phase 6 migration and collect measured shadow decisions."] } }))
    : { decision: { eligible: false, blockers: ["Select an agency first."] } };

  const { data: approvedTemplates } = await supabase.from("whatsapp_templates").select("id, name, components").eq("status", "APPROVED").order("name");
  const followupTemplates: FollowupTemplateOption[] = ((approvedTemplates ?? []) as { id: string; name: string; components: unknown }[])
    .filter((template) => countBodyVariables(template.components) <= 1)
    .map((template) => ({ id: template.id, name: template.name }));

  const settings = (settingsRow as AiSettingsRow | null) ?? { agency_id: agencyId ?? "", ...DEFAULT_SETTINGS };
  const departureOpsSettings = (settingsRow as DepartureOpsSettingsRow | null) ?? DEFAULT_DEPARTURE_OPS_SETTINGS;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Manasik Copilot</h1>
        <p className="text-sm text-muted-foreground">
          Configure the one assistant that answers on WhatsApp, Messenger and Instagram — its persona, tone and knowledge are
          the same everywhere. It only ever reads live departure and package data — nothing here is a separate copy of your catalog.
        </p>
      </div>

      {whatsapp?.status !== "CONNECTED" && (otherChannels ?? []).length === 0 && (
        <div className={`rounded-lg border p-3 text-sm ${TONE_CLASS.warning} ${TONE_BADGE_BORDER.warning}`}>
          No channel is connected yet — the agent has nothing to answer on until WhatsApp, Messenger or Instagram is connected under{" "}
          <a href="/management/settings/integrations" className="underline">
            Settings → Integrations
          </a>
          .
        </div>
      )}

      <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">Teach the assistant your own policies, visa guides and FAQs.</span>
        <a href="/management/ai-agent/knowledge" className="font-medium underline">
          Manage documents
        </a>
      </div>

      <AiAgentForm settings={settings} canEdit={can.editSettings} />

      <InboxAutonomyControl
        initialLevel={(["L0", "L1", "L2", "L3"].includes(String((inboxSurface?.autonomy as Record<string, unknown> | null)?.level)) ? String((inboxSurface?.autonomy as Record<string, unknown>).level) : "L0") as AutonomyLevel}
        blockers={autonomyEvidence.decision.blockers}
        canEdit={can.editSettings}
      />

      {can.viewAnalytics && agencyId && (
        <Suspense fallback={<AiAgentAnalyticsSkeleton />}>
          <AiAgentAnalyticsSection agencyId={agencyId} channel={channelFilter} />
        </Suspense>
      )}

      {can.viewAnalytics && <AiAgentActivity runs={(runs as AgentRunRow[] | null) ?? []} />}

      <FollowupSettingsForm
        settings={(settingsRow as FollowupSettingsRow | null) ?? DEFAULT_FOLLOWUP_SETTINGS}
        templates={followupTemplates}
        canEdit={can.editSettings}
      />

      <DepartureOpsSettingsForm settings={departureOpsSettings} canEdit={can.editSettings} />

      {can.viewAnalytics && <DepartureOpsActivity runs={(departureOpsRuns as DepartureOpsRunRow[] | null) ?? []} />}
    </div>
  );
}
