/**
 * Written on sign in and read back by `proxy.ts`. When the user did not tick
 * "Keep me signed in", the Supabase auth cookies are downgraded to
 * browser-session cookies so they disappear when the browser closes.
 */
export const REMEMBER_COOKIE = "rf.remember";

/** Drops the lifetime hints so the browser treats the cookie as session-only. */
export function toSessionCookieOptions<
  T extends { maxAge?: number; expires?: Date | number | string },
>(options: T): T {
  const sessionOnly = { ...options };
  delete sessionOnly.maxAge;
  delete sessionOnly.expires;
  return sessionOnly;
}
