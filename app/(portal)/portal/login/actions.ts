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
 * Sends a magic-link sign-in email — only when the address matches a
 * pilgrim who has actually been invited to the portal (Relationships →
 * Pilgrim Portal). Reports success either way, same as the staff magic-link
 * flow (`sendMagicLinkAction` in app/(auth)/actions.ts) — this form must
 * never be usable to check whether a given email belongs to a pilgrim.
 *
 * `shouldCreateUser: true` (the default) is deliberate here, unlike the
 * staff flow: a pilgrim has no pre-provisioned auth.users row the way an
 * invited staff member does, so the account is created on first sign-in.
 * This is safe because gaining a Supabase session grants zero data access
 * on its own — every RLS policy in 20261026090000_pilgrim_portal_auth.sql
 * requires pilgrims.portal_user_id to already be linked, which only
 * happens for an email that was actually invited (see
 * lib/data/pilgrim-portal-auth.ts's linkPortalPilgrimIfNeeded).
 */
export async function requestPortalMagicLinkAction(email: string): Promise<ActionResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return { ok: false, error: "Enter a valid email address." };

  const admin = createAdminClient();
  const { data: pilgrim } = await admin.from("pilgrims").select("id").ilike("email", trimmed).maybeSingle();

  if (pilgrim) {
    const { data: account } = await admin
      .from("portal_accounts")
      .select("status")
      .eq("pilgrim_id", pilgrim.id)
      .maybeSingle();

    if (account && account.status !== "REVOKED") {
      const supabase = await createClient(await cookies());
      const siteUrl = await getSiteUrl();
      await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/portal")}`,
        },
      });
    }
  }

  return { ok: true };
}
