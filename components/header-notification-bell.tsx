import { cookies } from "next/headers";
import { Bell } from "lucide-react";

import NotificationBell from "@/components/notification-bell";
import { createClient } from "@/utils/supabase/server";
import {
  getUnreadNotificationCount,
  listStaffNotifications,
} from "@/lib/data/staff-notifications";

/**
 * Loads the bell's data on its own, so the page around it never waits on it.
 * It is rendered inside a `<Suspense>` boundary by the layout and streams in
 * after the shell.
 *
 * Best-effort: a fresh account with no `staff_profiles` row yet, or a
 * transient error, shows an empty bell rather than breaking the header.
 */
export default async function HeaderNotificationBell({ staffId }: { staffId: string }) {
  let unreadNotificationCount = 0;
  let notifications: Awaited<ReturnType<typeof listStaffNotifications>> = [];

  try {
    const supabase = createClient(await cookies());
    [unreadNotificationCount, notifications] = await Promise.all([
      getUnreadNotificationCount(staffId, supabase),
      listStaffNotifications(staffId, supabase),
    ]);
  } catch {
    // Notifications are additive — the rest of the app still has to load.
  }

  return (
    <NotificationBell
      initialUnreadCount={unreadNotificationCount}
      initialNotifications={notifications}
    />
  );
}

/** Same footprint as the real bell, so the header does not shift when it streams in. */
export function HeaderNotificationBellPlaceholder() {
  return (
    <span
      className="size-8.5 rounded-full inline-flex items-center justify-center text-muted-foreground/50"
      aria-hidden="true"
    >
      <Bell className="size-4" />
    </span>
  );
}
