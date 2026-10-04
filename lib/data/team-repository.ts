/**
 * Server-only read/write access for the Team module.
 *
 * Same posture as `lib/data/suppliers-repository.ts` and
 * `lib/data/pilgrims-repository.ts`: this is the only file that touches
 * Supabase for `staff_profiles`, `staff_invitations`, `staff_group_assignments`
 * and `staff_activity_logs`. Mutators are added incrementally as each phase
 * of the Team build needs them — see `docs/modules/team-module-implementation-plan.md`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient, hasAdminClient } from "@/utils/supabase/admin";
import { colomboDayKey } from "@/lib/date";
import { getSiteUrl } from "@/lib/site-url";
import type { InviteStaffInput, UpdateStaffProfileInput } from "@/lib/validations/team";
import type { StaffActivityEventType, StaffInvitationRow, TeamDirectoryRow } from "@/lib/types/team";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * "the Acme Travels" / "your agency's" — slots into "You've been invited
 * to join {phrase} team OS", for copy that used to hardcode "the Royal
 * Al-Fathima Travels" (Phase 5 of docs/architecture/multi-tenancy-implementation-plan.md
 * — de-hardcoding the single tenant this app shipped with). `db` is the
 * session-scoped client, so this reads exactly the caller's agency row,
 * same as every other query in this file.
 */
async function agencyDisplayPhrase(db: Db): Promise<string> {
  const { data } = await db.from("agency_settings").select("agency_name").eq("singleton", true).maybeSingle();
  const name = data?.agency_name?.trim();
  return name ? `the ${name}` : "your agency's";
}

export class TeamPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    super(`${operation} on ${table} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "TeamPersistenceError";
  }
}

/**
 * Supabase's `.update()` does not error when the `.eq()` filter — or an RLS
 * `using` clause silently narrowing it further — matches zero rows; it just
 * returns `{ data: null, error: null }`. Every UPDATE-only mutator in this
 * file used to treat that as success, so a write blocked by RLS (a
 * tenant/agency mismatch, a role check that didn't hold) reported
 * `{ ok: true }` back to the UI — "Role updated" toast, nothing actually
 * changed — with no way to tell the two apart. Call this right after
 * `.select(...).maybeSingle()` on an update to turn the silent no-op into an
 * honest, loud failure instead.
 */
function assertRowUpdated<T>(row: T | null, table: string): asserts row is T {
  if (!row) {
    throw new TeamPersistenceError(
      table,
      "update",
      new Error("Update matched no row — the record may no longer exist, or this account cannot write it (check role/tenant scoping)."),
    );
  }
}

/* ── Directory reads ──────────────────────────────────────────────────────── */

export async function loadTeamDirectory(db: Db): Promise<TeamDirectoryRow[]> {
  const { data, error } = await db
    .from("team_directory_rows")
    .select("*")
    .order("full_name", { ascending: true });
  if (error) throw new TeamPersistenceError("team_directory_rows", "select", error);
  return (data ?? []) as TeamDirectoryRow[];
}

/**
 * Not derivable from the directory view — this is every open task with no
 * owner at all, which by definition belongs to no staff profile row. Backs
 * the "Unassigned Tasks" KPI card.
 */
export async function loadUnassignedTaskCount(db: Db): Promise<number> {
  const { count, error } = await db
    .from("departure_group_tasks")
    .select("id", { count: "exact", head: true })
    .is("owner_id", null)
    .neq("status", "COMPLETE");
  if (error) throw new TeamPersistenceError("departure_group_tasks", "select", error);
  return count ?? 0;
}

export async function loadOwnStaffId(db: Db, userId: string): Promise<string | null> {
  const { data, error } = await db.from("staff_profiles").select("id").eq("id", userId).maybeSingle();
  if (error) throw new TeamPersistenceError("staff_profiles", "select", error);
  return data?.id ?? null;
}

/* ── Profile reads ────────────────────────────────────────────────────────── */

export interface StaffAssignmentWithGroup {
  id: string;
  staff_profile_id: string;
  departure_group_id: string;
  responsibility: string;
  assigned_by_name: string | null;
  assigned_at: string;
  group_name: string;
  group_code: string;
  departure_date: string;
  group_status: string;
  readiness_score: number;
  readiness_status: string;
  booked_seats: number;
}

export interface StaffProfileBundle {
  profile: TeamDirectoryRow;
  assignments: StaffAssignmentWithGroup[];
  completedThisWeekCount: number;
  recentRoleChanges: StaffActivityLogWithId[];
}

export interface StaffActivityLogWithId {
  id: string;
  actor_name_snapshot: string;
  event_type: string;
  before_value: unknown;
  after_value: unknown;
  message: string;
  is_high_impact: boolean;
  created_at: string;
}

export async function loadStaffProfile(db: Db, staffId: string): Promise<StaffProfileBundle | null> {
  const { data: profileRow, error: profileError } = await db
    .from("team_directory_rows")
    .select("*")
    .eq("id", staffId)
    .maybeSingle();
  if (profileError) throw new TeamPersistenceError("team_directory_rows", "select", profileError);
  if (!profileRow) return null;

  // D8 of docs/modules/team-module-remediation-plan.md: "this week" must be measured
  // against the Colombo calendar the agency operates in, not the server's
  // local clock — colomboDayKey() is what every other date boundary in this
  // app uses. Deriving the weekday from the day-key string (rather than
  // `new Date()`) keeps it correct regardless of the server's own timezone.
  const todayKey = colomboDayKey();
  const weekdayIndex = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  const startOfWeekKey = colomboDayKey(
    new Date(Date.parse(`${todayKey}T00:00:00Z`) - weekdayIndex * 24 * 60 * 60 * 1000),
  );
  const startOfWeekIso = `${startOfWeekKey}T00:00:00+05:30`;

  const [assignmentsRes, completedRes, roleChangesRes] = await Promise.all([
    db
      .from("staff_group_assignments")
      .select(
        "id, staff_profile_id, departure_group_id, responsibility, assigned_by_name, assigned_at, " +
          "departure_groups(group_name, group_code, departure_date, group_status, readiness_score, readiness_status, booked_seats)",
      )
      .eq("staff_profile_id", staffId)
      .is("unassigned_at", null)
      .order("assigned_at", { ascending: false }),
    db
      .from("departure_group_tasks")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", staffId)
      .eq("status", "COMPLETE")
      .gte("due_at", startOfWeekIso),
    db
      .from("staff_activity_logs")
      .select("id, actor_name_snapshot, event_type, before_value, after_value, message, is_high_impact, created_at")
      .eq("staff_profile_id", staffId)
      .eq("event_type", "ROLE_CHANGED")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (assignmentsRes.error) throw new TeamPersistenceError("staff_group_assignments", "select", assignmentsRes.error);
  if (completedRes.error) throw new TeamPersistenceError("departure_group_tasks", "select", completedRes.error);
  if (roleChangesRes.error) throw new TeamPersistenceError("staff_activity_logs", "select", roleChangesRes.error);

  type AssignmentRow = {
    id: string;
    staff_profile_id: string;
    departure_group_id: string;
    responsibility: string;
    assigned_by_name: string | null;
    assigned_at: string;
    departure_groups: {
      group_name: string;
      group_code: string;
      departure_date: string;
      group_status: string;
      readiness_score: number;
      readiness_status: string;
      booked_seats: number;
    } | null;
  };

  const assignments: StaffAssignmentWithGroup[] = ((assignmentsRes.data ?? []) as unknown as AssignmentRow[])
    .filter((row) => row.departure_groups !== null)
    .map((row) => ({
      id: row.id,
      staff_profile_id: row.staff_profile_id,
      departure_group_id: row.departure_group_id,
      responsibility: row.responsibility,
      assigned_by_name: row.assigned_by_name,
      assigned_at: row.assigned_at,
      group_name: row.departure_groups!.group_name,
      group_code: row.departure_groups!.group_code,
      departure_date: row.departure_groups!.departure_date,
      group_status: row.departure_groups!.group_status,
      readiness_score: row.departure_groups!.readiness_score,
      readiness_status: row.departure_groups!.readiness_status,
      booked_seats: row.departure_groups!.booked_seats,
    }));

  return {
    profile: profileRow as TeamDirectoryRow,
    assignments,
    completedThisWeekCount: completedRes.count ?? 0,
    recentRoleChanges: (roleChangesRes.data ?? []) as StaffActivityLogWithId[],
  };
}

/* ── Activity log ─────────────────────────────────────────────────────────── */

export interface TeamActor {
  id: string | null;
  name: string;
}

export async function logStaffEvent(
  db: Db,
  input: {
    staffId: string;
    actor: TeamActor;
    eventType: StaffActivityEventType;
    beforeValue?: unknown;
    afterValue?: unknown;
    message?: string;
    isHighImpact?: boolean;
  },
): Promise<void> {
  const { error } = await db.from("staff_activity_logs").insert({
    staff_profile_id: input.staffId,
    actor_id: input.actor.id,
    actor_name_snapshot: input.actor.name,
    event_type: input.eventType,
    before_value: input.beforeValue ?? null,
    after_value: input.afterValue ?? null,
    message: input.message ?? "",
    is_high_impact: input.isHighImpact ?? false,
  });
  if (error) throw new TeamPersistenceError("staff_activity_logs", "insert", error);
}

/* ── Invitations ──────────────────────────────────────────────────────────── */

export type InviteStaffResult =
  | { ok: true; staffId: string; whatsappShareUrl: string | null }
  | { ok: false; error: string; deactivatedStaffId?: string };

/**
 * Creates the `auth.users` row via the Supabase admin API, then hands off to
 * `create_staff_invitation()` — a security-definer RPC that writes
 * `staff_profiles`, `staff_invitations` and `agency_members` in one
 * transaction (see `supabase/migrations/20260923090000_team_invitation_repair.sql`).
 * Folding those three writes into one call is what makes the second half of
 * this function atomic: any failure calls `deleteUser()` on the auth
 * identity just created, so a half-finished invite never poisons the email
 * address for future retries (B3 of docs/modules/team-module-remediation-plan.md).
 *
 * WhatsApp delivery is a `wa.me` deep link the caller opens by hand (D7) —
 * there is no WhatsApp Business API integration in this codebase, matching
 * every other WhatsApp surface in the app.
 */
export async function inviteStaff(
  db: Db,
  input: InviteStaffInput,
  actor: TeamActor,
): Promise<InviteStaffResult> {
  const email = input.email.trim().toLowerCase();

  const { data: existing, error: existingError } = await db
    .from("staff_profiles")
    .select("id, status")
    .ilike("email", email)
    .maybeSingle();
  if (existingError) throw new TeamPersistenceError("staff_profiles", "select", existingError);
  if (existing?.status === "DEACTIVATED") {
    // H3 of docs/modules/team-module-remediation-plan.md — a deactivated profile
    // permanently blocked re-inviting the same address with a flat refusal.
    // Reactivating restores the original account and history; the caller
    // (invite-team-member-dialog.tsx) offers this as a one-click follow-up.
    return {
      ok: false,
      error: "That email was deactivated on this team. Reactivate their account instead of sending a new invitation.",
      deactivatedStaffId: existing.id,
    };
  }
  if (existing) return { ok: false, error: "That email is already on the team." };

  // Resolved server-side, through the RLS-scoped session client, so an id
  // for another agency's branch can never be trusted from the client (H2 of
  // docs/modules/team-module-remediation-plan.md); create_staff_invitation() checks
  // it again as a second line of defence.
  const { data: branch, error: branchError } = await db
    .from("branches")
    .select("id, name")
    .eq("id", input.branchId)
    .maybeSingle();
  if (branchError) throw new TeamPersistenceError("branches", "select", branchError);
  if (!branch) return { ok: false, error: "Choose a valid branch." };

  const admin = createAdminClient();
  const siteUrl = await getSiteUrl();
  // Routed through /auth/confirm (not a direct redirectTo) so the invite
  // link is handled the same way every other Supabase email link in this
  // app is — see sendPasswordReset() below and B1 of the remediation plan.
  // A bare `redirectTo` either lands the session in the URL fragment
  // (unreadable server-side) or on a `mode=setup` the login page never
  // implemented.
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/login?mode=setup")}`,
  });
  if (inviteError || !invited?.user) {
    // The duplicate check above is RLS-scoped to this agency (F6 of
    // docs/architecture/multi-tenancy-implementation-plan.md), so it cannot see an
    // account that already exists under a DIFFERENT agency — that only
    // surfaces here, as Supabase Auth's own "already registered" error.
    // Cross-agency membership has no self-serve path yet (Phase 3), so this
    // is a clear dead end rather than the raw platform error, and never
    // names the other agency.
    if (inviteError?.code === "email_exists") {
      return {
        ok: false,
        error: "That email is already registered on the platform under a different workspace. Contact support to add them here.",
      };
    }
    return { ok: false, error: inviteError?.message ?? "Could not send the invitation email." };
  }

  const staffId = invited.user.id;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: rpcError } = await db.rpc("create_staff_invitation", {
    p_staff_id: staffId,
    p_full_name: input.fullName,
    p_email: email,
    p_whatsapp: input.whatsapp || "",
    p_role: input.role,
    p_branch: branch.name,
    p_branch_id: branch.id,
    p_employment_type: input.employmentType,
    p_access_starts_on: input.accessStartsOn || null,
    p_access_ends_on: input.accessEndsOn || null,
    p_job_title: input.jobTitle || "",
    p_sent_via: input.sendVia,
    p_expires_at: expiresAt,
  });
  if (rpcError) {
    try {
      await admin.auth.admin.deleteUser(staffId);
    } catch {
      // Best-effort cleanup — the failure below is still reported either
      // way; a stray auth user with no staff_profiles row can be cleaned up
      // manually if this also fails.
    }
    return { ok: false, error: "Could not create the team member's profile. Please try again." };
  }

  await logStaffEvent(db, {
    staffId,
    actor,
    eventType: "INVITED",
    afterValue: { role: input.role, branch: branch.name, employmentType: input.employmentType },
    message: `Invited by ${actor.name} as ${input.role}.`,
    isHighImpact: true,
  });

  const whatsappShareUrl = input.sendVia.includes("WHATSAPP") && input.whatsapp
    ? `https://wa.me/${input.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
        `You've been invited to join ${await agencyDisplayPhrase(db)} team OS. Check your email (${email}) for your secure setup link.`,
      )}`
    : null;

  return { ok: true, staffId, whatsappShareUrl };
}

export async function loadInvitationHistory(db: Db): Promise<(StaffInvitationRow & { staffFullName: string })[]> {
  const { data, error } = await db
    .from("staff_invitations")
    .select("*, staff_profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new TeamPersistenceError("staff_invitations", "select", error);

  return (data ?? []).map((row: StaffInvitationRow & { staff_profiles: { full_name: string } | null }) => ({
    ...row,
    staffFullName: row.staff_profiles?.full_name ?? "",
  }));
}

export async function resendInvitation(db: Db, staffId: string, actor: TeamActor): Promise<InviteStaffResult> {
  const { data: profile, error: profileError } = await db
    .from("staff_profiles")
    .select("email, role, branch, employment_type, whatsapp")
    .eq("id", staffId)
    .maybeSingle();
  if (profileError) throw new TeamPersistenceError("staff_profiles", "select", profileError);
  if (!profile) return { ok: false, error: "Team member not found." };

  const admin = createAdminClient();
  const siteUrl = await getSiteUrl();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(profile.email, {
    redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/login?mode=setup")}`,
  });
  if (inviteError) return { ok: false, error: inviteError.message };

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: invitationError } = await db.from("staff_invitations").insert({
    staff_profile_id: staffId,
    email: profile.email,
    role: profile.role,
    branch: profile.branch,
    employment_type: profile.employment_type,
    invited_by: actor.id,
    invited_by_name: actor.name,
    sent_via: ["EMAIL"],
    status: "PENDING",
    expires_at: expiresAt,
  });
  if (invitationError) throw new TeamPersistenceError("staff_invitations", "insert", invitationError);

  await logStaffEvent(db, { staffId, actor, eventType: "INVITATION_RESENT", message: `Invitation resent by ${actor.name}.` });

  const whatsappShareUrl = profile.whatsapp
    ? `https://wa.me/${profile.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Your invitation to ${await agencyDisplayPhrase(db)} team OS has been resent. Check your email (${profile.email}) for the link.`,
      )}`
    : null;

  return { ok: true, staffId, whatsappShareUrl };
}

export async function revokeInvitation(
  db: Db,
  staffId: string,
  actor: TeamActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: profile, error: profileLookupError } = await db
    .from("staff_profiles")
    .select("status")
    .eq("id", staffId)
    .maybeSingle();
  if (profileLookupError) throw new TeamPersistenceError("staff_profiles", "select", profileLookupError);
  if (!profile) return { ok: true };

  // Never accepted — nothing meaningful happened on this account yet, so
  // delete the auth identity outright. `staff_profiles.id` cascades from
  // `auth.users(id)`, so this also removes the profile, the invitation and
  // any activity rows in one step, freeing the email address for a future
  // invite instead of leaving a DEACTIVATED profile that blocks it forever
  // (C6 of docs/modules/team-module-remediation-plan.md).
  if (profile.status === "INVITED" && hasAdminClient()) {
    const { error } = await createAdminClient().auth.admin.deleteUser(staffId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error: invitationError } = await db
    .from("staff_invitations")
    .update({ status: "REVOKED" })
    .eq("staff_profile_id", staffId)
    .eq("status", "PENDING");
  if (invitationError) throw new TeamPersistenceError("staff_invitations", "update", invitationError);

  const { error: profileError } = await db
    .from("staff_profiles")
    .update({ status: "DEACTIVATED", deactivated_by: actor.id, deactivated_at: new Date().toISOString(), deactivation_reason: "Invitation revoked before acceptance." })
    .eq("id", staffId)
    .eq("status", "INVITED");
  if (profileError) throw new TeamPersistenceError("staff_profiles", "update", profileError);

  await logStaffEvent(db, { staffId, actor, eventType: "INVITATION_REVOKED", message: `Invitation revoked by ${actor.name}.`, isHighImpact: true });

  return { ok: true };
}

/* ── Profile writes ───────────────────────────────────────────────────────── */

/**
 * Edit Profile — C2 of docs/modules/team-module-remediation-plan.md. Runs on the
 * plain session client: `can.editProfile` is Admin-only (`lib/access/team-access.ts`),
 * and `staff_profiles_write` already grants that role full write access, so
 * no elevated RPC is needed here the way invitation creation needed one.
 *
 * `branchId`, when given, is resolved to its display name the same way
 * `inviteStaff()` does — through the RLS-scoped session client, so a branch
 * id belonging to another agency simply resolves to nothing and the update
 * is refused, never trusted from the caller (H2).
 */
export async function updateStaffProfile(
  db: Db,
  input: UpdateStaffProfileInput,
  actor: TeamActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: before, error: beforeError } = await db
    .from("staff_profiles")
    .select("full_name, whatsapp, job_title, branch, branch_id, employment_type, access_starts_on, access_ends_on")
    .eq("id", input.staffId)
    .maybeSingle();
  if (beforeError) throw new TeamPersistenceError("staff_profiles", "select", beforeError);
  if (!before) return { ok: false, error: "Team member not found." };

  const payload: Record<string, unknown> = {};
  if (input.fullName !== undefined) payload.full_name = input.fullName;
  if (input.whatsapp !== undefined) payload.whatsapp = input.whatsapp || null;
  if (input.jobTitle !== undefined) payload.job_title = input.jobTitle || null;
  if (input.employmentType !== undefined) payload.employment_type = input.employmentType;
  if (input.accessStartsOn !== undefined) payload.access_starts_on = input.accessStartsOn || null;
  if (input.accessEndsOn !== undefined) payload.access_ends_on = input.accessEndsOn || null;

  if (input.branchId !== undefined) {
    const { data: branch, error: branchError } = await db
      .from("branches")
      .select("id, name")
      .eq("id", input.branchId)
      .maybeSingle();
    if (branchError) throw new TeamPersistenceError("branches", "select", branchError);
    if (!branch) return { ok: false, error: "Choose a valid branch." };
    payload.branch_id = branch.id;
    payload.branch = branch.name;
  }

  if (Object.keys(payload).length === 0) return { ok: true };

  const { data: updated, error } = await db
    .from("staff_profiles")
    .update(payload)
    .eq("id", input.staffId)
    .select("id")
    .maybeSingle();
  if (error) throw new TeamPersistenceError("staff_profiles", "update", error);
  assertRowUpdated(updated, "staff_profiles");

  await logStaffEvent(db, {
    staffId: input.staffId,
    actor,
    eventType: "PROFILE_UPDATED",
    beforeValue: before,
    afterValue: { ...before, ...payload },
    message: `${actor.name} updated the profile.`,
  });

  return { ok: true };
}

/* ── Role changes ─────────────────────────────────────────────────────────── */

export async function changeStaffRole(
  db: Db,
  staffId: string,
  newRole: string,
  actor: TeamActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: current, error: currentError } = await db
    .from("staff_profiles")
    .select("role")
    .eq("id", staffId)
    .maybeSingle();
  if (currentError) throw new TeamPersistenceError("staff_profiles", "select", currentError);
  if (!current) return { ok: false, error: "Team member not found." };
  if (current.role === newRole) return { ok: true };

  if (current.role === "ADMIN" && newRole !== "ADMIN") {
    const { count, error: adminCountError } = await db
      .from("staff_profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "ADMIN")
      .eq("status", "ACTIVE");
    if (adminCountError) throw new TeamPersistenceError("staff_profiles", "select", adminCountError);
    if ((count ?? 0) <= 1) {
      return { ok: false, error: "Cannot change the role of the last remaining Admin." };
    }
  }

  const { data: updated, error } = await db
    .from("staff_profiles")
    .update({ role: newRole })
    .eq("id", staffId)
    .select("id")
    .maybeSingle();
  if (error) throw new TeamPersistenceError("staff_profiles", "update", error);
  assertRowUpdated(updated, "staff_profiles");

  await logStaffEvent(db, {
    staffId,
    actor,
    eventType: "ROLE_CHANGED",
    beforeValue: { role: current.role },
    afterValue: { role: newRole },
    message: `${actor.name} changed the role from ${current.role} to ${newRole}.`,
    isHighImpact: true,
  });

  return { ok: true };
}

/* ── Account lifecycle ────────────────────────────────────────────────────── */

/**
 * Never deletes. Sets status, revokes sessions when the admin client is
 * configured (best-effort — see `hasAdminClient()`), and deliberately leaves
 * `staff_group_assignments` untouched: a Departure Group with a deactivated
 * owner still shows that owner's name, flagged, rather than losing the
 * assignment outright (D15 in the Team build plan).
 */
export async function deactivateStaff(
  db: Db,
  staffId: string,
  reason: string | undefined,
  actor: TeamActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: current, error: currentError } = await db
    .from("staff_profiles")
    .select("role, status")
    .eq("id", staffId)
    .maybeSingle();
  if (currentError) throw new TeamPersistenceError("staff_profiles", "select", currentError);
  if (!current) return { ok: false, error: "Team member not found." };
  if (current.status === "DEACTIVATED") return { ok: true };

  if (current.role === "ADMIN") {
    const { count, error: adminCountError } = await db
      .from("staff_profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "ADMIN")
      .eq("status", "ACTIVE");
    if (adminCountError) throw new TeamPersistenceError("staff_profiles", "select", adminCountError);
    if ((count ?? 0) <= 1) {
      return { ok: false, error: "Cannot deactivate the last remaining Admin." };
    }
  }

  const { data: updated, error } = await db
    .from("staff_profiles")
    .update({
      status: "DEACTIVATED",
      deactivated_by: actor.id,
      deactivated_at: new Date().toISOString(),
      deactivation_reason: reason || null,
    })
    .eq("id", staffId)
    .select("id")
    .maybeSingle();
  if (error) throw new TeamPersistenceError("staff_profiles", "update", error);
  assertRowUpdated(updated, "staff_profiles");

  if (hasAdminClient()) {
    try {
      await createAdminClient().auth.admin.signOut(staffId, "global");
    } catch {
      // Deactivation itself succeeded; a session-revocation failure should
      // not roll it back. `manageSessionsAndPasswords` gives Admin a manual
      // retry via "Revoke Sessions" if this silently failed.
    }
  }

  await logStaffEvent(db, {
    staffId,
    actor,
    eventType: "ACCOUNT_DEACTIVATED",
    message: reason ? `Deactivated by ${actor.name}: ${reason}` : `Deactivated by ${actor.name}.`,
    isHighImpact: true,
  });

  return { ok: true };
}

export async function reactivateStaff(db: Db, staffId: string, actor: TeamActor): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: current, error: currentError } = await db
    .from("staff_profiles")
    .select("status")
    .eq("id", staffId)
    .maybeSingle();
  if (currentError) throw new TeamPersistenceError("staff_profiles", "select", currentError);
  if (!current) return { ok: false, error: "Team member not found." };
  // Already reactivated (or never deactivated) — idempotent success, not a
  // failed write; the `.eq("status", "DEACTIVATED")` filter below would
  // legitimately match zero rows here, so this check has to come first,
  // ahead of `assertRowUpdated()`, or a merely-redundant click would report
  // the same "did the write actually land?" error a real RLS block does.
  if (current.status !== "DEACTIVATED") return { ok: true };

  const { data: updated, error } = await db
    .from("staff_profiles")
    .update({ status: "ACTIVE", deactivated_by: null, deactivated_at: null, deactivation_reason: null })
    .eq("id", staffId)
    .eq("status", "DEACTIVATED")
    .select("id")
    .maybeSingle();
  if (error) throw new TeamPersistenceError("staff_profiles", "update", error);
  assertRowUpdated(updated, "staff_profiles");

  await logStaffEvent(db, { staffId, actor, eventType: "ACCOUNT_REACTIVATED", message: `Reactivated by ${actor.name}.`, isHighImpact: true });

  return { ok: true };
}

export async function loadDeactivatedStaff(db: Db): Promise<TeamDirectoryRow[]> {
  const { data, error } = await db
    .from("team_directory_rows")
    .select("*")
    .eq("status", "DEACTIVATED")
    .order("full_name", { ascending: true });
  if (error) throw new TeamPersistenceError("team_directory_rows", "select", error);
  return (data ?? []) as TeamDirectoryRow[];
}

/**
 * Every Departure Group this person currently holds a live assignment on.
 * The one query `filterGroupsForRole()` needs to stop matching Guides by
 * display name (see the Team build plan's finding on `primary_guide_name`).
 */
export async function loadAssignedGroupIds(db: Db, staffId: string): Promise<string[]> {
  const { data, error } = await db
    .from("staff_group_assignments")
    .select("departure_group_id")
    .eq("staff_profile_id", staffId)
    .is("unassigned_at", null);
  if (error) throw new TeamPersistenceError("staff_group_assignments", "select", error);
  return [...new Set((data ?? []).map((row: { departure_group_id: string }) => row.departure_group_id))];
}

/** Active staff of one role — the picker behind "Assign Guide" / "Assign Departure Group". */
export async function loadActiveStaffByRole(db: Db, role: string): Promise<{ id: string; fullName: string }[]> {
  const { data, error } = await db
    .from("staff_profiles")
    .select("id, full_name")
    .eq("role", role)
    .eq("status", "ACTIVE")
    .order("full_name", { ascending: true });
  if (error) throw new TeamPersistenceError("staff_profiles", "select", error);
  return (data ?? []).map((row: { id: string; full_name: string }) => ({ id: row.id, fullName: row.full_name }));
}

/* ── Group assignments ────────────────────────────────────────────────────── */

/**
 * Responsibilities `departure_groups` has a dedicated `*_owner_*` / guide
 * column for. Assigning one of these replaces whoever previously held it —
 * a group has exactly one Primary Guide, one Operations Owner, and so on.
 * `BACKUP_GUIDE`, `BACKUP_OPERATIONS` and `MARKETING_OWNER` have no such
 * column and are many-to-many: several people can hold them at once (D3 in
 * the Team build plan).
 */
const SINGULAR_RESPONSIBILITIES = new Set(["PRIMARY_GUIDE", "OPERATIONS_OWNER", "VISA_OWNER", "FINANCE_OWNER"]);

function cacheColumnsFor(responsibility: string, staffId: string | null, staffName: string | null): Record<string, unknown> | null {
  switch (responsibility) {
    case "PRIMARY_GUIDE":
      return { primary_guide_id: staffId, primary_guide_name: staffName };
    case "OPERATIONS_OWNER":
      return { operations_owner_id: staffId, operations_owner_name: staffName };
    case "VISA_OWNER":
      return { visa_owner_id: staffId, visa_owner_name: staffName };
    case "FINANCE_OWNER":
      return { finance_owner_id: staffId, finance_owner_name: staffName };
    case "BACKUP_GUIDE":
      // Single free-text column — best-effort cache of the most recent backup guide.
      return { backup_guide_name: staffName };
    default:
      // BACKUP_OPERATIONS and MARKETING_OWNER: no cache column, `staff_group_assignments` is the only record.
      return null;
  }
}

async function logGroupAssignmentEvent(
  db: Db,
  input: {
    departureGroupId: string;
    actor: TeamActor;
    actionType: "STAFF_ASSIGNED" | "STAFF_UNASSIGNED";
    message: string;
  },
): Promise<void> {
  const { error } = await db.from("departure_group_activity_logs").insert({
    departure_group_id: input.departureGroupId,
    actor_id: input.actor.id,
    actor_name_snapshot: input.actor.name,
    action_type: input.actionType,
    entity_type: "GROUP",
    entity_id: input.departureGroupId,
    message: input.message,
    is_high_impact: true,
  });
  if (error) throw new TeamPersistenceError("departure_group_activity_logs", "insert", error);
}

export async function assignGroupToStaff(
  db: Db,
  input: { staffId: string; departureGroupId: string; responsibility: string },
  actor: TeamActor,
): Promise<{ ok: true; assignmentId: string } | { ok: false; error: string }> {
  const [{ data: staff, error: staffError }, { data: group, error: groupError }] = await Promise.all([
    db.from("staff_profiles").select("full_name, role").eq("id", input.staffId).maybeSingle(),
    db.from("departure_groups").select("group_name").eq("id", input.departureGroupId).maybeSingle(),
  ]);
  if (staffError) throw new TeamPersistenceError("staff_profiles", "select", staffError);
  if (groupError) throw new TeamPersistenceError("departure_groups", "select", groupError);
  if (!staff) return { ok: false, error: "Team member not found." };
  if (!group) return { ok: false, error: "Departure Group not found." };

  // A group has exactly one holder of a singular responsibility — release
  // whoever had it before this insert, so the assignment table never shows
  // two "current" Operations Owners at once.
  if (SINGULAR_RESPONSIBILITIES.has(input.responsibility)) {
    const { error: releaseError } = await db
      .from("staff_group_assignments")
      .update({ unassigned_at: new Date().toISOString() })
      .eq("departure_group_id", input.departureGroupId)
      .eq("responsibility", input.responsibility)
      .is("unassigned_at", null);
    if (releaseError) throw new TeamPersistenceError("staff_group_assignments", "update", releaseError);
  }

  const { data: inserted, error: insertError } = await db
    .from("staff_group_assignments")
    .upsert(
      {
        staff_profile_id: input.staffId,
        departure_group_id: input.departureGroupId,
        responsibility: input.responsibility,
        assigned_by: actor.id,
        assigned_by_name: actor.name,
        assigned_at: new Date().toISOString(),
        unassigned_at: null,
      },
      { onConflict: "departure_group_id,staff_profile_id,responsibility" },
    )
    .select("id")
    .single();
  if (insertError) throw new TeamPersistenceError("staff_group_assignments", "insert", insertError);

  const cacheColumns = cacheColumnsFor(input.responsibility, input.staffId, staff.full_name);
  if (cacheColumns) {
    const { error: cacheError } = await db.from("departure_groups").update(cacheColumns).eq("id", input.departureGroupId);
    if (cacheError) throw new TeamPersistenceError("departure_groups", "update", cacheError);
  }

  const message = `${actor.name} assigned ${staff.full_name} as ${input.responsibility.replaceAll("_", " ").toLowerCase()} on ${group.group_name}.`;

  await Promise.all([
    logStaffEvent(db, {
      staffId: input.staffId,
      actor,
      eventType: "GROUP_ASSIGNED",
      afterValue: { departureGroupId: input.departureGroupId, groupName: group.group_name, responsibility: input.responsibility },
      message,
      isHighImpact: true,
    }),
    logGroupAssignmentEvent(db, { departureGroupId: input.departureGroupId, actor, actionType: "STAFF_ASSIGNED", message }),
  ]);

  return { ok: true, assignmentId: inserted.id as string };
}

export async function unassignGroupFromStaff(
  db: Db,
  assignmentId: string,
  actor: TeamActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: assignment, error: assignmentError } = await db
    .from("staff_group_assignments")
    .select("staff_profile_id, departure_group_id, responsibility, unassigned_at")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignmentError) throw new TeamPersistenceError("staff_group_assignments", "select", assignmentError);
  if (!assignment) return { ok: false, error: "Assignment not found." };
  if (assignment.unassigned_at) return { ok: true };

  const [{ data: staff, error: staffError }, { data: group, error: groupError }] = await Promise.all([
    db.from("staff_profiles").select("full_name").eq("id", assignment.staff_profile_id).maybeSingle(),
    db.from("departure_groups").select("group_name, primary_guide_id, operations_owner_id, visa_owner_id, finance_owner_id").eq("id", assignment.departure_group_id).maybeSingle(),
  ]);
  if (staffError) throw new TeamPersistenceError("staff_profiles", "select", staffError);
  if (groupError) throw new TeamPersistenceError("departure_groups", "select", groupError);

  const { error } = await db
    .from("staff_group_assignments")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("id", assignmentId);
  if (error) throw new TeamPersistenceError("staff_group_assignments", "update", error);

  // Only clear the cache column if it still points at this person — an
  // assignment released after already being superseded (see
  // `SINGULAR_RESPONSIBILITIES` above) must not blank out the new holder.
  if (group) {
    const ownerIdColumn: Record<string, string> = {
      PRIMARY_GUIDE: "primary_guide_id",
      OPERATIONS_OWNER: "operations_owner_id",
      VISA_OWNER: "visa_owner_id",
      FINANCE_OWNER: "finance_owner_id",
    };
    const column = ownerIdColumn[assignment.responsibility];
    if (column && (group as Record<string, unknown>)[column] === assignment.staff_profile_id) {
      const nameColumn = column.replace("_id", "_name");
      const { error: clearError } = await db
        .from("departure_groups")
        .update({ [column]: null, [nameColumn]: null })
        .eq("id", assignment.departure_group_id);
      if (clearError) throw new TeamPersistenceError("departure_groups", "update", clearError);
    }
  }

  const message = `${actor.name} unassigned ${staff?.full_name ?? "a team member"} from ${group?.group_name ?? "the group"}.`;

  await Promise.all([
    logStaffEvent(db, {
      staffId: assignment.staff_profile_id,
      actor,
      eventType: "GROUP_UNASSIGNED",
      beforeValue: { departureGroupId: assignment.departure_group_id, responsibility: assignment.responsibility },
      message,
      isHighImpact: true,
    }),
    logGroupAssignmentEvent(db, { departureGroupId: assignment.departure_group_id, actor, actionType: "STAFF_UNASSIGNED", message }),
  ]);

  return { ok: true };
}

/** Departure Groups still open for operational assignment — the picker behind "Assign Departure Group". */
export async function loadAssignableDepartureGroups(
  db: Db,
): Promise<{ id: string; group_name: string; group_code: string; departure_date: string }[]> {
  const { data, error } = await db
    .from("departure_groups")
    .select("id, group_name, group_code, departure_date")
    .not("group_status", "in", "(DEPARTED,COMPLETED,CLOSED,CANCELLED)")
    .order("departure_date", { ascending: true });
  if (error) throw new TeamPersistenceError("departure_groups", "select", error);
  return data ?? [];
}

/* ── Seasonal access ──────────────────────────────────────────────────────── */

export async function extendSeasonalAccess(
  db: Db,
  staffId: string,
  newAccessEndsOn: string,
  actor: TeamActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: current, error: currentError } = await db
    .from("staff_profiles")
    .select("access_ends_on, status")
    .eq("id", staffId)
    .maybeSingle();
  if (currentError) throw new TeamPersistenceError("staff_profiles", "select", currentError);
  if (!current) return { ok: false, error: "Team member not found." };

  const wasExpired = current.access_ends_on !== null && current.access_ends_on < colomboDayKey();

  const { data: updated, error } = await db
    .from("staff_profiles")
    .update({
      access_ends_on: newAccessEndsOn,
      // A seasonal account that had already lapsed becomes reachable again the
      // instant its window is extended — getCurrentStaffRole() re-derives
      // SEASONAL_INACTIVE from the date, but a DEACTIVATED account still needs
      // an explicit reactivation, so only lift the block if it was date-driven.
      ...(wasExpired && current.status === "SEASONAL_INACTIVE" ? { status: "ACTIVE" } : {}),
    })
    .eq("id", staffId)
    .select("id")
    .maybeSingle();
  if (error) throw new TeamPersistenceError("staff_profiles", "update", error);
  assertRowUpdated(updated, "staff_profiles");

  await logStaffEvent(db, {
    staffId,
    actor,
    eventType: "ACCESS_EXTENDED",
    beforeValue: { accessEndsOn: current.access_ends_on },
    afterValue: { accessEndsOn: newAccessEndsOn },
    message: `${actor.name} extended access to ${newAccessEndsOn}.`,
  });

  return { ok: true };
}

/**
 * Best-effort review nudge: when a Departure Group is marked completed, flag
 * any still-active Seasonal guide assigned to it so an Admin sees a prompt to
 * extend or deactivate. Informational only — never blocks or rolls back the
 * group completion it is called from.
 */
export async function flagSeasonalGuidesForReview(db: Db, departureGroupId: string): Promise<void> {
  const { data: group } = await db.from("departure_groups").select("group_name").eq("id", departureGroupId).maybeSingle();

  const { data: assignments } = await db
    .from("staff_group_assignments")
    .select("staff_profile_id, responsibility, staff_profiles(full_name, employment_type, status)")
    .eq("departure_group_id", departureGroupId)
    .is("unassigned_at", null)
    .in("responsibility", ["PRIMARY_GUIDE", "BACKUP_GUIDE"]);

  type Row = {
    staff_profile_id: string;
    staff_profiles: { full_name: string; employment_type: string; status: string } | null;
  };

  const seasonalGuides = ((assignments ?? []) as unknown as Row[]).filter(
    (row) => row.staff_profiles?.employment_type === "SEASONAL" && row.staff_profiles?.status === "ACTIVE",
  );

  await Promise.all(
    seasonalGuides.map((row) =>
      db.from("staff_activity_logs").insert({
        staff_profile_id: row.staff_profile_id,
        actor_id: null,
        actor_name_snapshot: "System",
        event_type: "ACCESS_EXPIRED",
        message: `${group?.group_name ?? "A Departure Group"} was marked completed — review whether ${
          row.staff_profiles?.full_name ?? "this guide"
        }'s seasonal access should be extended or deactivated.`,
        is_high_impact: false,
      }),
    ),
  );
}

/**
 * Best-effort name → id resolution for the free-text task "Owner" fields in
 * Operations and Departure Groups. An exact, case-insensitive match against
 * an active staff member populates `departure_group_tasks.owner_id`; no
 * match leaves it `null` — the display name is stored either way, so nothing
 * regresses when it misses. Converting those inputs into a staff picker
 * (like `assign-guide-dialog.tsx`) is the complete fix; this is the
 * incremental one that needs no UI change.
 */
export async function resolveStaffIdByName(db: Db, fullName: string): Promise<string | null> {
  const trimmed = fullName.trim();
  if (!trimmed) return null;

  const { data, error } = await db
    .from("staff_profiles")
    .select("id")
    .ilike("full_name", trimmed)
    .eq("status", "ACTIVE")
    .limit(1)
    .maybeSingle();
  if (error) throw new TeamPersistenceError("staff_profiles", "select", error);
  return data?.id ?? null;
}

/* ── Tasks ────────────────────────────────────────────────────────────────── */

export interface StaffTaskWithGroup {
  id: string;
  title: string;
  category: string;
  due_at: string;
  status: string;
  departure_group_id: string;
  group_name: string;
}

/** Every open task this person owns — the profile's Tasks & Workload table. Requires `owner_id` to be populated (`resolveStaffIdByName`). */
export async function loadTasksForStaff(db: Db, staffId: string): Promise<StaffTaskWithGroup[]> {
  const { data, error } = await db
    .from("departure_group_tasks")
    .select("id, title, category, due_at, status, departure_group_id, departure_groups(group_name)")
    .eq("owner_id", staffId)
    .neq("status", "COMPLETE")
    .order("due_at", { ascending: true });
  if (error) throw new TeamPersistenceError("departure_group_tasks", "select", error);

  type Row = {
    id: string;
    title: string;
    category: string;
    due_at: string;
    status: string;
    departure_group_id: string;
    departure_groups: { group_name: string } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    due_at: row.due_at,
    status: row.status,
    departure_group_id: row.departure_group_id,
    group_name: row.departure_groups?.group_name ?? "—",
  }));
}

/* ── Activity & Security tab ──────────────────────────────────────────────── */

export interface MergedActivityRow {
  id: string;
  source: "STAFF" | "GROUP";
  actorName: string;
  message: string;
  isHighImpact: boolean;
  createdAt: string;
  groupName: string | null;
}

/**
 * Merges `staff_activity_logs` (account lifecycle, role changes, access
 * events) with `departure_group_activity_logs` where this person is the
 * actor (their day-to-day group work) into one feed, newest first — see the
 * Team build plan's D4. Each table is capped independently before the merge
 * so a very active group-work day cannot crowd out account-level events.
 */
export async function loadMergedActivityFeed(db: Db, staffId: string, cap: number): Promise<MergedActivityRow[]> {
  const [staffRes, groupRes] = await Promise.all([
    db
      .from("staff_activity_logs")
      .select("id, actor_name_snapshot, message, is_high_impact, created_at")
      .eq("staff_profile_id", staffId)
      .order("created_at", { ascending: false })
      .limit(cap),
    db
      .from("departure_group_activity_logs")
      .select("id, actor_name_snapshot, message, is_high_impact, created_at, departure_groups(group_name)")
      .eq("actor_id", staffId)
      .order("created_at", { ascending: false })
      .limit(cap),
  ]);
  if (staffRes.error) throw new TeamPersistenceError("staff_activity_logs", "select", staffRes.error);
  if (groupRes.error) throw new TeamPersistenceError("departure_group_activity_logs", "select", groupRes.error);

  type StaffRow = { id: string; actor_name_snapshot: string; message: string; is_high_impact: boolean; created_at: string };
  type GroupRow = StaffRow & { departure_groups: { group_name: string } | null };

  const staffRows: MergedActivityRow[] = ((staffRes.data ?? []) as StaffRow[]).map((row) => ({
    id: row.id,
    source: "STAFF",
    actorName: row.actor_name_snapshot,
    message: row.message,
    isHighImpact: row.is_high_impact,
    createdAt: row.created_at,
    groupName: null,
  }));

  const groupRows: MergedActivityRow[] = ((groupRes.data ?? []) as unknown as GroupRow[]).map((row) => ({
    id: row.id,
    source: "GROUP",
    actorName: row.actor_name_snapshot,
    message: row.message,
    isHighImpact: row.is_high_impact,
    createdAt: row.created_at,
    groupName: row.departure_groups?.group_name ?? null,
  }));

  return [...staffRows, ...groupRows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, cap);
}

/* ── Password & sessions ──────────────────────────────────────────────────── */

export async function sendPasswordReset(
  db: Db,
  staffId: string,
  actor: TeamActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: profile, error: profileError } = await db
    .from("staff_profiles")
    .select("email")
    .eq("id", staffId)
    .maybeSingle();
  if (profileError) throw new TeamPersistenceError("staff_profiles", "select", profileError);
  if (!profile) return { ok: false, error: "Team member not found." };

  const siteUrl = await getSiteUrl();
  const { error } = await db.auth.resetPasswordForEmail(profile.email, {
    redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/login?mode=reset")}`,
  });
  if (error) return { ok: false, error: error.message };

  await logStaffEvent(db, { staffId, actor, eventType: "PASSWORD_RESET_SENT", message: `${actor.name} sent a password reset link.` });

  return { ok: true };
}

export async function revokeSessions(
  db: Db,
  staffId: string,
  actor: TeamActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasAdminClient()) {
    return { ok: false, error: "Session revocation is not configured for this deployment." };
  }

  try {
    await createAdminClient().auth.admin.signOut(staffId, "global");
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Could not revoke sessions." };
  }

  await logStaffEvent(db, { staffId, actor, eventType: "SESSIONS_REVOKED", message: `${actor.name} revoked all sessions.`, isHighImpact: true });

  return { ok: true };
}
