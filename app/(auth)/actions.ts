"use server";

import { createServerClient } from "@supabase/ssr";
import type { AuthError, EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { REMEMBER_COOKIE, toSessionCookieOptions } from "@/lib/auth-cookie";
import { getSiteUrl, safeRedirectPath } from "@/lib/site-url";
import {
  emailSchema,
  resetPasswordSchema,
  signInSchema,
  signupSchema,
  toFieldErrorState,
  type AuthActionState,
} from "@/lib/validations/auth";
import { createClient } from "@/utils/supabase/server";
import { checkAndRecordSignupAttempt } from "@/lib/onboarding/signup-attempts";
import { createAdminClient } from "@/utils/supabase/admin";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** Supabase client that writes session cookies that die with the browser. */
function createSessionOnlyClient(cookieStore: CookieStore) {
  return createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, toSessionCookieOptions(options)),
          );
        } catch {
          // Called from a Server Component — proxy.ts refreshes the session.
        }
      },
    },
  });
}

function friendlyMessage(error: AuthError) {
  switch (error.code) {
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Confirm your email address before signing in.";
    case "user_banned":
      return "This account has been suspended. Contact your agency administrator.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
    case "otp_expired":
      return "That link has expired. Request a new one.";
    case "same_password":
      return "Choose a password you have not used before.";
    case "weak_password":
      return "That password is too weak. Try a longer one.";
    case "session_not_found":
    case "session_expired":
      return "Your session expired. Request a new link and try again.";
    default:
      return error.message || "Something went wrong. Please try again.";
  }
}

/** Email + password sign in. Used with `useActionState`. */
export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    remember: formData.get("remember") ?? undefined,
  });

  if (!parsed.success) {
    return toFieldErrorState(parsed.error);
  }

  const { email, password, remember } = parsed.data;
  const cookieStore = await cookies();
  const supabase = remember
    ? createClient(cookieStore)
    : createSessionOnlyClient(cookieStore);

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: "error", message: friendlyMessage(error), email };
  }

  cookieStore.set(REMEMBER_COOKIE, remember ? "1" : "0", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: 400 * 24 * 60 * 60 } : {}),
  });

  redirect(safeRedirectPath(formData.get("next")?.toString()));
}

/** Passwordless sign in — "Continue with a secure email link". */
export async function sendMagicLinkAction(input: {
  email: string;
}): Promise<AuthActionState> {
  const parsed = emailSchema.safeParse(input);

  if (!parsed.success) {
    return toFieldErrorState(parsed.error);
  }

  const { email } = parsed.data;
  const supabase = createClient(await cookies());
  const siteUrl = await getSiteUrl();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Accounts are provisioned by an agency administrator, never self-signup.
      shouldCreateUser: false,
      emailRedirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/dashboard")}`,
    },
  });

  // "Signups not allowed for otp" means the address has no account. Report
  // success anyway so the form cannot be used to enumerate staff emails.
  if (error && error.code !== "otp_disabled") {
    return { status: "error", message: friendlyMessage(error), email };
  }

  return { status: "success", email };
}

/** Step 1 of the reset flow: email the recovery link. */
export async function sendPasswordResetAction(input: {
  email: string;
}): Promise<AuthActionState> {
  const parsed = emailSchema.safeParse(input);

  if (!parsed.success) {
    return toFieldErrorState(parsed.error);
  }

  const { email } = parsed.data;
  const supabase = createClient(await cookies());
  const siteUrl = await getSiteUrl();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/login?mode=reset")}`,
  });

  if (error) {
    return { status: "error", message: friendlyMessage(error), email };
  }

  return { status: "success", email };
}

/** How long a recovery-link session may be used to set a new password. Matches
 *  the window a user realistically needs to open the email and type a
 *  password, not how long the underlying session cookie happens to live. */
const RECOVERY_WINDOW_MS = 15 * 60 * 1000;

/**
 * True only when the *current* session was minted by an email link
 * (password recovery, Team invitation, or magic link) within
 * `RECOVERY_WINDOW_MS`, verified from the JWT's `amr` (auth methods
 * reference) claim rather than trusted from the caller. Without this,
 * `updatePasswordAction` would accept password changes from *any* live
 * session — an unlocked laptop would be a full account takeover with no
 * knowledge of the current password.
 *
 * Checked against `"otp"` — GoTrue records that `amr` method for every
 * `verifyOtp()`-derived session regardless of the `type` passed in
 * (`recovery`, `invite`, `magiclink` all come back as `"otp"` in practice;
 * confirmed from a live invite session's decoded JWT, not from the
 * client-library type definitions, which only list the OAuth/password/MFA
 * methods and let anything else through as a bare string). `"recovery"` and
 * `"invite"` are kept alongside it in case a future GoTrue version reports
 * the more specific value — belt and suspenders, not the load-bearing
 * check. Accepting a magic-link-derived `"otp"` session here too is
 * intentional, not a widening of the hole this guards: proving control of
 * the inbox is exactly the same bar a recovery link clears, and no dialog in
 * this app calls `updatePasswordAction` from a magic-link session anyway
 * (only `mode=reset`/`mode=setup` render `reset-password-dialog.tsx`).
 * The Team module's Set Password screen (`mode=setup`) reuses this same
 * action for a newly invited user — see
 * docs/modules/team-module-remediation-plan.md B1.
 */
async function hasRecentRecoveryAuth(
  supabase: ReturnType<typeof createClient>,
): Promise<boolean> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return false;

  const amr = data.claims.amr;
  if (!amr) return false;

  const entries = Array.isArray(amr) ? amr : [];
  const cutoff = Date.now() / 1000 - RECOVERY_WINDOW_MS / 1000;
  const acceptedMethods = new Set(["otp", "recovery", "invite"]);

  return entries.some((entry) => {
    if (typeof entry === "string") return false; // no timestamp to bound — reject rather than trust
    return acceptedMethods.has(entry.method) && entry.timestamp >= cutoff;
  });
}

/**
 * Step 2 of the reset flow — and, identically, step 2 of accepting a Team
 * invitation (`mode=setup`): the recovery/invite link has already exchanged
 * itself for a session, so `updateUser` is authorised by that session, but
 * only for the short window after the link was used. Any other live session
 * is refused.
 */
export async function updatePasswordAction(input: {
  password: string;
  confirmPassword: string;
}): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse(input);

  if (!parsed.success) {
    return toFieldErrorState(parsed.error);
  }

  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      status: "error",
      message: "Your link expired. Request a new one.",
    };
  }

  if (!(await hasRecentRecoveryAuth(supabase))) {
    return {
      status: "error",
      message: "Your link expired. Request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { status: "error", message: friendlyMessage(error) };
  }

  return { status: "success" };
}

/**
 * Performs the actual OTP verification / PKCE code exchange for a magic
 * link, password-recovery link, or Team invitation — called only from a
 * genuine click on `/auth/confirm`'s "Confirm" button, never from the GET
 * request that lands there.
 *
 * This is the click-to-confirm mitigation for a real failure mode: email
 * providers and corporate mail-security scanners (Gmail's phishing scanner,
 * Outlook Safe Links, etc.) automatically fetch links found in incoming
 * email to check them for safety — including GET requests. Supabase auth
 * tokens are single-use, so if the GET itself verified the token (as the old
 * `app/auth/confirm/route.ts` did), an automated prefetch silently burns it
 * before the real person ever clicks, and they land on a link that says
 * "expired" despite never having used it. Moving verification behind a
 * button click (a `<form action={...}>` submission, not a plain link) means
 * an automated GET-only prefetch can no longer consume the token — only an
 * actual user gesture can.
 *
 * This only closes the gap for links using the `{{ .TokenHash }}` email
 * template format, which route the click directly to this app's own
 * `/auth/confirm` (see app/(auth)/README.md). The stock `{{ .ConfirmationURL }}`
 * template points at Supabase's own `/auth/v1/verify` endpoint first, which
 * verifies (and can be prefetched) before this app is ever involved — no
 * code on this side can protect that path. Both shapes are still accepted
 * here for backward compatibility; only the token-hash shape gets the
 * anti-prefetch benefit.
 */
export async function confirmAuthLinkAction(input: {
  tokenHash?: string;
  type?: string;
  code?: string;
  next?: string;
}): Promise<AuthActionState> {
  const next = safeRedirectPath(input.next);
  const supabase = createClient(await cookies());

  let error: AuthError | null = null;
  if (input.tokenHash && input.type) {
    ({ error } = await supabase.auth.verifyOtp({
      type: input.type as EmailOtpType,
      token_hash: input.tokenHash,
    }));
  } else if (input.code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(input.code));
  } else {
    return { status: "error", message: "That link is missing its confirmation code. Request a new one." };
  }

  if (error) {
    console.error("[auth] confirmAuthLinkAction failed", { type: input.type, code: error.code, status: error.status, message: error.message });
    return {
      status: "error",
      message: "That link has expired or was already used. Request a new one.",
    };
  }

  // Session cookies are now set; land on the page the email asked for.
  redirect(next);
}

/**
 * Self-serve agency signup — see docs/architecture/multi-tenancy-implementation-plan.md
 * Phase 5 / D6. Never calls `supabase.auth.signUp()`: this project's
 * Supabase Auth has public sign-ups disabled (app/(auth)/README.md §4),
 * and this reuses the invite path that already works regardless of that
 * setting. Provisioning the agency does not happen here — only after the
 * invite email is confirmed, in app/(auth)/onboarding/page.tsx — so an
 * unverified email can never bring a tenant into existence.
 */
export async function signupAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (process.env.SIGNUP_MODE !== "open") {
    return { status: "error", message: "Self-serve signup is not open on this deployment." };
  }

  const parsed = signupSchema.safeParse({
    agencyName: formData.get("agencyName"),
    ownerFullName: formData.get("ownerFullName"),
    email: formData.get("email"),
    countryCode: formData.get("countryCode") ?? undefined,
  });
  if (!parsed.success) {
    return toFieldErrorState(parsed.error);
  }

  const { agencyName, ownerFullName, email, countryCode } = parsed.data;
  const admin = createAdminClient();

  const limit = await checkAndRecordSignupAttempt(admin, email);
  if (!limit.allowed) {
    return { status: "error", message: limit.message, email };
  }

  // The unique index is a partial one (email where unconsumed), which
  // PostgREST's upsert on_conflict can't target directly — so a repeat
  // attempt with the same email (typo'd agency name, lost the first email) is
  // handled explicitly: update the still-open row if one exists, insert a
  // fresh one otherwise. Emails are stored lower-cased, so the match is an
  // exact `eq`, never `ilike` (where `_` and `%` would act as wildcards).
  const { data: openRow } = await admin
    .from("pending_agency_signups")
    .select("id")
    .eq("email", email)
    .is("consumed_at", null)
    .maybeSingle();

  const stagedFields = {
    agency_name: agencyName,
    owner_full_name: ownerFullName,
    country_code: countryCode ?? null,
  };
  const { error: pendingError } = openRow
    ? await admin
        .from("pending_agency_signups")
        // A repeat attempt restarts the 7-day validity window.
        .update({ ...stagedFields, expires_at: new Date(Date.now() + SIGNUP_VALIDITY_MS).toISOString() })
        .eq("id", openRow.id)
    : await admin.from("pending_agency_signups").insert({ email, ...stagedFields });
  if (pendingError) {
    return { status: "error", message: "Something went wrong. Please try again.", email };
  }

  return sendSignupLink(admin, email, Boolean(openRow));
}

/**
 * "Send it again" on the signup confirmation screen. Only works for a signup
 * that is still staged and unexpired, and counts against the same rate limits
 * as the first request.
 */
export async function resendSignupLinkAction(input: { email: string }): Promise<AuthActionState> {
  if (process.env.SIGNUP_MODE !== "open") {
    return { status: "error", message: "Self-serve signup is not open on this deployment." };
  }

  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) {
    return toFieldErrorState(parsed.error);
  }

  const { email } = parsed.data;
  const admin = createAdminClient();

  const limit = await checkAndRecordSignupAttempt(admin, email);
  if (!limit.allowed) {
    return { status: "error", message: limit.message, email };
  }

  const { data: openRow } = await admin
    .from("pending_agency_signups")
    .select("id")
    .eq("email", email)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!openRow) {
    return {
      status: "error",
      message: "We could not find a signup waiting for that email. Start again to create your workspace.",
      email,
    };
  }

  return sendSignupLink(admin, email, true);
}

/** How long a staged signup stays valid — keep equal to the column default in 20261205090000. */
const SIGNUP_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sends the confirmation email for a staged signup. First tries the invite
 * (creates the auth user). If that user already exists *and* this signup is
 * still open, the invite was sent before and is being asked for again, so a
 * secure sign-in link that lands on /onboarding is sent instead. An existing
 * account with no open signup is a genuine "already registered".
 */
async function sendSignupLink(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  hasOpenSignup: boolean,
): Promise<AuthActionState> {
  const siteUrl = await getSiteUrl();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/onboarding`,
  });

  if (!inviteError) {
    return { status: "success", email };
  }

  if (inviteError.code === "email_exists") {
    if (!hasOpenSignup) {
      return {
        status: "error",
        message: "That email already has an account on the platform. Sign in instead, or use a different address.",
        email,
      };
    }
    const supabase = createClient(await cookies());
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/onboarding")}`,
      },
    });
    if (otpError) {
      return { status: "error", message: friendlyMessage(otpError), email };
    }
    return { status: "success", email };
  }

  return { status: "error", message: inviteError.message, email };
}

export async function signOutAction() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  await supabase.auth.signOut();
  cookieStore.delete(REMEMBER_COOKIE);

  redirect("/login");
}
