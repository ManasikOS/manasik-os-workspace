import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { getPortalAgentSession, linkPortalAgentIfNeeded } from "@/lib/data/agent-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

/**
 * Guards everything under `/agent-portal` except `/agent-portal/login`,
 * which is a sibling route outside this `(authenticated)` group
 * specifically so it never hits this same auth requirement. Two checks, in
 * order: is there a session at all; is it linked to an invited, active
 * sales agent (auto-links on first visit after a successful magic-link
 * sign-in).
 */
export default async function AgentPortalAuthenticatedLayout({ children }: { children: ReactNode }) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/agent-portal/login");

  const admin = createAdminClient();
  if (user.email) {
    await linkPortalAgentIfNeeded(admin, user.id, user.email);
  }

  const session = await getPortalAgentSession(supabase);
  if (!session) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background p-6 text-sm">
        <p className="font-medium text-foreground">We couldn&apos;t find your portal access</p>
        <p className="text-muted-foreground">
          This email isn&apos;t recognised as an active agent portal invitation. Contact your travel agency if
          you believe this is a mistake.
        </p>
      </div>
    );
  }

  if (session.status !== "ACTIVE") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background p-6 text-sm">
        <p className="font-medium text-foreground">Portal access suspended</p>
        <p className="text-muted-foreground">Your travel agency has temporarily suspended your portal access.</p>
      </div>
    );
  }

  return <>{children}</>;
}
