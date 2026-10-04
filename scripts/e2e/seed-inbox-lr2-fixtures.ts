import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  assertInboxLr2FixtureTarget,
  inboxLr2FixtureAgencySlugs,
  inboxLr2FixtureConversations,
  inboxLr2FixtureSimulatedCredentialRef,
  inboxLr2FixtureSimulatedNumbers,
  inboxLr2FixtureTemplate,
  inboxLr2FixtureStaff,
  inboxLr2FixtureWindowTimes,
  type InboxLr2FixtureStaffKey,
} from "./inbox-lr2-fixtures-config";

/**
 * Seeds the disposable Agency A / Agency B conversations that `npm run test:e2e` needs. It never creates accounts:
 * the four staff users must already exist in Supabase Auth. Dry run by default; `--execute` writes. Re-running resets
 * each fixture conversation to its starting state, so the take-control scenario can be repeated.
 *
 * Both fixture agencies are TEST agencies (`agencies.is_test`, TASK-032): they are connected through a simulated WhatsApp number
 * (`sim-` ids), so every send is answered by the in-memory simulator and nothing can reach a real customer. With `--execute`, the
 * agencies, their simulated connections and the `is_test` flag are written even when the staff users are still missing; the
 * staff profiles and conversations follow once the users exist.
 */
loadEnvConfig(process.cwd());

const execute = process.argv.includes("--execute");
const target = assertInboxLr2FixtureTarget(process.env);
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is required.");
const db: SupabaseClient = createClient(target.url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const emailOf: Record<InboxLr2FixtureStaffKey, string | undefined> = {
  A1: process.env.INBOX_E2E_A1_EMAIL,
  A2: process.env.INBOX_E2E_A2_EMAIL,
  A_READONLY: process.env.INBOX_E2E_A_READONLY_EMAIL,
  B1: process.env.INBOX_E2E_B1_EMAIL,
};

async function findAuthUserIdsByEmail(): Promise<Record<InboxLr2FixtureStaffKey, string>> {
  const wanted = new Map<string, InboxLr2FixtureStaffKey>();
  for (const key of Object.keys(emailOf) as InboxLr2FixtureStaffKey[]) {
    const email = emailOf[key]?.trim().toLowerCase();
    if (!email) throw new Error(`INBOX_E2E_${key}_EMAIL is not set.`);
    wanted.set(email, key);
  }
  const found: Partial<Record<InboxLr2FixtureStaffKey, string>> = {};
  for (let page = 1; page <= 20 && Object.keys(found).length < wanted.size; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list auth users: ${error.message}`);
    for (const user of data.users) {
      const key = wanted.get((user.email ?? "").toLowerCase());
      if (key) found[key] = user.id;
    }
    if (data.users.length < 200) break;
  }
  const missing = [...wanted.values()].filter((key) => !found[key]);
  if (missing.length > 0) throw new Error(`These staff users do not exist in Supabase Auth yet (create them first): ${missing.join(", ")}.`);
  return found as Record<InboxLr2FixtureStaffKey, string>;
}

async function ensureFixtureAgency(agency: "agencyA" | "agencyB"): Promise<string> {
  const slug = inboxLr2FixtureAgencySlugs[agency];
  const existing = await db.from("agencies").select("id, is_test").eq("slug", slug).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    // A fixture agency is always a test agency, including one created before the flag existed.
    if (execute && existing.data.is_test !== true) {
      const marked = await db.from("agencies").update({ is_test: true }).eq("id", existing.data.id as string);
      if (marked.error) throw new Error(`Could not mark ${slug} as a test agency: ${marked.error.message}`);
    }
    return existing.data.id as string;
  }
  if (!execute) return `(would create ${slug})`;
  const created = await db.from("agencies").insert({ name: agency === "agencyA" ? "LR2 Fixture Agency A" : "LR2 Fixture Agency B", slug, is_test: true }).select("id").single();
  if (created.error) throw new Error(`Could not create ${slug}: ${created.error.message}`);
  return created.data.id as string;
}

/** The agency's simulated WhatsApp integration: what the outbox needs to resolve a sendable connection. One row per agency. */
async function ensureFixtureIntegration(agencyId: string, agency: "agencyA" | "agencyB"): Promise<string> {
  const number = inboxLr2FixtureSimulatedNumbers[agency];
  const saved = await db
    .from("whatsapp_integrations")
    .upsert(
      {
        agency_id: agencyId,
        phone_number_id: number.phoneNumberId,
        display_phone_number: number.displayPhoneNumber,
        business_name: `LR2 fixture ${agency} (simulated)`,
        credential_ref: inboxLr2FixtureSimulatedCredentialRef,
        status: "CONNECTED",
        funding_status: "FUNDED",
      },
      { onConflict: "agency_id" },
    )
    .select("id")
    .single();
  if (saved.error) throw new Error(`Could not save the simulated WhatsApp integration for ${agency}: ${saved.error.message}`);
  return saved.data.id as string;
}

async function ensureFixtureConnection(agencyId: string, agency: "agencyA" | "agencyB"): Promise<string> {
  const number = inboxLr2FixtureSimulatedNumbers[agency];
  const integrationId = await ensureFixtureIntegration(agencyId, agency);
  const existing = await db.from("channel_connections").select("id").eq("agency_id", agencyId).eq("provider", "WHATSAPP").maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const row = {
    provider_account_id: number.phoneNumberId,
    display_name: `LR2 fixture ${agency} (simulated, no live provider)`,
    status: "CONNECTED",
    legacy_whatsapp_integration_id: integrationId,
  };
  if (existing.data) {
    const updated = await db.from("channel_connections").update(row).eq("id", existing.data.id as string);
    if (updated.error) throw new Error(`Could not update the fixture connection: ${updated.error.message}`);
    return existing.data.id as string;
  }
  const created = await db.from("channel_connections").insert({ agency_id: agencyId, provider: "WHATSAPP", ...row }).select("id").single();
  if (created.error) throw new Error(`Could not create the fixture connection: ${created.error.message}`);
  return created.data.id as string;
}

/** The specs open every Inbox view, including the grouped queues, so both fixture agencies run the grouped queue rail (agency_settings.inbox_queues_v2). */
async function ensureFixtureQueueRail(agencyId: string, agency: "agencyA" | "agencyB"): Promise<void> {
  const saved = await db.from("agency_settings").upsert(
    { agency_id: agencyId, agency_name: agency === "agencyA" ? "LR2 Fixture Agency A" : "LR2 Fixture Agency B", inbox_queues_v2: true },
    { onConflict: "agency_id" },
  );
  if (saved.error) throw new Error(`Could not save the settings for ${agency}: ${saved.error.message}`);
}

/** One approved template for Agency A, which the composer spec (C2) picks to reopen the closed-window conversation. Simulated, so nothing is submitted to Meta. */
async function ensureFixtureTemplate(agencyId: string): Promise<void> {
  const saved = await db.from("whatsapp_templates").upsert(
    {
      agency_id: agencyId,
      name: inboxLr2FixtureTemplate.name,
      language: inboxLr2FixtureTemplate.language,
      category: "UTILITY",
      status: "APPROVED",
      components: [{ type: "BODY", text: inboxLr2FixtureTemplate.bodyText }],
    },
    { onConflict: "agency_id,name,language" },
  );
  if (saved.error) throw new Error(`Could not save the fixture template: ${saved.error.message}`);
}

async function main() {
  console.error(`LR2 fixtures -> project ${target.projectRef} (${execute ? "EXECUTE" : "dry run; add --execute to write"})`);
  const agencyIds = { agencyA: await ensureFixtureAgency("agencyA"), agencyB: await ensureFixtureAgency("agencyB") };
  // The test agencies and their simulated connections need no staff accounts, so they come first: a missing login then costs
  // only the staff profiles and conversations, which a re-run adds.
  const connectionIds = execute
    ? { agencyA: await ensureFixtureConnection(agencyIds.agencyA, "agencyA"), agencyB: await ensureFixtureConnection(agencyIds.agencyB, "agencyB") }
    : null;
  if (execute) {
    await ensureFixtureTemplate(agencyIds.agencyA);
    await ensureFixtureQueueRail(agencyIds.agencyA, "agencyA");
    await ensureFixtureQueueRail(agencyIds.agencyB, "agencyB");
  }
  let userIds: Record<InboxLr2FixtureStaffKey, string>;
  try {
    userIds = await findAuthUserIdsByEmail();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(execute ? `${reason}\nThe test agencies and their simulated WhatsApp connections were written. Re-run once the users exist.` : reason);
  }
  if (!execute || !connectionIds) {
    console.error("All four staff users found. Agencies:", agencyIds, "\nNothing written.");
    return;
  }

  for (const key of Object.keys(inboxLr2FixtureStaff) as InboxLr2FixtureStaffKey[]) {
    const plan = inboxLr2FixtureStaff[key];
    const existing = await db.from("staff_profiles").select("agency_id").eq("id", userIds[key]).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const fixtureAgencyIds: string[] = Object.values(agencyIds);
    if (existing.data?.agency_id && !fixtureAgencyIds.includes(existing.data.agency_id as string)) {
      throw new Error(`${emailOf[key]} already belongs to a non-fixture agency; use a dedicated test user instead of moving a real one.`);
    }
    const saved = await db.from("staff_profiles").upsert(
      { id: userIds[key], email: emailOf[key]!.trim().toLowerCase(), full_name: plan.fullName, role: plan.role, status: "ACTIVE", employment_type: "PERMANENT", agency_id: agencyIds[plan.agency] },
      { onConflict: "id" },
    );
    if (saved.error) throw new Error(`Could not save the ${key} staff profile: ${saved.error.message}`);
  }

  const now = new Date();
  const printed: string[] = [];
  for (const [index, plan] of Object.values(inboxLr2FixtureConversations).entries()) {
    const agencyId = agencyIds[plan.agency];
    const times = inboxLr2FixtureWindowTimes(plan.windowHours, now);
    const contactPhone = `+447700900${String(index + 1).padStart(3, "0")}`;
    // A real WhatsApp conversation is identified by the customer's number (digits only); template sends read the recipient from it.
    const whatsappConversationId = contactPhone.replace(/\D/g, "");
    const row = {
      agency_id: agencyId,
      connection_id: connectionIds[plan.agency],
      channel: "WHATSAPP",
      external_conversation_id: whatsappConversationId,
      contact_name: plan.contactName,
      // +44 7700 900xxx is the range regulators reserve for fiction: it passes number validation and can never belong to a real person.
      contact_phone: contactPhone,
      state: plan.state,
      handling_mode: plan.state,
      ai_enabled: plan.state === "AI_ACTIVE",
      lifecycle_status: "OPEN",
      assigned_to_id: plan.owner ? userIds[plan.owner] : null,
      assigned_to_name: plan.owner ? inboxLr2FixtureStaff[plan.owner].fullName : null,
      service_window_expires_at: times.serviceWindowExpiresAt,
      human_agent_window_expires_at: times.serviceWindowExpiresAt,
      last_inbound_at: times.lastInboundAt,
      last_activity_at: times.lastInboundAt,
      last_message_preview: plan.message,
      unread_count: 1,
    };
    const existing = await db.from("conversations").select("id").eq("agency_id", agencyId).in("external_conversation_id", [plan.externalId, whatsappConversationId]).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    let conversationId: string;
    if (existing.data) {
      conversationId = existing.data.id as string;
      const reset = await db.from("conversations").update(row).eq("id", conversationId);
      if (reset.error) throw new Error(`Could not reset ${plan.externalId}: ${reset.error.message}`);
      // A run leaves its sent messages and attachments behind; a fixture starts each run with only its own first message.
      const outboxCleared = await db.from("outbox_messages").delete().eq("conversation_id", conversationId);
      if (outboxCleared.error) throw new Error(`Could not clear the outbox of ${plan.externalId}: ${outboxCleared.error.message}`);
      const cleared = await db.from("conversation_messages").delete().eq("conversation_id", conversationId).neq("external_message_id", `${plan.externalId}-m1`);
      if (cleared.error) throw new Error(`Could not clear the messages left in ${plan.externalId}: ${cleared.error.message}`);
    } else {
      const created = await db.from("conversations").insert(row).select("id").single();
      if (created.error) throw new Error(`Could not create ${plan.externalId}: ${created.error.message}`);
      conversationId = created.data.id as string;
      const message = await db.from("conversation_messages").insert({
        agency_id: agencyId, conversation_id: conversationId, role: "user", actor_kind: "CUSTOMER", direction: "INBOUND",
        message_type: "TEXT", content: plan.message, delivery_status: "DELIVERED", external_message_id: `${plan.externalId}-m1`,
      });
      if (message.error) throw new Error(`Could not add the ${plan.externalId} message: ${message.error.message}`);
    }
    if (plan.withLead && plan.owner) {
      // A lead of this agency, owned by the conversation's owner, linked to the conversation: the customer panel then has a lead to open.
      const reference = "LR2-LEAD-A1";
      const found = await db.from("leads").select("id").eq("agency_id", agencyId).eq("reference", reference).maybeSingle();
      if (found.error) throw new Error(found.error.message);
      let leadId = found.data?.id as string | undefined;
      if (!leadId) {
        const insertedLead = await db.from("leads").insert({ agency_id: agencyId, reference, full_name: plan.contactName, mobile: contactPhone, assigned_to_id: userIds[plan.owner], assigned_to_name: inboxLr2FixtureStaff[plan.owner].fullName }).select("id").single();
        if (insertedLead.error) throw new Error(`Could not create the fixture lead: ${insertedLead.error.message}`);
        leadId = insertedLead.data.id as string;
      }
      const linked = await db.from("conversations").update({ lead_id: leadId }).eq("id", conversationId);
      if (linked.error) throw new Error(`Could not link the fixture lead: ${linked.error.message}`);
    }
    printed.push(`${plan.envKey}=${conversationId}`);
  }
  console.error("\nSeeded. Add these to .env.local:\n");
  console.log(printed.join("\n"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
