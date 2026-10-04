import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

/**
 * Security headers, applied to every route.
 *
 * CSP allows `'unsafe-inline'` on `script-src` because the App Router injects
 * its own hydration/streaming bootstrap scripts without a nonce; tightening
 * that requires wiring a per-request nonce through `proxy.ts` and is tracked
 * separately (docs/architecture/production-readiness-plan.md P0-7). `connect-src` is
 * scoped to Supabase, since that is the only external origin the app talks
 * to from the browser (see `utils/supabase/client.ts`).
 *
 * In development only, `'unsafe-eval'` and a localhost `connect-src` are
 * added — Next's dev server uses `eval()` for React's debug stack
 * reconstruction and a WebSocket for Fast Refresh, neither of which exist in
 * a production build. Without this, `next dev` silently loses Fast Refresh
 * and DevTools' component stacks. Both `ws:`/`http:` and `wss:`/`https:`
 * variants are allowed, since `npm run dev` now serves over HTTPS (see the
 * `certificates/` dev cert and package.json's `dev` script) — Meta's
 * Embedded Signup refuses to run `FB.login()` from a plain HTTP page, so
 * local dev needs TLS even before it reaches production.
 */
const isDev = process.env.NODE_ENV !== "production";

/**
 * The origin the browser talks to for Supabase (REST, Storage, Realtime), when it is not a hosted `*.supabase.co` project: a Supabase custom domain
 * or a self-hosted stack. Without it the browser blocks every request and the Realtime WebSocket to that host. Taken from the same
 * NEXT_PUBLIC_SUPABASE_URL the client is built with, so it is exactly one explicit origin, never a wildcard.
 */
function configuredSupabaseOrigins(): string {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (url.hostname.endsWith(".supabase.co")) return "";
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const websocketScheme = url.protocol === "https:" ? "wss:" : "ws:";
    return ` ${url.origin} ${websocketScheme}//${url.host}`;
  } catch {
    return "";
  }
}
const supabaseCustomOrigins = configuredSupabaseOrigins();

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  // Native audio uses media-src, not connect-src; without this it falls back
  // to default-src 'self' and blocks the Inbox's signed Storage recordings.
  "media-src 'self' https://*.supabase.co/storage/v1/object/sign/inbox-attachments/",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${supabaseCustomOrigins}${isDev ? " ws://localhost:* http://localhost:* wss://localhost:* https://localhost:*" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * Meta's WhatsApp Embedded Signup runs `FB.login()` in the browser — it loads
 * `connect.facebook.net`, opens a `facebook.com` iframe, and posts back to
 * `graph.facebook.com`. Scoped to the one route that runs the signup popup
 * (see docs/modules/whatsapp-ai-agent-implementation-plan.md F2 / §6.0) rather than
 * widening the global CSP.
 */
const whatsappConnectCsp = [
  "default-src 'self'",
  // 'unsafe-eval' is NOT dev-only here, unlike the global CSP above — the
  // Facebook JS SDK itself uses eval()-family calls internally (documented,
  // widely-reported CSP incompatibility: javaspring.net/blog/facebook-
  // javascript-sdk-and-csp), so production needs this too on this one
  // scoped route or FB.login() fails opaquely. This is exactly why the
  // allowance is scoped to only /management/settings/integrations rather
  // than loosened globally.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  // *.fbcdn.net serves the profile pictures / assets Meta's own signup
  // dialog renders inside its iframe.
  "img-src 'self' data: blob: https://*.supabase.co https://*.facebook.com https://*.fbcdn.net",
  "font-src 'self' data:",
  // https://*.facebook.com (not just graph.facebook.com/connect.facebook.net)
  // because the JS SDK fetch()es its own telemetry — e.g.
  // www.facebook.com/platform/impression.php — as an ordinary part of
  // running FB.login(), not something this app calls directly.
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.facebook.com https://*.fbcdn.net https://connect.facebook.net${supabaseCustomOrigins}${isDev ? " ws://localhost:* http://localhost:* wss://localhost:* https://localhost:*" : ""}`,
  // Widened to any facebook.com subdomain, matching the postMessage origin
  // check in whatsapp-connect-card.tsx (F6) — Meta doesn't always serve the
  // signup popup/iframe from exactly www.facebook.com.
  "frame-src https://*.facebook.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // `next dev` otherwise rewrites AGENTS.md and CLAUDE.md with a generic stub on every start, replacing this repository's own agent rules.
  agentRules: false,
  /* config options here */

  // Lets a production build (e.g. for bundle-size checks) write somewhere other
  // than `.next` so it cannot clobber a running `next dev`. Unset in normal use.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // `pdf-parse` (lib/data/ticket-pdf-extraction.ts) wraps `pdfjs-dist`, which
  // touches Node-specific internals pdfjs was never designed to survive being
  // bundled/transformed by webpack or Turbopack — left un-externalized, the
  // bundler silently mangles it and `PDFParse.getText()` throws inside the
  // Server Action, which looks like "the free PDF text extraction doesn't
  // work" when it's actually never running at all (the ticket-matching flow
  // then falls back to the AI review, which is why it looked like every PDF
  // was going through OpenRouter regardless). This keeps both packages as
  // plain `require()`s Node resolves normally instead of bundling them.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],

  // Barrel-import packages: rewrites `import { X } from "pkg"` to load only
  // the modules actually used, which trims dev compile time and bundle size.
  // `lucide-react` is already optimized by Next by default.
  experimental: {
    optimizePackageImports: ["recharts", "motion", "reicon-react"],
  },

  devIndicators: false,
  images: {
    remotePatterns: [
      { hostname: "img.icons8.com" },
      // Agency logo, served from the private `agency-assets` Supabase Storage
      // bucket via a short-lived signed URL — see
      // app/(main)/management/settings/branding/logo-storage.ts. The bucket
      // is tenant-isolated (docs/architecture/multi-tenancy-implementation-plan.md Phase
      // 1), so no object is reachable through the old /object/public/ path.
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/sign/**" },
    ],
  },
  async headers() {
    const commonHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
    ];

    // Two Content-Security-Policy headers on one response are BOTH enforced, and a script must satisfy every
    // one of them. So the broad rule must not match the integrations route at all: otherwise its strict
    // script-src blocks https://connect.facebook.net there even though the scoped policy below allows it
    // ("Loading the script ... violates the following Content Security Policy directive").
    return [
      {
        source: "/((?!management/settings/integrations).*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          ...commonHeaders,
        ],
      },
      {
        source: "/management/settings/integrations/:path*",
        headers: [
          { key: "Content-Security-Policy", value: whatsappConnectCsp },
          ...commonHeaders,
        ],
      },
    ];
  },
  async redirects() {
    return [
      // WhatsApp Embedded Signup returns to the site root (the redirect URI already registered in the Meta app)
      // with ?code=…&state=wa_…; hand that to the callback route. Must come before the plain "/" rule.
      {
        source: "/",
        has: [{ type: "query", key: "state", value: "wa_.*" }],
        destination: "/api/oauth/whatsapp/callback",
        permanent: false,
      },
      // Messenger connect (Facebook Login for Business) returns the same way, with state=ms_…
      {
        source: "/",
        has: [{ type: "query", key: "state", value: "ms_.*" }],
        destination: "/api/oauth/messenger/callback",
        permanent: false,
      },
      // Instagram connect (its own Facebook Login for Business configuration) returns the same way, with state=ig_…
      {
        source: "/",
        has: [{ type: "query", key: "state", value: "ig_.*" }],
        destination: "/api/oauth/instagram/callback",
        permanent: false,
      },
      {
        source: "/",
        destination: "/dashboard",
        permanent: false,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
 // For all available options, see:
 // https://www.npmjs.com/package/@sentry/webpack-plugin#options

 org: "manasikos",

 project: "javascript-nextjs",

 // Only print logs for uploading source maps in CI
 silent: !process.env.CI,

 // For all available options, see:
 // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

 // Upload a larger set of source maps for prettier stack traces (increases build time)
 widenClientFileUpload: true,

 // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
 // This can increase your server load as well as your hosting bill.
 // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
 // side errors will fail.
 tunnelRoute: "/monitoring",

 webpack: {
   // Tree-shaking options for reducing bundle size
   treeshake: {
     // Automatically tree-shake Sentry logger statements to reduce bundle size
     removeDebugLogging: true,
   },
 },
});
