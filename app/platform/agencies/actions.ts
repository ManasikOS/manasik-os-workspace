"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/dal";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { z } from "zod";

export interface AgencyListRow {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  createdAt: string;
  staffCount: number;
  activeGroupCount: number;
}

/**
 * Lists every agency on the platform. `agencies` itself is readable by an
 * operator through the `agencies_platform_write` policy (it is `for all`,
 * so SELECT is included) — the session client is enough for that one
 * table. The per-agency counts reach into tables an operator has no direct
 * RLS grant on, so those go through the service-role client, explicitly
 * filtered by `agency_id` for each row — same discipline `lib/agent/*`
 * already follows for its own service-role reads.
 */
export async function listAgencies(): Promise<AgencyListRow[]> {
  await requireUser();
  const supabase = createClient(await cookies());

  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, name, slug, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load agencies: ${error.message}`);
  if (!agencies?.length) return [];

  const admin = createAdminClient();
  const rows = await Promise.all(
    agencies.map(async (a) => {
      const [{ count: staffCount }, { count: activeGroupCount }] = await Promise.all([
        admin
          .from("agency_members")
          .select("id", { count: "exact", head: true })
          .eq("agency_id", a.id)
          .eq("status", "ACTIVE"),
        admin
          .from("departure_groups")
          .select("id", { count: "exact", head: true })
          .eq("agency_id", a.id)
          .not("group_status", "in", "(COMPLETED,CANCELLED,CLOSED)"),
      ]);

      return {
        id: a.id,
        name: a.name,
        slug: a.slug,
        status: a.status,
        createdAt: a.created_at,
        staffCount: staffCount ?? 0,
        activeGroupCount: activeGroupCount ?? 0,
      };
    }),
  );

  return rows;
}

export interface AgencyDetail {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  createdAt: string;
  staff: { id: string; fullName: string; email: string; role: string; status: string }[];
  activeGroupCount: number;
}

export interface AgencyPlanAssignment { planCode: string; status: string; plans: Array<{ code: string; name: string }> }

export async function loadAgencyPlanAssignment(agencyId: string): Promise<AgencyPlanAssignment | null> {
  await requireUser();
  const session = createClient(await cookies());
  const { data: visibleAgency } = await session.from("agencies").select("id").eq("id", agencyId).maybeSingle();
  if (!visibleAgency) return null;
  const admin = createAdminClient();
  const [{ data: subscription }, { data: plans }] = await Promise.all([
    admin.from("agency_subscriptions").select("plan_code,status").eq("agency_id", agencyId).maybeSingle(),
    admin.from("plans").select("code,name").eq("active", true).order("monthly_price"),
  ]);
  if (!subscription) return null;
  return { planCode: subscription.plan_code as string, status: subscription.status as string, plans: (plans ?? []) as Array<{ code: string; name: string }> };
}

const agencyPlanAssignmentSchema = z.object({ agencyId: z.string().uuid(), planCode: z.enum(["STARTER","GROWTH","PROFESSIONAL","ENTERPRISE"]) }).strict();

export async function assignAgencyPlanAction(input: unknown): Promise<AgencyActionResult> {
  await requireUser();
  const parsed = agencyPlanAssignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid agency plan." };
  const session = createClient(await cookies());
  const { data: visibleAgency } = await session.from("agencies").select("id").eq("id", parsed.data.agencyId).maybeSingle();
  if (!visibleAgency) return { ok: false, error: "Agency not found or platform access denied." };
  const { error } = await createAdminClient().from("agency_subscriptions").update({ plan_code: parsed.data.planCode, status: "ACTIVE" }).eq("agency_id", parsed.data.agencyId);
  if (error) return { ok: false, error: "Could not assign the plan." };
  revalidatePath(`/platform/agencies/${parsed.data.agencyId}`);
  return { ok: true };
}

/** Loads one agency's detail and logs the operator's reason for looking (Phase 4's audit trail). */
export async function loadAgencyDetail(agencyId: string, reason: string): Promise<AgencyDetail | null> {
  await requireUser();
  const supabase = createClient(await cookies());

  const { error: logError } = await supabase.rpc("log_support_access", {
    p_agency_id: agencyId,
    p_reason: reason,
    p_action: "VIEW",
  });
  if (logError) throw new Error(`Support access was not logged: ${logError.message}`);

  const { data: agency, error } = await supabase
    .from("agencies")
    .select("id, name, slug, status, created_at")
    .eq("id", agencyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load agency: ${error.message}`);
  if (!agency) return null;

  const admin = createAdminClient();
  const [{ data: staffRows }, { count: activeGroupCount }] = await Promise.all([
    admin
      .from("staff_profiles")
      .select("id, full_name, email, role, status")
      .eq("agency_id", agencyId)
      .order("full_name"),
    admin
      .from("departure_groups")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agencyId)
      .not("group_status", "in", "(COMPLETED,CANCELLED,CLOSED)"),
  ]);

  return {
    id: agency.id,
    name: agency.name,
    slug: agency.slug,
    status: agency.status,
    createdAt: agency.created_at,
    staff: (staffRows ?? []).map((s) => ({
      id: s.id,
      fullName: s.full_name,
      email: s.email,
      role: s.role,
      status: s.status,
    })),
    activeGroupCount: activeGroupCount ?? 0,
  };
}

export type AgencyActionResult = { ok: true } | { ok: false; error: string };

export async function suspendAgencyAction(agencyId: string, reason: string): Promise<AgencyActionResult> {
  await requireUser();
  const supabase = createClient(await cookies());

  const { error } = await supabase.rpc("suspend_agency", { p_agency_id: agencyId, p_reason: reason });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/platform/agencies/${agencyId}`);
  revalidatePath("/platform/agencies");
  return { ok: true };
}

export async function resumeAgencyAction(agencyId: string, reason: string): Promise<AgencyActionResult> {
  await requireUser();
  const supabase = createClient(await cookies());

  const { error } = await supabase.rpc("resume_agency", { p_agency_id: agencyId, p_reason: reason });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/platform/agencies/${agencyId}`);
  revalidatePath("/platform/agencies");
  return { ok: true };
}

export type ProvisionAgencyResult = { ok: true; agencyId: string } | { ok: false; error: string };

/**
 * Creates a new agency: an `auth.users` row for the owner via the admin
 * API (same invite-only posture as Team's `inviteStaff()`), then
 * `provision_agency()` in one transaction for everything else (F5).
 */
export async function provisionAgencyAction(input: {
  agencyName: string;
  ownerFullName: string;
  ownerEmail: string;
}): Promise<ProvisionAgencyResult> {
  await requireUser();

  const name = input.agencyName.trim();
  const ownerFullName = input.ownerFullName.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();

  if (!name) return { ok: false, error: "Agency name is required." };
  if (!ownerFullName) return { ok: false, error: "Owner name is required." };
  if (!ownerEmail) return { ok: false, error: "Owner email is required." };

  const supabase = createClient(await cookies());
  const { data: isOperator } = await supabase.rpc("is_platform_admin");
  if (!isOperator) return { ok: false, error: "Not a platform operator." };

  const admin = createAdminClient();
  const siteUrl = await getSiteUrl();
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(ownerEmail, {
    redirectTo: `${siteUrl}/login?mode=setup`,
  });
  if (inviteError || !invited?.user) {
    return {
      ok: false,
      error:
        inviteError?.code === "email_exists"
          ? "That email is already registered on the platform. Provisioning a brand-new agency needs a fresh owner email for now."
          : (inviteError?.message ?? "Could not send the owner's invitation email."),
    };
  }

  const { data: agencyId, error: provisionError } = await admin.rpc("provision_agency", {
    p_name: name,
    p_slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    p_owner_user_id: invited.user.id,
    p_owner_full_name: ownerFullName,
    p_owner_email: ownerEmail,
  });
  if (provisionError || !agencyId) {
    return { ok: false, error: provisionError?.message ?? "Could not provision the agency." };
  }

  const { error: logError } = await supabase.rpc("log_support_access", {
    p_agency_id: agencyId as string,
    p_reason: `Provisioned via platform console for owner ${ownerEmail}.`,
    p_action: "PROVISION",
  });
  if (logError) {
    // The agency exists and the owner is invited — a failed audit write is
    // not a reason to report the whole operation as failed.
    console.error("log_support_access after provision_agency failed:", logError.message);
  }

  revalidatePath("/platform/agencies");
  return { ok: true, agencyId: agencyId as string };
}
