/**
 * Public, unauthenticated legal pages — Privacy Policy, Terms of Service,
 * Data Deletion Instructions. Required by Meta's App Review before
 * submitting for Advanced Access on whatsapp_business_management /
 * whatsapp_business_messaging (see docs/whatsapp-meta-connection-
 * implementation-plan.md §4 M2) and reachable without logging in — see the
 * ALWAYS_ACCESSIBLE_ROUTES entry in proxy.ts.
 *
 * Deliberately outside the (main) and (auth) route groups so it inherits
 * neither's layout or auth expectations — only the root app/layout.tsx
 * (fonts/theming, no session check).
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <a href="/legal" className="text-sm text-muted-foreground hover:underline">
          ← Hajj &amp; Umrah CRM — Legal
        </a>
        <div className="mt-6 flex flex-col gap-4 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1 [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </div>
      </div>
    </div>
  );
}
