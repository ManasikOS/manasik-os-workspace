import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/site-url";
import { createClient } from "@/utils/supabase/server";

/**
 * PKCE callback. Supabase's default email templates (and any OAuth provider)
 * come back here with `?code=`, which is exchanged for a session.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  // Supabase reports rejected links through query params rather than a code.
  if (searchParams.get("error")) {
    redirect("/login?error=link_expired");
  }

  if (!code) {
    redirect("/login?error=link_invalid");
  }

  const supabase = createClient(await cookies());
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    redirect("/login?error=link_expired");
  }

  redirect(next);
}
