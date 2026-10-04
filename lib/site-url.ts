import { headers } from "next/headers";

/**
 * Absolute origin of the current deployment, used to build the links that
 * Supabase puts inside magic-link and password-recovery emails.
 *
 * Set `NEXT_PUBLIC_SITE_URL` in production; the header fallback keeps local
 * development and preview deployments working without extra configuration.
 */
export async function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "localhost:3000";
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${host}`;
}

/**
 * Only allow same-origin, single-slash paths so a crafted `next=` parameter in
 * an email link can never bounce the user to another site.
 */
export function safeRedirectPath(path: string | null | undefined, fallback = "/dashboard") {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return fallback;
  }
  return path;
}
