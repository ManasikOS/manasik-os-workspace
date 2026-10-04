import { cookies } from "next/headers";

import { getPortalSession } from "@/lib/data/pilgrim-portal-auth";
import { listPortalBookings } from "@/lib/data/pilgrim-portal-repository";
import { createClient } from "@/utils/supabase/server";

import PortalDashboardView from "./components/portal-dashboard-view";

export default async function PortalDashboardPage() {
  const supabase = createClient(await cookies());
  const session = await getPortalSession(supabase);
  if (!session) return null; // Guarded by the (authenticated) layout — this should be unreachable.

  const bookings = await listPortalBookings(supabase);

  return <PortalDashboardView fullName={session.fullName} reference={session.reference} bookings={bookings} />;
}
