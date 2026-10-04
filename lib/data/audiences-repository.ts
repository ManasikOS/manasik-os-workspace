/**
 * Server-only read/write access for Audiences.
 *
 * Backed by `audiences` / `audience_members` added in
 * `supabase/migrations/20261014090000_audiences.sql`.
 *
 * A DYNAMIC audience's size is never trusted from the stored
 * `computed_count` — every read here re-runs the filter against `leads` or
 * `pilgrims` live and writes the fresh count back, so the number on screen
 * can never disagree with who would actually be contacted. `audience_type =
 * STATIC` is the one case membership is read from `audience_members`
 * instead.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AudienceFilters,
  AudienceMemberPreview,
  AudienceRow,
  AudienceSubjectType,
  AudienceType,
  AudienceWithSize,
  LeadAudienceFilters,
  PilgrimAudienceFilters,
} from "@/lib/types/audiences";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class AudiencePersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Audiences: ${operation} on ${table} failed — ${detail}`);
    this.name = "AudiencePersistenceError";
  }
}

export interface CreateAudienceInput {
  name: string;
  description: string | null;
  subjectType: AudienceSubjectType;
  audienceType: AudienceType;
  filters: AudienceFilters | null;
  createdByName: string;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function applyLeadFilters(query: any, filters: LeadAudienceFilters) {
  let q = query;
  if (filters.stages?.length) q = q.in("stage", filters.stages);
  if (filters.sources?.length) q = q.in("source", filters.sources);
  if (filters.campaignId) q = q.eq("campaign_id", filters.campaignId);
  if (filters.doNotContact !== undefined) q = q.eq("do_not_contact", filters.doNotContact);
  if (filters.consentStatus?.length) q = q.in("consent_status", filters.consentStatus);
  if (filters.createdAfter) q = q.gte("created_at", filters.createdAfter);
  if (filters.createdBefore) q = q.lte("created_at", filters.createdBefore);
  return q;
}

/**
 * Pilgrim ids whose most recent COMPLETED departure falls `minMonthsAgo` to
 * `maxMonthsAgo` months back. `departure_group_pilgrims.journey_status` and
 * `departure_date` live on the per-enrolment join (see
 * `supabase/migrations/20260813090000_create_pilgrims.sql` and
 * `20260809090000_create_departure_groups.sql`), not on `pilgrims` itself, so
 * this can't be a single query-builder filter — it resolves ids first, the
 * same way `resolveAudienceSubjectIds` resolves STATIC membership before
 * filtering.
 */
async function resolvePilgrimIdsByTravelWindow(
  client: Db,
  minMonthsAgo: number | null | undefined,
  maxMonthsAgo: number | null | undefined,
): Promise<string[]> {
  const now = Date.now();
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  const windowStart = maxMonthsAgo != null ? new Date(now - maxMonthsAgo * monthMs) : null;
  const windowEnd = minMonthsAgo != null ? new Date(now - minMonthsAgo * monthMs) : null;

  const { data, error } = await client
    .from("departure_group_pilgrims")
    .select("pilgrim_id, departure_groups!inner(departure_date)")
    .eq("journey_status", "COMPLETED")
    .not("pilgrim_id", "is", null);
  if (error) throw new AudiencePersistenceError("departure_group_pilgrims", "select", error);

  const lastTravelled = new Map<string, string>();
  for (const row of (data ?? []) as {
    pilgrim_id: string;
    departure_groups: { departure_date: string } | { departure_date: string }[];
  }[]) {
    const group = Array.isArray(row.departure_groups) ? row.departure_groups[0] : row.departure_groups;
    if (!group) continue;
    const current = lastTravelled.get(row.pilgrim_id);
    if (!current || group.departure_date > current) {
      lastTravelled.set(row.pilgrim_id, group.departure_date);
    }
  }

  const ids: string[] = [];
  for (const [pilgrimId, departureDate] of lastTravelled) {
    const date = new Date(departureDate);
    if (windowStart && date < windowStart) continue;
    if (windowEnd && date > windowEnd) continue;
    ids.push(pilgrimId);
  }
  return ids;
}

/**
 * Pilgrim ids with at least one enrolment in one of `journeyStatuses`.
 * `journey_status` lives on `departure_group_pilgrims` (the per-journey
 * enrolment), not on `pilgrims` itself — see
 * `resolvePilgrimIdsByTravelWindow` above for the same shape of problem.
 */
async function resolvePilgrimIdsByJourneyStatus(client: Db, journeyStatuses: string[]): Promise<string[]> {
  const { data, error } = await client
    .from("departure_group_pilgrims")
    .select("pilgrim_id")
    .in("journey_status", journeyStatuses)
    .not("pilgrim_id", "is", null);
  if (error) throw new AudiencePersistenceError("departure_group_pilgrims", "select", error);
  return [...new Set((data ?? []).map((r: { pilgrim_id: string }) => r.pilgrim_id))];
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
async function applyPilgrimFilters(client: Db, query: any, filters: PilgrimAudienceFilters) {
  let q = query;
  if (filters.journeyStatuses?.length) {
    const ids = await resolvePilgrimIdsByJourneyStatus(client, filters.journeyStatuses);
    q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (filters.nationality) q = q.eq("nationality", filters.nationality);
  if (filters.doNotContact !== undefined) q = q.eq("do_not_contact", filters.doNotContact);
  if (filters.consentStatus?.length) q = q.in("consent_status", filters.consentStatus);
  if (filters.travelledMonthsAgoMin != null || filters.travelledMonthsAgoMax != null) {
    const ids = await resolvePilgrimIdsByTravelWindow(
      client,
      filters.travelledMonthsAgoMin,
      filters.travelledMonthsAgoMax,
    );
    q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  return q;
}

/**
 * Exported so a draft (unsaved) filter set can be previewed before an
 * audience is created from it — e.g. the AI-suggested audience draft in
 * `lib/copilot/marketing/*` needs a real count to show alongside the
 * suggestion, never a guessed one.
 */
export async function countDynamicAudience(
  client: Db,
  subjectType: AudienceSubjectType,
  filters: AudienceFilters | null,
): Promise<number> {
  const table = subjectType === "LEAD" ? "leads" : "pilgrims";
  let query = client.from(table).select("id", { count: "exact", head: true });
  if (filters) {
    query =
      subjectType === "LEAD"
        ? applyLeadFilters(query, filters as LeadAudienceFilters)
        : await applyPilgrimFilters(client, query, filters as PilgrimAudienceFilters);
  }
  const { count, error } = await query;
  if (error) throw new AudiencePersistenceError(table, "select", error);
  return count ?? 0;
}

/** Every audience for this agency, with a freshly recomputed size for DYNAMIC ones. */
export async function listAudiences(client: Db): Promise<AudienceWithSize[]> {
  const { data, error } = await client
    .from("audiences")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new AudiencePersistenceError("audiences", "select", error);

  const rows = (data ?? []) as AudienceRow[];
  return Promise.all(
    rows.map(async (row) => {
      const liveCount =
        row.audience_type === "DYNAMIC"
          ? await countDynamicAudience(client, row.subject_type, row.filters)
          : await countStaticAudience(client, row.id);

      if (row.audience_type === "DYNAMIC" && liveCount !== row.computed_count) {
        await client
          .from("audiences")
          .update({ computed_count: liveCount, computed_at: new Date().toISOString() })
          .eq("id", row.id);
      }

      return { ...row, liveCount };
    }),
  );
}

async function countStaticAudience(client: Db, audienceId: string): Promise<number> {
  const { count, error } = await client
    .from("audience_members")
    .select("id", { count: "exact", head: true })
    .eq("audience_id", audienceId)
    .eq("included", true);
  if (error) throw new AudiencePersistenceError("audience_members", "select", error);
  return count ?? 0;
}

export async function getAudience(client: Db, audienceId: string): Promise<AudienceWithSize | null> {
  const { data, error } = await client.from("audiences").select("*").eq("id", audienceId).maybeSingle();
  if (error) throw new AudiencePersistenceError("audiences", "select", error);
  if (!data) return null;

  const row = data as AudienceRow;
  const liveCount =
    row.audience_type === "DYNAMIC"
      ? await countDynamicAudience(client, row.subject_type, row.filters)
      : await countStaticAudience(client, row.id);

  return { ...row, liveCount };
}

/**
 * Up to `limit` members for preview, whichever subject type the audience
 * targets. For DYNAMIC audiences this re-runs the filter; for STATIC it
 * reads the frozen `audience_members` list and joins the subject.
 */
export async function listAudienceMembers(
  client: Db,
  audience: AudienceRow,
  limit = 50,
): Promise<AudienceMemberPreview[]> {
  if (audience.audience_type === "STATIC") {
    const { data, error } = await client
      .from("audience_members")
      .select("subject_id")
      .eq("audience_id", audience.id)
      .eq("included", true)
      .order("added_at", { ascending: false })
      .limit(limit);
    if (error) throw new AudiencePersistenceError("audience_members", "select", error);
    const ids = (data ?? []).map((r: { subject_id: string }) => r.subject_id);
    if (ids.length === 0) return [];
    return audience.subject_type === "LEAD"
      ? previewLeadsByIds(client, ids)
      : previewPilgrimsByIds(client, ids);
  }

  const table = audience.subject_type === "LEAD" ? "leads" : "pilgrims";
  let query = client
    .from(table)
    .select(
      audience.subject_type === "LEAD"
        ? "id, full_name, mobile, stage, consent_status, do_not_contact"
        : "id, full_name, whatsapp_number, journey_status, consent_status, do_not_contact",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (audience.filters) {
    query =
      audience.subject_type === "LEAD"
        ? applyLeadFilters(query, audience.filters as LeadAudienceFilters)
        : await applyPilgrimFilters(client, query, audience.filters as PilgrimAudienceFilters);
  }

  const { data, error } = await query;
  if (error) throw new AudiencePersistenceError(table, "select", error);

  return (data ?? []).map((row: Record<string, unknown>) =>
    audience.subject_type === "LEAD"
      ? leadRowToPreview(row)
      : pilgrimRowToPreview(row),
  );
}

async function previewLeadsByIds(client: Db, ids: string[]): Promise<AudienceMemberPreview[]> {
  const { data, error } = await client
    .from("leads")
    .select("id, full_name, mobile, stage, consent_status, do_not_contact")
    .in("id", ids);
  if (error) throw new AudiencePersistenceError("leads", "select", error);
  return (data ?? []).map(leadRowToPreview);
}

async function previewPilgrimsByIds(client: Db, ids: string[]): Promise<AudienceMemberPreview[]> {
  const { data, error } = await client
    .from("pilgrims")
    .select("id, full_name, whatsapp_number, journey_status, consent_status, do_not_contact")
    .in("id", ids);
  if (error) throw new AudiencePersistenceError("pilgrims", "select", error);
  return (data ?? []).map(pilgrimRowToPreview);
}

function leadRowToPreview(row: Record<string, unknown>): AudienceMemberPreview {
  return {
    subjectId: row.id as string,
    name: row.full_name as string,
    contact: (row.mobile as string | null) ?? null,
    consentStatus: row.consent_status as AudienceMemberPreview["consentStatus"],
    doNotContact: Boolean(row.do_not_contact),
    detail: String(row.stage ?? ""),
  };
}

function pilgrimRowToPreview(row: Record<string, unknown>): AudienceMemberPreview {
  return {
    subjectId: row.id as string,
    name: row.full_name as string,
    contact: (row.whatsapp_number as string | null) ?? null,
    consentStatus: row.consent_status as AudienceMemberPreview["consentStatus"],
    doNotContact: Boolean(row.do_not_contact),
    detail: String(row.journey_status ?? ""),
  };
}

export async function createAudience(client: Db, input: CreateAudienceInput): Promise<AudienceRow> {
  const { data, error } = await client
    .from("audiences")
    .insert({
      name: input.name,
      description: input.description,
      subject_type: input.subjectType,
      audience_type: input.audienceType,
      filters: input.audienceType === "DYNAMIC" ? input.filters : null,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new AudiencePersistenceError("audiences", "insert", error);
  return data as AudienceRow;
}

export async function updateAudienceFilters(
  client: Db,
  audienceId: string,
  filters: AudienceFilters,
): Promise<void> {
  const { error } = await client
    .from("audiences")
    .update({ filters, updated_at: new Date().toISOString() })
    .eq("id", audienceId);
  if (error) throw new AudiencePersistenceError("audiences", "update", error);
}

export async function deleteAudience(client: Db, audienceId: string): Promise<void> {
  const { error } = await client.from("audiences").delete().eq("id", audienceId);
  if (error) throw new AudiencePersistenceError("audiences", "delete", error);
}

export async function addStaticMember(
  client: Db,
  input: {
    audienceId: string;
    subjectType: AudienceSubjectType;
    subjectId: string;
    addedByName: string;
  },
): Promise<void> {
  const { error } = await client.from("audience_members").upsert(
    {
      audience_id: input.audienceId,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      included: true,
      added_by_name: input.addedByName,
    },
    { onConflict: "audience_id,subject_id" },
  );
  if (error) throw new AudiencePersistenceError("audience_members", "insert", error);
}

export async function removeStaticMember(client: Db, audienceId: string, subjectId: string): Promise<void> {
  const { error } = await client
    .from("audience_members")
    .delete()
    .eq("audience_id", audienceId)
    .eq("subject_id", subjectId);
  if (error) throw new AudiencePersistenceError("audience_members", "delete", error);
}

/**
 * Resolves an audience to the plain subject IDs it currently contains — for
 * DYNAMIC, re-runs the filter; for STATIC, reads `audience_members`. Used by
 * Announcements to turn "target this audience" into an actual recipient
 * list, separately from consent (which the caller checks against these IDs).
 */
export async function resolveAudienceSubjectIds(
  client: Db,
  audienceId: string,
): Promise<{ subjectType: AudienceSubjectType; subjectIds: string[] }> {
  const { data, error } = await client.from("audiences").select("*").eq("id", audienceId).maybeSingle();
  if (error) throw new AudiencePersistenceError("audiences", "select", error);
  if (!data) return { subjectType: "LEAD", subjectIds: [] };

  const audience = data as AudienceRow;
  const table = audience.subject_type === "LEAD" ? "leads" : "pilgrims";

  if (audience.audience_type === "STATIC") {
    const { data: members, error: memberError } = await client
      .from("audience_members")
      .select("subject_id")
      .eq("audience_id", audienceId)
      .eq("included", true);
    if (memberError) throw new AudiencePersistenceError("audience_members", "select", memberError);
    return {
      subjectType: audience.subject_type,
      subjectIds: ((members ?? []) as { subject_id: string }[]).map((m) => m.subject_id),
    };
  }

  let query = client.from(table).select("id");
  if (audience.filters) {
    query =
      audience.subject_type === "LEAD"
        ? applyLeadFilters(query, audience.filters as LeadAudienceFilters)
        : await applyPilgrimFilters(client, query, audience.filters as PilgrimAudienceFilters);
  }
  const { data: rows, error: rowsError } = await query;
  if (rowsError) throw new AudiencePersistenceError(table, "select", rowsError);
  return { subjectType: audience.subject_type, subjectIds: ((rows ?? []) as { id: string }[]).map((r) => r.id) };
}
