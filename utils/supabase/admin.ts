import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

/**
 * Service-role Supabase client for `auth.admin.*` calls — inviting a staff
 * member, revoking sessions, resetting a password on someone else's behalf.
 *
 * `import "server-only"` plus never exporting the key itself is what keeps
 * this out of the browser bundle. Every other client in `utils/supabase/`
 * runs on the anon/publishable key and is safe to reach from a Server
 * Component; this one is not, and must only be called from Server Actions.
 *
 * Throws rather than silently no-opping when the key is missing, so a
 * misconfigured deployment fails loudly at the one call site that needs it
 * instead of pretending an invite succeeded.
 */
export function createAdminClient() {
  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured — staff invitations, password resets and session " +
        "revocation are unavailable until it is set. See docs/modules/team-module-implementation-plan.md §D6.",
    );
  }

  return createSupabaseClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** True when the admin client can be constructed — gates security-panel fields that need it (D14). */
export function hasAdminClient(): boolean {
  return Boolean(supabaseUrl && secretKey);
}
