import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

/**
 * Platform operator console — internal tooling, not a tenant surface.
 * `is_platform_admin()` is a security-definer RPC (Phase 4 of
 * docs/architecture/multi-tenancy-implementation-plan.md), safe to call from the
 * session-scoped client even though `platform_admins` itself has no RLS
 * policy granting `authenticated` any access at all.
 *
 * A non-operator gets a 404, not a 403 or a redirect — this route group's
 * existence is not something to advertise to ordinary staff.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  const supabase = createClient(await cookies());
  const { data: isOperator } = await supabase.rpc("is_platform_admin");

  if (!isOperator) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 px-8 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Platform console</p>
      </header>
      <main className="px-8 py-8">{children}</main>
    </div>
  );
}
