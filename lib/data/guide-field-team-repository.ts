/**
 * Server-only read/write access for Guides & Field Team.
 *
 * Backed by `guide_profiles` / `guide_briefings` / `guide_handovers` /
 * `field_checkins` added in `supabase/migrations/20261024090000_guide_field_team.sql`.
 * "Who is assigned where" stays in `staff_group_assignments` — see
 * `lib/data/team-repository.ts` — and is not read or written here.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import type {
  FieldCheckinRow,
  FieldCheckinStatus,
  FieldCheckinWithGroup,
  GuideBriefingRow,
  GuideBriefingWithGroup,
  GuideHandoverRow,
  GuideHandoverStatus,
  GuideHandoverWithNames,
  GuideProfileRow,
} from "@/lib/types/guide-field-team";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class GuideFieldTeamPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`GuideFieldTeam: ${operation} on ${table} failed — ${detail}`);
    this.name = "GuideFieldTeamPersistenceError";
  }
}

async function namesByStaffId(client: Db, staffIds: string[]): Promise<Map<string, string>> {
  if (staffIds.length === 0) return new Map();
  const { data, error } = await client.from("staff_profiles").select("id, full_name").in("id", [...new Set(staffIds)]);
  if (error) throw new GuideFieldTeamPersistenceError("staff_profiles", "select", error);
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
}

async function groupNamesByGroupId(client: Db, groupIds: string[]): Promise<Map<string, string>> {
  if (groupIds.length === 0) return new Map();
  const { data, error } = await client.from("departure_groups").select("id, group_name").in("id", [...new Set(groupIds)]);
  if (error) throw new GuideFieldTeamPersistenceError("departure_groups", "select", error);
  return new Map(((data ?? []) as { id: string; group_name: string }[]).map((g) => [g.id, g.group_name]));
}

/** A guide's currently-active group assignments, name resolved — the picker behind "New briefing" / "Check in". Reuses staff_group_assignments via team-repository, no duplicate assignment model. */
export async function listActiveAssignedGroups(client: Db, staffId: string): Promise<{ id: string; name: string }[]> {
  const groupIds = await loadAssignedGroupIds(client, staffId);
  if (groupIds.length === 0) return [];
  const names = await groupNamesByGroupId(client, groupIds);
  return groupIds.map((id) => ({ id, name: names.get(id) ?? "Unknown group" }));
}

export async function getGuideProfile(client: Db, staffId: string): Promise<GuideProfileRow | null> {
  const { data, error } = await client.from("guide_profiles").select("*").eq("staff_id", staffId).maybeSingle();
  if (error) throw new GuideFieldTeamPersistenceError("guide_profiles", "select", error);
  return (data as GuideProfileRow) ?? null;
}

export interface UpsertGuideProfileInput {
  staffId: string;
  languages: string[];
  certifications: string | null;
  yearsExperience: number | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
}

export async function upsertGuideProfile(client: Db, input: UpsertGuideProfileInput): Promise<GuideProfileRow> {
  const { data, error } = await client
    .from("guide_profiles")
    .upsert(
      {
        staff_id: input.staffId,
        languages: input.languages,
        certifications: input.certifications,
        years_experience: input.yearsExperience,
        emergency_contact_name: input.emergencyContactName,
        emergency_contact_phone: input.emergencyContactPhone,
        notes: input.notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "staff_id" },
    )
    .select("*")
    .single();
  if (error) throw new GuideFieldTeamPersistenceError("guide_profiles", "insert", error);
  return data as GuideProfileRow;
}

export async function listBriefingsForGuide(client: Db, staffId: string): Promise<GuideBriefingWithGroup[]> {
  const { data, error } = await client
    .from("guide_briefings")
    .select("*")
    .eq("staff_id", staffId)
    .order("created_at", { ascending: false });
  if (error) throw new GuideFieldTeamPersistenceError("guide_briefings", "select", error);
  const rows = (data ?? []) as GuideBriefingRow[];
  const groupNames = await groupNamesByGroupId(client, rows.map((r) => r.departure_group_id));
  return rows.map((r) => ({ ...r, groupName: groupNames.get(r.departure_group_id) ?? "Unknown group" }));
}

export interface CreateBriefingInput {
  departureGroupId: string;
  staffId: string;
  title: string;
  content: string;
  createdByName: string;
}

export async function createBriefing(client: Db, input: CreateBriefingInput): Promise<GuideBriefingRow> {
  const { data, error } = await client
    .from("guide_briefings")
    .insert({
      departure_group_id: input.departureGroupId,
      staff_id: input.staffId,
      title: input.title,
      content: input.content,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new GuideFieldTeamPersistenceError("guide_briefings", "insert", error);
  return data as GuideBriefingRow;
}

export async function acknowledgeBriefing(client: Db, briefingId: string): Promise<void> {
  const { error } = await client
    .from("guide_briefings")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", briefingId);
  if (error) throw new GuideFieldTeamPersistenceError("guide_briefings", "update", error);
}

export async function listHandoversForGuide(client: Db, staffId: string): Promise<GuideHandoverWithNames[]> {
  const { data, error } = await client
    .from("guide_handovers")
    .select("*")
    .or(`from_staff_id.eq.${staffId},to_staff_id.eq.${staffId}`)
    .order("created_at", { ascending: false });
  if (error) throw new GuideFieldTeamPersistenceError("guide_handovers", "select", error);
  const rows = (data ?? []) as GuideHandoverRow[];

  const [groupNames, staffNames] = await Promise.all([
    groupNamesByGroupId(client, rows.map((r) => r.departure_group_id)),
    namesByStaffId(client, [
      ...rows.map((r) => r.to_staff_id),
      ...rows.map((r) => r.from_staff_id).filter((id): id is string => Boolean(id)),
    ]),
  ]);

  return rows.map((r) => ({
    ...r,
    groupName: groupNames.get(r.departure_group_id) ?? "Unknown group",
    fromName: r.from_staff_id ? staffNames.get(r.from_staff_id) ?? "Unknown" : null,
    toName: staffNames.get(r.to_staff_id) ?? "Unknown",
  }));
}

export interface CreateHandoverInput {
  departureGroupId: string;
  fromStaffId: string | null;
  toStaffId: string;
  handoverNotes: string;
  createdByName: string;
}

export async function createHandover(client: Db, input: CreateHandoverInput): Promise<GuideHandoverRow> {
  const { data, error } = await client
    .from("guide_handovers")
    .insert({
      departure_group_id: input.departureGroupId,
      from_staff_id: input.fromStaffId,
      to_staff_id: input.toStaffId,
      handover_notes: input.handoverNotes,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new GuideFieldTeamPersistenceError("guide_handovers", "insert", error);
  return data as GuideHandoverRow;
}

export async function acknowledgeHandover(client: Db, handoverId: string): Promise<void> {
  const { error } = await client
    .from("guide_handovers")
    .update({ status: "ACKNOWLEDGED" satisfies GuideHandoverStatus, acknowledged_at: new Date().toISOString() })
    .eq("id", handoverId);
  if (error) throw new GuideFieldTeamPersistenceError("guide_handovers", "update", error);
}

export async function listCheckinsForGuide(client: Db, staffId: string, limit = 50): Promise<FieldCheckinWithGroup[]> {
  const { data, error } = await client
    .from("field_checkins")
    .select("*")
    .eq("staff_id", staffId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new GuideFieldTeamPersistenceError("field_checkins", "select", error);
  const rows = (data ?? []) as FieldCheckinRow[];
  const groupNames = await groupNamesByGroupId(client, rows.map((r) => r.departure_group_id));
  return rows.map((r) => ({ ...r, groupName: groupNames.get(r.departure_group_id) ?? "Unknown group" }));
}

export interface CreateCheckinInput {
  departureGroupId: string;
  staffId: string;
  status: FieldCheckinStatus;
  note: string | null;
}

export async function createCheckin(client: Db, input: CreateCheckinInput): Promise<FieldCheckinRow> {
  const { data, error } = await client
    .from("field_checkins")
    .insert({
      departure_group_id: input.departureGroupId,
      staff_id: input.staffId,
      status: input.status,
      note: input.note,
    })
    .select("*")
    .single();
  if (error) throw new GuideFieldTeamPersistenceError("field_checkins", "insert", error);
  return data as FieldCheckinRow;
}
