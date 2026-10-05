/**
 * What an OAuth callback shows when the provider's redirect carries an `error` (SEC-10 in docs/progress/2026-10-05-inbox-security-and-bug-audit.md).
 *
 * The error branch of a callback has to skip the state check: when a person cancels, there is no code to bind to the state. So anyone can build
 * a link to the callback with `?error=x&error_description=<anything>`, and the callback used to copy that description into the message shown on
 * the signed-in admin's real Integrations page ("Your account is locked: call +94..."). The text is now ours, never the URL's:
 * a fixed sentence chosen from the provider and whether the person declined, with the provider's own words kept in the server log only.
 */

export type OAuthProviderName = "WhatsApp" | "Messenger" | "Instagram" | "Meta Ads" | "Google Ads";

/** The standard OAuth code for "the person pressed Cancel". Providers use others for their own failures. */
const DECLINED_CODES = new Set(["access_denied", "user_denied", "user_cancelled_login", "user_cancelled_authorize"]);

/** One short line with no control characters, safe to write to a log. */
function forLog(value: string | null | undefined, max: number): string {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

/** Whether a callback's query carries an error from the provider, whichever of the two parameters it used. */
export function hasOAuthProviderError(input: { error?: string | null; description?: string | null }): boolean {
  return Boolean(input.error || input.description);
}

/**
 * The message to show for a provider error, and the only place the provider's words go: a warning in the server log (capped, single line).
 * Never returns any part of `error` or `description`.
 */
export function oauthProviderErrorMessage(input: { provider: OAuthProviderName; error?: string | null; description?: string | null }): string {
  const code = forLog(input.error, 60).toLowerCase();
  console.warn(`${input.provider} sign-in returned an error:`, JSON.stringify({ error: forLog(input.error, 60), description: forLog(input.description, 300) }));
  if (DECLINED_CODES.has(code)) {
    return `The ${input.provider} connection was cancelled. Click Connect to try again.`;
  }
  return `The ${input.provider} connection did not complete. Click Connect to try again, and ask an admin to check the logs if it keeps happening.`;
}
