import "../globals.css";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Suspense } from "react";
import HeaderBar from "@/components/header-bar";
import RouteProgressBar from "@/components/route-progress-bar";
import RouteLoadingSkeleton from "@/components/route-loading-skeleton";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { redirect } from "next/navigation";
import { getSessionUser, touchSessionActivity } from "@/lib/dal";
import SuspendedPage from "@/app/(main)/suspended/page";
import { createClient } from "@/utils/supabase/server";
import HeaderNotificationBell, {
  HeaderNotificationBellPlaceholder,
} from "@/components/header-notification-bell";
import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import { listSearchablePagesForRole } from "@/lib/search/global-search-pages";
import { needsAgencyProvisioning } from "@/lib/onboarding/onboarding-routing";

/**
 * Overrides the root layout's tenant-neutral default with the signed-in
 * agency's own name (Phase 5 of docs/architecture/multi-tenancy-implementation-plan.md)
 * — the browser tab reads "Dashboard · Al-Noor Travels", not every
 * agency's staff seeing "Royal Al-Fathima Travels" regardless of who they
 * actually work for. `app/layout.tsx`'s `title.template` still applies;
 * this only supplies the piece before it.
 *
 * Best-effort: a denied role, a suspended agency, or a settings row that
 * hasn't landed yet all fall back to the parent's default rather than
 * failing metadata generation — the page itself already renders its own
 * "no access" or "suspended" state for those, and a wrong tab title is not
 * worth crashing that render over.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const supabase = createClient(await cookies());
    const { data } = await supabase
      .from("agency_settings")
      .select("agency_name")
      .eq("singleton", true)
      .maybeSingle();
    return data?.agency_name?.trim() ? { title: data.agency_name.trim() } : {};
  } catch {
    return {};
  }
}

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `getCurrentStaffRole()` alone never touches `touchLastActive()`'s
  // INVITED -> ACTIVE flip or last_active_at stamp, which live behind the
  // require*User helpers. Every other call site for that is a Server Action,
  // so a freshly invited person who signs in and simply *looks* at a page
  // (without submitting a form first) never got flipped out of INVITED — the
  // Team list kept showing "Invited" forever. This is the one place every
  // authenticated page in (main) passes through, so the side effect runs here
  // unconditionally, ahead of any role/capability gating below.
  //
  // The session check and the role lookup are independent, so they run
  // together. The activity touch reuses the profile facts the role lookup
  // already read, instead of selecting the row a second time.
  const [sessionUser, { role, name, staffId, agencySuspended, memberships, activity }] =
    await Promise.all([getSessionUser(), getCurrentStaffRole()]);
  if (!sessionUser) redirect("/login");
  // A confirmed signup that never reached provisioning (D1 in docs/onboarding/plan.md)
  // belongs to no agency yet: send them to /onboarding rather than an empty dashboard.
  if (needsAgencyProvisioning({ activity, memberships })) redirect("/onboarding");
  await touchSessionActivity(sessionUser.id, activity);

  if (agencySuspended) {
    return <SuspendedPage />;
  }

  return (
    <SidebarProvider className="flex-col h-screen custom-scroll">
      {/* Header spans the full width, above everything — the sidebar docks
          below it rather than pushing it aside (see SIDEBAR_HEADER_HEIGHT
          in components/ui/sidebar.tsx, which keeps the two in sync). */}
      <HeaderBar
        notificationBellSlot={
          staffId ? (
            <Suspense fallback={<HeaderNotificationBellPlaceholder />}>
              <HeaderNotificationBell staffId={staffId} />
            </Suspense>
          ) : (
            <HeaderNotificationBellPlaceholder />
          )
        }
        canViewInbox={capabilitiesForInbox(role).viewModule}
        searchablePages={listSearchablePagesForRole(role)}
      />
      <div className="flex flex-1 min-h-0 w-full">
        <AppSidebar
          role={role}
          memberships={memberships}
          name={name}
          staffId={staffId}
        />
        <main className="custom-scroll flex-1 w-full flex flex-col h-full overflow-hidden ">
          {/* `useSearchParams()` inside the bar needs its own boundary so it never blocks the page. */}
          <Suspense fallback={null}>
            <RouteProgressBar />
          </Suspense>
          <Suspense
            fallback={
              <div className="overflow-y-auto flex-1 custom-scroll bg-white dark:bg-background">
                <div className="px-10 pb-5 pt-6 min-h-full">
                  <RouteLoadingSkeleton />
                </div>
              </div>
            }
          >
            <div id="layout-scroll" className="overflow-y-auto flex-1 custom-scroll bg-white dark:bg-background">
              <div className="px-10 pb-5 pt-6 bg-linear-to-br from-[#009473]/5 dark:from-[#009473]/5 via-[#6bc1ae]/4 dark:via-[#6bc1ae]/3 to-orange-200/40 dark:to-orange-950/10 min-h-full">
                {children}
              </div>
            </div>
          </Suspense>
        </main>
      </div>
    </SidebarProvider>
  );
}
