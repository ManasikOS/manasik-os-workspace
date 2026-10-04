import type { ReactNode } from "react";

/**
 * Root shell for the agent-facing portal — its own route group, sibling to
 * `(main)` (staff), `(auth)`, and `(portal)` (pilgrims), so none of the
 * staff sidebar/navigation chrome or staff-role machinery leaks in here.
 * Auth/session checks live in `app/(agent-portal)/agent-portal/(authenticated)/layout.tsx`
 * instead of here, so `/agent-portal/login` renders through this same shell
 * without needing a session.
 */
export default function AgentPortalRootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
    </div>
  );
}
