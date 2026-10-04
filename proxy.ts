import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { REMEMBER_COOKIE, toSessionCookieOptions } from "@/lib/auth-cookie";
import { withTiming } from "@/lib/timing";
import { loginReturnPath } from "@/lib/login-return-path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Routes reachable without a session. */
const PUBLIC_ROUTES = ["/login", "/signup", "/portal/login", "/agent-portal/login"];
/** Supabase email links land here and must run before any session exists. */
const AUTH_ROUTES = ["/auth/confirm", "/auth/callback"];
/**
 * Server-to-server routes with no browser session: Meta's webhook and the
 * cron drain. They carry no Supabase cookies, so refreshing a session here
 * only wastes a round trip — and a redirect response would break Meta's
 * webhook contract (it expects 200/401/403, never a 302 to /login). See
 * docs/modules/whatsapp-ai-agent-implementation-plan.md F1.
 */
const MACHINE_ROUTES = ["/api/webhooks", "/api/cron", "/api/health", "/monitoring"];
/**
 * Legal/compliance pages Meta's App Review requires to be reachable without
 * logging in (Privacy Policy, Terms, Data Deletion Instructions — see
 * docs/modules/whatsapp-meta-connection-implementation-plan.md §4 M2). Unlike
 * PUBLIC_ROUTES below (login/signup), a signed-in staff member must also be
 * able to view these — they are not an auth *alternative* to redirect away
 * from once a session exists, just ordinary public pages.
 */
const ALWAYS_ACCESSIBLE_ROUTES = ["/legal"];

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (MACHINE_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next({ request });
  }
  if (ALWAYS_ACCESSIBLE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  // When "Keep me signed in" was left unchecked, refreshed tokens must stay
  // browser-session cookies instead of being re-persisted for 400 days.
  const persistSession = request.cookies.get(REMEMBER_COOKIE)?.value !== "0";

  const supabase = createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, responseHeaders) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(
            name,
            value,
            persistSession ? options : toSessionCookieOptions(options),
          ),
        );
        Object.entries(responseHeaders ?? {}).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value),
        );
      },
    },
  });

  // Refreshes an expiring token and tells us who is signed in. Do not put any
  // logic between creating the client and this call.
  //
  // `getClaims()` verifies the JWT locally against cached signing keys instead
  // of calling Supabase Auth on every request like `getUser()` does — this
  // runs before every navigation, so that round trip was the single most
  // repeated cost in the app. The proxy is only an optimistic gate; Server
  // Actions still verify with `requireUser()` (lib/dal.ts).
  const { data: claimsData } = await withTiming("proxy.getClaims", () => supabase.auth.getClaims());
  const user = claimsData?.claims?.sub ? { id: claimsData.claims.sub } : null;

  if (AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    return supabaseResponse;
  }

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (!user && !isPublicRoute) {
    // A pilgrim hitting /portal/* or an agent hitting /agent-portal/* with no
    // session belongs at their own login page, never the staff /login page
    // (or each other's).
    const loginPath = pathname.startsWith("/agent-portal")
      ? "/agent-portal/login"
      : pathname.startsWith("/portal")
        ? "/portal/login"
        : "/login";
    const loginUrl = new URL(loginPath, request.url);
    const returnPath = loginReturnPath(pathname, request.nextUrl.search);
    if (returnPath) {
      loginUrl.searchParams.set("next", returnPath);
    }
    return withAuthCookies(NextResponse.redirect(loginUrl), supabaseResponse);
  }

  // A recovery or Team-invitation link signs the user in before they choose
  // a password, so /login?mode=reset and /login?mode=setup both have to stay
  // reachable while a session exists — without this, an invited user who has
  // just confirmed their invite gets bounced straight to /dashboard and can
  // never reach the "set your password" screen at all.
  const isChoosingNewPassword = searchParams.get("mode") === "reset" || searchParams.get("mode") === "setup";

  if (user && isPublicRoute && !isChoosingNewPassword) {
    // /portal/login and /agent-portal/login are the public routes where
    // "already signed in" means a pilgrim or agent, not staff — sending them
    // to /dashboard would just bounce them straight into a staff
    // permission-denied screen.
    const destination = pathname.startsWith("/agent-portal")
      ? "/agent-portal"
      : pathname.startsWith("/portal")
        ? "/portal"
        : "/dashboard";
    return withAuthCookies(
      NextResponse.redirect(new URL(destination, request.url)),
      supabaseResponse,
    );
  }

  return supabaseResponse;
}

/** Carries refreshed session cookies over onto a redirect response. */
function withAuthCookies(
  response: NextResponse,
  source: NextResponse,
): NextResponse {
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files, so the session is
     * refreshed on each navigation.
     */
    "/((?!_next/static|_next/image|favicon.ico|logos|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
