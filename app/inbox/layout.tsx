import { redirect } from "next/navigation";
import { Suspense } from "react";

import SuspendedPage from "@/app/(main)/suspended/page";
import RouteProgressBar from "@/components/route-progress-bar";
import { getSessionUser, touchSessionActivity } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";

/** Authenticated Inbox shell without the main application's header and sidebar. */
export default async function InboxStandaloneLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [sessionUser, { agencySuspended, activity }] = await Promise.all([
    getSessionUser(),
    getCurrentStaffRole(),
  ]);
  if (!sessionUser) redirect("/login");
  await touchSessionActivity(sessionUser.id, activity);

  if (agencySuspended) return <SuspendedPage />;

  return (
    <main className="h-dvh overflow-hidden bg-background">
      <Suspense fallback={null}>
        <RouteProgressBar />
      </Suspense>
      {children}
    </main>
  );
}
