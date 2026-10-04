/**
 * Pilgrim Portal authentication (v1) — email magic-link sign-in backed by
 * Supabase's own `auth.users`, linked to `pilgrims.portal_user_id`. See
 * `supabase/migrations/20261026090000_pilgrim_portal_auth.sql` for the RLS
 * model this relies on.
 *
 * The link between a fresh Supabase auth session and a `pilgrims` row can
 * only be written with the admin client: before it exists, the signed-in
 * user has no RLS access to `pilgrims` at all (they are neither staff nor
 * yet a linked portal pilgrim) — the same chicken-and-egg problem
 * `inviteStaff()` solves the same way in `lib/data/team-repository.ts`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface PortalPilgrimSession {
  id: string;
  agencyId: string;
  fullName: string;
  reference: string;
  journeyStatus: string;
}

/**
 * Links the given auth user to the pilgrim invited under this email, if one
 * exists and isn't linked to someone else already. Idempotent — safe to
 * call on every portal page load. Does nothing (and is not an error) when
 * no invited pilgrim matches this email, e.g. an arbitrary visitor who
 * signed themselves in with an email that was never invited.
 */
export async function linkPortalPilgrimIfNeeded(admin: Db, userId: string, email: string): Promise<void> {
  const { data: pilgrim, error } = await admin
    .from("pilgrims")
    .select("id, portal_user_id")
    .ilike("email", email)
    .is("portal_user_id", null)
    .maybeSingle();
  if (error || !pilgrim) return;

  const { data: account } = await admin
    .from("portal_accounts")
    .select("id, status")
    .eq("pilgrim_id", pilgrim.id)
    .maybeSingle();
  // Only an explicitly invited pilgrim can complete sign-in — an email that
  // matches a pilgrim record but was never invited stays unlinked.
  if (!account || account.status === "REVOKED") return;

  await admin.from("pilgrims").update({ portal_user_id: userId }).eq("id", pilgrim.id);

  const now = new Date().toISOString();
  await admin
    .from("portal_accounts")
    .update({
      status: "ACTIVE",
      activated_at: account.status === "ACTIVE" ? undefined : now,
      last_login_at: now,
      updated_at: now,
    })
    .eq("id", account.id);

  await admin.from("portal_access_events").insert({
    pilgrim_id: pilgrim.id,
    event_type: account.status === "INVITED" ? "ACTIVATED" : "LOGIN",
    actor_name: "Portal sign-in",
  });
}

/** The signed-in portal pilgrim's own record, via their session client (RLS-scoped) — null if not linked (or not signed in at all). */
export async function getPortalSession(client: Db): Promise<PortalPilgrimSession | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const { data, error } = await client
    .from("pilgrims")
    .select("id, agency_id, full_name, reference, journey_status")
    .eq("portal_user_id", user.id)
    .maybeSingle();
  if (error || !data) return null;

  return {
    id: data.id,
    agencyId: data.agency_id,
    fullName: data.full_name,
    reference: data.reference,
    journeyStatus: data.journey_status,
  };
}

/** Whether the portal is switched on for this pilgrim's agency (agency_settings.portal_active — the Danger Zone kill switch). Read via admin client since a portal pilgrim has no staff-level RLS access to agency_settings. */
export async function isPortalActiveForAgency(admin: Db, agencyId: string): Promise<boolean> {
  const { data } = await admin
    .from("agency_settings")
    .select("portal_active")
    .eq("agency_id", agencyId)
    .eq("singleton", true)
    .maybeSingle();
  return Boolean(data?.portal_active);
}
