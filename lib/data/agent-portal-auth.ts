/**
 * Agent Portal authentication (v1) — email magic-link sign-in backed by
 * Supabase's own `auth.users`, linked to `sales_agents.portal_user_id`. See
 * `supabase/migrations/20261030090000_agent_portal_auth.sql` for the RLS
 * model this relies on.
 *
 * The link between a fresh Supabase auth session and a `sales_agents` row
 * can only be written with the admin client: before it exists, the
 * signed-in user has no RLS access to `sales_agents` at all (they are
 * neither staff nor yet a linked portal agent) — the same chicken-and-egg
 * problem `linkPortalPilgrimIfNeeded` solves in `lib/data/pilgrim-portal-auth.ts`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface PortalAgentSession {
  id: string;
  agencyId: string;
  name: string;
  agencyName: string | null;
  status: string;
}

/**
 * Links the given auth user to the sales agent invited under this email, if
 * one exists and isn't linked to someone else already. Idempotent — safe to
 * call on every portal page load. Does nothing (and is not an error) when no
 * invited agent matches this email, e.g. an arbitrary visitor who signed
 * themselves in with an email that was never invited.
 */
export async function linkPortalAgentIfNeeded(admin: Db, userId: string, email: string): Promise<void> {
  const { data: agent, error } = await admin
    .from("sales_agents")
    .select("id, status, portal_invited_at")
    .ilike("contact_email", email)
    .is("portal_user_id", null)
    .maybeSingle();
  if (error || !agent) return;

  // Only an explicitly invited, still-active agent can complete sign-in — an
  // email that matches an agent record but was never invited stays unlinked.
  if (!agent.portal_invited_at || agent.status !== "ACTIVE") return;

  await admin.from("sales_agents").update({ portal_user_id: userId }).eq("id", agent.id);
}

/** The signed-in portal agent's own record, via their session client (RLS-scoped) — null if not linked (or not signed in at all). */
export async function getPortalAgentSession(client: Db): Promise<PortalAgentSession | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const { data, error } = await client
    .from("sales_agents")
    .select("id, agency_id, name, agency_name, status")
    .eq("portal_user_id", user.id)
    .maybeSingle();
  if (error || !data) return null;

  return {
    id: data.id,
    agencyId: data.agency_id,
    name: data.name,
    agencyName: data.agency_name,
    status: data.status,
  };
}
