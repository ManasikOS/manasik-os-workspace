"use server";

import { cookies } from "next/headers";

import { getSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Sends a magic-link sign-in email — only when the address matches a sales
 * agent who has actually been invited to the portal (Relationships → Agent
 * Portal). Reports success either way, same as the pilgrim/staff magic-link
 * flows — this form must never be usable to check whether a given email
 * belongs to an agent.
 *
 * `shouldCreateUser: true` (the default) is deliberate here: an agent has no
 * pre-provisioned auth.users row, so the account is created on first
 * sign-in. This is safe because gaining a Supabase session grants zero data
 * access on its own — every RLS policy in
 * 20261030090000_agent_portal_auth.sql requires sales_agents.portal_user_id
 * to already be linked, which only happens for an email that was actually
 * invited (see lib/data/agent-portal-auth.ts's linkPortalAgentIfNeeded).
 */
export async function requestAgentPortalMagicLinkAction(email: string): Promise<ActionResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return { ok: false, error: "Enter a valid email address." };

  const admin = createAdminClient();
  const { data: agent } = await admin
    .from("sales_agents")
    .select("id, status, portal_invited_at")
    .ilike("contact_email", trimmed)
    .maybeSingle();

  if (agent && agent.status === "ACTIVE" && agent.portal_invited_at) {
    const supabase = await createClient(await cookies());
    const siteUrl = await getSiteUrl();
    await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/agent-portal")}`,
      },
    });
  }

  return { ok: true };
}
