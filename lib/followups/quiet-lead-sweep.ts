/**
 * Phase 2 of docs/modules/lead-retention-followups-implementation-plan.md: nudge customers who went quiet
 * after the assistant replied. Runs for ONE agency per call. Every business rule is in
 * `decideQuietLeadNudge`; this file loads facts, asks it, claims the step in the ledger BEFORE sending, then
 * sends (or, in dry-run, only records what would have been sent).
 *
 * Working hours (§6.1 rule 8): a nudge is only sent while the agency is open, by the same calendar the reply
 * targets use (`ai_settings.working_hours` in the agency's timezone, see lib/inbox/sla/business-hours.ts). An agency
 * that has set no hours is treated as always open. A nudge held back outside hours is not lost: the next sweep that
 * runs while the agency is open sends it.
 */

import "server-only";

import { deliverAgentReply } from "@/lib/agent/whatsapp/reply-delivery";
import { getChannelAdapterForAgency } from "@/lib/inbox/simulator/adapter-for-agency";
import type { ChannelProvider } from "@/lib/inbox/contracts";
import {
  claimFollowup,
  completeFollowup,
  listLedgerForConversations,
  summariseNudgeLedger,
} from "@/lib/data/conversation-followups-repository";
import { insertMessage, type Db } from "@/lib/data/whatsapp-repository";
import { decideQuietLeadNudge, firstNameForNudge, renderNudgeText, type QuietLeadDecision } from "@/lib/followups/quiet-lead-eligibility";
import { loadSlaSettings } from "@/lib/data/inbox-sla-repository";
import { isWithinBusinessHours } from "@/lib/inbox/sla/business-hours";
import { sendApprovedTemplate } from "@/lib/whatsapp/send-template-message";
import { countBodyVariables } from "@/lib/whatsapp/template-params";
import type { ConsentChannel, ConsentStatus } from "@/lib/types/consent";
import type { LeadStage } from "@/lib/types/leads";

const CONVERSATION_LIMIT = 200;
const MIN_SILENCE_MS = 60 * 60_000; // cheapest lower bound; the exact delay is checked by the decision function
const DAY_MS = 24 * 60 * 60_000;

export interface QuietLeadSweepResult {
  considered: number;
  sent: number;
  dryRun: number;
  skipped: number;
  failed: number;
}

interface FollowupSettings {
  enabled: boolean;
  dryRun: boolean;
  delaysHours: number[];
  messageText: string;
  templateId: string | null;
}

interface CandidateConversation {
  id: string;
  channel: string;
  state: string;
  ai_enabled: boolean;
  lead_id: string | null;
  contact_name: string | null;
  external_conversation_id: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  service_window_expires_at: string | null;
}

interface CandidateLead {
  id: string;
  stage: LeadStage;
  postponed_until: string | null;
  consent_status: ConsentStatus;
  do_not_contact: boolean;
  contactable_channels: ConsentChannel[] | null;
  follow_up_attempts: number | null;
}

async function loadSettings(db: Db, agencyId: string): Promise<FollowupSettings | null> {
  const { data } = await db
    .from("ai_settings")
    .select("enabled, followups_enabled, followups_dry_run, followup_delays_hours, followup_message_text, followup_whatsapp_template_id")
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!data || !data.enabled || !data.followups_enabled) return null;
  return {
    enabled: true,
    dryRun: Boolean(data.followups_dry_run),
    delaysHours: (data.followup_delays_hours as number[] | null) ?? [],
    messageText: (data.followup_message_text as string) ?? "",
    templateId: (data.followup_whatsapp_template_id as string | null) ?? null,
  };
}

/** Which channels have a live connection with the assistant switched on. WhatsApp is gated by its own integration status. */
async function loadReadyChannels(db: Db, agencyId: string): Promise<Set<string>> {
  const ready = new Set<string>();
  const [{ data: pages }, { data: whatsapp }] = await Promise.all([
    db.from("channel_connections").select("provider").eq("agency_id", agencyId).in("provider", ["MESSENGER", "INSTAGRAM"]).eq("status", "CONNECTED").eq("ai_enabled", true),
    db.from("whatsapp_integrations").select("status").eq("agency_id", agencyId).maybeSingle(),
  ]);
  for (const row of (pages ?? []) as { provider: string }[]) ready.add(row.provider);
  if (whatsapp?.status === "CONNECTED") ready.add("WHATSAPP");
  return ready;
}

/** Whether the template can be sent by this sweep: approved, and needing at most one variable (the first name). */
async function loadTemplateUsable(db: Db, agencyId: string, templateId: string | null): Promise<boolean> {
  if (!templateId) return false;
  const { data } = await db.from("whatsapp_templates").select("components").eq("id", templateId).eq("agency_id", agencyId).eq("status", "APPROVED").maybeSingle();
  return Boolean(data) && countBodyVariables(data?.components) <= 1;
}

export async function runQuietLeadSweep(db: Db, agencyId: string, options: { now?: Date; deadlineMs?: number } = {}): Promise<QuietLeadSweepResult> {
  const now = options.now ?? new Date();
  const result: QuietLeadSweepResult = { considered: 0, sent: 0, dryRun: 0, skipped: 0, failed: 0 };

  const settings = await loadSettings(db, agencyId);
  if (!settings || settings.delaysHours.length === 0) return result;

  const schedule = await loadSlaSettings(db, agencyId);
  const withinWorkingHours = isWithinBusinessHours(now, schedule.calendar, schedule.timezone);

  const longestDelayMs = Math.max(...settings.delaysHours) * 3_600_000;
  const { data: conversations, error } = await db
    .from("conversations")
    .select("id, channel, state, ai_enabled, lead_id, contact_name, external_conversation_id, last_inbound_at, last_outbound_at, service_window_expires_at")
    .eq("agency_id", agencyId)
    .in("state", ["AI_ACTIVE", "AI_RESUMED"])
    .eq("ai_enabled", true)
    .not("lead_id", "is", null)
    .lt("last_inbound_at", new Date(now.getTime() - MIN_SILENCE_MS).toISOString())
    .gte("last_inbound_at", new Date(now.getTime() - longestDelayMs - DAY_MS).toISOString())
    .order("last_inbound_at", { ascending: true })
    .limit(CONVERSATION_LIMIT);
  if (error) throw new Error(`Could not load quiet conversations: ${error.message}`);

  const candidates = ((conversations ?? []) as CandidateConversation[]).filter(
    (row) => row.last_inbound_at && row.last_outbound_at && new Date(row.last_outbound_at) > new Date(row.last_inbound_at),
  );
  if (candidates.length === 0) return result;

  const leadIds = [...new Set(candidates.map((row) => row.lead_id).filter((id): id is string => Boolean(id)))];
  const [{ data: leadRows }, readyChannels, templateUsable, ledger] = await Promise.all([
    db.from("leads").select("id, stage, postponed_until, consent_status, do_not_contact, contactable_channels, follow_up_attempts").eq("agency_id", agencyId).in("id", leadIds),
    loadReadyChannels(db, agencyId),
    loadTemplateUsable(db, agencyId, settings.templateId),
    listLedgerForConversations(db, agencyId, candidates.map((row) => row.id)),
  ]);
  const leadsById = new Map(((leadRows ?? []) as CandidateLead[]).map((lead) => [lead.id, lead]));

  for (const conversation of candidates) {
    if (options.deadlineMs !== undefined && Date.now() >= options.deadlineMs) break;
    result.considered += 1;

    const lead = conversation.lead_id ? leadsById.get(conversation.lead_id) ?? null : null;

    // The customer message the timing is measured from — the newest one.
    const { data: anchor } = await db
      .from("conversation_messages")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("conversation_id", conversation.id)
      .eq("actor_kind", "CUSTOMER")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!anchor) continue;
    const anchorMessageId = anchor.id as string;

    const decision = decideQuietLeadNudge({
      now,
      settings: { enabled: settings.enabled, dryRun: settings.dryRun, delaysHours: settings.delaysHours, hasApprovedTemplate: templateUsable },
      connectionReady: readyChannels.has(conversation.channel),
      withinWorkingHours,
      conversation: {
        channel: conversation.channel,
        state: conversation.state,
        aiEnabled: conversation.ai_enabled,
        lastInboundAt: conversation.last_inbound_at,
        lastOutboundAt: conversation.last_outbound_at,
        serviceWindowExpiresAt: conversation.service_window_expires_at,
      },
      lead: lead ? { stage: lead.stage, postponedUntil: lead.postponed_until } : null,
      consent: {
        consentStatus: lead?.consent_status ?? "UNKNOWN",
        doNotContact: lead?.do_not_contact ?? false,
        contactableChannels: lead?.contactable_channels ?? [],
      },
      ledger: summariseNudgeLedger(ledger, conversation.id, anchorMessageId),
    });
    if (decision.action === "WAIT") continue;

    try {
      await actOnDecision({ db, agencyId, conversation, lead, anchorMessageId, decision, settings, result });
    } catch (cause) {
      result.failed += 1;
      console.error(`Quiet-lead follow-up failed for conversation ${conversation.id}:`, cause instanceof Error ? cause.message : "unknown error");
    }
  }
  return result;
}

async function actOnDecision(input: {
  db: Db;
  agencyId: string;
  conversation: CandidateConversation;
  lead: CandidateLead | null;
  anchorMessageId: string;
  decision: Exclude<QuietLeadDecision, { action: "WAIT" }>;
  settings: FollowupSettings;
  result: QuietLeadSweepResult;
}): Promise<void> {
  const { db, agencyId, conversation, lead, anchorMessageId, decision, result } = input;
  const base = {
    agencyId,
    conversationId: conversation.id,
    leadId: conversation.lead_id,
    kind: "QUIET_NUDGE" as const,
    anchorMessageId,
    channel: conversation.channel,
  };

  if (decision.action === "SKIP") {
    // The sequence number is the next unused one so the row does not collide with an earlier nudge.
    const claim = await claimFollowup(db, { ...base, sequence: await nextSequence(db, conversation.id, anchorMessageId), status: "SKIPPED", skipReason: decision.reason });
    if (claim.claimed) result.skipped += 1;
    return;
  }

  if (decision.dryRun) {
    const claim = await claimFollowup(db, { ...base, sequence: decision.sequence, status: "DRY_RUN", skipReason: `WOULD_SEND_${decision.mode}` });
    if (claim.claimed) result.dryRun += 1;
    return;
  }

  const claim = await claimFollowup(db, { ...base, sequence: decision.sequence, status: "CLAIMED" });
  if (!claim.claimed) return; // another run took this step

  // Checked again at send time: the customer may have written, or staff may have taken over, since selection.
  const { data: fresh } = await db.from("conversations").select("state, ai_enabled, last_inbound_at").eq("id", conversation.id).eq("agency_id", agencyId).maybeSingle();
  if (!fresh || !fresh.ai_enabled || !["AI_ACTIVE", "AI_RESUMED"].includes(fresh.state as string) || fresh.last_inbound_at !== conversation.last_inbound_at) {
    await completeFollowup(db, claim.id, { status: "SKIPPED", skipReason: "CONVERSATION_CHANGED" });
    result.skipped += 1;
    return;
  }

  const outcome = decision.mode === "TEXT" ? await sendInWindowNudge(input) : await sendTemplateNudge(input);
  if (outcome.ok) {
    await completeFollowup(db, claim.id, { status: "SENT", externalMessageId: outcome.externalMessageId });
    await db.from("leads").update({ follow_up_attempts: (lead?.follow_up_attempts ?? 0) + 1 }).eq("id", conversation.lead_id!).eq("agency_id", agencyId);
    result.sent += 1;
  } else {
    await completeFollowup(db, claim.id, { status: "FAILED", skipReason: outcome.reason });
    result.failed += 1;
  }
}

type SendOutcome = { ok: true; externalMessageId: string } | { ok: false; reason: string };

async function sendInWindowNudge(input: { db: Db; agencyId: string; conversation: CandidateConversation; settings: FollowupSettings }): Promise<SendOutcome> {
  const { db, agencyId, conversation, settings } = input;
  const reply = await deliverAgentReply({
    db,
    adapter: await getChannelAdapterForAgency(db, agencyId, conversation.channel as ChannelProvider),
    agencyId,
    conversation: { id: conversation.id, external_conversation_id: conversation.external_conversation_id },
    reply: renderNudgeText(settings.messageText, conversation.contact_name),
    buttons: [],
    metadata: { source: "quiet_followup" },
  });
  return reply.status === "SENT" ? { ok: true, externalMessageId: reply.externalMessageId } : { ok: false, reason: reply.reason };
}

async function sendTemplateNudge(input: { db: Db; agencyId: string; conversation: CandidateConversation; settings: FollowupSettings }): Promise<SendOutcome> {
  const { db, agencyId, conversation, settings } = input;
  if (!settings.templateId) return { ok: false, reason: "NO_TEMPLATE" };

  const sent = await sendApprovedTemplate({
    db,
    agencyId,
    to: conversation.external_conversation_id,
    templateId: settings.templateId,
    values: [firstNameForNudge(conversation.contact_name)],
  });
  if (!sent.ok) return { ok: false, reason: sent.reason };

  await insertMessage(db, {
    agencyId,
    conversationId: conversation.id,
    externalMessageId: sent.externalMessageId,
    role: "assistant",
    actorKind: "AI",
    content: sent.renderedText,
    messageType: "TEMPLATE",
    deliveryStatus: "SENT",
    metadata: {
      source: "quiet_followup",
      template_id: sent.template.id,
      template_name: sent.template.name,
      template_language: sent.template.language,
      template_category: sent.template.category,
      body_parameters: sent.bodyParameters,
    },
  });
  await db.from("conversations").update({ last_outbound_at: new Date().toISOString() }).eq("id", conversation.id).eq("agency_id", agencyId);
  return { ok: true, externalMessageId: sent.externalMessageId };
}

/** The next unused nudge number for a customer message — a skip is recorded as the step that could not happen. */
async function nextSequence(db: Db, conversationId: string, anchorMessageId: string): Promise<number> {
  const { count } = await db
    .from("conversation_followups")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("kind", "QUIET_NUDGE")
    .eq("anchor_message_id", anchorMessageId);
  return (count ?? 0) + 1;
}
