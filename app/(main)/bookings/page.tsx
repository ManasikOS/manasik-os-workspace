import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  listAllBookings,
  listOpenGroupsForBookingPicker,
} from "@/lib/data/bookings-repository";
import { createClient } from "@/utils/supabase/server";

import BookingsListView from "./components/bookings-list-view";

/**
 * Cross-group bookings ledger. A booking is still a child of its departure
 * group — this page only reads across every group so a booking can be found
 * without knowing its group first. Every mutation still happens inside the
 * booking detail dialog, which this page opens for any booking.
 */
export default async function BookingsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesFor(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const [bookings, groupOptions] = await Promise.all([
    listAllBookings(supabase, can),
    can.addBookings ? listOpenGroupsForBookingPicker(supabase) : Promise.resolve([]),
  ]);

  return <BookingsListView bookings={bookings} groupOptions={groupOptions} can={can} />;
}
