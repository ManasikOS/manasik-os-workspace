import type { ReactNode } from "react";

/**
 * Root shell for the pilgrim-facing portal — deliberately its own route
 * group, sibling to `(main)` (staff) and `(auth)`, so none of the staff
 * sidebar/navigation chrome or `getCurrentStaffRole()` machinery leaks in
 * here. Auth/session/agency-availability checks live in
 * `app/(portal)/portal/layout.tsx` instead of here, so `/portal/login`
 * itself renders through this same shell without needing a session.
 */
export default function PortalRootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
    </div>
  );
}
