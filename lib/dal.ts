import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/utils/supabase/server";
import { withTiming } from "@/lib/timing";

/**
 * Session helpers for Server Components, Server Actions and Route Handlers.
 * `proxy.ts` is only an optimistic gate — anything that reads or writes data
 * should call `requireUser()` so the check lives next to the data.
 *
 * `cache` keeps it to one Supabase round trip per render pass.
 */
export const getUser = cache(async () => {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await withTiming("auth.getUser (verified)", () => supabase.auth.getUser());

  return user;
});

/**
 * The signed-in user as far as page rendering needs to know: id and email,
 * read from the access token's verified claims.
 *
 * `getClaims()` checks the JWT signature locally against the project's cached
 * signing keys — no round trip to Supabase Auth — whereas `getUser()` always
 * makes one (hundreds of ms on every navigation). The trade-off is that a
 * session revoked server-side is still honoured until its token expires, so
 * this is for reading and rendering only: every Server Action and Route
 * Handler still starts with `requireUser()`, which does the verified lookup.
 * (Projects still on a legacy symmetric JWT secret fall back to a server
 * lookup inside `getClaims()` itself, so this is correct either way.)
 */
export interface SessionUser {
  id: string;
  email: string | null;
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = createClient(await cookies());
  const { data, error } = await withTiming("auth.getClaims", () => supabase.auth.getClaims());
  if (error || !data?.claims?.sub) return null;

  const email = data.claims.email;
  return { id: data.claims.sub, email: typeof email === "string" ? email : null };
});

/**
 * Throttle for `touchLastActive` — `staff_profiles.last_active_at` is the
 * Team page's only view into "is this person still around" (there is no
 * access to `auth.sessions`), so it only needs to be roughly right, not
 * written on every request.
 */
const LAST_ACTIVE_THROTTLE_MS = 15 * 60 * 1000;

/**
 * Stamps `staff_profiles.last_active_at` and, for a first-time sign-in after
 * an invite, flips `status` from `INVITED` to `ACTIVE`. Runs via `after()` so
 * it never adds latency to the request that triggered it, and is best-effort:
 * a user with no `staff_profiles` row yet (or a database hiccup) is not an
 * error here — `getCurrentStaffRole()` is the actual access gate.
 *
 * The two writes route through `touch_own_activity()` / `accept_own_invitation()`
 * — security-definer RPCs, not direct table writes. `staff_profiles_write` /
 * `staff_invitations_write` only grant ADMIN, so a direct update from this
 * function was silently denied for every other role and the account could
 * never leave `INVITED` (B2 of docs/modules/team-module-remediation-plan.md). The
 * RPCs let a person touch only their OWN row's activity fields — never role,
 * branch or another account.
 *
 * `cookieStore` is a REQUIRED parameter, resolved by the caller before this
 * runs — not `await cookies()` inside the `after()` callback below. Next.js
 * throws "Route ... used cookies() inside after(). This is not supported."
 * if you do that, which silently aborted every single call this function
 * ever made (caught by the `catch` below and only ever logged, never
 * surfaced) — the actual root cause of `INVITED` never clearing to `ACTIVE`
 * (§10 of docs/modules/team-module-remediation-plan.md, found from a live server log).
 */
const touchLastActive = cache(
  async (
    userId: string,
    cookieStore: Awaited<ReturnType<typeof cookies>>,
    knownStatus?: string | null,
    knownLastActiveAt?: string | null,
  ) => {
  // Fire-and-forget: same best-effort semantics as `after()` but without the
  // App Router-only dependency. The void prevents unhandled-rejection warnings;
  // errors are caught inside the async IIFE.
  void (async () => {
    try {
      const supabase = createClient(cookieStore);

      // A caller that already loaded the profile (the layout, via
      // `getCurrentStaffRole()`) passes its status and last-active stamp so
      // this does not spend a query re-reading the same row on every
      // navigation; `requireUser()` has no profile yet and reads it here.
      const profile =
        knownStatus !== undefined
          ? { status: knownStatus, last_active_at: knownLastActiveAt ?? null }
          : (
              await supabase
                .from("staff_profiles")
                .select("status, last_active_at")
                .eq("id", userId)
                .maybeSingle()
            ).data;

      if (!profile) return;

      const isStale =
        !profile.last_active_at ||
        Date.now() - new Date(profile.last_active_at).getTime() > LAST_ACTIVE_THROTTLE_MS;

      if (profile.status === "INVITED") {
        const { error } = await supabase.rpc("touch_own_activity");
        if (error) {
          console.error("touch_own_activity (INVITED -> ACTIVE) failed", error);
          return;
        }

        const { error: acceptError } = await supabase.rpc("accept_own_invitation");
        if (acceptError) console.error("accept_own_invitation failed", acceptError);

        await supabase.from("staff_activity_logs").insert({
          staff_profile_id: userId,
          actor_id: userId,
          actor_name_snapshot: "System",
          event_type: "ACCOUNT_ACTIVATED",
          message: "Invitation accepted — account activated.",
        });
        return;
      }

      if (isStale) {
        const { error } = await supabase.rpc("touch_own_activity");
        if (error) console.error("touch_own_activity (last_active_at) failed", error);
      }
    } catch (cause) {
      // Best-effort activity tracking. Never block or fail the request over
      // it — but do log, so a denial like B2 doesn't go unnoticed again (D1).
      console.error("touchLastActive failed", cause);
    }
  })();
  },
);

export async function requireUser() {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  // Resolved here, outside touchLastActive's after() callback — see that
  // function's doc comment for why this can't move inside it.
  const cookieStore = await cookies();
  await touchLastActive(user.id, cookieStore);

  return user;
}

/**
 * Layout-side counterpart of `requireUser()`'s activity side effect: stamps
 * last-active and flips INVITED -> ACTIVE using the profile facts the layout
 * already loaded, so it costs no extra read. `activity` is null when the
 * account has no profile row, in which case there is nothing to touch.
 * Never a gate for a mutation — those call `requireUser()`.
 */
export async function touchSessionActivity(
  userId: string,
  activity: { status: string | null; lastActiveAt: string | null } | null,
) {
  if (!activity) return;
  const cookieStore = await cookies();
  await touchLastActive(userId, cookieStore, activity.status, activity.lastActiveAt);
}
