/**
 * Server-only read/write access for Announcements.
 *
 * Backed by `announcements` / `announcement_recipients` added in
 * `supabase/migrations/20261017090000_announcements.sql`. Targeting reuses
 * Audiences (`lib/data/audiences-repository.ts`) and departure groups —
 * this file only resolves a target into a recipient list and freezes it.
 *
 * Consent is re-checked here at resolve/send time, live off `leads` /
 * `pilgrims` — never trusted from an audience's own cached size. PORTAL and
 * IN_APP are pull channels (the recipient has to open the app/portal) so
 * they are never blocked by do_not_contact/contactable_channels the way an
 * outbound push (WhatsApp/Email/SMS) is.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveAudienceSubjectIds } from "@/lib/data/audiences-repository";
import type {
  AnnouncementChannel,
  AnnouncementRecipientRow,
  AnnouncementRow,
  AnnouncementStatus,
  AnnouncementTargetType,
  AnnouncementWithReach,
} from "@/lib/types/announcements";
import type { ConsentChannel } from "@/lib/types/consent";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class AnnouncementPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Announcements: ${operation} on ${table} failed — ${detail}`);
    this.name = "AnnouncementPersistenceError";
  }
}

const PUSH_CHANNELS: ReadonlySet<AnnouncementChannel> = new Set(["WHATSAPP", "EMAIL", "SMS"]);
const CHANNEL_TO_CONSENT: Partial<Record<AnnouncementChannel, ConsentChannel>> = {
  WHATSAPP: "WHATSAPP",
  EMAIL: "EMAIL",
  SMS: "SMS",
};

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  channel: AnnouncementChannel;
  targetType: AnnouncementTargetType;
  departureGroupId: string | null;
  audienceId: string | null;
  whatsappTemplateId: string | null;
  whatsappTemplateParam: string | null;
  createdByName: string;
}

export async function listAnnouncementsWithReach(client: Db): Promise<AnnouncementWithReach[]> {
  const { data, error } = await client.from("announcements").select("*").order("created_at", { ascending: false });
  if (error) throw new AnnouncementPersistenceError("announcements", "select", error);
  const rows = (data ?? []) as AnnouncementRow[];

  return Promise.all(
    rows.map(async (row) => {
      const targetName = await resolveTargetName(client, row);
      if (row.status !== "SENT") {
        return {
          ...row,
          reach: { targetName, totalRecipients: 0, contactableCount: 0, deliveredCount: 0, failedCount: 0, readCount: 0, acknowledgedCount: 0 },
        };
      }
      const recipients = await listAnnouncementRecipients(client, row.id);
      return {
        ...row,
        reach: {
          targetName,
          totalRecipients: recipients.length,
          contactableCount: recipients.filter((r) => r.contactable).length,
          deliveredCount: recipients.filter((r) => r.delivered_at).length,
          failedCount: recipients.filter((r) => r.delivery_error).length,
          readCount: recipients.filter((r) => r.read_at).length,
          acknowledgedCount: recipients.filter((r) => r.acknowledged_at).length,
        },
      };
    }),
  );
}

export async function getAnnouncement(client: Db, id: string): Promise<AnnouncementRow | null> {
  const { data, error } = await client.from("announcements").select("*").eq("id", id).maybeSingle();
  if (error) throw new AnnouncementPersistenceError("announcements", "select", error);
  return (data as AnnouncementRow) ?? null;
}

async function resolveTargetName(client: Db, row: AnnouncementRow): Promise<string> {
  if (row.target_type === "DEPARTURE_GROUP" && row.departure_group_id) {
    const { data } = await client
      .from("departure_groups")
      .select("group_name")
      .eq("id", row.departure_group_id)
      .maybeSingle();
    return (data as { group_name: string } | null)?.group_name ?? "Unknown group";
  }
  if (row.target_type === "AUDIENCE" && row.audience_id) {
    const { data } = await client.from("audiences").select("name").eq("id", row.audience_id).maybeSingle();
    return (data as { name: string } | null)?.name ?? "Unknown audience";
  }
  return "Unknown target";
}

export async function listAnnouncementRecipients(client: Db, announcementId: string): Promise<AnnouncementRecipientRow[]> {
  const { data, error } = await client
    .from("announcement_recipients")
    .select("*")
    .eq("announcement_id", announcementId);
  if (error) throw new AnnouncementPersistenceError("announcement_recipients", "select", error);
  return (data ?? []) as AnnouncementRecipientRow[];
}

export async function createAnnouncement(client: Db, input: CreateAnnouncementInput): Promise<AnnouncementRow> {
  const { data, error } = await client
    .from("announcements")
    .insert({
      title: input.title,
      body: input.body,
      channel: input.channel,
      target_type: input.targetType,
      departure_group_id: input.targetType === "DEPARTURE_GROUP" ? input.departureGroupId : null,
      audience_id: input.targetType === "AUDIENCE" ? input.audienceId : null,
      whatsapp_template_id: input.channel === "WHATSAPP" ? input.whatsappTemplateId : null,
      whatsapp_template_param: input.channel === "WHATSAPP" ? input.whatsappTemplateParam : null,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new AnnouncementPersistenceError("announcements", "insert", error);
  return data as AnnouncementRow;
}

interface ResolvedSubject {
  subjectType: "LEAD" | "PILGRIM";
  subjectId: string;
  contactable: boolean;
  exclusionReason: string | null;
}

/**
 * Resolves an announcement's target into the subjects it would reach right
 * now, with consent applied for push channels. Used both for the live
 * preview count on the compose screen and for the frozen snapshot at send.
 */
async function resolveRecipients(client: Db, announcement: AnnouncementRow): Promise<ResolvedSubject[]> {
  const subjects: { subjectType: "LEAD" | "PILGRIM"; subjectId: string }[] = [];

  if (announcement.target_type === "DEPARTURE_GROUP" && announcement.departure_group_id) {
    const { data, error } = await client
      .from("departure_group_pilgrims")
      .select("pilgrim_id")
      .eq("departure_group_id", announcement.departure_group_id);
    if (error) throw new AnnouncementPersistenceError("departure_group_pilgrims", "select", error);
    for (const row of (data ?? []) as { pilgrim_id: string | null }[]) {
      if (row.pilgrim_id) subjects.push({ subjectType: "PILGRIM", subjectId: row.pilgrim_id });
    }
  } else if (announcement.target_type === "AUDIENCE" && announcement.audience_id) {
    const resolved = await resolveAudienceSubjectIds(client, announcement.audience_id);
    for (const subjectId of resolved.subjectIds) {
      subjects.push({ subjectType: resolved.subjectType, subjectId });
    }
  }

  if (subjects.length === 0) return [];

  const leadIds = subjects.filter((s) => s.subjectType === "LEAD").map((s) => s.subjectId);
  const pilgrimIds = subjects.filter((s) => s.subjectType === "PILGRIM").map((s) => s.subjectId);

  const consentById = new Map<string, { doNotContact: boolean; channels: ConsentChannel[] }>();
  if (leadIds.length > 0) {
    const { data, error } = await client
      .from("leads")
      .select("id, do_not_contact, contactable_channels")
      .in("id", leadIds);
    if (error) throw new AnnouncementPersistenceError("leads", "select", error);
    for (const row of (data ?? []) as { id: string; do_not_contact: boolean; contactable_channels: ConsentChannel[] }[]) {
      consentById.set(row.id, { doNotContact: row.do_not_contact, channels: row.contactable_channels ?? [] });
    }
  }
  if (pilgrimIds.length > 0) {
    const { data, error } = await client
      .from("pilgrims")
      .select("id, do_not_contact, contactable_channels")
      .in("id", pilgrimIds);
    if (error) throw new AnnouncementPersistenceError("pilgrims", "select", error);
    for (const row of (data ?? []) as { id: string; do_not_contact: boolean; contactable_channels: ConsentChannel[] }[]) {
      consentById.set(row.id, { doNotContact: row.do_not_contact, channels: row.contactable_channels ?? [] });
    }
  }

  const requiredChannel = CHANNEL_TO_CONSENT[announcement.channel];
  const isPush = PUSH_CHANNELS.has(announcement.channel);

  return subjects.map((s) => {
    const consent = consentById.get(s.subjectId);
    if (!isPush || !consent) {
      return { ...s, contactable: true, exclusionReason: null };
    }
    if (consent.doNotContact) {
      return { ...s, contactable: false, exclusionReason: "Marked do-not-contact" };
    }
    if (requiredChannel && !consent.channels.includes(requiredChannel)) {
      return { ...s, contactable: false, exclusionReason: `Not opted in for ${requiredChannel}` };
    }
    return { ...s, contactable: true, exclusionReason: null };
  });
}

/** Live preview — does not persist anything. */
export async function previewAnnouncementReach(
  client: Db,
  announcement: AnnouncementRow,
): Promise<{ total: number; contactable: number }> {
  const resolved = await resolveRecipients(client, announcement);
  return { total: resolved.length, contactable: resolved.filter((r) => r.contactable).length };
}

/**
 * Freezes the recipient snapshot into announcement_recipients and marks the
 * announcement SENT. For WHATSAPP, `delivered_at` is left null here — the
 * actual send happens afterwards in the Server Action (which needs the
 * admin client / Vault token, out of scope for this repository — see
 * app/(main)/relationships/announcements/actions.ts) and sets it per
 * recipient on real delivery. Every other channel still has no dispatch
 * integration, so it keeps the old placeholder of marking contactable
 * recipients delivered immediately.
 */
export async function sendAnnouncement(client: Db, announcementId: string): Promise<void> {
  const announcement = await getAnnouncement(client, announcementId);
  if (!announcement) throw new AnnouncementPersistenceError("announcements", "select", new Error("not found"));

  const resolved = await resolveRecipients(client, announcement);
  const isWhatsApp = announcement.channel === "WHATSAPP";
  if (resolved.length > 0) {
    const { error: insertError } = await client.from("announcement_recipients").upsert(
      resolved.map((r) => ({
        announcement_id: announcementId,
        subject_type: r.subjectType,
        subject_id: r.subjectId,
        contactable: r.contactable,
        exclusion_reason: r.exclusionReason,
        delivered_at: r.contactable && !isWhatsApp ? new Date().toISOString() : null,
      })),
      { onConflict: "announcement_id,subject_id" },
    );
    if (insertError) throw new AnnouncementPersistenceError("announcement_recipients", "insert", insertError);
  }

  const { error } = await client
    .from("announcements")
    .update({ status: "SENT", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", announcementId);
  if (error) throw new AnnouncementPersistenceError("announcements", "update", error);
}

export interface DispatchRecipient {
  recipientRowId: string;
  subjectType: "LEAD" | "PILGRIM";
  subjectId: string;
  phone: string | null;
}

/**
 * The contactable, not-yet-delivered recipients for one announcement, with
 * their phone number resolved — the list the WhatsApp dispatch loop in the
 * Server Action actually sends to.
 */
export async function listDispatchRecipients(client: Db, announcementId: string): Promise<DispatchRecipient[]> {
  const { data, error } = await client
    .from("announcement_recipients")
    .select("id, subject_type, subject_id")
    .eq("announcement_id", announcementId)
    .eq("contactable", true)
    .is("delivered_at", null);
  if (error) throw new AnnouncementPersistenceError("announcement_recipients", "select", error);

  const rows = (data ?? []) as { id: string; subject_type: "LEAD" | "PILGRIM"; subject_id: string }[];
  if (rows.length === 0) return [];

  const leadIds = rows.filter((r) => r.subject_type === "LEAD").map((r) => r.subject_id);
  const pilgrimIds = rows.filter((r) => r.subject_type === "PILGRIM").map((r) => r.subject_id);
  const phoneById = new Map<string, string>();

  if (leadIds.length > 0) {
    const { data: leads, error: leadsError } = await client.from("leads").select("id, mobile").in("id", leadIds);
    if (leadsError) throw new AnnouncementPersistenceError("leads", "select", leadsError);
    for (const l of (leads ?? []) as { id: string; mobile: string }[]) phoneById.set(l.id, l.mobile);
  }
  if (pilgrimIds.length > 0) {
    const { data: pilgrims, error: pilgrimsError } = await client
      .from("pilgrims")
      .select("id, whatsapp_number")
      .in("id", pilgrimIds);
    if (pilgrimsError) throw new AnnouncementPersistenceError("pilgrims", "select", pilgrimsError);
    for (const p of (pilgrims ?? []) as { id: string; whatsapp_number: string }[]) phoneById.set(p.id, p.whatsapp_number);
  }

  return rows.map((r) => ({
    recipientRowId: r.id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    phone: phoneById.get(r.subject_id) ?? null,
  }));
}

export async function markRecipientDelivered(client: Db, recipientRowId: string): Promise<void> {
  const { error } = await client
    .from("announcement_recipients")
    .update({ delivered_at: new Date().toISOString(), delivery_error: null })
    .eq("id", recipientRowId);
  if (error) throw new AnnouncementPersistenceError("announcement_recipients", "update", error);
}

export async function markRecipientDeliveryFailed(client: Db, recipientRowId: string, message: string): Promise<void> {
  const { error } = await client
    .from("announcement_recipients")
    .update({ delivery_error: message.slice(0, 500) })
    .eq("id", recipientRowId);
  if (error) throw new AnnouncementPersistenceError("announcement_recipients", "update", error);
}

export async function getWhatsAppTemplateForAnnouncement(
  client: Db,
  templateId: string,
): Promise<{ id: string; name: string; language: string; status: string; components: unknown } | null> {
  const { data, error } = await client
    .from("whatsapp_templates")
    .select("id, name, language, status, components")
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw new AnnouncementPersistenceError("whatsapp_templates", "select", error);
  return data ?? null;
}

export async function updateAnnouncementStatus(client: Db, id: string, status: AnnouncementStatus): Promise<void> {
  const { error } = await client
    .from("announcements")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new AnnouncementPersistenceError("announcements", "update", error);
}

export async function scheduleAnnouncement(client: Db, id: string, scheduledAt: string): Promise<void> {
  const { error } = await client
    .from("announcements")
    .update({ status: "SCHEDULED", scheduled_at: scheduledAt, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new AnnouncementPersistenceError("announcements", "update", error);
}
